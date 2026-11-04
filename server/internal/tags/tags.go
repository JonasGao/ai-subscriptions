package tags

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// MaxNameLength and MaxPerSubscription mirror lib/tags.ts.
const (
	MaxNameLength      = 30
	MaxPerSubscription = 20
)

// Errors returned by the validators. They carry the old stack's user-facing
// Chinese messages because the API surfaces them verbatim (parity).
var (
	ErrEmpty     = errors.New("标签不能为空")
	ErrSeparator = errors.New("标签不能包含中英文逗号或换行")
	ErrTooLong   = fmt.Errorf("标签不能超过 %d 个字符", MaxNameLength)
	ErrTooMany   = fmt.Errorf("每个订阅最多添加 %d 个标签", MaxPerSubscription)
)

// Normalize trims surrounding whitespace; names are otherwise compared
// case-sensitively ("Stable" and "stable" stay distinct).
func Normalize(value string) string {
	return strings.TrimSpace(value)
}

// NameError returns the validation error for value, or nil when it is valid.
func NameError(value string) error {
	normalized := Normalize(value)

	if normalized == "" {
		return ErrEmpty
	}
	if strings.ContainsAny(normalized, ",，\r\n") {
		return ErrSeparator
	}
	if utf8.RuneCountInString(normalized) > MaxNameLength {
		return ErrTooLong
	}
	return nil
}

// ValidateName validates and normalizes a single tag name.
func ValidateName(value string) (string, error) {
	if err := NameError(value); err != nil {
		return "", err
	}
	return Normalize(value), nil
}

// ValidateNames validates a tag-name list, dropping later duplicates while
// preserving first-seen order, and enforces the per-subscription limit.
func ValidateNames(values []string) ([]string, error) {
	unique := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		name, err := ValidateName(value)
		if err != nil {
			return nil, err
		}
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		unique = append(unique, name)
	}

	if len(unique) > MaxPerSubscription {
		return nil, ErrTooMany
	}
	return unique, nil
}
