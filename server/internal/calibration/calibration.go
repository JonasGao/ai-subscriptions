// Package calibration ports the scheduler entry point of
// lib/reset-alignment.ts (ADR-0014 / ADR-0016): after a reset tick, query the
// usage API for every triggered subscription, once per subscription, and let
// the store reverse-derive the schedule config from the returned reset time.
//
// Notifications never wait for or depend on calibration: failures only log and
// skip, matching the old stack's try/catch envelope.
package calibration

import (
	"context"
	"log"
	"os"

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/providers"
	"ai-subscriptions/internal/store"
)

// UsageFetcher fetches one subscription's usage result. ok=false means the
// fetch was skipped or failed; the caller leaves the subscription untouched.
// The default implementation resolves the provider handler and decrypts
// credentials; tests inject a fake to state the exact result per case.
type UsageFetcher func(ctx context.Context, sub model.Subscription) (providers.UsageResult, bool)

// Service runs query-driven reset-time calibration.
type Service struct {
	Data  *store.Store
	Fetch UsageFetcher
}

// New builds a Service bound to a store, credential cipher and outbound HTTP
// client (nil = providers.DefaultHTTPClient). A nil cipher derives one from
// NEXTAUTH_SECRET like the rest of the old stack.
func New(data *store.Store, cipher *crypto.Cipher, client providers.HTTPDoer) *Service {
	if cipher == nil {
		cipher = crypto.NewFromEnv(os.Getenv)
	}
	service := &Service{Data: data}
	service.Fetch = service.defaultFetch(cipher, client)
	return service
}

// AlignResetTimes is the scheduler entry point. Triggers are deduped by
// subscription id (one fetch covers all of a subscription's schedules); each
// subscription's schedules are then calibrated in a single read-modify-write
// pass inside the store.
func (s *Service) AlignResetTimes(ctx context.Context, triggers []model.ResetTickTrigger) error {
	if len(triggers) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(triggers))
	subIDs := make([]string, 0, len(triggers))
	for _, trigger := range triggers {
		if _, exists := seen[trigger.SubscriptionID]; exists {
			continue
		}
		seen[trigger.SubscriptionID] = struct{}{}
		subIDs = append(subIDs, trigger.SubscriptionID)
	}

	for _, subscriptionID := range subIDs {
		sub, err := s.Data.SubscriptionByID(subscriptionID)
		if err != nil {
			return err
		}
		if sub == nil {
			log.Printf("[Scheduler] Reset-time calibration skipped for (%s): subscription not found", subscriptionID)
			continue
		}
		result, ok := s.Fetch(ctx, *sub)
		if !ok {
			continue
		}
		if _, err := s.Data.CalibrateSubscriptionFromUsage(subscriptionID, result); err != nil {
			return err
		}
	}
	return nil
}

// defaultFetch ports computeCandidatesForSub: preconditions first (credentials,
// then usage-handler resolution), then one provider call. Every skip only logs.
func (s *Service) defaultFetch(cipher *crypto.Cipher, client providers.HTTPDoer) UsageFetcher {
	return func(ctx context.Context, sub model.Subscription) (providers.UsageResult, bool) {
		if sub.Credentials == "" {
			skip(sub, "no credentials", "")
			return providers.UsageResult{}, false
		}
		if sub.SubscriptionType != "recurring" {
			skip(sub, "not recurring", "")
			return providers.UsageResult{}, false
		}
		provider, ok := providers.ProviderByID(sub.Provider)
		if !ok || providers.ResolveUsageAPIURL(provider, sub.PlanID) == "" {
			skip(sub, "no usage API URL", "")
			return providers.UsageResult{}, false
		}
		handlerKey := providers.ResolveUsageHandlerKey(sub.Provider, sub.PlanID)
		if !providers.HasUsageHandler(handlerKey) {
			skip(sub, "no handler", "")
			return providers.UsageResult{}, false
		}
		handler := providers.UsageHandlers(client)[handlerKey]
		if handler == nil {
			skip(sub, "no handler", "")
			return providers.UsageResult{}, false
		}

		credentials := cipher.DecryptCredentials(sub.Credentials)
		if len(credentials) == 0 {
			// The old stack threw from JSON.parse here; a blob that does not
			// decrypt is treated as a failed fetch, not as empty credentials.
			skip(sub, "fetch failed", "")
			return providers.UsageResult{}, false
		}
		result, err := handler.FetchUsage(ctx, credentials)
		if err != nil {
			skip(sub, "fetch failed", "")
			return providers.UsageResult{}, false
		}
		return result, true
	}
}

func skip(sub model.Subscription, reason string, schedulePart string) {
	if schedulePart != "" {
		log.Printf("[Scheduler] Reset-time calibration skipped for %s(%s) %s: %s", sub.Name, sub.ID, schedulePart, reason)
		return
	}
	log.Printf("[Scheduler] Reset-time calibration skipped for %s(%s): %s", sub.Name, sub.ID, reason)
}
