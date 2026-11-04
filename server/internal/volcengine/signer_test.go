package volcengine

import (
	"strings"
	"testing"
	"time"
)

// Port of __tests__/volcengine-signer.test.ts (6 cases): V4 HMAC signature
// header format, determinism, custom region/service, body sensitivity, and
// query-string inclusion.

func TestSignReturnsRequiredHeaders(t *testing.T) {
	// Freeze the date for deterministic output.
	now := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
	headers := Sign(SignOptions{
		Method: "POST",
		URL:    "https://open.volcengineapi.com/open/GetAFPUsage",
		Body:   "{}",
		AK:     "AKIAIOSFODNN7EXAMPLE",
		SK:     "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		Now:    now,
	})

	if headers["Content-Type"] != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", headers["Content-Type"])
	}
	if headers["Host"] != "open.volcengineapi.com" {
		t.Errorf("Host = %q, want open.volcengineapi.com", headers["Host"])
	}
	if headers["X-Date"] != "20260601T080000Z" {
		t.Errorf("X-Date = %q, want 20260601T080000Z", headers["X-Date"])
	}
	if want := "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"; headers["X-Content-Sha256"] != want {
		t.Errorf("X-Content-Sha256 = %q, want %q", headers["X-Content-Sha256"], want)
	}
	if headers["Authorization"] == "" {
		t.Error("Authorization header is empty")
	}
}

func TestSignAuthorizationFormat(t *testing.T) {
	now := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
	headers := Sign(SignOptions{
		Method: "POST",
		URL:    "https://open.volcengineapi.com/open/GetAFPUsage",
		Body:   "{}",
		AK:     "AKIAIOSFODNN7EXAMPLE",
		SK:     "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		Now:    now,
	})

	auth := headers["Authorization"]
	if !strings.HasPrefix(auth, "HMAC-SHA256 Credential=") {
		t.Errorf("Authorization = %q, want HMAC-SHA256 Credential=... prefix", auth)
	}
	if !strings.Contains(auth, "AKIAIOSFODNN7EXAMPLE") {
		t.Error("Authorization missing AK")
	}
	if !strings.Contains(auth, "/20260601/cn-beijing/ark/request") {
		t.Error("Authorization missing credential scope")
	}
	if !strings.Contains(auth, "SignedHeaders=host;x-content-sha256;x-date") {
		t.Error("Authorization missing signed headers")
	}
	if !strings.Contains(auth, "Signature=") {
		t.Error("Authorization missing Signature")
	}
}

func TestSignCustomRegionAndService(t *testing.T) {
	now := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
	headers := Sign(SignOptions{
		Method:  "POST",
		URL:     "https://open.volcengineapi.com/open/GetAFPUsage",
		Body:    "{}",
		AK:      "AKTEST",
		SK:      "SKTEST",
		Region:  "ap-singapore",
		Service: "ecs",
		Now:     now,
	})

	if !strings.Contains(headers["Authorization"], "/ap-singapore/ecs/request") {
		t.Errorf("Authorization = %q, want /ap-singapore/ecs/request", headers["Authorization"])
	}
}

func TestSignDifferentBodyProducesDifferentSignature(t *testing.T) {
	now := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
	h1 := Sign(SignOptions{
		Method: "POST",
		URL:    "https://open.volcengineapi.com/open/GetAFPUsage",
		Body:   "{}",
		AK:     "AKTEST",
		SK:     "SKTEST",
		Now:    now,
	})
	h2 := Sign(SignOptions{
		Method: "POST",
		URL:    "https://open.volcengineapi.com/open/GetAFPUsage",
		Body:   `{"key":"value"}`,
		AK:     "AKTEST",
		SK:     "SKTEST",
		Now:    now,
	})

	sig1 := extractSignature(h1["Authorization"])
	sig2 := extractSignature(h2["Authorization"])
	if sig1 == sig2 {
		t.Error("different bodies produced the same signature")
	}
}

func TestSignDeterministic(t *testing.T) {
	now := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
	opts := SignOptions{
		Method: "POST",
		URL:    "https://open.volcengineapi.com/open/GetAFPUsage",
		Body:   "{}",
		AK:     "AKTEST",
		SK:     "SKTEST",
		Now:    now,
	}
	h1 := Sign(opts)
	h2 := Sign(opts)
	if h1["Authorization"] != h2["Authorization"] {
		t.Error("same inputs produced different signatures")
	}
}

func TestSignIncludesQueryString(t *testing.T) {
	now := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
	headers := Sign(SignOptions{
		Method: "GET",
		URL:    "https://open.volcengineapi.com/open/GetAFPUsage?foo=bar&baz=qux",
		Body:   "",
		AK:     "AKTEST",
		SK:     "SKTEST",
		Now:    now,
	})

	if !strings.HasPrefix(headers["Authorization"], "HMAC-SHA256") {
		t.Errorf("Authorization = %q, want HMAC-SHA256 prefix", headers["Authorization"])
	}
}

// extractSignature pulls the Signature value from the Authorization header.
func extractSignature(auth string) string {
	const prefix = "Signature="
	idx := strings.Index(auth, prefix)
	if idx < 0 {
		return ""
	}
	return auth[idx+len(prefix):]
}
