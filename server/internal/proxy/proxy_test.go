package proxy

import (
	"strings"
	"testing"
	"time"
)

// Parity port of the "proxy subscription date rules" describe block in
// __tests__/proxy-subscriptions.test.ts (5 cases). The storage half of that
// file lives in server/internal/store/proxy_test.go.

func utc(year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, time.UTC)
}

// proxy-subscriptions.test.ts: "calculates an inclusive expiration date".
func TestCalculateProxyExpirationDateIsInclusive(t *testing.T) {
	got, err := CalculateProxyExpirationDate("2026-08-01", 30)
	if err != nil {
		t.Fatalf("CalculateProxyExpirationDate: %v", err)
	}
	if want := "2026-08-30"; got != want {
		t.Fatalf("CalculateProxyExpirationDate(2026-08-01, 30) = %q, want %q", got, want)
	}
}

// proxy-subscriptions.test.ts: "skips expiration notices for unused
// subscriptions".
func TestDateNoticeSkipsUnusedSubscriptions(t *testing.T) {
	got := DateNoticeFor("unused", "2020-01-01", utc(2026, time.August, 30, 0, 0))
	if want := (DateNotice{Kind: NoticeNone}); got != want {
		t.Fatalf("DateNoticeFor(unused) = %#v, want %#v", got, want)
	}
}

// proxy-subscriptions.test.ts: "skips expiration notices for unlimited in-use
// subscriptions".
func TestDateNoticeSkipsUnlimitedInUseSubscriptions(t *testing.T) {
	got := DateNoticeFor("in-use", "", utc(2026, time.August, 30, 0, 0))
	if want := (DateNotice{Kind: NoticeNone}); got != want {
		t.Fatalf("DateNoticeFor(in-use, unlimited) = %#v, want %#v", got, want)
	}
}

// proxy-subscriptions.test.ts: "reports overdue days only for in-use
// subscriptions".
func TestDateNoticeReportsOverdueDaysOnlyForInUse(t *testing.T) {
	got := DateNoticeFor("in-use", "2026-08-28", utc(2026, time.August, 30, 0, 0))
	if want := (DateNotice{Kind: NoticeOverdue, Days: 2}); got != want {
		t.Fatalf("DateNoticeFor(in-use, 2026-08-28) = %#v, want %#v", got, want)
	}
}

// proxy-subscriptions.test.ts: "uses China calendar dates around UTC midnight".
func TestTodayDateUsesChinaCalendarAroundUTCMidnight(t *testing.T) {
	if got, want := TodayDate(utc(2026, time.August, 29, 16, 30)), "2026-08-30"; got != want {
		t.Fatalf("TodayDate(2026-08-29T16:30Z) = %q, want %q", got, want)
	}
}

// The old form's inclusive rule is `start + days - 1`; the notice is only
// informational for a manually In Use record with a date (ADR-0009).
func TestDateNoticeReportsRemainingAndToday(t *testing.T) {
	now := utc(2026, time.August, 30, 0, 0)
	if got, want := DateNoticeFor("in-use", "2026-09-02", now), (DateNotice{Kind: NoticeRemaining, Days: 3}); got != want {
		t.Fatalf("remaining notice = %#v, want %#v", got, want)
	}
	if got, want := DateNoticeFor("in-use", "2026-08-30", now), (DateNotice{Kind: NoticeToday}); got != want {
		t.Fatalf("today notice = %#v, want %#v", got, want)
	}
	// An expired-by-hand record is out of expiry processing entirely.
	if got, want := DateNoticeFor("expired", "2026-08-01", now), (DateNotice{Kind: NoticeNone}); got != want {
		t.Fatalf("expired notice = %#v, want %#v", got, want)
	}
}

