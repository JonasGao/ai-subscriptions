package notify

// Parity port of __tests__/dispatcher.test.ts (36 cases). The old module owned
// the threshold state machine, the fan-out to configured channels and the
// rollback when every channel fails. The store is a seam here (old tests
// mocked the storage module), and the senders are injectable, so each old case
// maps to the same behavioural assertion.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ai-subscriptions/internal/model"
)

var (
	errBoom        = errors.New("boom")
	errNetworkDown = errors.New("network down")
	errFeishuDown  = errors.New("feishu down")
)

// ---------- fakes ----------

type recordedSendResult struct {
	channelID string
	success   bool
	err       string
}

type fakeStore struct {
	defaultThreshold float64
	transitions      map[string]model.BalanceTransitionState
	channels         []model.NotificationChannel
	sendResults      []recordedSendResult
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		defaultThreshold: 10,
		transitions:      map[string]model.BalanceTransitionState{},
		channels:         []model.NotificationChannel{},
	}
}

func (f *fakeStore) DefaultLowBalanceThreshold() (float64, error) {
	return f.defaultThreshold, nil
}

func (f *fakeStore) BalanceTransitionState(subscriptionID string) (*model.BalanceTransitionState, error) {
	state, ok := f.transitions[subscriptionID]
	if !ok {
		return nil, nil
	}
	return &state, nil
}

func (f *fakeStore) SetBalanceTransitionState(subscriptionID string, state model.BalanceTransitionState) error {
	f.transitions[subscriptionID] = state
	return nil
}

func (f *fakeStore) NotificationChannels() ([]model.NotificationChannel, error) {
	return f.channels, nil
}

func (f *fakeStore) SetNotificationChannelSendResult(id string, result model.SendResult) error {
	f.sendResults = append(f.sendResults, recordedSendResult{
		channelID: id,
		success:   result.Success,
		err:       result.Error,
	})
	return nil
}

func (f *fakeStore) lastResultFor(channelID string) *recordedSendResult {
	for i := len(f.sendResults) - 1; i >= 0; i-- {
		if f.sendResults[i].channelID == channelID {
			return &f.sendResults[i]
		}
	}
	return nil
}

type fakeSender struct {
	sends []*PreparedSend
	fail  func(*PreparedSend) error
}

func (f *fakeSender) Send(send *PreparedSend) error {
	if f.fail != nil {
		if err := f.fail(send); err != nil {
			return err
		}
	}
	f.sends = append(f.sends, send)
	return nil
}

type fakeFeishuAppSender struct {
	events   []Event
	channels []model.NotificationChannel
	fail     error
}

func (f *fakeFeishuAppSender) SendToChannel(_ context.Context, event Event, channel model.NotificationChannel) error {
	if f.fail != nil {
		return f.fail
	}
	f.events = append(f.events, event)
	f.channels = append(f.channels, channel)
	return nil
}

// ---------- fixtures ----------

func newTestDispatcher(store Store, sender Sender) *Dispatcher {
	dispatcher := NewDispatcher(store, sender, nil)
	dispatcher.Now = func() time.Time {
		return time.Date(2024, time.June, 1, 0, 0, 0, 0, time.UTC)
	}
	return dispatcher
}

func dispatchSub(overrides func(*model.Subscription)) model.Subscription {
	balance := 5.0
	sub := model.Subscription{
		ID:               "sub-1",
		Name:             "Claude Pro",
		Category:         "AI助手",
		Provider:         "anthropic",
		SubscriptionType: "one-time",
		Price:            20,
		Status:           "active",
		Balance:          &balance,
		CreatedAt:        "2024-01-01T00:00:00Z",
		UpdatedAt:        "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&sub)
	}
	return sub
}

func dispatchChannel(overrides func(*model.NotificationChannel)) model.NotificationChannel {
	channel := model.NotificationChannel{
		ID:        "ch-1",
		Type:      TypeDingtalk,
		Name:      "Test",
		URL:       "https://example.com/hook",
		Enabled:   true,
		CreatedAt: "2024-01-01T00:00:00Z",
		UpdatedAt: "2024-01-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&channel)
	}
	return channel
}

func dispatchTrigger(overrides func(*model.ResetTickTrigger)) model.ResetTickTrigger {
	trigger := model.ResetTickTrigger{
		SubscriptionID: "sub-1",
		ScheduleType:   "monthly",
		NextResetTime:  "2024-07-01T00:00:00Z",
	}
	if overrides != nil {
		overrides(&trigger)
	}
	return trigger
}

