package notify

// Event detection and fan-out, ported from lib/notifications/dispatcher.ts.
//
// The old module imported the storage singleton directly; here persistence is
// a narrow Store interface implemented by internal/store, and the two senders
// (HTTP webhooks and the Feishu app bot) are injectable. The behaviour is
// otherwise identical: the threshold state machine only fires on an
// above→below crossing, reset events are never deduplicated, and a low-balance
// transition is rolled back when every enabled channel fails.

import (
	"context"
	"fmt"
	"time"

	"ai-subscriptions/internal/model"
)

// Threshold transition states persisted per subscription.
const (
	transitionAbove = "above"
	transitionBelow = "below"
)

// TransitionStore is the persistence seam for the low-balance state machine.
type TransitionStore interface {
	DefaultLowBalanceThreshold() (float64, error)
	BalanceTransitionState(subscriptionID string) (*model.BalanceTransitionState, error)
	SetBalanceTransitionState(subscriptionID string, state model.BalanceTransitionState) error
}

// ChannelStore is the persistence seam for channels and their send results.
type ChannelStore interface {
	NotificationChannels() ([]model.NotificationChannel, error)
	SetNotificationChannelSendResult(id string, result model.SendResult) error
}

// Store is everything the dispatcher needs from the storage layer.
type Store interface {
	TransitionStore
	ChannelStore
}

// Sender delivers one prepared HTTP webhook send.
type Sender interface {
	Send(send *PreparedSend) error
}

// SenderFunc adapts a function to Sender, the same injectable-seam shape the
// old tests used for their fake sender.
type SenderFunc func(send *PreparedSend) error

// Send calls f.
func (f SenderFunc) Send(send *PreparedSend) error { return f(send) }

// FeishuAppSender delivers an event through a feishu-app channel (app bot with
// token management and retry). *FeishuClient implements it.
type FeishuAppSender interface {
	SendToChannel(ctx context.Context, event Event, channel model.NotificationChannel) error
}

// Dispatcher runs event detection and fan-out on the notification tick.
type Dispatcher struct {
	Store     Store
	Sender    Sender
	FeishuApp FeishuAppSender
	// Now is the clock seam; nil means time.Now.
	Now func() time.Time
}

// NewDispatcher wires the store and senders. A nil HTTP sender defaults to the
// production HTTPSender and a nil feishu-app sender to the process-wide app
// client, exactly like the old default sender / defaultFeishuAppSender.
func NewDispatcher(store Store, sender Sender, feishuApp FeishuAppSender) *Dispatcher {
	if sender == nil {
		sender = NewHTTPSender(nil)
	}
	if feishuApp == nil {
		feishuApp = DefaultFeishuClient()
	}
	return &Dispatcher{Store: store, Sender: sender, FeishuApp: feishuApp}
}

func (d *Dispatcher) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// ResolveThreshold returns the subscription-level low-balance threshold when
// set, otherwise the global default.
func ResolveThreshold(subscription model.Subscription, globalDefault float64) float64 {
	if subscription.LowBalanceThreshold != nil {
		return *subscription.LowBalanceThreshold
	}
	return globalDefault
}

// EvaluateLowBalanceTransition reports whether this observation is an
// above→below crossing. The first observation never fires: it only records the
// state so pre-existing low-balance subscriptions do not all alert at once on
// first deployment. The caller persists the returned status.
func (d *Dispatcher) EvaluateLowBalanceTransition(subscriptionID string, balance, threshold float64) (bool, string, error) {
	current := transitionAbove
	if balance < threshold {
		current = transitionBelow
	}

	previous, err := d.Store.BalanceTransitionState(subscriptionID)
	if err != nil {
		return false, current, fmt.Errorf("read balance transition state %q: %w", subscriptionID, err)
	}
	if previous == nil {
		return false, current, nil
	}
	shouldFire := previous.Status == transitionAbove && current == transitionBelow
	return shouldFire, current, nil
}

// DetectLowBalanceEvents records the current threshold state for every eligible
// one-time subscription and returns the events that crossed from above to below
// on this tick.
func (d *Dispatcher) DetectLowBalanceEvents(subscriptions []model.Subscription) ([]Event, error) {
	defaultThreshold, err := d.Store.DefaultLowBalanceThreshold()
	if err != nil {
		return nil, fmt.Errorf("read default low-balance threshold: %w", err)
	}

	now := d.now()
	nowISO := model.FormatTimestamp(now)
	events := make([]Event, 0)

	for _, sub := range subscriptions {
		if sub.SubscriptionType != "one-time" || sub.Status == "cancelled" || sub.Balance == nil {
			continue
		}

		threshold := ResolveThreshold(sub, defaultThreshold)
		shouldFire, status, err := d.EvaluateLowBalanceTransition(sub.ID, *sub.Balance, threshold)
		if err != nil {
			return nil, err
		}
		if err := d.Store.SetBalanceTransitionState(sub.ID, model.BalanceTransitionState{
			Status:    status,
			UpdatedAt: nowISO,
		}); err != nil {
			return nil, fmt.Errorf("write balance transition state %q: %w", sub.ID, err)
		}

		if shouldFire {
			events = append(events, Event{
				Kind:         "low-balance",
				Subscription: sub,
				Balance:      *sub.Balance,
				Threshold:    threshold,
				TriggeredAt:  nowISO,
			})
		}
	}
	return events, nil
}

