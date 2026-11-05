package providers

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ACS3 (Alibaba Cloud) request signing, ported from
// lib/providers/alibaba-tokenplan.ts. The canonical request and
// string-to-sign are constructed byte-for-byte so the hand-written signature
// matches the old stack.

// AcsSignConfig selects the request to sign. Method defaults to POST, DateISO
// to the current time (ISO 8601, no milliseconds) and Nonce to a random UUID.
type AcsSignConfig struct {
	AccessKeyID     string
	AccessKeySecret string
	Action          string
	Version         string
	Body            string
	Host            string
	Pathname        string
	Method          string
	QueryString     string
	// DateISO overrides the x-acs-date header (ISO 8601, no milliseconds).
	DateISO string
	// Nonce overrides x-acs-signature-nonce.
	Nonce string
}

// buildAcsCanonicalQuery ports buildAcsCanonicalQuery: array values expand to
// `Key.1=v1&Key.2=v2`, empty/nil values are skipped, pairs sort by key, and
// both sides are RFC 3986 percent-encoded.
func buildAcsCanonicalQuery(params map[string]any) string {
	type pair struct{ key, value string }
	pairs := make([]pair, 0, len(params))
	for key, value := range params {
		switch v := value.(type) {
		case nil:
			continue
		case string:
			if v == "" {
				continue
			}
			pairs = append(pairs, pair{key, v})
		case []string:
			for i, elem := range v {
				if elem == "" {
					continue
				}
				pairs = append(pairs, pair{fmt.Sprintf("%s.%d", key, i+1), elem})
			}
		case []any:
			for i, elem := range v {
				s := acsString(elem)
				if s == "" {
					continue
				}
				pairs = append(pairs, pair{fmt.Sprintf("%s.%d", key, i+1), s})
			}
		default:
			pairs = append(pairs, pair{key, acsString(v)})
		}
	}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i].key < pairs[j].key })

	var b strings.Builder
	for i, p := range pairs {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(encodeRFC3986(p.key))
		b.WriteByte('=')
		b.WriteString(encodeRFC3986(p.value))
	}
	return b.String()
}

// acsString mirrors JS String(value) for the scalar shapes query params use.
func acsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return formatJSFloat(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprint(x)
	}
}

// signAcsRequest ports signAcsRequest. It returns headers including
// authorization (ACS3-HMAC-SHA256), x-acs-action, x-acs-version, x-acs-date,
// x-acs-signature-nonce, x-acs-content-sha256, content-type and host.
func signAcsRequest(cfg AcsSignConfig) map[string]string {
	method := cfg.Method
	if method == "" {
		method = http.MethodPost
	}
	dateISO := cfg.DateISO
	if dateISO == "" {
		dateISO = time.Now().UTC().Format("2006-01-02T15:04:05Z")
	}
	nonce := cfg.Nonce
	if nonce == "" {
		nonce = newSignatureNonce()
	}
	hashedBody := sha256Hex(cfg.Body)

	headers := map[string]string{
		"host":                  cfg.Host,
		"x-acs-action":          cfg.Action,
		"x-acs-version":         cfg.Version,
		"x-acs-date":            dateISO,
		"x-acs-signature-nonce": nonce,
		"x-acs-content-sha256":  hashedBody,
		"content-type":          "application/json",
	}

	signedHeaderKeys := make([]string, 0, len(headers))
	for key := range headers {
		if key == "host" || key == "content-type" || strings.HasPrefix(key, "x-acs-") {
			signedHeaderKeys = append(signedHeaderKeys, key)
		}
	}
	sort.Strings(signedHeaderKeys)

	var canonicalHeaders strings.Builder
	for _, key := range signedHeaderKeys {
		canonicalHeaders.WriteString(key)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(headers[key])
		canonicalHeaders.WriteByte('\n')
	}
	signedHeadersStr := strings.Join(signedHeaderKeys, ";")

	canonicalRequest := strings.Join([]string{
		method,
		cfg.Pathname,
		cfg.QueryString,
		canonicalHeaders.String(),
		signedHeadersStr,
		hashedBody,
	}, "\n")

	const algorithm = "ACS3-HMAC-SHA256"
	hashedCanonical := sha256Hex(canonicalRequest)
	stringToSign := algorithm + "\n" + hashedCanonical
	signature := hmacSHA256Hex(cfg.AccessKeySecret, stringToSign)

	headers["authorization"] = algorithm + " Credential=" + cfg.AccessKeyID +
		",SignedHeaders=" + signedHeadersStr +
		",Signature=" + signature
	return headers
}