func decodeSendBody[T any](t *testing.T, send *PreparedSend) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(send.Body, &value); err != nil {
		t.Fatalf("decode send body: %v", err)
	}
	return value
}

// ---------- resolveThreshold (2 cases) ----------

func TestResolveThresholdUsesSubscriptionThreshold(t *testing.T) {
	sub := dispatchSub(func(s *model.Subscription) {
		threshold := 50.0
		s.LowBalanceThreshold = &threshold
	})
	if got := ResolveThreshold(sub, 10); got != 50 {
		t.Errorf("ResolveThreshold = %v, want 50", got)
	}
}

func TestResolveThresholdFallsBackToGlobal(t *testing.T) {
	if got := ResolveThreshold(dispatchSub(nil), 10); got != 10 {
		t.Errorf("ResolveThreshold = %v, want the global default 10", got)
	}
}

// ---------- evaluateLowBalanceTransition (6 cases) ----------

func TestEvaluateLowBalanceTransitionDoesNotFireOnFirstObservationBelow(t *testing.T) {
	dispatcher := newTestDispatcher(newFakeStore(), nil)
	shouldFire, status, err := dispatcher.EvaluateLowBalanceTransition("sub-1", 5, 10)
	if err != nil {
		t.Fatalf("EvaluateLowBalanceTransition: %v", err)
	}
	if shouldFire || status != "below" {
		t.Errorf("(shouldFire, status) = (%v, %q), want (false, below)", shouldFire, status)
	}
}

func TestEvaluateLowBalanceTransitionDoesNotFireOnFirstObservationAbove(t *testing.T) {
	dispatcher := newTestDispatcher(newFakeStore(), nil)
	shouldFire, status, err := dispatcher.EvaluateLowBalanceTransition("sub-1", 15, 10)
	if err != nil {
		t.Fatalf("EvaluateLowBalanceTransition: %v", err)
	}
	if shouldFire || status != "above" {
		t.Errorf("(shouldFire, status) = (%v, %q), want (false, above)", shouldFire, status)
	}
}

func TestEvaluateLowBalanceTransitionDoesNotFireWhenStillBelow(t *testing.T) {
	store := newFakeStore()
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "below", UpdatedAt: "2024-01-01T00:00:00Z"}
	dispatcher := newTestDispatcher(store, nil)
	shouldFire, status, err := dispatcher.EvaluateLowBalanceTransition("sub-1", 3, 10)
	if err != nil {
		t.Fatalf("EvaluateLowBalanceTransition: %v", err)
	}
	if shouldFire || status != "below" {
		t.Errorf("(shouldFire, status) = (%v, %q), want (false, below)", shouldFire, status)
	}
}

func TestEvaluateLowBalanceTransitionFiresOnAboveToBelow(t *testing.T) {
	store := newFakeStore()
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "above", UpdatedAt: "2024-01-01T00:00:00Z"}
	dispatcher := newTestDispatcher(store, nil)
	shouldFire, status, err := dispatcher.EvaluateLowBalanceTransition("sub-1", 5, 10)
	if err != nil {
		t.Fatalf("EvaluateLowBalanceTransition: %v", err)
	}
	if !shouldFire || status != "below" {
		t.Errorf("(shouldFire, status) = (%v, %q), want (true, below)", shouldFire, status)
	}
}

func TestEvaluateLowBalanceTransitionDoesNotFireWhenStillAbove(t *testing.T) {
	store := newFakeStore()
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "above", UpdatedAt: "2024-01-01T00:00:00Z"}
	dispatcher := newTestDispatcher(store, nil)
	shouldFire, status, err := dispatcher.EvaluateLowBalanceTransition("sub-1", 15, 10)
	if err != nil {
		t.Fatalf("EvaluateLowBalanceTransition: %v", err)
	}
	if shouldFire || status != "above" {
		t.Errorf("(shouldFire, status) = (%v, %q), want (false, above)", shouldFire, status)
	}
}