// DispatchEvent sends one event to every enabled channel. Individual channel
// failures are recorded in lastSendResult and never abort the remaining
// channels. It returns the number of successful channels; a nil FeishuApp
// sender is treated as a channel failure rather than a panic.
func (d *Dispatcher) DispatchEvent(ctx context.Context, event Event, channels []model.NotificationChannel) (int, error) {
	successCount := 0
	var firstErr error

	for _, channel := range channels {
		if !channel.Enabled {
			continue
		}

		var sendErr error
		if channel.Type == TypeFeishuApp {
			if d.FeishuApp == nil {
				sendErr = fmt.Errorf("no feishu-app sender configured for channel %s", channel.ID)
			} else {
				sendErr = d.FeishuApp.SendToChannel(ctx, event, channel)
			}
		} else {
			prepared, err := PrepareSend(channel, event, d.now())
			if err != nil {
				sendErr = err
			} else {
				sendErr = d.Sender.Send(prepared)
			}
		}

		result := model.SendResult{Success: sendErr == nil, Timestamp: model.FormatTimestamp(d.now())}
		if sendErr != nil {
			result.Error = sendErr.Error()
		} else {
			successCount++
		}
		if err := d.Store.SetNotificationChannelSendResult(channel.ID, result); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("record send result for channel %q: %w", channel.ID, err)
		}
	}
	return successCount, firstErr
}

// RollbackTransition puts a subscription back to "above" so the next tick can
// re-evaluate it after every enabled channel failed.
func (d *Dispatcher) RollbackTransition(subscriptionID string) error {
	if err := d.Store.SetBalanceTransitionState(subscriptionID, model.BalanceTransitionState{
		Status:    transitionAbove,
		UpdatedAt: model.FormatTimestamp(d.now()),
	}); err != nil {
		return fmt.Errorf("roll back balance transition state %q: %w", subscriptionID, err)
	}
	return nil
}

// DetectResetEvents builds one reset event per trigger. Triggers come
// pre-filtered from ProcessResetTick (cancelled subscriptions and disabled
// schedules never appear); a trigger whose subscription no longer exists is
// silently skipped.
func DetectResetEvents(triggers []model.ResetTickTrigger, subscriptions []model.Subscription, triggeredAt string) []Event {
	byID := make(map[string]model.Subscription, len(subscriptions))
	for _, sub := range subscriptions {
		byID[sub.ID] = sub
	}

	events := make([]Event, 0, len(triggers))
	for _, trigger := range triggers {
		sub, ok := byID[trigger.SubscriptionID]
		if !ok {
			continue
		}
		events = append(events, Event{
			Kind:          "reset",
			Subscription:  sub,
			ScheduleType:  trigger.ScheduleType,
			NextResetTime: trigger.NextResetTime,
			TriggeredAt:   triggeredAt,
		})
	}
	return events
}

// RunNotificationTick is the top-level tick entry point: reset events are
// dispatched first (no deduplication, no rollback), then low-balance events
// (rolled back to "above" when every enabled channel failed). With no channels
// configured the tick is a no-op, exactly like the old runNotificationTick.
func (d *Dispatcher) RunNotificationTick(ctx context.Context, subscriptions []model.Subscription, resetTriggers []model.ResetTickTrigger) error {
	channels, err := d.Store.NotificationChannels()
	if err != nil {
		return fmt.Errorf("list notification channels: %w", err)
	}
	if len(channels) == 0 {
		return nil
	}

	var firstErr error
	for _, event := range DetectResetEvents(resetTriggers, subscriptions, model.FormatTimestamp(d.now())) {
		if _, err := d.DispatchEvent(ctx, event, channels); err != nil && firstErr == nil {
			firstErr = err
		}
	}

	lowBalanceEvents, err := d.DetectLowBalanceEvents(subscriptions)
	if err != nil {
		return err
	}
	for _, event := range lowBalanceEvents {
		successCount, err := d.DispatchEvent(ctx, event, channels)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		if successCount == 0 {
			if err := d.RollbackTransition(event.Subscription.ID); err != nil {
				return err
			}
		}
	}
	return firstErr
}