func TestIsDateOnlyRequiresPaddedDigitsAndRealDays(t *testing.T) {
	valid := []string{"2026-08-01", "2028-02-29", "2026-12-31"}
	for _, value := range valid {
		if !IsDateOnly(value) {
			t.Errorf("IsDateOnly(%q) = false, want true", value)
		}
	}
	invalid := []string{
		"", "2026-8-1", "2026-02-30", "2026-13-01", "2026-00-10",
		"2026-+1-01", "2026-01-01T00:00:00Z", "abc",
	}
	for _, value := range invalid {
		if IsDateOnly(value) {
			t.Errorf("IsDateOnly(%q) = true, want false", value)
		}
	}
}

func TestValidateRejectsFieldErrorsWithOldStackMessages(t *testing.T) {
	name := "  "
	if err := (Fields{Name: &name}).Validate(); err == nil || err.Error() != "代理订阅名称不能为空" {
		t.Fatalf("blank name error = %v, want 代理订阅名称不能为空", err)
	}

	price := -1.0
	if err := (Fields{MonthlyPrice: &price}).Validate(); err == nil || err.Error() != "单月价格必须是非负数字" {
		t.Fatalf("negative price error = %v, want 单月价格必须是非负数字", err)
	}

	date := "2026-02-30"
	if err := (Fields{ExpirationDate: &date}).Validate(); err == nil || err.Error() != "到期日期必须是 YYYY-MM-DD 格式的有效日期" {
		t.Fatalf("bad date error = %v, want the date format message", err)
	}

	site := "ftp://example.com"
	if err := (Fields{Website: &site}).Validate(); err == nil || err.Error() != "网站地址必须是有效的 http 或 https 地址" {
		t.Fatalf("bad website error = %v, want the http/https message", err)
	}

	notes := strings.Repeat("x", 2001)
	if err := (Fields{Notes: &notes}).Validate(); err == nil || err.Error() != "备注不能超过 2000 个字符" {
		t.Fatalf("long notes error = %v, want the notes length message", err)
	}

	status := "archived"
	if err := (Fields{Status: &status}).Validate(); err == nil || err.Error() != "无效的代理订阅状态" {
		t.Fatalf("bad status error = %v, want 无效的代理订阅状态", err)
	}

	// Empty optional strings are legal (they clear the field).
	empty := ""
	validSite := "https://example.com/x?a=1&b=2"
	validDate := "2026-12-31"
	inUse := "in-use"
	if err := (Fields{
		Name: strptr("Relay"), MonthlyPrice: floatptr(0), ExpirationDate: &empty,
		Website: &empty, Notes: &empty, Status: &inUse,
	}).Validate(); err != nil {
		t.Fatalf("clearing optional fields: %v", err)
	}
	if err := (Fields{
		Name: strptr("Relay"), MonthlyPrice: floatptr(9.9), ExpirationDate: &validDate,
		Website: &validSite, Status: &inUse,
	}).Validate(); err != nil {
		t.Fatalf("valid fields: %v", err)
	}
}

func TestValidateTagNamesUsesProxyVocabulary(t *testing.T) {
	if _, err := ValidateTagNames(make([]string, MaxTagsPerSubscription+1)); err == nil ||
		err.Error() != "每个代理订阅最多添加 20 个标签" {
		t.Fatalf("too many tags error = %v, want 每个代理订阅最多添加 20 个标签", err)
	}
	if _, err := ValidateTagNames([]string{"a, b"}); err == nil || err.Error() != "标签不能包含中英文逗号或换行" {
		t.Fatalf("separator error = %v, want the separator message", err)
	}
	got, err := ValidateTagNames([]string{" 备用 ", "备用", "工作"})
	if err != nil {
		t.Fatalf("ValidateTagNames: %v", err)
	}
	if len(got) != 2 || got[0] != "备用" || got[1] != "工作" {
		t.Fatalf("ValidateTagNames = %#v, want [备用 工作]", got)
	}
}

func strptr(value string) *string     { return &value }
func floatptr(value float64) *float64 { return &value }