func TestEvaluateLowBalanceTransitionRearmsAfterRecovery(t *testing.T) {
	store := newFakeStore()
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "below", UpdatedAt: "2024-01-01T00:00:00Z"}
	dispatcher := newTestDispatcher(store, nil)

	shouldFire, status, err := dispatcher.EvaluateLowBalanceTransition("sub-1", 15, 10)
	if err != nil {
		t.Fatalf("EvaluateLowBalanceTransition(recovered): %v", err)
	}
	if shouldFire || status != "above" {
		t.Fatalf("(shouldFire, status) = (%v, %q), want (false, above)", shouldFire, status)
	}
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: status, UpdatedAt: "2024-01-01T00:00:01Z"}

	shouldFire, _, err = dispatcher.EvaluateLowBalanceTransition("sub-1", 5, 10)
	if err != nil {
		t.Fatalf("EvaluateLowBalanceTransition(dropped again): %v", err)
	}
	if !shouldFire {
		t.Error("shouldFire = false, want true after recovering above then dropping below")
	}
}

// ---------- detectLowBalanceEvents (7 cases) ----------

func TestDetectLowBalanceEventsSkipsRecurring(t *testing.T) {
	dispatcher := newTestDispatcher(newFakeStore(), nil)
	sub := dispatchSub(func(s *model.Subscription) {
		s.SubscriptionType = "recurring"
		balance := 1.0
		s.Balance = &balance
	})
	events, err := dispatcher.DetectLowBalanceEvents([]model.Subscription{sub})
	if err != nil {
		t.Fatalf("DetectLowBalanceEvents: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("events = %d, want 0", len(events))
	}
}

func TestDetectLowBalanceEventsSkipsCancelled(t *testing.T) {
	dispatcher := newTestDispatcher(newFakeStore(), nil)
	sub := dispatchSub(func(s *model.Subscription) {
		s.Status = "cancelled"
		balance := 1.0
		s.Balance = &balance
	})
	events, err := dispatcher.DetectLowBalanceEvents([]model.Subscription{sub})
	if err != nil {
		t.Fatalf("DetectLowBalanceEvents: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("events = %d, want 0", len(events))
	}
}

func TestDetectLowBalanceEventsSkipsWithoutBalance(t *testing.T) {
	dispatcher := newTestDispatcher(newFakeStore(), nil)
	sub := dispatchSub(func(s *model.Subscription) { s.Balance = nil })
	events, err := dispatcher.DetectLowBalanceEvents([]model.Subscription{sub})
	if err != nil {
		t.Fatalf("DetectLowBalanceEvents: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("events = %d, want 0", len(events))
	}
}

func TestDetectLowBalanceEventsRecordsFirstObservationWithoutEvent(t *testing.T) {
	store := newFakeStore()
	dispatcher := newTestDispatcher(store, nil)
	events, err := dispatcher.DetectLowBalanceEvents([]model.Subscription{dispatchSub(nil)})
	if err != nil {
		t.Fatalf("DetectLowBalanceEvents: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("events = %d, want 0 on first observation", len(events))
	}
	if got := store.transitions["sub-1"].Status; got != "below" {
		t.Errorf("recorded status = %q, want below", got)
	}
}

func TestDetectLowBalanceEventsDoesNotRepeatWhileBelow(t *testing.T) {
	dispatcher := newTestDispatcher(newFakeStore(), nil)
	subs := []model.Subscription{dispatchSub(nil)}
	if _, err := dispatcher.DetectLowBalanceEvents(subs); err != nil {
		t.Fatalf("DetectLowBalanceEvents(first): %v", err)
	}
	events, err := dispatcher.DetectLowBalanceEvents(subs)
	if err != nil {
		t.Fatalf("DetectLowBalanceEvents(second): %v", err)
	}
	if len(events) != 0 {
		t.Errorf("events = %d, want 0 while still below", len(events))
	}
}

func TestDetectLowBalanceEventsEmitsOnAboveToBelowCrossing(t *testing.T) {
	store := newFakeStore()
	dispatcher := newTestDispatcher(store, nil)
	subs := []model.Subscription{dispatchSub(nil)}

	if _, err := dispatcher.DetectLowBalanceEvents(subs); err != nil {
		t.Fatalf("DetectLowBalanceEvents(first): %v", err)
	}
	above := 15.0
	subs[0].Balance = &above
	if _, err := dispatcher.DetectLowBalanceEvents(subs); err != nil {
		t.Fatalf("DetectLowBalanceEvents(second): %v", err)
	}
	below := 3.0
	subs[0].Balance = &below
	events, err := dispatcher.DetectLowBalanceEvents(subs)
	if err != nil {
		t.Fatalf("DetectLowBalanceEvents(third): %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].Kind != "low-balance" || events[0].Balance != 3 || events[0].Threshold != 10 {
		t.Errorf("event = %#v, want low-balance balance=3 threshold=10", events[0])
	}
}

func TestDetectLowBalanceEventsUsesSubscriptionThreshold(t *testing.T) {
	store := newFakeStore()
	dispatcher := newTestDispatcher(store, nil)
	sub := dispatchSub(func(s *model.Subscription) {
		threshold := 3.0
		s.LowBalanceThreshold = &threshold
	})
	events, err := dispatcher.DetectLowBalanceEvents([]model.Subscription{sub})
	if err != nil {
		t.Fatalf("DetectLowBalanceEvents: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("events = %d, want 0 on first observation", len(events))
	}
	if got := store.transitions["sub-1"].Status; got != "above" {
		t.Errorf("recorded status = %q, want above for 5 >= 3", got)
	}
}

// ---------- dispatchEvent (3 cases) ----------

func TestDispatchEventSendsToAllEnabledChannels(t *testing.T) {
	store := newFakeStore()
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)
	channels := []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-1" }),
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-2" }),
	}
	count, err := dispatcher.DispatchEvent(context.Background(), payloadLowBalanceEvent(), channels)
	if err != nil {
		t.Fatalf("DispatchEvent: %v", err)
	}
	if len(sender.sends) != 2 || count != 2 {
		t.Errorf("sends/count = %d/%d, want 2/2", len(sender.sends), count)
	}
	if len(store.sendResults) != 2 {
		t.Fatalf("send results = %d, want 2", len(store.sendResults))
	}
	for _, result := range store.sendResults {
		if !result.success {
			t.Errorf("send result %#v, want success", result)
		}
	}
}

func TestDispatchEventSkipsDisabledChannels(t *testing.T) {
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(newFakeStore(), sender)
	channel := dispatchChannel(func(ch *model.NotificationChannel) { ch.Enabled = false })
	count, err := dispatcher.DispatchEvent(context.Background(), payloadLowBalanceEvent(), []model.NotificationChannel{channel})
	if err != nil {
		t.Fatalf("DispatchEvent: %v", err)
	}
	if len(sender.sends) != 0 || count != 0 {
		t.Errorf("sends/count = %d/%d, want 0/0", len(sender.sends), count)
	}
}

func TestDispatchEventContinuesAfterSingleChannelFailure(t *testing.T) {
	store := newFakeStore()
	sender := &fakeSender{fail: func(send *PreparedSend) error {
		if send.Channel.ID == "ch-1" {
			return errBoom
		}
		return nil
	}}
	dispatcher := newTestDispatcher(store, sender)
	channels := []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-1" }),
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-2" }),
	}
	count, err := dispatcher.DispatchEvent(context.Background(), payloadLowBalanceEvent(), channels)
	if err != nil {
		t.Fatalf("DispatchEvent: %v", err)
	}
	if len(sender.sends) != 1 || sender.sends[0].Channel.ID != "ch-2" {
		t.Fatalf("sends = %#v, want only ch-2", sender.sends)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}
	failure := store.lastResultFor("ch-1")
	if failure == nil || failure.success || !strings.Contains(failure.err, "boom") {
		t.Errorf("ch-1 result = %#v, want a failure containing boom", failure)
	}
}

// ---------- rollbackTransition (1 case) ----------

func TestRollbackTransitionSetsAbove(t *testing.T) {
	store := newFakeStore()
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "below", UpdatedAt: "2024-01-01T00:00:00Z"}
	dispatcher := newTestDispatcher(store, nil)
	if err := dispatcher.RollbackTransition("sub-1"); err != nil {
		t.Fatalf("RollbackTransition: %v", err)
	}
	if got := store.transitions["sub-1"].Status; got != "above" {
		t.Errorf("status = %q, want above", got)
	}
}

// ---------- runNotificationTick (4 cases) ----------

func TestRunNotificationTickNoOpsWithoutChannels(t *testing.T) {
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(newFakeStore(), sender)
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, nil); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if len(sender.sends) != 0 {
		t.Errorf("sends = %d, want 0 with no channels configured", len(sender.sends))
	}
}

func TestRunNotificationTickDispatchesLowBalanceEvent(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{dispatchChannel(nil)}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)

	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, nil); err != nil {
		t.Fatalf("RunNotificationTick(first): %v", err)
	}
	if len(sender.sends) != 0 {
		t.Fatalf("sends = %d, want 0 on first observation", len(sender.sends))
	}

	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "above", UpdatedAt: "2024-01-01T00:00:00Z"}
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, nil); err != nil {
		t.Fatalf("RunNotificationTick(second): %v", err)
	}
	if len(sender.sends) != 1 {
		t.Fatalf("sends = %d, want 1 after the threshold crossing", len(sender.sends))
	}
	body := decodeSendBody[DingtalkPayload](t, sender.sends[0])
	if body.MsgType != "markdown" {
		t.Errorf("msgtype = %q, want markdown", body.MsgType)
	}
	if !strings.Contains(body.Markdown.Title, "余额不足") {
		t.Errorf("title = %q, want 余额不足", body.Markdown.Title)
	}
	if !strings.Contains(body.Markdown.Text, "5") {
		t.Errorf("text = %q, want the balance", body.Markdown.Text)
	}
}

