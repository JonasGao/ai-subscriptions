package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Port of lib/providers/github.ts (ticket #32): Copilot usage query, credential
// test, PAT → short-lived Copilot token exchange, and the model list.
const (
	githubUsageURL         = "https://api.github.com/copilot_internal/user"
	githubTokenExchangeURL = "https://api.github.com/copilot_internal/v2/token"
	githubModelsURL        = "https://api.githubcopilot.com/models"
)

// githubUsageHandler implements UsageHandler for the bare "github" key.
type githubUsageHandler struct{ client HTTPDoer }

func (h *githubUsageHandler) FetchUsage(ctx context.Context, credentials map[string]string) (UsageResult, error) {
	return FetchGithubUsage(ctx, h.client, credentials)
}

func (h *githubUsageHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testGithubConnection(ctx, h.client, credentials)
}

// FetchGithubUsage ports fetchGithubUsage. Only premium_interactions maps to a
// window (monthly); chat/completions snapshots are intentionally ignored.
func FetchGithubUsage(ctx context.Context, client HTTPDoer, credentials map[string]string) (UsageResult, error) {
	token := credentials["token"]
	if token == "" {
		return UsageResult{}, fmt.Errorf("Token 未配置")
	}

	response, err := doGithubGET(ctx, client, githubUsageURL, map[string]string{
		"Authorization":        "token " + token,
		"Accept":               "application/json",
		"Editor-Version":       "vscode/1.96.2",
		"X-Github-Api-Version": "2025-04-01",
	})
	if err != nil {
		return UsageResult{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return UsageResult{}, fmt.Errorf("Copilot usage API returned %d", response.StatusCode)
	}

	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return UsageResult{}, err
	}

	snapshots, _ := payload["quota_snapshots"].(map[string]any)
	var premium any
	if snapshots != nil {
		premium = snapshots["premium_interactions"]
	}

	return UsageResult{
		Provider: "github",
		Monthly:  githubMonthlyWindow(premium, payload["quota_reset_date"]),
	}, nil
}

// githubMonthlyWindow ports toMonthlyWindow: missing/non-positive entitlement
// means "no monthly data" (null).
func githubMonthlyWindow(snapshot any, resetDate any) *UsageWindow {
	record, ok := snapshot.(map[string]any)
	if !ok {
		return nil
	}
	entitlement, ok := jsNumber(record["entitlement"])
	if !ok || entitlement <= 0 {
		return nil
	}

	remaining := 0.0
	if value, ok := jsNumber(record["remaining"]); ok {
		remaining = value
	}
	used := entitlement - remaining
	if used < 0 {
		used = 0
	}

	return &UsageWindow{
		Limit:     formatJSFloat(entitlement),
		Used:      formatJSFloat(used),
		Remaining: formatJSFloat(remaining),
		ResetTime: githubResetTime(resetDate),
	}
}

// githubResetTime mirrors new Date(value).toISOString() with a null fallback
// for absent/invalid values. Numeric values are epoch milliseconds.
func githubResetTime(value any) *string {
	var parsed time.Time
	switch v := value.(type) {
	case string:
		formats := []string{time.RFC3339Nano, "2006-01-02T15:04:05Z0700", "2006-01-02"}
		found := false
		for _, format := range formats {
			if ts, err := time.Parse(format, v); err == nil {
				parsed = ts.UTC()
				found = true
				break
			}
		}
		if !found {
			return nil
		}
	case float64:
		parsed = time.UnixMilli(int64(v)).UTC()
	case json.Number:
		ms, err := v.Float64()
		if err != nil {
			return nil
		}
		parsed = time.UnixMilli(int64(ms)).UTC()
	default:
		return nil
	}
	iso := parsed.UTC().Format("2006-01-02T15:04:05.000Z")
	return &iso
}

// TestGithubConnection ports testGithubConnection: 401 means the PAT itself is
// invalid or expired; 403/404 means the endpoint rejected the token type.
func testGithubConnection(ctx context.Context, client HTTPDoer, credentials map[string]string) (ConnectionResult, error) {
	token := credentials["token"]
	if token == "" {
		return ConnectionResult{OK: false, Message: "Token 未配置"}, nil
	}

	response, err := doGithubGET(ctx, client, githubUsageURL, map[string]string{
		"Authorization":        "token " + token,
		"Accept":               "application/json",
		"Editor-Version":       "vscode/1.96.2",
		"X-Github-Api-Version": "2025-04-01",
	})
	if err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	defer response.Body.Close()

	switch response.StatusCode {
	case http.StatusUnauthorized:
		return ConnectionResult{OK: false, Message: "Token 无效或已过期"}, nil
	case http.StatusForbidden, http.StatusNotFound:
		return ConnectionResult{OK: false, Message: "接口拒绝请求(可能不支持该 token 类型)"}, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ConnectionResult{OK: false, Message: fmt.Sprintf("API 返回 %d", response.StatusCode)}, nil
	}

	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return ConnectionResult{OK: false, Message: err.Error()}, nil
	}
	if payload["quota_snapshots"] == nil {
		return ConnectionResult{OK: false, Message: "响应缺少 quota_snapshots"}, nil
	}
	return ConnectionResult{OK: true, Message: "已配置"}, nil
}