// newSignatureNonce returns a random RFC 4122 v4 UUID.
func newSignatureNonce() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// Practically unreachable; fall back to a time-derived value rather
		// than failing to sign.
		now := time.Now().UnixNano()
		for i := 0; i < 8; i++ {
			b[i] = byte(now >> (8 * i))
			b[8+i] = byte(now >> (8 * i))
		}
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// encodeRFC3986 matches JS encodeURIComponent with the additional
// !'()* → %XX escapes (the old stack's encodeRFC3986 helper): everything
// except A-Z a-z 0-9 - _ . ~ is percent-encoded, uppercase hex.
func encodeRFC3986(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
			(c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteString(strings.ToUpper(hex.EncodeToString([]byte{c})))
	}
	return b.String()
}

func sha256Hex(data string) string {
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

func hmacSHA256Hex(key, data string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

// ── Token Plan usage ────────────────────────────────────────────────────────

const (
	tokenPlanDefaultHost = "modelstudio.cn-beijing.aliyuncs.com"
	tokenPlanAPIPath     = "/tokenplan/subscription/seat-detail"
	tokenPlanAPIAction   = "GetSubscriptionSeatDetails"
	tokenPlanAPIVersion  = "2026-02-10"
)

type tokenPlanSeatEquity struct {
	EquityType        *string  `json:"EquityType"`
	CycleInstanceID   *string  `json:"CycleInstanceId"`
	CycleStartTime    *float64 `json:"CycleStartTime"`
	CycleEndTime      *float64 `json:"CycleEndTime"`
	CycleTotalValue   *float64 `json:"CycleTotalValue"`
	CycleSurplusValue *float64 `json:"CycleSurplusValue"`
	CycleVersion      *float64 `json:"CycleVersion"`
}

type tokenPlanSeatDetail struct {
	InstanceCode   *string               `json:"InstanceCode"`
	EquityList     []tokenPlanSeatEquity `json:"EquityList"`
	EndTime        *float64              `json:"EndTime"`
	SeatID         *string               `json:"SeatId"`
	SpecType       *string               `json:"SpecType"`
	StartTime      *float64              `json:"StartTime"`
	AssignedStatus *string               `json:"AssignedStatus"`
	AccountID      *string               `json:"AccountId"`
	AccountName    *string               `json:"AccountName"`
	AccountEmail   *string               `json:"AccountEmail"`
	Status         *string               `json:"Status"`
}

type tokenPlanSeatDetailsData struct {
	Items    []tokenPlanSeatDetail `json:"Items"`
	Total    *float64              `json:"Total"`
	PageNo   *float64              `json:"PageNo"`
	PageSize *float64              `json:"PageSize"`
}

type tokenPlanSeatDetailsResponse struct {
	Success *bool                     `json:"Success"`
	Code    *string                   `json:"Code"`
	Message *string                   `json:"Message"`
	Data    *tokenPlanSeatDetailsData `json:"Data"`
}

type tokenPlanUsageHandler struct{ client HTTPDoer }

func (h *tokenPlanUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	return FetchTokenPlanUsage(ctx, h.client, credentials)
}

func (h *tokenPlanUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testTokenPlanConnection(ctx, h.client, credentials)
}

// FetchTokenPlanUsage ports fetchTokenPlanUsage: sign an ACS3 GET to the
// seat-detail endpoint, bucket each equity into a usage window by its cycle
// duration, and keep the highest-limit equity per slot.
func FetchTokenPlanUsage(ctx context.Context, client HTTPDoer, credentials map[string]string) (UsageResult, error) {
	ak, sk := credentials["ak"], credentials["sk"]
	if ak == "" || sk == "" {
		return UsageResult{}, fmt.Errorf("AK/SK not configured")
	}
	workspaceID := credentials["workspaceId"]
	if workspaceID == "" {
		return UsageResult{}, fmt.Errorf("WorkspaceId not configured")
	}
	host := credentials["host"]
	if host == "" {
		host = tokenPlanDefaultHost
	}

	queryString := buildAcsCanonicalQuery(map[string]any{
		"WorkspaceId": workspaceID,
		"NamespaceId": "namespace-1",
	})
	headers := signAcsRequest(AcsSignConfig{
		AccessKeyID:     ak,
		AccessKeySecret: sk,
		Action:          tokenPlanAPIAction,
		Version:         tokenPlanAPIVersion,
		Body:            "",
		Host:            host,
		Pathname:        tokenPlanAPIPath,
		Method:          http.MethodGet,
		QueryString:     queryString,
	})

	endpoint := "https://" + host + tokenPlanAPIPath + "?" + queryString
	response, err := doTokenPlanRequest(ctx, client, endpoint, headers)
	if err != nil {
		return UsageResult{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.ReadAll(response.Body)
		return UsageResult{}, fmt.Errorf("TokenPlan usage API returned %d", response.StatusCode)
	}

	var data tokenPlanSeatDetailsResponse
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return UsageResult{}, err
	}

	if data.Success == nil || !*data.Success || data.Data == nil || len(data.Data.Items) == 0 {
		code, message := "", ""
		if data.Code != nil {
			code = *data.Code
		}
		if data.Message != nil {
			message = *data.Message
		}
		return UsageResult{}, fmt.Errorf("No active TokenPlan seats: %s", strings.TrimSpace(code+" "+message))
	}

	var fiveHour, weekly, monthly *UsageWindow
	for i := range data.Data.Items {
		seat := &data.Data.Items[i]
		for j := range seat.EquityList {
			equity := &seat.EquityList[j]
			window := tokenPlanToUsageWindow(equity)
			if window == nil {
				continue
			}
			switch tokenPlanClassifyCycle(equity) {
			case "fiveHour":
				fiveHour = pickHigherWindow(fiveHour, window)
			case "weekly":
				weekly = pickHigherWindow(weekly, window)
			case "monthly":
				monthly = pickHigherWindow(monthly, window)
			}
		}
	}

	return UsageResult{
		Provider: "alibaba",
		FiveHour: fiveHour,
		Weekly:   weekly,
		Monthly:  monthly,
	}, nil
}

// testTokenPlanConnection ports testTokenPlanConnection. It never returns an
// error: every failure becomes {ok:false, message}.
func testTokenPlanConnection(ctx context.Context, client HTTPDoer, credentials map[string]string) (ConnectionResult, error) {
	ak, sk := credentials["ak"], credentials["sk"]
	if ak == "" || sk == "" {
		return ConnectionResult{OK: false, Message: "AK/SK 未配置"}, nil
	}
	workspaceID := credentials["workspaceId"]
	if workspaceID == "" {
		return ConnectionResult{OK: false, Message: "Workspace ID 未配置"}, nil
	}
	host := credentials["host"]
	if host == "" {
		host = tokenPlanDefaultHost
	}

	queryString := buildAcsCanonicalQuery(map[string]any{
		"WorkspaceId": workspaceID,
		"NamespaceId": "namespace-1",
		"PageSize":    1,
	})
	headers := signAcsRequest(AcsSignConfig{
		AccessKeyID:     ak,
		AccessKeySecret: sk,
		Action:          tokenPlanAPIAction,
		Version:         tokenPlanAPIVersion,
		Body:            "",
		Host:            host,
		Pathname:        tokenPlanAPIPath,
		Method:          http.MethodGet,
		QueryString:     queryString,
	})

	endpoint := "https://" + host + tokenPlanAPIPath + "?" + queryString
	response, err := doTokenPlanRequest(ctx, client, endpoint, headers)
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ConnectionResult{OK: false, Message: fmt.Sprintf("API 返回 %d", response.StatusCode)}, nil
	}

	var data tokenPlanSeatDetailsResponse
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	if data.Success == nil || !*data.Success {
		message := "API 返回失败"
		if data.Message != nil {
			message = *data.Message
		}
		return ConnectionResult{OK: false, Message: message}, nil
	}

	total := 0.0
	if data.Data != nil && data.Data.Total != nil {
		total = *data.Data.Total
	}
	if total > 0 {
		return ConnectionResult{OK: true, Message: "已订阅 (" + formatJSFloat(total) + " 个席位)"}, nil
	}
	return ConnectionResult{OK: false, Message: "未检测到 Token Plan 订阅"}, nil
}

func doTokenPlanRequest(ctx context.Context, client HTTPDoer, endpoint string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		if strings.EqualFold(key, "host") {
			req.Host = value
			continue
		}
		req.Header.Set(key, value)
	}
	return client.Do(req)
}

