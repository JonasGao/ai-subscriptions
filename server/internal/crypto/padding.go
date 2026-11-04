package crypto

import "errors"

var errInvalidCiphertext = errors.New("crypto: invalid ciphertext")

// pkcs7Pad matches Node's crypto padding for AES-256-CBC.
func pkcs7Pad(data []byte, blockSize int) []byte {
	padding := blockSize - len(data)%blockSize
	out := make([]byte, len(data)+padding)
	copy(out, data)
	for i := len(data); i < len(out); i++ {
		out[i] = byte(padding)
	}
	return out
}

func pkcs7Unpad(data []byte, blockSize int) ([]byte, error) {
	if len(data) == 0 || len(data)%blockSize != 0 {
		return nil, errInvalidCiphertext
	}
	padding := int(data[len(data)-1])
	if padding == 0 || padding > blockSize || padding > len(data) {
		return nil, errInvalidCiphertext
	}
	for _, b := range data[len(data)-padding:] {
		if int(b) != padding {
			return nil, errInvalidCiphertext
		}
	}
	return data[:len(data)-padding], nil
}
