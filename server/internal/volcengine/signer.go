// Package volcengine signs Volcengine (Ark) API requests with the V4
// HMAC-SHA256 scheme.
//
// Port of lib/volcengine-signer.ts. The exhaustive signature-string parity
// cases (__tests__/signing.test.ts, __tests__/volcengine-signer.test.ts) belong
// to the fangzhou ticket (#30); this port exists because the provider usage
// handlers registered by #25 must issue signed requests.
package volcengine

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strings"
	"time"
)

// SignOptions selects the request to sign. Region/Service default to
// "cn-beijing"/"ark" and Now defaults to time.Now.
type SignOptions struct {
	Method  string
	URL     string
	Body    string
	AK      string
	SK      string
	Region  string
	Service string
	Now     time.Time
}

// Sign returns the headers to send: Content-Type, Host, X-Content-Sha256,
// X-Date and Authorization.
func Sign(opts SignOptions) map[string]string {
	region := opts.Region
	if region == "" {
		region = "cn-beijing"
	}
	service := opts.Service
	if service == "" {
		service = "ark"
	}
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()

	parsed, err := url.Parse(opts.URL)
	if err != nil {
		parsed = &url.URL{Path: opts.URL}
	}
	host := parsed.Host
	canonicalURI := parsed.Path
	if canonicalURI == "" {
		canonicalURI = "/"
	}
	canonicalQuery := canonicalQueryString(parsed.RawQuery)

	xDate := formatXDate(now)
	dateStamp := formatDate(now)
	credentialScope := dateStamp + "/" + region + "/" + service + "/request"
	hashedPayload := sha256Hex(opts.Body)

	// Mirrors the official SDK: content-type is unsignable, kDatePrefix is
	// "", signed headers sorted alphabetically.
	headersToSign := [][2]string{
		{"host", host},
		{"x-content-sha256", hashedPayload},
		{"x-date", xDate},
	}
	sort.Slice(headersToSign, func(i, j int) bool { return headersToSign[i][0] < headersToSign[j][0] })

	var canonicalHeaders strings.Builder
	signedHeaderNames := make([]string, 0, len(headersToSign))
	for _, header := range headersToSign {
		canonicalHeaders.WriteString(header[0] + ":" + header[1] + "\n")
		signedHeaderNames = append(signedHeaderNames, header[0])
	}
	signedHeaders := strings.Join(signedHeaderNames, ";")

	canonicalRequest := strings.Join([]string{
		strings.ToUpper(opts.Method),
		canonicalURI,
		canonicalQuery,
		canonicalHeaders.String(),
		signedHeaders,
		hashedPayload,
	}, "\n")

	stringToSign := strings.Join([]string{
		"HMAC-SHA256",
		xDate,
		credentialScope,
		sha256Hex(canonicalRequest),
	}, "\n")

	dateKey := hmacSHA256([]byte(opts.SK), dateStamp)
	regionKey := hmacSHA256(dateKey, region)
	serviceKey := hmacSHA256(regionKey, service)
	signingKey := hmacSHA256(serviceKey, "request")
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))

	authorization := "HMAC-SHA256 Credential=" + opts.AK + "/" + credentialScope +
		", SignedHeaders=" + signedHeaders + ", Signature=" + signature

	return map[string]string{
		"Content-Type":     "application/json",
		"Host":             host,
		"X-Content-Sha256": hashedPayload,
		"X-Date":           xDate,
		"Authorization":    authorization,
	}
}

// canonicalQueryString ports the old stack's implementation: split the raw
// query on "&", sort the raw "k=v" pairs, then percent-encode both sides
// (encodeURIComponent semantics).
func canonicalQueryString(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	parts := strings.Split(rawQuery, "&")
	sort.Strings(parts)

	encoded := make([]string, 0, len(parts))
	for _, part := range parts {
		key, value, _ := strings.Cut(part, "=")
		encoded = append(encoded, encodeURIComponent(key)+"="+encodeURIComponent(value))
	}
	return strings.Join(encoded, "&")
}

// encodeURIComponent matches JS encodeURIComponent for the ASCII parameters
// used by Volcengine's signed actions: space becomes %20 (not "+") and the
// unreserved set stays literal.
func encodeURIComponent(s string) string {
	escaped := url.QueryEscape(s)
	return strings.ReplaceAll(escaped, "+", "%20")
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

func sha256Hex(data string) string {
	sum := sha256.Sum256([]byte(data))
	return hex.EncodeToString(sum[:])
}

func formatDate(t time.Time) string {
	return t.Format("20060102")
}

func formatXDate(t time.Time) string {
	return t.Format("20060102T150405Z")
}
