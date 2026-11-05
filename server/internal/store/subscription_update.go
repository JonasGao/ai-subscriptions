package store

import (
	"errors"
	"fmt"
	"strings"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/providers"
	"ai-subscriptions/internal/tags"
)

// SubscriptionUpdates is the sparse update accepted by UpdateSubscription. A
// nil pointer means "field absent from the request" and leaves the stored value
// untouched; that mirrors the old stack's `{...existing, ...updates}` spread.
type SubscriptionUpdates struct {
	Name             *string
	Category         *string
	Provider         *string
	ProviderCustom   *string
	SubscriptionType *string
	BillingCycle     *string
	Price            *float64
	StartDate        *string
	RenewalDate      *string
	Status           *string
	Notes            *string
	// Credentials is ciphertext; the HTTP layer encrypts, the store persists
	// verbatim (ADR-0017).
	Credentials         *string
	Balance             *float64
	BalanceCurrency     *string
	LowBalanceThreshold *float64
	// ClearLowBalanceThreshold clears the field (lib/db.ts normalizeNullable
	// turns an explicit null into "overwrite with no value").
	ClearLowBalanceThreshold bool
	ResetSchedules           *[]model.ResetSchedule
	PlanID                   *string
	// ClearPlanID forces the plan to be re-resolved as unset (one-time).
	ClearPlanID bool
}

// Validation errors surfaced verbatim by the HTTP layer (lib/db.ts messages).
var (
	ErrUpdateName       = errors.New("Subscription name must be a non-empty string")
	ErrUpdateBalanceCur = errors.New("balanceCurrency must be a non-empty string")
	ErrUpdateStatus     = errors.New("Invalid status value")
	ErrUpdateType       = errors.New("Invalid subscriptionType value")
	ErrUpdateCycle      = errors.New("Invalid billingCycle value")
)