// tokenPlanToUsageWindow ports toUsageWindow: a missing/zero limit yields nil;
// resetTime is only set for a truthy CycleEndTime.
func tokenPlanToUsageWindow(equity *tokenPlanSeatEquity) *UsageWindow {
	if equity.CycleTotalValue == nil || *equity.CycleTotalValue <= 0 {
		return nil
	}
	limit := *equity.CycleTotalValue
	remaining := 0.0
	if equity.CycleSurplusValue != nil {
		remaining = *equity.CycleSurplusValue
	}
	used := limit - remaining
	if used < 0 {
		used = 0
	}

	var resetTime *string
	if equity.CycleEndTime != nil && *equity.CycleEndTime != 0 {
		iso := time.UnixMilli(int64(*equity.CycleEndTime)).UTC().Format("2006-01-02T15:04:05.000Z")
		resetTime = &iso
	}

	return &UsageWindow{
		Used:      formatJSFloat(used),
		Limit:     formatJSFloat(limit),
		Remaining: formatJSFloat(remaining),
		ResetTime: resetTime,
	}
}

// tokenPlanClassifyCycle ports classifyCycle: <30h → fiveHour, <240h →
// weekly, else monthly. Missing or non-positive timestamps fall back to
// fiveHour.
func tokenPlanClassifyCycle(equity *tokenPlanSeatEquity) string {
	if equity.CycleStartTime == nil || equity.CycleEndTime == nil {
		return "fiveHour"
	}
	durationMs := *equity.CycleEndTime - *equity.CycleStartTime
	if math.IsNaN(durationMs) || math.IsInf(durationMs, 0) || durationMs <= 0 {
		return "fiveHour"
	}
	hours := durationMs / (1000 * 60 * 60)
	if hours < 30 {
		return "fiveHour"
	}
	if hours < 240 {
		return "weekly"
	}
	return "monthly"
}

// pickHigherWindow ports pickHigher: when several equities map to the same
// slot, keep the one with the higher limit (primary vs. add-on).
func pickHigherWindow(current, candidate *UsageWindow) *UsageWindow {
	if current == nil {
		return candidate
	}
	candidateLimit, _ := strconv.ParseFloat(candidate.Limit, 64)
	currentLimit, _ := strconv.ParseFloat(current.Limit, 64)
	if candidateLimit > currentLimit {
		return candidate
	}
	return current
}
