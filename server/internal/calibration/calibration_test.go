package calibration

// Parity port of the `alignResetTimes` describe block of
// __tests__/reset-alignment.test.ts (24 cases). The old stack mocked lib/db,
// lib/providers and lib/encryption; here the store is a real SQLite database,
// the provider call goes through an injected HTTPDoer for the guard cases, and
// the success cases inject a fake UsageFetcher so each case states the exact
// usage result it needs.

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/providers"
	"ai-subscriptions/internal/store"
)

var alignNow = time.Date(2024, 6, 1, 1, 0, 0, 0, time.UTC)

const futureReset = "2099-12-31T23:59:59Z"

func openAlignStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(t.TempDir()+"/align.db", store.WithClock(func() time.Time { return alignNow }))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func intPtr(value int) *int { return &value }

func strPtr(value string) *string { return &value }

func schedule(overrides func(*model.ResetSchedule)) model.ResetSchedule {
	result := model.ResetSchedule{
		ID:            "sched-monthly",
		Enabled:       true,
		Type:          "monthly",
		Timezone:      "UTC",
		NextResetTime: "2024-01-01T00:00:00Z",
		CreatedAt:     "2024-01-01T00:00:00Z",
		UpdatedAt:     "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&result)
	}
	return result
}

func subscription(overrides func(*model.Subscription)) model.Subscription {
	result := model.Subscription{
		ID:               "sub-1",
		Name:             "Test Sub",
		Category:         "AI助手",
		Provider:         "test-provider",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "active",
		Credentials:      "encrypted",
		PlanID:           "test-plan",
		ResetSchedules:   []model.ResetSchedule{schedule(nil)},
		CreatedAt:        "2024-01-01T00:00:00Z",
		UpdatedAt:        "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&result)
	}
	return result
}

func seedSubscriptions(t *testing.T, s *store.Store, subs ...model.Subscription) {
	t.Helper()
	if err := s.WriteSubscriptionData(&model.SubscriptionData{Subscriptions: subs}); err != nil {
		t.Fatalf("seed subscriptions: %v", err)
	}
}

func monthly(reset string) providers.UsageResult {
	return providers.UsageResult{Provider: "test-provider", Monthly: &providers.UsageWindow{
		Limit: "100", Used: "0", Remaining: "100", ResetTime: strPtr(reset),
	}}
}

func weekly(reset string) providers.UsageResult {
	return providers.UsageResult{Provider: "test-provider", Weekly: &providers.UsageWindow{
		Limit: "100", Used: "0", Remaining: "100", ResetTime: strPtr(reset),
	}}
}

type fakeFetcher struct {
	calls  int
	result providers.UsageResult
	ok     bool
	before func()
}

func (f *fakeFetcher) fetch(_ context.Context, _ model.Subscription) (providers.UsageResult, bool) {
	f.calls++
	if f.before != nil {
		f.before()
	}
	return f.result, f.ok
}

func newFakeService(data *store.Store, fake *fakeFetcher) *Service {
	return &Service{Data: data, Fetch: fake.fetch}
}

// stubHTTP records outbound requests and replies with a canned body.
type stubHTTP struct {
	body     string
	err      error
	requests int
}

func (s *stubHTTP) Do(*http.Request) (*http.Response, error) {
	s.requests++
	if s.err != nil {
		return nil, s.err
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(s.body)),
		Header:     make(http.Header),
	}, nil
}

const moonshotUsageBody = `{"usage":{"limit":"1024","used":"100","remaining":"924","resetTime":"2026-03-04T04:01:38Z"},"limits":[]}`

func TestAlignResetTimesIsNoOpWhenTriggersEmpty(t *testing.T) {
	data := openAlignStore(t)
	fake := &fakeFetcher{ok: true}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), nil); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if fake.calls != 0 {
		t.Fatalf("fetch calls = %d, want 0", fake.calls)
	}
}