// UpdateSubscription applies a sparse update and returns the saved record, or
// nil when the id does not exist. tagNames == nil keeps the current tag
// associations; a non-nil slice replaces them (resolving by name, ADR-0008).
func (s *Store) UpdateSubscription(id string, updates SubscriptionUpdates, tagNames *[]string) (*model.Subscription, error) {
	if err := validateUpdates(updates); err != nil {
		return nil, err
	}

	var names []string
	if tagNames != nil {
		resolved, err := tags.ValidateNames(*tagNames)
		if err != nil {
			return nil, err
		}
		names = resolved
	}

	now := s.nowISO()
	var updated *model.Subscription
	err := s.updateSubscriptionData(func(data *model.SubscriptionData) (bool, error) {
		index := -1
		for i := range data.Subscriptions {
			if data.Subscriptions[i].ID == id {
				index = i
				break
			}
		}
		if index == -1 {
			return false, nil
		}

		existing := data.Subscriptions[index]
		merged := existing
		if updates.Name != nil {
			merged.Name = *updates.Name
		}
		if updates.Category != nil {
			merged.Category = *updates.Category
		}
		if updates.Provider != nil {
			merged.Provider = *updates.Provider
		}
		if updates.ProviderCustom != nil {
			merged.ProviderCustom = *updates.ProviderCustom
		}
		if updates.SubscriptionType != nil {
			merged.SubscriptionType = *updates.SubscriptionType
		}
		if updates.BillingCycle != nil {
			merged.BillingCycle = *updates.BillingCycle
		}
		if updates.Price != nil {
			merged.Price = *updates.Price
		}
		if updates.StartDate != nil {
			merged.StartDate = *updates.StartDate
		}
		if updates.RenewalDate != nil {
			merged.RenewalDate = *updates.RenewalDate
		}
		if updates.Status != nil {
			merged.Status = *updates.Status
		}
		if updates.Notes != nil {
			merged.Notes = *updates.Notes
		}
		if updates.Credentials != nil {
			merged.Credentials = *updates.Credentials
		}
		if updates.Balance != nil {
			value := *updates.Balance
			merged.Balance = &value
		}
		if updates.BalanceCurrency != nil {
			merged.BalanceCurrency = *updates.BalanceCurrency
		}
		if updates.ClearLowBalanceThreshold {
			merged.LowBalanceThreshold = nil
		} else if updates.LowBalanceThreshold != nil {
			value := *updates.LowBalanceThreshold
			merged.LowBalanceThreshold = &value
		}
		if updates.ResetSchedules != nil {
			merged.ResetSchedules = *updates.ResetSchedules
		}

		// ADR-0005: plan resolution re-runs when the update touches any of
		// provider / subscriptionType / planId, and always clears the plan for
		// a one-time subscription.
		if updates.Provider != nil || updates.SubscriptionType != nil || updates.PlanID != nil || updates.ClearPlanID {
			planID := merged.PlanID
			if updates.ClearPlanID {
				planID = ""
			}
			if updates.PlanID != nil {
				planID = *updates.PlanID
			}
			resolved, err := providers.ResolvePlanIDOnUpdate(
				providers.PlanSelection{
					Provider:         existing.Provider,
					SubscriptionType: existing.SubscriptionType,
					PlanID:           existing.PlanID,
				},
				providers.PlanChanges{
					Provider:         updates.Provider,
					SubscriptionType: updates.SubscriptionType,
					PlanID:           &planID,
				},
			)
			if err != nil {
				return false, err
			}
			merged.PlanID = resolved
		}

		// Schedule edits derive status unless the caller explicitly chose one
		// (lib/db.ts updateSubscription).
		if updates.ResetSchedules != nil && updates.Status == nil {
			merged.Status = deriveStatus(merged)
		}

		if tagNames != nil {
			merged.TagIDs = resolveTagIDs(data, names, now)
		}

		merged.UpdatedAt = now
		data.Subscriptions[index] = merged
		copy := merged
		updated = &copy
		return true, nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func validateUpdates(updates SubscriptionUpdates) error {
	if updates.Name != nil && strings.TrimSpace(*updates.Name) == "" {
		return ErrUpdateName
	}
	if updates.Price != nil && *updates.Price < 0 {
		return ErrPriceInvalid
	}
	if updates.Balance != nil && *updates.Balance < 0 {
		return ErrBalanceInvalid
	}
	if updates.BalanceCurrency != nil && strings.TrimSpace(*updates.BalanceCurrency) == "" {
		return ErrUpdateBalanceCur
	}
	if updates.LowBalanceThreshold != nil && *updates.LowBalanceThreshold < 0 {
		return ErrThresholdInvalid
	}
	if updates.Status != nil && !validStatus(*updates.Status) {
		return ErrUpdateStatus
	}
	if updates.SubscriptionType != nil && !validSubscriptionType(*updates.SubscriptionType) {
		return ErrUpdateType
	}
	if updates.BillingCycle != nil && !validBillingCycle(*updates.BillingCycle) {
		return ErrUpdateCycle
	}
	if updates.ResetSchedules != nil {
		if err := assertUniqueScheduleTypes(*updates.ResetSchedules); err != nil {
			return err
		}
	}
	return nil
}

func validStatus(value string) bool {
	switch value {
	case "active", "paused", "cancelled":
		return true
	}
	return false
}

func validSubscriptionType(value string) bool {
	switch value {
	case "recurring", "one-time":
		return true
	}
	return false
}

func validBillingCycle(value string) bool {
	switch value {
	case "monthly", "yearly":
		return true
	}
	return false
}

// resolvePlanIDOnCreate applies ADR-0005 to a new subscription: one-time
// clears the plan; a recurring provider with one plan gets it implicitly; a
// multi-plan provider requires an explicit, valid planId.
func resolvePlanIDOnCreate(input SubscriptionInput) (string, error) {
	planID, err := providers.ResolvePlanIDOnCreate(providers.PlanSelection{
		Provider:         input.Provider,
		SubscriptionType: defaultString(input.SubscriptionType, "recurring"),
		PlanID:           input.PlanID,
	})
	if err != nil {
		return "", fmt.Errorf("%w", err)
	}
	return planID, nil
}
