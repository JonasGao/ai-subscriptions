package notify

import (
	"encoding/base64"
	"net/url"
	"testing"
)

// Signing behaviour ported from lib/notifications/signing.ts, needed by the
// channel test-send endpoint (#37). The dedicated signing.test.ts parity row is
// owned by another ticket; these cases lock the parts #37 puts on the wire.

func TestDingtalkSignReturnsNilWithoutSecret(t *testing.T) {
	if sign := ComputeDingtalkSign("", 1700000000000); sign != nil {
		t.Fatalf("sign = %+v, want nil", sign)
	}
}

func TestDingtalkSignIsDeterministicAndTimestamped(t *testing.T) {
	a := ComputeDingtalkSign("test-secret", 1700000000000)
	b := ComputeDingtalkSign("test-secret", 1700000000000)
	if a == nil || b == nil {
		t.Fatal("sign = nil, want a signature")
	}
	if a.Timestamp != 1700000000000 {
		t.Errorf("timestamp = %d, want 1700000000000", a.Timestamp)
	}
	if a.Sign != b.Sign {
		t.Error("sign is not deterministic for the same (secret, timestamp)")
	}
}

func TestDingtalkSignVariesWithSecretAndTimestamp(t *testing.T) {
	a := ComputeDingtalkSign("secret-a", 1700000000000)
	b := ComputeDingtalkSign("secret-b", 1700000000000)
	c := ComputeDingtalkSign("secret-a", 1700000001000)
	if a.Sign == b.Sign {
		t.Error("different secrets produced the same sign")
	}
	if a.Sign == c.Sign {
		t.Error("different timestamps produced the same sign")
	}
}

func TestDingtalkSignIsURLEncodedBase64(t *testing.T) {
	sign := ComputeDingtalkSign("secret", 1700000000000)
	decoded, err := url.QueryUnescape(sign.Sign)
	if err != nil {
		t.Fatalf("unescape %q: %v", sign.Sign, err)
	}
	if _, err := base64.StdEncoding.DecodeString(decoded); err != nil {
		t.Errorf("decoded sign %q is not base64: %v", decoded, err)
	}
}

func TestFeishuSignUsesTimestampAsHMACKey(t *testing.T) {
	if sign := ComputeFeishuSign("", 1700000000); sign != nil {
		t.Fatalf("sign = %+v, want nil", sign)
	}

	sign := ComputeFeishuSign("feishu-secret", 1700000000)
	if sign == nil {
		t.Fatal("sign = nil, want a signature")
	}
	if sign.Timestamp != "1700000000" {
		t.Errorf("timestamp = %q, want the seconds string", sign.Timestamp)
	}

	// The Feishu convention is the opposite orientation of DingTalk: the key
	// is "timestamp\nsecret" and the signed data is the empty string. The
	// result is plain base64 because it lives in the JSON body.
	mac := hmacSHA256([]byte("1700000000\nfeishu-secret"), nil)
	if want := base64.StdEncoding.EncodeToString(mac); sign.Sign != want {
		t.Errorf("sign = %q, want %q", sign.Sign, want)
	}
}