func TestAlignResetTimesOverwritesNextResetTime(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: monthly("2024-07-15T12:00:00Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}

	saved := mustSubscription(t, data, "sub-1")
	if saved.ResetSchedules[0].NextResetTime != "2024-07-15T12:00:00Z" {
		t.Errorf("nextResetTime = %q, want API value", saved.ResetSchedules[0].NextResetTime)
	}
}

func TestAlignResetTimesAlignsAllEnabledSchedulesWithOneFetch(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{
			schedule(func(s *model.ResetSchedule) { s.ID = "sched-weekly"; s.Type = "weekly" }),
			schedule(nil),
		}
	}))
	fake := &fakeFetcher{ok: true, result: providers.UsageResult{
		Weekly:  &providers.UsageWindow{Limit: "100", Used: "0", Remaining: "100", ResetTime: strPtr("2024-06-10T00:00:00Z")},
		Monthly: &providers.UsageWindow{Limit: "500", Used: "0", Remaining: "500", ResetTime: strPtr("2024-07-01T00:00:00Z")},
	}}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), []model.ResetTickTrigger{
		{SubscriptionID: "sub-1", ScheduleType: "weekly"},
		{SubscriptionID: "sub-1", ScheduleType: "monthly"},
	}); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if fake.calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", fake.calls)
	}
	saved := mustSubscription(t, data, "sub-1")
	byType := map[string]string{}
	for _, s := range saved.ResetSchedules {
		byType[s.Type] = s.NextResetTime
	}
	if byType["weekly"] != "2024-06-10T00:00:00Z" || byType["monthly"] != "2024-07-01T00:00:00Z" {
		t.Errorf("schedule reset times = %#v", byType)
	}
}

func TestAlignResetTimesSkipsNullResetTime(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: providers.UsageResult{Monthly: &providers.UsageWindow{
		Limit: "100", Used: "0", Remaining: "100", ResetTime: nil,
	}}}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsMissingBucket(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: providers.UsageResult{Provider: "test-provider"}}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsFetchFailure(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: false}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsPastResetTime(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: monthly("2020-01-01T00:00:00Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsResetTimeEqualToNow(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: monthly("2024-06-01T01:00:00Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsInvalidResetTime(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: monthly("not-a-date")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsSubscriptionWithoutCredentials(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) { sub.Credentials = "" }))
	client := &stubHTTP{body: moonshotUsageBody}
	service := New(data, crypto.New("test-secret"), client)

	if err := service.AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if client.requests != 0 {
		t.Fatalf("outbound requests = %d, want 0", client.requests)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsUnresolvableHandler(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.Provider = "unknown-provider"
		sub.PlanID = "unknown-plan"
	}))
	client := &stubHTTP{body: moonshotUsageBody}
	service := New(data, crypto.New("test-secret"), client)

	if err := service.AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if client.requests != 0 {
		t.Fatalf("outbound requests = %d, want 0", client.requests)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsNonRecurringSubscription(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.SubscriptionType = "one-time"
		sub.BillingCycle = ""
	}))
	client := &stubHTTP{body: moonshotUsageBody}
	service := New(data, crypto.New("test-secret"), client)

	if err := service.AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if client.requests != 0 {
		t.Fatalf("outbound requests = %d, want 0", client.requests)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsUndecryptableCredentials(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.Provider = "moonshot"
		sub.PlanID = "kimi-code"
		sub.Credentials = "BAD_CREDS"
	}))
	client := &stubHTTP{body: moonshotUsageBody}
	service := New(data, crypto.New("test-secret"), client)

	if err := service.AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if client.requests != 0 {
		t.Fatalf("outbound requests = %d, want 0", client.requests)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesSkipsProviderFetchError(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.Provider = "moonshot"
		sub.PlanID = "kimi-code"
		cipher := crypto.New("test-secret")
		encrypted, err := cipher.EncryptCredentials(map[string]string{"apiKey": "k"})
		if err != nil {
			t.Fatalf("encrypt: %v", err)
		}
		sub.Credentials = encrypted
	}))
	client := &stubHTTP{err: fmt.Errorf("network down")}
	service := New(data, crypto.New("test-secret"), client)

	if err := service.AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if client.requests != 1 {
		t.Fatalf("outbound requests = %d, want 1", client.requests)
	}
	assertUnchanged(t, data)
}

func TestAlignResetTimesAlignsPausedSubscription(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) { sub.Status = "paused" }))
	fake := &fakeFetcher{ok: true, result: monthly("2024-07-15T12:00:00Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if saved := mustSubscription(t, data, "sub-1"); saved.ResetSchedules[0].NextResetTime != "2024-07-15T12:00:00Z" {
		t.Errorf("nextResetTime = %q, want API value", saved.ResetSchedules[0].NextResetTime)
	}
}

func TestAlignResetTimesDedupesTriggers(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: monthly(futureReset)}

	all := []model.ResetTickTrigger{
		{SubscriptionID: "sub-1"},
		{SubscriptionID: "sub-1"},
		{SubscriptionID: "sub-1"},
	}
	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), all); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if fake.calls != 1 {
		t.Fatalf("fetch calls = %d, want 1", fake.calls)
	}
}

