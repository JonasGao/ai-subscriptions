// Package proxy ports the proxy-subscription domain rules from
// lib/proxy-utils.ts and lib/proxy-subscriptions.ts (ADR-0009).
//
// Proxy Subscriptions are an independent boundary: their own status
// vocabulary, their own tag catalog, and an expiration date that is optional.
// A record without an expiration date is an unlimited traffic purchase and
// never takes part in expiry processing; a record is only considered for a
// notice while it is manually In Use.
package proxy

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"ai-subscriptions/internal/tags"
)

// Statuses (lib/types.ts ProxySubscriptionStatus).
const (
	Unused  = "unused"
	InUse   = "in-use"
	Expired = "expired"
)

// Limits mirror MAX_TAGS / MAX_TAG_NAME_LENGTH / MAX_NOTES_LENGTH in
// lib/proxy-subscriptions.ts.
const (
	MaxTagsPerSubscription = 20
	MaxTagNameLength       = tags.MaxNameLength
	MaxNotesLength         = 2000
	MaxWebsiteLength       = 2000
)

// Errors carry the old stack's user-facing Chinese messages because the API
// surfaces them verbatim (parity).
var (
	ErrNameRequired    = errors.New("代理订阅名称不能为空")
	ErrPriceInvalid    = errors.New("单月价格必须是非负数字")
	ErrPriceRequired   = errors.New("单月价格不能为空")
	ErrDateInvalid     = errors.New("到期日期必须是 YYYY-MM-DD 格式的有效日期")
	ErrWebsiteInvalid  = errors.New("网站地址必须是有效的 http 或 https 地址")
	ErrWebsiteTooLong  = errors.New("网站地址无效")
	ErrNotesTooLong    = fmt.Errorf("备注不能超过 %d 个字符", MaxNotesLength)
	ErrStatusInvalid   = errors.New("无效的代理订阅状态")
	ErrTagNamesInvalid = errors.New("tagNames must be an array")
	ErrTooManyTags     = fmt.Errorf("每个代理订阅最多添加 %d 个标签", MaxTagsPerSubscription)
	ErrTagNameExists   = errors.New("标签名称已存在")
)

// IsDateOnly reports whether value is a real calendar date in YYYY-MM-DD form
// (2026-02-30 is rejected, matching isDateOnly in lib/proxy-utils.ts).
func IsDateOnly(value string) bool {
	if len(value) != 10 || value[4] != '-' || value[7] != '-' {
		return false
	}
	for i, r := range value {
		if i == 4 || i == 7 {
			continue
		}
		if r < '0' || r > '9' {
			return false
		}
	}
	year, _ := strconv.Atoi(value[0:4])
	month, _ := strconv.Atoi(value[5:7])
	day, _ := strconv.Atoi(value[8:10])
	parsed := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	return parsed.Year() == year && int(parsed.Month()) == month && parsed.Day() == day
}