func doGithubGET(ctx context.Context, client HTTPDoer, url string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return client.Do(req)
}

// --- Copilot token exchange cache ---

// githubTokenCache is the module-level PAT → Copilot token cache. It is keyed
// by PAT so subscriptions never share a token, and invalidates five minutes
// before expiry, matching the old stack.
type githubTokenCache struct {
	mu        sync.Mutex
	pat       string
	token     string
	expiresAt int64
}

var defaultGithubTokenCache = &githubTokenCache{}

func (c *githubTokenCache) get(pat string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pat == pat && c.token != "" && time.Now().UnixMilli() < c.expiresAt-5*60*1000 {
		return c.token, true
	}
	return "", false
}

func (c *githubTokenCache) set(pat, token string, expiresAt int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pat = pat
	c.token = token
	c.expiresAt = expiresAt
}

func (c *githubTokenCache) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pat = ""
	c.token = ""
	c.expiresAt = 0
}

func exchangeGithubToken(ctx context.Context, client HTTPDoer, cache *githubTokenCache, pat string) (string, error) {
	if token, ok := cache.get(pat); ok {
		return token, nil
	}

	response, err := doGithubGET(ctx, client, githubTokenExchangeURL, map[string]string{
		"Authorization":  "token " + pat,
		"Accept":         "application/json",
		"Editor-Version": "vscode/1.96.2",
	})
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("Token exchange API returned %d", response.StatusCode)
	}

	var payload struct {
		Token     string  `json:"token"`
		ExpiresAt float64 `json:"expires_at"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return "", err
	}

	cache.set(pat, payload.Token, int64(payload.ExpiresAt))
	return payload.Token, nil
}

// githubModelsHandler implements the exception handler for the bare "github"
// key: the models endpoint requires a short-lived Copilot token rather than the
// stored PAT.
type githubModelsHandler struct{ client HTTPDoer }

func (h githubModelsHandler) FetchModels(ctx context.Context, credentials map[string]string) ([]string, error) {
	return FetchGithubModels(ctx, h.client, credentials)
}

// FetchGithubModels ports fetchGithubModels: exchange the PAT, query
// /models, and keep enabled chat models only (exclude embeddings).
func FetchGithubModels(ctx context.Context, client HTTPDoer, credentials map[string]string) ([]string, error) {
	return fetchGithubModelsWithCache(ctx, client, defaultGithubTokenCache, credentials)
}

func fetchGithubModelsWithCache(ctx context.Context, client HTTPDoer, cache *githubTokenCache, credentials map[string]string) ([]string, error) {
	pat := credentials["token"]
	if pat == "" {
		return nil, fmt.Errorf("Token 未配置")
	}

	copilotToken, err := exchangeGithubToken(ctx, client, cache, pat)
	if err != nil {
		return nil, err
	}

	response, err := doGithubGET(ctx, client, githubModelsURL, map[string]string{
		"Authorization": "Bearer " + copilotToken,
		"Accept":        "application/json",
	})
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("Copilot models API returned %d", response.StatusCode)
	}

	var payload struct {
		Data []struct {
			ID           *string `json:"id"`
			Capabilities *struct {
				Type string `json:"type"`
			} `json:"capabilities"`
			Policy *struct {
				State string `json:"state"`
			} `json:"policy"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}

	models := make([]string, 0, len(payload.Data))
	for _, model := range payload.Data {
		if model.ID == nil {
			continue
		}
		if model.Policy == nil || model.Policy.State != "enabled" {
			continue
		}
		if model.Capabilities == nil || model.Capabilities.Type != "chat" {
			continue
		}
		models = append(models, *model.ID)
	}
	return models, nil
}
