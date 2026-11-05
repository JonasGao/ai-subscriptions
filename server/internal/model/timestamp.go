package model

import "time"

// FormatTimestamp renders t exactly like JavaScript's Date#toISOString: UTC,
// millisecond precision, trailing "Z". The old stack persists these strings
// verbatim, so every generated timestamp must use this form.
func FormatTimestamp(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