func TestRunNotificationTickRollsBackWhenAllChannelsFail(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{dispatchChannel(nil)}
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "above", UpdatedAt: "2024-01-01T00:00:00Z"}
	sender := &fakeSender{fail: func(*PreparedSend) error { return errNetworkDown }}
	dispatcher := newTestDispatcher(store, sender)

	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, nil); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if got := store.transitions["sub-1"].Status; got != "above" {
		t.Errorf("status = %q, want the rolled-back above", got)
	}
	if failure := store.lastResultFor("ch-1"); failure == nil || failure.success {
		t.Errorf("ch-1 result = %#v, want a recorded failure", failure)
	}
}

func TestRunNotificationTickPersistsBelowWhenOneChannelSucceeds(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-1" }),
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-2" }),
	}
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "above", UpdatedAt: "2024-01-01T00:00:00Z"}
	sender := &fakeSender{fail: func(send *PreparedSend) error {
		if send.Channel.ID == "ch-1" {
			return errBoom
		}
		return nil
	}}
	dispatcher := newTestDispatcher(store, sender)

	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, nil); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if got := store.transitions["sub-1"].Status; got != "below" {
		t.Errorf("status = %q, want below after one channel succeeded", got)
	}
}

// ---------- detectResetEvents (4 cases) ----------