// AddCalendarDays shifts a date-only string by whole days.
func AddCalendarDays(dateOnly string, days int) (string, error) {
	if !IsDateOnly(dateOnly) {
		return "", errors.New("Invalid date or day count")
	}
	parsed, err := time.Parse("2006-01-02", dateOnly)
	if err != nil {
		return "", err
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02"), nil
}

// CalculateProxyExpirationDate turns the form's "start date + usable days"
// input into the inclusive expiration date it persists (start + days - 1).
func CalculateProxyExpirationDate(startDate string, durationDays int) (string, error) {
	if !IsDateOnly(startDate) {
		return "", errors.New("起始日期必须是 YYYY-MM-DD 格式")
	}
	if durationDays < 1 {
		return "", errors.New("订阅天数必须是正整数")
	}
	return AddCalendarDays(startDate, durationDays-1)
}

// chinaZone is Asia/Shanghai. China has no DST, so a fixed +08:00 zone gives
// the same calendar dates as the old stack's Intl.DateTimeFormat call.
var chinaZone = time.FixedZone("CST", 8*60*60)

// TodayDate returns today's calendar date in China local time, which is what
// the page compares expiration dates against.
func TodayDate(now time.Time) string {
	return now.In(chinaZone).Format("2006-01-02")
}

// Notice kinds of DateNotice.
const (
	NoticeNone      = ""
	NoticeToday     = "today"
	NoticeRemaining = "remaining"
	NoticeOverdue   = "overdue"
)

// DateNotice is the expiry hint the UI shows. Days is set only for remaining
// and overdue.
type DateNotice struct {
	Kind string
	Days int
}

// DateNoticeFor mirrors getProxyDateNotice: only an In Use record with a valid
// expiration date produces anything but NoticeNone.
func DateNoticeFor(status, expirationDate string, now time.Time) DateNotice {
	if status != InUse || expirationDate == "" || !IsDateOnly(expirationDate) {
		return DateNotice{Kind: NoticeNone}
	}
	expiration, err := time.Parse("2006-01-02", expirationDate)
	if err != nil {
		return DateNotice{Kind: NoticeNone}
	}
	today, err := time.Parse("2006-01-02", TodayDate(now))
	if err != nil {
		return DateNotice{Kind: NoticeNone}
	}
	difference := int(expiration.Sub(today).Hours() / 24)

	switch {
	case difference < 0:
		return DateNotice{Kind: NoticeOverdue, Days: -difference}
	case difference == 0:
		return DateNotice{Kind: NoticeToday}
	default:
		return DateNotice{Kind: NoticeRemaining, Days: difference}
	}
}

// Fields is the writable subset of a proxy subscription. Every field is a
// pointer so a nil means "not supplied": on create that falls back to a
// default, on update it means "leave unchanged".
type Fields struct {
	Name           *string
	MonthlyPrice   *float64
	ExpirationDate *string
	Website        *string
	Notes          *string
	Status         *string
}

// Validate mirrors validateSubscriptionFields; absent fields are skipped, so
// the same method serves create and partial update.
func (f Fields) Validate() error {
	if f.Name != nil && strings.TrimSpace(*f.Name) == "" {
		return ErrNameRequired
	}
	if f.MonthlyPrice != nil {
		price := *f.MonthlyPrice
		if math.IsNaN(price) || math.IsInf(price, 0) || price < 0 {
			return ErrPriceInvalid
		}
	}
	if f.ExpirationDate != nil && *f.ExpirationDate != "" && !IsDateOnly(*f.ExpirationDate) {
		return ErrDateInvalid
	}
	if f.Website != nil && *f.Website != "" {
		website := *f.Website
		if utf8.RuneCountInString(website) > MaxWebsiteLength {
			return ErrWebsiteTooLong
		}
		parsed, err := url.Parse(website)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return ErrWebsiteInvalid
		}
	}
	if f.Notes != nil && utf8.RuneCountInString(*f.Notes) > MaxNotesLength {
		return ErrNotesTooLong
	}
	if f.Status != nil && *f.Status != Unused && *f.Status != InUse && *f.Status != Expired {
		return ErrStatusInvalid
	}
	return nil
}

func isNaNOrInf(value float64) bool {
	return value != value || value > 1.7976931348623157e308 || value < -1.7976931348623157e308
}

// ValidateTagNames normalises a tag-name list, dropping later duplicates while
// preserving first-seen order, and enforces the proxy-specific limit message.
// Like resolveTagIds in the old stack, the raw count is checked before names
// are validated.
func ValidateTagNames(values []string) ([]string, error) {
	if len(values) > MaxTagsPerSubscription {
		return nil, ErrTooManyTags
	}
	unique := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if err := tags.NameError(value); err != nil {
			return nil, err
		}
		name := tags.Normalize(value)
		if _, duplicate := seen[name]; duplicate {
			continue
		}
		seen[name] = struct{}{}
		unique = append(unique, name)
	}
	return unique, nil
}