func TestAlignResetTimesDoesNotWriteWhenValuesUnchanged(t *testing.T) {
	data := openAlignStore(t)
	const currentNext = "2024-06-15T00:00:00Z"
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{schedule(func(s *model.ResetSchedule) {
			s.NextResetTime = currentNext
			s.Timezone = "UTC"
			s.DayOfMonth = intPtr(15)
			s.TimeOfDay = "00:00"
		})}
	}))
	fake := &fakeFetcher{ok: true, result: monthly(currentNext)}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	saved := mustSubscription(t, data, "sub-1")
	if saved.UpdatedAt != "2024-01-01T00:00:00Z" {
		t.Errorf("subscription updatedAt = %q, want untouched", saved.UpdatedAt)
	}
	if saved.ResetSchedules[0].UpdatedAt != "2024-01-01T00:00:00Z" {
		t.Errorf("schedule updatedAt = %q, want untouched", saved.ResetSchedules[0].UpdatedAt)
	}
}

func TestAlignResetTimesSkipsDeletedSubscription(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{
		ok:     true,
		result: monthly(futureReset),
		before: func() {
			if err := data.WriteSubscriptionData(&model.SubscriptionData{}); err != nil {
				t.Fatalf("delete subscription: %v", err)
			}
		},
	}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	subs, err := data.Subscriptions()
	if err != nil {
		t.Fatalf("Subscriptions: %v", err)
	}
	if len(subs) != 0 {
		t.Fatalf("subscriptions = %#v, want none", subs)
	}
}

func TestAlignResetTimesSkipsDeletedSchedule(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{
		ok:     true,
		result: monthly(futureReset),
		before: func() {
			saved := mustSubscription(t, data, "sub-1")
			saved.ResetSchedules = nil
			if err := data.WriteSubscriptionData(&model.SubscriptionData{Subscriptions: []model.Subscription{*saved}}); err != nil {
				t.Fatalf("delete schedule: %v", err)
			}
		},
	}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	if saved := mustSubscription(t, data, "sub-1"); len(saved.ResetSchedules) != 0 {
		t.Fatalf("schedules = %#v, want none", saved.ResetSchedules)
	}
}

func TestAlignResetTimesSkipsScheduleDisabledDuringFetch(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{
		ok:     true,
		result: monthly(futureReset),
		before: func() {
			saved := mustSubscription(t, data, "sub-1")
			saved.ResetSchedules[0].Enabled = false
			if err := data.WriteSubscriptionData(&model.SubscriptionData{Subscriptions: []model.Subscription{*saved}}); err != nil {
				t.Fatalf("disable schedule: %v", err)
			}
		},
	}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	saved := mustSubscription(t, data, "sub-1")
	if saved.ResetSchedules[0].Enabled {
		t.Error("schedule was re-enabled")
	}
	if saved.ResetSchedules[0].NextResetTime != "2024-01-01T00:00:00Z" {
		t.Errorf("nextResetTime = %q, want untouched", saved.ResetSchedules[0].NextResetTime)
	}
}