func TestDetectResetEventsEmitsOnePerTrigger(t *testing.T) {
	sub := dispatchSub(nil)
	events := DetectResetEvents(
		[]model.ResetTickTrigger{dispatchTrigger(nil)},
		[]model.Subscription{sub},
		"2024-06-01T00:00:00.000Z",
	)
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].Kind != "reset" {
		t.Errorf("kind = %q, want reset", events[0].Kind)
	}
	if events[0].Subscription.ID != "sub-1" {
		t.Errorf("subscription id = %q, want sub-1", events[0].Subscription.ID)
	}
	if events[0].ScheduleType != "monthly" {
		t.Errorf("scheduleType = %q, want monthly", events[0].ScheduleType)
	}
	if events[0].NextResetTime != "2024-07-01T00:00:00Z" {
		t.Errorf("nextResetTime = %q, want the trigger value", events[0].NextResetTime)
	}
}

func TestDetectResetEventsEmitsMultiple(t *testing.T) {
	sub1 := dispatchSub(func(s *model.Subscription) { s.ID = "sub-1" })
	sub2 := dispatchSub(func(s *model.Subscription) {
		s.ID = "sub-2"
		s.Name = "OpenAI Plus"
	})
	events := DetectResetEvents(
		[]model.ResetTickTrigger{
			dispatchTrigger(func(tr *model.ResetTickTrigger) { tr.SubscriptionID = "sub-1" }),
			dispatchTrigger(func(tr *model.ResetTickTrigger) { tr.SubscriptionID = "sub-2" }),
		},
		[]model.Subscription{sub1, sub2},
		"2024-06-01T00:00:00.000Z",
	)
	if len(events) != 2 {
		t.Errorf("events = %d, want 2", len(events))
	}
}

func TestDetectResetEventsSkipsMissingSubscription(t *testing.T) {
	events := DetectResetEvents(
		[]model.ResetTickTrigger{dispatchTrigger(func(tr *model.ResetTickTrigger) { tr.SubscriptionID = "missing" })},
		nil,
		"2024-06-01T00:00:00.000Z",
	)
	if len(events) != 0 {
		t.Errorf("events = %d, want 0 for a deleted subscription", len(events))
	}
}

