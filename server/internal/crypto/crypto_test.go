package crypto

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

// nodeVectors is produced by ../scripts/gen-node-vectors.mjs, which mirrors
// the old stack's lib/encryption.ts line for line. Keeping it committed makes
// the "Node encrypts, Go decrypts" direction part of the always-on suite.
type nodeVector struct {
	Secret       string `json:"secret"`
	KeyHex       string `json:"keyHex"`
	APIKeyPlain  string `json:"apiKeyPlain"`
	APIKeyIV     string `json:"apiKeyIv"`
	APIKeyCipher string `json:"apiKeyCipher"`
	CredsJSON    string `json:"credsJson"`
	CredsIV      string `json:"credsIv"`
	CredsCipher  string `json:"credsCipher"`
}

func loadNodeVector(t *testing.T) nodeVector {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "interop", "node-vectors.json"))
	if err != nil {
		t.Fatalf("read node vectors: %v", err)
	}
	var v nodeVector
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("parse node vectors: %v", err)
	}
	return v
}

func TestKeyDerivationMatchesNode(t *testing.T) {
	v := loadNodeVector(t)
	got := hex.EncodeToString(DeriveKey(v.Secret))
	if got != v.KeyHex {
		t.Fatalf("DeriveKey = %s, want %s", got, v.KeyHex)
	}
}

func TestDecryptsNodeAPIKey(t *testing.T) {
	v := loadNodeVector(t)
	c := New(v.Secret)
	got, err := c.DecryptAPIKey(v.APIKeyCipher)
	if err != nil {
		t.Fatalf("DecryptAPIKey: %v", err)
	}
	if got != v.APIKeyPlain {
		t.Fatalf("DecryptAPIKey = %q, want %q", got, v.APIKeyPlain)
	}
}

func TestDecryptsNodeCredentials(t *testing.T) {
	v := loadNodeVector(t)
	c := New(v.Secret)
	want := map[string]string{"apiKey": "sk-cred-xyz", "sk": "s3cr3t", "workspaceId": "ws-1"}
	if got := c.DecryptCredentials(v.CredsCipher); !reflect.DeepEqual(got, want) {
		t.Fatalf("DecryptCredentials = %#v, want %#v", got, want)
	}
}

func TestEncryptAPIKeyIsDecryptable(t *testing.T) {
	c := New("interop-secret-42")
	enc, err := c.EncryptAPIKey("sk-test-abcdef1234567890")
	if err != nil {
		t.Fatalf("EncryptAPIKey: %v", err)
	}
	// Wire shape: 32 lowercase hex chars (16-byte IV), ":", hex ciphertext.
	// 24 plaintext bytes pad to one AES block: 32 IV + 1 sep + 64 ct = 97.
	if len(enc) != 32+1+64 {
		t.Fatalf("EncryptAPIKey length = %d, want 97 (%q)", len(enc), enc)
	}
	got, err := c.DecryptAPIKey(enc)
	if err != nil || got != "sk-test-abcdef1234567890" {
		t.Fatalf("round trip = %q, %v", got, err)
	}
}

func TestEncryptAPIKeyLeavesPlainAndAlreadyEncryptedValuesAlone(t *testing.T) {
	c := New("interop-secret-42")
	for _, input := range []string{"", "already:encrypted-value"} {
		got, err := c.EncryptAPIKey(input)
		if err != nil {
			t.Fatalf("EncryptAPIKey(%q): %v", input, err)
		}
		if got != input {
			t.Fatalf("EncryptAPIKey(%q) = %q, want unchanged", input, got)
		}
	}
}

func TestDecryptAPIKeyPassesThroughUnrecognizedShapes(t *testing.T) {
	c := New("interop-secret-42")
	inputs := []string{
		"",
		"plain-value",
		"short:aa",
		"not-hex-iv-not-hex-iv-not-hex-iv!!:deadbeef",
	}
	for _, input := range inputs {
		got, err := c.DecryptAPIKey(input)
		if err != nil {
			t.Fatalf("DecryptAPIKey(%q): %v", input, err)
		}
		if got != input {
			t.Fatalf("DecryptAPIKey(%q) = %q, want unchanged", input, got)
		}
	}
}

func TestEncryptCredentialsWireShape(t *testing.T) {
	c := New("interop-secret-42")
	enc, err := c.EncryptCredentials(map[string]string{"apiKey": "sk-cred-xyz"})
	if err != nil {
		t.Fatalf("EncryptCredentials: %v", err)
	}
	if len(enc) < len("v1:")+32+1 {
		t.Fatalf("EncryptCredentials = %q, want v1:<iv>:<ct>", enc)
	}
	if got := enc[:3]; got != "v1:" {
		t.Fatalf("prefix = %q, want v1:", got)
	}
	want := map[string]string{"apiKey": "sk-cred-xyz"}
	if got := c.DecryptCredentials(enc); !reflect.DeepEqual(got, want) {
		t.Fatalf("round trip = %#v, want %#v", got, want)
	}
}

func TestDecryptCredentialsRejectsMalformedInput(t *testing.T) {
	c := New("interop-secret-42")
	inputs := []string{
		"",
		"plain",
		"v1:",
		"v1:no-colon-here",
		"v1:00112233445566778899aabbccddeeff:zzzz",
		"v1:00112233445566778899aabbccddeeff:00",
		"iv:ct",
	}
	for _, input := range inputs {
		if got := c.DecryptCredentials(input); len(got) != 0 {
			t.Fatalf("DecryptCredentials(%q) = %#v, want empty", input, got)
		}
	}
}

func TestNewFallsBackToDefaultSecret(t *testing.T) {
	fromEnv := NewFromEnv(func(string) string { return "" })
	if fromEnv.keyHex() != hex.EncodeToString(DeriveKey(DefaultSecret)) {
		t.Fatal("NewFromEnv with empty env did not use the default secret")
	}
	custom := NewFromEnv(func(key string) string {
		if key == "NEXTAUTH_SECRET" {
			return "env-secret"
		}
		return ""
	})
	if custom.keyHex() != hex.EncodeToString(DeriveKey("env-secret")) {
		t.Fatal("NewFromEnv did not honor NEXTAUTH_SECRET")
	}
}

// TestGoEncryptNodeDecrypt closes the loop in the other direction with a real
// Node process. It is skipped only when node is unavailable on PATH.
func TestGoEncryptNodeDecrypt(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not found on PATH")
	}
	c := New("interop-secret-42")
	apiKey, err := c.EncryptAPIKey("sk-go-encrypted")
	if err != nil {
		t.Fatalf("EncryptAPIKey: %v", err)
	}
	creds, err := c.EncryptCredentials(map[string]string{"apiKey": "sk-go", "sk": "secret"})
	if err != nil {
		t.Fatalf("EncryptCredentials: %v", err)
	}
	script := filepath.Join("..", "..", "scripts", "interop", "verify-go-encryption.mjs")
	out, err := exec.Command(node, script, "interop-secret-42", apiKey, creds).CombinedOutput()
	if err != nil {
		t.Fatalf("node verify failed: %v\n%s", err, out)
	}
	var got struct {
		APIKey string            `json:"apiKey"`
		Creds  map[string]string `json:"credentials"`
	}
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("node output is not JSON: %v\n%s", err, out)
	}
	if got.APIKey != "sk-go-encrypted" {
		t.Fatalf("node decrypted api key = %q", got.APIKey)
	}
	if !reflect.DeepEqual(got.Creds, map[string]string{"apiKey": "sk-go", "sk": "secret"}) {
		t.Fatalf("node decrypted credentials = %#v", got.Creds)
	}
}
