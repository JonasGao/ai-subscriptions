// Package crypto implements the old stack's API-key encryption byte for byte.
//
// Parity note: lib/encryption.ts is the specification. AES-256-CBC with a key
// derived as sha256(NEXTAUTH_SECRET + "-api-key-encryption"), hex encoding, and
// two wrappers: "iv:ct" for a single API key and "v1:iv:ct" for a credential
// object. Ciphertext already in DATA_DIR must stay readable without
// re-encryption (ADR-0017), so this file is deliberately a port, not a design.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// DefaultSecret mirrors lib/encryption.ts's fallback when NEXTAUTH_SECRET is
// unset. Production deployments must set the env var; this keeps a fresh
// checkout and the unit tests working.
const DefaultSecret = "ai-subscriptions-secret-key-change-in-production"

// keySuffix is appended to the secret before hashing (lib/encryption.ts).
const keySuffix = "-api-key-encryption"

// ivLength is the AES block size used as the random IV.
const ivLength = 16

// DeriveKey returns sha256(secret + "-api-key-encryption"), the AES-256 key
// shared with the Node implementation.
func DeriveKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret + keySuffix))
	return sum[:]
}

// Cipher encrypts and decrypts API keys and credential blobs.
type Cipher struct {
	key []byte
}

// New returns a Cipher bound to secret.
func New(secret string) *Cipher {
	return &Cipher{key: DeriveKey(secret)}
}

// Getenv is the signature of os.Getenv, injected so tests can supply a fake.
type Getenv func(string) string

// NewFromEnv returns a Cipher keyed by NEXTAUTH_SECRET, falling back to
// DefaultSecret when unset.
func NewFromEnv(getenv Getenv) *Cipher {
	secret := getenv("NEXTAUTH_SECRET")
	if secret == "" {
		secret = DefaultSecret
	}
	return New(secret)
}

func (c *Cipher) keyHex() string {
	return hex.EncodeToString(c.key)
}

// EncryptAPIKey wraps plain with a random IV as "iv:ct".
//
// Values that are empty or already contain a ":" are returned unchanged, which
// is exactly what lib/encryption.ts does — it keeps double-encryption and
// crashes on already-encrypted input impossible.
func (c *Cipher) EncryptAPIKey(plain string) (string, error) {
	if plain == "" || strings.Contains(plain, ":") {
		return plain, nil
	}
	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	ct, err := c.encrypt(iv, []byte(plain))
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(iv) + ":" + hex.EncodeToString(ct), nil
}

// DecryptAPIKey unwraps "iv:ct". Anything that does not look like that shape
// (or fails to decrypt) is returned unchanged, matching lib/encryption.ts's
// lenient fallback: plain values are passed through.
func (c *Cipher) DecryptAPIKey(value string) (string, error) {
	if value == "" || !strings.Contains(value, ":") {
		return value, nil
	}
	parts := strings.Split(value, ":")
	if len(parts) != 2 || len(parts[0]) != ivLength*2 {
		return value, nil
	}
	iv, err := hex.DecodeString(parts[0])
	if err != nil {
		return value, nil
	}
	ct, err := hex.DecodeString(parts[1])
	if err != nil {
		return value, nil
	}
	plain, err := c.decrypt(iv, ct)
	if err != nil {
		return value, nil
	}
	return string(plain), nil
}

// EncryptCredentials wraps a credential object as "v1:iv:ct" over its JSON.
func (c *Cipher) EncryptCredentials(creds map[string]string) (string, error) {
	payload, err := json.Marshal(creds)
	if err != nil {
		return "", err
	}
	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	ct, err := c.encrypt(iv, payload)
	if err != nil {
		return "", err
	}
	return "v1:" + hex.EncodeToString(iv) + ":" + hex.EncodeToString(ct), nil
}

// DecryptCredentials unwraps "v1:iv:ct". Malformed or undecryptable input
// yields an empty map rather than an error — parity with the old stack, which
// swallows the failure so a corrupted blob degrades to "no credentials".
func (c *Cipher) DecryptCredentials(value string) map[string]string {
	if !strings.HasPrefix(value, "v1:") {
		return map[string]string{}
	}
	rest := value[len("v1:"):]
	sep := strings.Index(rest, ":")
	if sep == -1 {
		return map[string]string{}
	}
	iv, err := hex.DecodeString(rest[:sep])
	if err != nil || len(iv) != ivLength {
		return map[string]string{}
	}
	ct, err := hex.DecodeString(rest[sep+1:])
	if err != nil {
		return map[string]string{}
	}
	plain, err := c.decrypt(iv, ct)
	if err != nil {
		return map[string]string{}
	}
	var creds map[string]string
	if err := json.Unmarshal(plain, &creds); err != nil || creds == nil {
		return map[string]string{}
	}
	return creds
}

func (c *Cipher) encrypt(iv, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return nil, err
	}
	padded := pkcs7Pad(plain, block.BlockSize())
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, padded)
	return out, nil
}

func (c *Cipher) decrypt(iv, ct []byte) ([]byte, error) {
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return nil, err
	}
	if len(ct) == 0 || len(ct)%block.BlockSize() != 0 {
		return nil, errInvalidCiphertext
	}
	out := make([]byte, len(ct))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, ct)
	return pkcs7Unpad(out, block.BlockSize())
}
