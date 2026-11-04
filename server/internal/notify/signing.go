package notify

// Webhook signing, ported from lib/notifications/signing.ts. The two schemes
// are mirror images of each other: DingTalk keys the HMAC with the secret and
// signs "timestamp\nsecret" (result in the URL query), Feishu keys the HMAC
// with "timestamp\nsecret" and signs the empty string (result in the JSON
// body). Getting this backwards silently breaks the channel, so each scheme is
// pinned by its own test.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strconv"
)

// DingtalkSign is the (timestamp, sign) pair appended to a DingTalk bot URL.
type DingtalkSign struct {
	Timestamp int64
	// Sign is URL-encoded base64, ready to drop into a query string.
	Sign string
}

// FeishuSign is the (timestamp, sign) pair carried in a Feishu bot body.
type FeishuSign struct {
	// Timestamp is unix seconds as a string (Feishu's convention).
	Timestamp string
	Sign      string
}

// ComputeDingtalkSign signs timestampMs with secret, returning nil when the
// channel has no secret (keyword security mode).
func ComputeDingtalkSign(secret string, timestampMs int64) *DingtalkSign {
	if secret == "" {
		return nil
	}
	timestamp := strconv.FormatInt(timestampMs, 10)
	mac := hmacSHA256([]byte(secret), []byte(timestamp+"\n"+secret))
	return &DingtalkSign{
		Timestamp: timestampMs,
		Sign:      url.QueryEscape(base64.StdEncoding.EncodeToString(mac)),
	}
}

// ComputeFeishuSign signs the empty string with the key "timestamp\nsecret",
// returning nil when the channel has no secret.
func ComputeFeishuSign(secret string, timestampSec int64) *FeishuSign {
	if secret == "" {
		return nil
	}
	timestamp := strconv.FormatInt(timestampSec, 10)
	mac := hmacSHA256([]byte(timestamp+"\n"+secret), nil)
	return &FeishuSign{
		Timestamp: timestamp,
		Sign:      base64.StdEncoding.EncodeToString(mac),
	}
}

func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}