func TestDetectResetEventsEmptyWithoutTriggers(t *testing.T) {
	events := DetectResetEvents(nil, []model.Subscription{dispatchSub(nil)}, "2024-06-01T00:00:00.000Z")
	if len(events) != 0 {
		t.Errorf("events = %d, want 0", len(events))
	}
}

// ---------- reset event dispatch (5 cases) ----------

func TestRunNotificationTickDispatchesResetPayload(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{dispatchChannel(nil)}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)

	triggers := []model.ResetTickTrigger{dispatchTrigger(func(tr *model.ResetTickTrigger) {
		tr.ScheduleType = "weekly"
	})}
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, triggers); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if len(sender.sends) != 1 {
		t.Fatalf("sends = %d, want 1", len(sender.sends))
	}
	body := decodeSendBody[DingtalkPayload](t, sender.sends[0])
	if body.MsgType != "markdown" {
		t.Errorf("msgtype = %q, want markdown", body.MsgType)
	}
	if !strings.Contains(body.Markdown.Title, "Claude Pro") || !strings.Contains(body.Markdown.Title, "配额已重置") {
		t.Errorf("title = %q, want Claude Pro + 配额已重置", body.Markdown.Title)
	}
	if !strings.Contains(body.Markdown.Text, "每周") {
		t.Errorf("text = %q, want 每周", body.Markdown.Text)
	}
}

func TestRunNotificationTickNoResetWithoutTriggers(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{dispatchChannel(nil)}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, []model.ResetTickTrigger{}); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if len(sender.sends) != 0 {
		t.Errorf("sends = %d, want 0", len(sender.sends))
	}
}

func TestRunNotificationTickResetFansOutToEnabledChannels(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-1" }),
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-2" }),
	}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, []model.ResetTickTrigger{dispatchTrigger(nil)}); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if len(sender.sends) != 2 {
		t.Fatalf("sends = %d, want one per enabled channel (2)", len(sender.sends))
	}
	ids := []string{sender.sends[0].Channel.ID, sender.sends[1].Channel.ID}
	if !strings.Contains(strings.Join(ids, ","), "ch-1") || !strings.Contains(strings.Join(ids, ","), "ch-2") {
		t.Errorf("channel ids = %v, want ch-1 and ch-2", ids)
	}
}

func TestRunNotificationTickResetSkipsDisabledChannels(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-1" }),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-2"
			ch.Enabled = false
		}),
	}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, []model.ResetTickTrigger{dispatchTrigger(nil)}); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if len(sender.sends) != 1 || sender.sends[0].Channel.ID != "ch-1" {
		t.Errorf("sends = %#v, want only ch-1", sender.sends)
	}
}

func TestRunNotificationTickDoesNotDedupeResetTriggers(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{dispatchChannel(nil)}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)
	triggers := []model.ResetTickTrigger{dispatchTrigger(nil)}
	for i := 0; i < 2; i++ {
		if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, triggers); err != nil {
			t.Fatalf("RunNotificationTick(%d): %v", i, err)
		}
	}
	if len(sender.sends) != 2 {
		t.Errorf("sends = %d, want 2 (reset events are not deduplicated)", len(sender.sends))
	}
}

// ---------- three-channel fanout (4 cases) ----------

