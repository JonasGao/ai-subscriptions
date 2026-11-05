package notify

import (
	"encoding/base64"
	"net/url"
	"testing"
)

// Port of __tests__/signing.test.ts (12 cases): DingTalk and Feishu webhook
// signing. Each test name maps 1:1 to the old file.
//
// The two schemes are mirror images of each other: DingTalk keys the HMAC with
// the secret and signs "timestamp\nsecret" (result URL-encoded into the query),
// Feishu keys the HMAC with "timestamp\nsecret" and signs the empty string
// (result standard-base64 into the JSON body).

// ── computeDingtalkSign (5 examples) ─────────────────────────────────────────

func TestDingtalkSign_ReturnsNullWhenSecretIsEmpty(t *testing.T) {
	if got := ComputeDingtalkSign("", 1700000000000); got != nil {
		t.Fatalf("ComputeDingtalkSign(empty) = %+v, want nil", got)
	}
	// "undefined" in JS maps to "" in Go.
	if got := ComputeDingtalkSign("", 1700000000000); got != nil {
		t.Fatalf("ComputeDingtalkSign(undefined) = %+v, want nil", got)
	}
}

func TestDingtalkSign_ProducesDeterministicSignForGivenSecretAndTimestamp(t *testing.T) {
	a := ComputeDingtalkSign("test-secret", 1700000000000)
	b := ComputeDingtalkSign("test-secret", 1700000000000)
	if a == nil || b == nil {
		t.Fatal("sign = nil, want a signature")
	}
	if a.Sign != b.Sign {
		t.Error("sign is not deterministic for the same (secret, timestamp)")
	}
	if a.Timestamp != 1700000000000 {
		t.Errorf("timestamp = %d, want 1700000000000", a.Timestamp)
	}
	if len(a.Sign) == 0 {
		t.Error("sign is empty string")
	}
}

func TestDingtalkSign_DifferentSecretsYieldDifferentSigns(t *testing.T) {
	a := ComputeDingtalkSign("secret-a", 1700000000000)
	b := ComputeDingtalkSign("secret-b", 1700000000000)
	if a == nil || b == nil {
		t.Fatal("sign = nil, want signatures")
	}
	if a.Sign == b.Sign {
		t.Error("different secrets produced the same sign")
	}
}

func TestDingtalkSign_DifferentTimestampsYieldDifferentSigns(t *testing.T) {
	a := ComputeDingtalkSign("secret", 1700000000000)
	b := ComputeDingtalkSign("secret", 1700000001000)
	if a == nil || b == nil {
		t.Fatal("sign = nil, want signatures")
	}
	if a.Sign == b.Sign {
		t.Error("different timestamps produced the same sign")
	}
}

func TestDingtalkSign_SignIsURLSafePercentEncoded(t *testing.T) {
	result := ComputeDingtalkSign("secret", 1700000000000)
	if result == nil {
		t.Fatal("sign = nil, want a signature")
	}

	// The sign output goes into a URL query param; url.QueryEscape ensures no
	// raw '+' or '/' leak through. The decoded form must be valid base64.
	decoded, err := url.QueryUnescape(result.Sign)
	if err != nil {
		t.Fatalf("unescape %q: %v", result.Sign, err)
	}
	if _, err := base64.StdEncoding.DecodeString(decoded); err != nil {
		t.Errorf("decoded sign %q is not base64: %v", decoded, err)
	}

	// And if the raw form had unsafe chars, it would differ from the decoded form.
	// url.QueryEscape encodes '+' as '%2B', '/' as '%2F', '=' as '%3D', so the
	// raw form must not contain raw '+', '/', or '='.
	for _, c := range result.Sign {
		if c == '+' || c == '/' || c == '=' {
			t.Errorf("sign contains unsafe char %q (raw=%q)", string(c), result.Sign)
		}
	}
}

// ── computeFeishuSign (7 examples) ───────────────────────────────────────────

func TestFeishuSign_ReturnsNullWhenSecretIsEmpty(t *testing.T) {
	// "undefined" in JS maps to "" in Go.
	if got := ComputeFeishuSign("", 1754300000); got != nil {
		t.Fatalf("ComputeFeishuSign(empty) = %+v, want nil", got)
	}
}

// Reference value generated via Node's crypto with the documented Feishu
// algorithm: key = `timestamp + "\n" + secret`, data = "".
//
//	key  = "1754300000\ntest-feishu-secret"
//	out  = base64(HMAC-SHA256(key, ""))
//	     = "TOjmNE0/gdXWiUBBctTQNdftMsBHtkNSOeswvkAA7FM="
func TestFeishuSign_MatchesOfficialFeishuSigningAlgorithm(t *testing.T) {
	result := ComputeFeishuSign("test-feishu-secret", 1754300000)
	if result == nil {
		t.Fatal("ComputeFeishuSign returned nil, want a signature")
	}
	if result.Timestamp != "1754300000" {
		t.Errorf("timestamp = %q, want \"1754300000\"", result.Timestamp)
	}
	if want := "TOjmNE0/gdXWiUBBctTQNdftMsBHtkNSOeswvkAA7FM="; result.Sign != want {
		t.Errorf("sign = %q, want %q", result.Sign, want)
	}
}

func TestFeishuSign_ReturnsTimestampAsString(t *testing.T) {
	result := ComputeFeishuSign("any-secret", 1754300000)
	if result == nil {
		t.Fatal("sign = nil, want a signature")
	}
	// In Go this is trivially a string (FeishuSign.Timestamp is string), but the
	// old test guards against accidental int return.
	if result.Timestamp == "" {
		t.Error("timestamp is empty")
	}
}

func TestFeishuSign_ProducesDeterministicOutput(t *testing.T) {
	a := ComputeFeishuSign("secret", 1754300000)
	b := ComputeFeishuSign("secret", 1754300000)
	if a == nil || b == nil {
		t.Fatal("sign = nil, want signatures")
	}
	if a.Sign != b.Sign || a.Timestamp != b.Timestamp {
		t.Error("sign is not deterministic for the same (secret, timestamp)")
	}
}

func TestFeishuSign_DifferentSecretsYieldDifferentSigns(t *testing.T) {
	a := ComputeFeishuSign("secret-a", 1754300000)
	b := ComputeFeishuSign("secret-b", 1754300000)
	if a == nil || b == nil {
		t.Fatal("sign = nil, want signatures")
	}
	if a.Sign == b.Sign {
		t.Error("different secrets produced the same sign")
	}
}

func TestFeishuSign_DifferentTimestampsYieldDifferentSigns(t *testing.T) {
	a := ComputeFeishuSign("secret", 1754300000)
	b := ComputeFeishuSign("secret", 1754300001)
	if a == nil || b == nil {
		t.Fatal("sign = nil, want signatures")
	}
	if a.Sign == b.Sign {
		t.Error("different timestamps produced the same sign")
	}
}

func TestFeishuSign_SignIsStandardBase64NotURLEncoded(t *testing.T) {
	// Unlike DingTalk, Feishu signs live in the JSON body and must be plain
	// base64 — raw '+' and '/' are allowed, and trailing '=' padding is kept.
	result := ComputeFeishuSign("secret", 1754300000)
	if result == nil {
		t.Fatal("sign = nil, want a signature")
	}
	// Must match standard base64 pattern: [A-Za-z0-9+/]+=*
	if _, err := base64.StdEncoding.DecodeString(result.Sign); err != nil {
		t.Errorf("sign %q is not standard base64: %v", result.Sign, err)
	}
}
