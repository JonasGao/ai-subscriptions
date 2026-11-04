package providers

import "fmt"

// PlanSelection holds the fields that drive plan resolution for a subscription.
// It is the data structure the subscription form/create path (#26) feeds into
// the resolver below.
type PlanSelection struct {
	Provider         string
	SubscriptionType string // "recurring" | "one-time"
	PlanID           string // "" means unset
}

// PlanChanges carries the fields of an update that may affect the plan.
// A nil pointer means "field not part of this update"; this mirrors the old
// stack's `updates.x !== undefined ? updates.x : existing.x` rule.
type PlanChanges struct {
	Provider         *string
	SubscriptionType *string
	PlanID           *string
}

// ProviderByID returns the registry entry for id (zero value when unknown).
func ProviderByID(id string) (Provider, bool) {
	for _, p := range DefaultProviders() {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{}, false
}

// ResolvePlanID ports lib/db.ts resolvePlanId:
//   - one-time → always clears planId (plans are recurring-only)
//   - recurring, no plans → empty
//   - recurring, single plan → that plan (implicitly assigned)
//   - recurring, multiple plans → planId required, must exist
func ResolvePlanID(providerID, subscriptionType, planID string) (string, error) {
	if subscriptionType != "recurring" {
		return "", nil
	}

	provider, ok := ProviderByID(providerID)
	if !ok || len(provider.Plans) == 0 {
		return "", nil
	}

	if len(provider.Plans) == 1 {
		return provider.Plans[0].ID, nil
	}

	if planID == "" {
		return "", fmt.Errorf(`Provider %q has multiple plans; planId is required`, providerID)
	}
	for _, plan := range provider.Plans {
		if plan.ID == planID {
			return planID, nil
		}
	}
	return "", fmt.Errorf(`Plan %q not found for provider %q`, planID, providerID)
}

// ResolvePlanIDOnCreate applies the plan rules to a new subscription.
func ResolvePlanIDOnCreate(sel PlanSelection) (string, error) {
	return ResolvePlanID(sel.Provider, sel.SubscriptionType, sel.PlanID)
}

// ResolvePlanIDOnUpdate applies the plan rules after an update. The plan is
// re-resolved only when the update touches provider, subscriptionType or
// planId; otherwise the current planId is preserved untouched.
func ResolvePlanIDOnUpdate(current PlanSelection, changes PlanChanges) (string, error) {
	if changes.Provider == nil && changes.SubscriptionType == nil && changes.PlanID == nil {
		return current.PlanID, nil
	}

	provider := current.Provider
	if changes.Provider != nil {
		provider = *changes.Provider
	}
	subscriptionType := current.SubscriptionType
	if changes.SubscriptionType != nil {
		subscriptionType = *changes.SubscriptionType
	}
	planID := current.PlanID
	if changes.PlanID != nil {
		planID = *changes.PlanID
	}

	return ResolvePlanID(provider, subscriptionType, planID)
}

// ResolveUsageAPIURL ports lib/api-url-resolver.ts resolveUsageApiUrl:
// plan-level URL when planId matches, otherwise the provider-level URL.
func ResolveUsageAPIURL(provider Provider, planID string) string {
	if planID != "" {
		for _, plan := range provider.Plans {
			if plan.ID == planID && plan.UsageAPIURL != "" {
				return plan.UsageAPIURL
			}
		}
	}
	return provider.UsageAPIURL
}

// ResolveModelsAPIURL ports lib/api-url-resolver.ts resolveModelsApiUrl.
func ResolveModelsAPIURL(provider Provider, planID string) string {
	if planID != "" {
		for _, plan := range provider.Plans {
			if plan.ID == planID && plan.ModelsAPIURL != "" {
				return plan.ModelsAPIURL
			}
		}
	}
	return provider.ModelsAPIURL
}

// ResolveModelsRequireCredentials ports
// lib/api-url-resolver.ts resolveModelsRequireCredentials: a plan-level flag
// overrides the provider flag, defaulting to true when neither is set.
func ResolveModelsRequireCredentials(provider Provider, planID string) bool {
	if planID != "" {
		for _, plan := range provider.Plans {
			if plan.ID == planID && plan.ModelsRequireCredentials != nil {
				return *plan.ModelsRequireCredentials
			}
		}
	}
	if provider.ModelsRequireCredentials != nil {
		return *provider.ModelsRequireCredentials
	}
	return true
}