func TestRunNotificationTickFansOutLowBalanceToThreeChannels(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-dt" }),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-fs"
			ch.Type = TypeFeishu
			ch.URL = "https://feishu.example/hook"
		}),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-wh"
			ch.Type = TypeWebhook
			ch.URL = "https://webhook.example/hook"
		}),
	}
	store.transitions["sub-1"] = model.BalanceTransitionState{Status: "above", UpdatedAt: "2024-01-01T00:00:00Z"}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)

	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, nil); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if len(sender.sends) != 3 {
		t.Fatalf("sends = %d, want 3", len(sender.sends))
	}
	byID := map[string]*PreparedSend{}
	for _, send := range sender.sends {
		byID[send.Channel.ID] = send
	}

	dingtalk := decodeSendBody[DingtalkPayload](t, byID["ch-dt"])
	if dingtalk.MsgType != "markdown" || !strings.Contains(dingtalk.Markdown.Title, "余额不足") {
		t.Errorf("dingtalk payload = %#v, want markdown 余额不足", dingtalk)
	}

	feishu := decodeSendBody[FeishuPayload](t, byID["ch-fs"])
	if feishu.MsgType != "interactive" || !strings.Contains(feishu.Card.Header.Title.Content, "AI订阅") {
		t.Errorf("feishu payload = %#v, want an interactive card with the keyword", feishu)
	}
	if feishu.Timestamp != "" || feishu.Sign != "" {
		t.Errorf("feishu timestamp/sign = %q/%q, want none without a secret", feishu.Timestamp, feishu.Sign)
	}
	if byID["ch-fs"].URL != "https://feishu.example/hook" {
		t.Errorf("feishu url = %q, want the channel URL", byID["ch-fs"].URL)
	}

	webhook := decodeSendBody[WebhookPayload](t, byID["ch-wh"])
	if webhook.Event != "low-balance" || webhook.Subscription.ID != "sub-1" {
		t.Errorf("webhook payload = %#v, want a low-balance event for sub-1", webhook)
	}
	if webhook.Balance == nil || *webhook.Balance != 5 || webhook.Threshold == nil || *webhook.Threshold != 10 {
		t.Errorf("webhook balance/threshold = %v/%v, want 5/10", webhook.Balance, webhook.Threshold)
	}
	if byID["ch-wh"].URL != "https://webhook.example/hook" {
		t.Errorf("webhook url = %q, want the channel URL", byID["ch-wh"].URL)
	}
}

func TestRunNotificationTickFansOutResetToThreeChannels(t *testing.T) {
	store := newFakeStore()
	store.channels = []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-dt" }),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-fs"
			ch.Type = TypeFeishu
		}),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-wh"
			ch.Type = TypeWebhook
		}),
	}
	sender := &fakeSender{}
	dispatcher := newTestDispatcher(store, sender)

	triggers := []model.ResetTickTrigger{dispatchTrigger(nil)}
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, triggers); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}
	if len(sender.sends) != 3 {
		t.Fatalf("sends = %d, want 3", len(sender.sends))
	}

	var webhookSend, feishuSend *PreparedSend
	for _, send := range sender.sends {
		switch send.Channel.ID {
		case "ch-wh":
			webhookSend = send
		case "ch-fs":
			feishuSend = send
		}
	}
	webhook := decodeSendBody[WebhookPayload](t, webhookSend)
	if webhook.Event != "reset" || webhook.ScheduleType != "monthly" || webhook.NextResetTime != "2024-07-01T00:00:00Z" {
		t.Errorf("webhook payload = %#v, want reset/monthly/nextResetTime", webhook)
	}

	feishu := decodeSendBody[FeishuPayload](t, feishuSend)
	if feishu.MsgType != "interactive" || !strings.Contains(feishu.Card.Elements[0].Content, "每月") {
		t.Errorf("feishu payload = %#v, want an interactive card with 每月", feishu)
	}
}

func TestDispatchEventThreeChannelPartialFailure(t *testing.T) {
	store := newFakeStore()
	channels := []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-dt" }),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-fs"
			ch.Type = TypeFeishu
		}),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-wh"
			ch.Type = TypeWebhook
		}),
	}
	sender := &fakeSender{fail: func(send *PreparedSend) error {
		if send.Channel.ID == "ch-fs" {
			return errFeishuDown
		}
		return nil
	}}
	dispatcher := newTestDispatcher(store, sender)

	count, err := dispatcher.DispatchEvent(context.Background(), payloadLowBalanceEvent(), channels)
	if err != nil {
		t.Fatalf("DispatchEvent: %v", err)
	}
	if len(sender.sends) != 2 || count != 2 {
		t.Errorf("sends/count = %d/%d, want 2/2", len(sender.sends), count)
	}
	if sender.sends[0].Channel.ID != "ch-dt" || sender.sends[1].Channel.ID != "ch-wh" {
		t.Errorf("successful channels = %q, %q, want ch-dt, ch-wh", sender.sends[0].Channel.ID, sender.sends[1].Channel.ID)
	}
	failure := store.lastResultFor("ch-fs")
	if failure == nil || failure.success || !strings.Contains(failure.err, "feishu down") {
		t.Errorf("ch-fs result = %#v, want failure containing feishu down", failure)
	}
}