func TestAlignResetTimesBumpsUpdatedAt(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(nil))
	fake := &fakeFetcher{ok: true, result: monthly("2024-07-15T12:00:00Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	saved := mustSubscription(t, data, "sub-1")
	const nowISO = "2024-06-01T01:00:00.000Z"
	if saved.UpdatedAt != nowISO {
		t.Errorf("subscription updatedAt = %q, want %q", saved.UpdatedAt, nowISO)
	}
	if saved.ResetSchedules[0].UpdatedAt != nowISO {
		t.Errorf("schedule updatedAt = %q, want %q", saved.ResetSchedules[0].UpdatedAt, nowISO)
	}
}

func TestAlignResetTimesDerivesWeeklyConfig(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{schedule(func(s *model.ResetSchedule) {
			s.ID = "sched-weekly"
			s.Type = "weekly"
			s.DayOfWeek = intPtr(0)
			s.TimeOfDay = "00:00"
		})}
	}))
	// 2024-07-15 is a Monday (getDay 1); 12:34:56 truncates to "12:34".
	fake := &fakeFetcher{ok: true, result: weekly("2024-07-15T12:34:56Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	saved := mustSubscription(t, data, "sub-1").ResetSchedules[0]
	if saved.NextResetTime != "2024-07-15T12:34:56Z" {
		t.Errorf("nextResetTime = %q", saved.NextResetTime)
	}
	if saved.DayOfWeek == nil || *saved.DayOfWeek != 1 {
		t.Errorf("dayOfWeek = %v, want 1", saved.DayOfWeek)
	}
	if saved.TimeOfDay != "12:34" {
		t.Errorf("timeOfDay = %q, want 12:34", saved.TimeOfDay)
	}
}

func TestAlignResetTimesDerivesMonthlyConfig(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{schedule(func(s *model.ResetSchedule) {
			s.DayOfMonth = intPtr(1)
			s.TimeOfDay = "00:00"
		})}
	}))
	fake := &fakeFetcher{ok: true, result: monthly("2024-07-15T08:05:30Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	saved := mustSubscription(t, data, "sub-1").ResetSchedules[0]
	if saved.NextResetTime != "2024-07-15T08:05:30Z" {
		t.Errorf("nextResetTime = %q", saved.NextResetTime)
	}
	if saved.DayOfMonth == nil || *saved.DayOfMonth != 15 {
		t.Errorf("dayOfMonth = %v, want 15", saved.DayOfMonth)
	}
	if saved.TimeOfDay != "08:05" {
		t.Errorf("timeOfDay = %q, want 08:05", saved.TimeOfDay)
	}
}

func TestAlignResetTimesDerivesConfigInScheduleTimezone(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{schedule(func(s *model.ResetSchedule) {
			s.Timezone = "Asia/Shanghai"
			s.DayOfMonth = intPtr(1)
			s.TimeOfDay = "00:00"
		})}
	}))
	// 2024-07-15T16:30:00Z is 2024-07-16 00:30 in Asia/Shanghai (UTC+8).
	fake := &fakeFetcher{ok: true, result: monthly("2024-07-15T16:30:00Z")}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	saved := mustSubscription(t, data, "sub-1").ResetSchedules[0]
	if saved.DayOfMonth == nil || *saved.DayOfMonth != 16 {
		t.Errorf("dayOfMonth = %v, want 16", saved.DayOfMonth)
	}
	if saved.TimeOfDay != "00:30" {
		t.Errorf("timeOfDay = %q, want 00:30", saved.TimeOfDay)
	}
}

func TestAlignResetTimesFiveHourOnlyUpdatesAnchor(t *testing.T) {
	data := openAlignStore(t)
	seedSubscriptions(t, data, subscription(func(sub *model.Subscription) {
		sub.ResetSchedules = []model.ResetSchedule{schedule(func(s *model.ResetSchedule) {
			s.ID = "sched-fiveHour"
			s.Type = "fiveHour"
		})}
	}))
	fake := &fakeFetcher{ok: true, result: providers.UsageResult{FiveHour: &providers.UsageWindow{
		Limit: "100", Used: "0", Remaining: "100", ResetTime: strPtr("2024-06-01T06:00:00Z"),
	}}}

	if err := newFakeService(data, fake).AlignResetTimes(context.Background(), triggers("sub-1")); err != nil {
		t.Fatalf("AlignResetTimes: %v", err)
	}
	saved := mustSubscription(t, data, "sub-1").ResetSchedules[0]
	if saved.NextResetTime != "2024-06-01T06:00:00Z" {
		t.Errorf("nextResetTime = %q", saved.NextResetTime)
	}
	if saved.TimeOfDay != "" {
		t.Errorf("timeOfDay = %q, want empty", saved.TimeOfDay)
	}
	if saved.DayOfWeek != nil || saved.DayOfMonth != nil {
		t.Errorf("derived config fields = %v/%v, want nil", saved.DayOfWeek, saved.DayOfMonth)
	}
}

func triggers(subID string) []model.ResetTickTrigger {
	return []model.ResetTickTrigger{{SubscriptionID: subID}}
}

func mustSubscription(t *testing.T, data *store.Store, id string) *model.Subscription {
	t.Helper()
	sub, err := data.SubscriptionByID(id)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if sub == nil {
		t.Fatalf("subscription %q not found", id)
	}
	return sub
}

func assertUnchanged(t *testing.T, data *store.Store) {
	t.Helper()
	saved := mustSubscription(t, data, "sub-1")
	if saved.ResetSchedules[0].NextResetTime != "2024-01-01T00:00:00Z" {
		t.Errorf("nextResetTime = %q, want untouched", saved.ResetSchedules[0].NextResetTime)
	}
	if saved.UpdatedAt != "2024-01-01T00:00:00Z" {
		t.Errorf("updatedAt = %q, want untouched", saved.UpdatedAt)
	}
}