func TestDispatchEventRecordsLastSendResultPerChannel(t *testing.T) {
	store := newFakeStore()
	channels := []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-dt" }),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-fs"
			ch.Type = TypeFeishu
		}),
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-wh"
			ch.Type = TypeWebhook
		}),
	}
	dispatcher := newTestDispatcher(store, &fakeSender{})
	if _, err := dispatcher.DispatchEvent(context.Background(), payloadLowBalanceEvent(), channels); err != nil {
		t.Fatalf("DispatchEvent: %v", err)
	}
	if len(store.sendResults) != 3 {
		t.Fatalf("send results = %d, want one per channel", len(store.sendResults))
	}
	for _, result := range store.sendResults {
		if !result.success {
			t.Errorf("send result %#v, want success", result)
		}
	}
}

// ---------- matrix-extra: end-to-end feishu delivery ----------

func TestResetEventReachesFeishuWebhookEndToEnd(t *testing.T) {
	var received []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	store := newFakeStore()
	store.channels = []model.NotificationChannel{dispatchChannel(func(ch *model.NotificationChannel) {
		ch.ID = "ch-fs"
		ch.Type = TypeFeishu
		ch.URL = server.URL
	})}
	dispatcher := NewDispatcher(store, NewHTTPSender(nil), nil)
	dispatcher.Now = func() time.Time { return time.Date(2024, time.June, 1, 0, 0, 0, 0, time.UTC) }

	triggers := []model.ResetTickTrigger{dispatchTrigger(func(tr *model.ResetTickTrigger) {
		tr.ScheduleType = "weekly"
	})}
	if err := dispatcher.RunNotificationTick(context.Background(), []model.Subscription{dispatchSub(nil)}, triggers); err != nil {
		t.Fatalf("RunNotificationTick: %v", err)
	}

	var body FeishuPayload
	if err := json.Unmarshal(received, &body); err != nil {
		t.Fatalf("decode delivered body %q: %v", received, err)
	}
	if body.MsgType != "interactive" {
		t.Errorf("msg_type = %q, want interactive", body.MsgType)
	}
	if !strings.Contains(body.Card.Header.Title.Content, "配额已重置") {
		t.Errorf("title = %q, want 配额已重置", body.Card.Header.Title.Content)
	}
	if !strings.Contains(body.Card.Elements[0].Content, "每周") {
		t.Errorf("content = %q, want 每周", body.Card.Elements[0].Content)
	}
}

// ---------- matrix-extra: feishu-app routing ----------

func TestDispatchEventRoutesFeishuAppToAppSender(t *testing.T) {
	store := newFakeStore()
	httpSender := &fakeSender{}
	appSender := &fakeFeishuAppSender{}
	dispatcher := NewDispatcher(store, httpSender, appSender)
	dispatcher.Now = func() time.Time { return time.Date(2024, time.June, 1, 0, 0, 0, 0, time.UTC) }
	channels := []model.NotificationChannel{
		dispatchChannel(func(ch *model.NotificationChannel) {
			ch.ID = "ch-app"
			ch.Type = TypeFeishuApp
			ch.AppID = "app-id"
			ch.AppSecret = "app-secret"
			ch.ReceiveID = "ou_xxx"
			ch.ReceiveIDType = "open_id"
		}),
		dispatchChannel(func(ch *model.NotificationChannel) { ch.ID = "ch-dt" }),
	}

	count, err := dispatcher.DispatchEvent(context.Background(), payloadLowBalanceEvent(), channels)
	if err != nil {
		t.Fatalf("DispatchEvent: %v", err)
	}
	if count != 2 {
		t.Errorf("count = %d, want 2", count)
	}
	if len(appSender.channels) != 1 || appSender.channels[0].ID != "ch-app" {
		t.Errorf("feishu-app sender channels = %#v, want ch-app", appSender.channels)
	}
	if len(appSender.events) != 1 || appSender.events[0].Kind != "low-balance" {
		t.Errorf("feishu-app sender events = %#v, want the low-balance event", appSender.events)
	}
	if len(httpSender.sends) != 1 || httpSender.sends[0].Channel.ID != "ch-dt" {
		t.Errorf("http sender = %#v, want only the dingtalk channel", httpSender.sends)
	}
	if len(store.sendResults) != 2 {
		t.Errorf("send results = %d, want 2", len(store.sendResults))
	}
}
