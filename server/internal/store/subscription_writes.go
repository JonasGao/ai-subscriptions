package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/tags"
)

// Errors returned by the write APIs. Messages carry over from lib/db.ts because
// the HTTP layer surfaces them to the user verbatim.
var (
	ErrNameRequired     = errors.New("Subscription name is required")
	ErrPriceInvalid     = errors.New("Price must be a non-negative number")
	ErrBalanceInvalid   = errors.New("Balance must be a non-negative number")
	ErrThresholdInvalid = errors.New("lowBalanceThreshold must be a non-negative finite number")
	ErrTagNameExists    = errors.New("标签名称已存在")
)

// SubscriptionInput is the writable part of a subscription on create
// (createSubscription's first argument in lib/db.ts, minus generated fields).
type SubscriptionInput struct {
	Name             string
	Category         string
	Provider         string
	ProviderCustom   string
	SubscriptionType string
	BillingCycle     string
	Price            float64
	StartDate        string
	RenewalDate      string
	Status           string
	Notes            string
	// Credentials is the ciphertext as produced by crypto.Cipher; the store
	// never decrypts or re-encrypts it (ADR-0017).
	Credentials         string
	Balance             *float64
	BalanceCurrency     string
	LowBalanceThreshold *float64
	ResetSchedules      []model.ResetSchedule
	PlanID              string
}

// DeleteTagResult reports which subscriptions lost an association.
type DeleteTagResult struct {
	TagID                   string   `json:"tagId"`
	AffectedSubscriptionIDs []string `json:"affectedSubscriptionIds"`
}

// Tags returns the tag catalog, newest first (lib/db.ts getTags), falling back
// to insertion order for identical timestamps.
func (s *Store) Tags() ([]model.Tag, error) {
	all, err := s.tags(context.Background(), s.db)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(all, func(i, j int) bool {
		return all[j].CreatedAt < all[i].CreatedAt
	})
	return all, nil
}

// CreateSubscription validates input, mints tag ids for the requested names,
// and persists the new subscription. Nothing is written when validation fails.
func (s *Store) CreateSubscription(input SubscriptionInput, tagNames []string) (*model.Subscription, error) {
	if err := validateInput(input); err != nil {
		return nil, err
	}
	// Validate names up front so an invalid set never reaches the transaction.
	names, err := tags.ValidateNames(tagNames)
	if err != nil {
		return nil, err
	}

	// ADR-0005: the persisted planId is derived from provider/type/planId.
	planID, err := resolvePlanIDOnCreate(input)
	if err != nil {
		return nil, err
	}

	now := s.nowISO()
	created := model.Subscription{
		ID:               newID(),
		Name:             input.Name,
		Category:         input.Category,
		Provider:         input.Provider,
		ProviderCustom:   input.ProviderCustom,
		SubscriptionType: defaultString(input.SubscriptionType, "recurring"),
		// lib/db.ts readData normalized every stored record to
		// `billingCycle || "monthly"`, so an omitted cycle never round-tripped
		// as absent. Persisting the default keeps the wire shape identical.
		BillingCycle:        defaultString(input.BillingCycle, "monthly"),
		Price:               input.Price,
		StartDate:           input.StartDate,
		RenewalDate:         input.RenewalDate,
		Status:              defaultString(input.Status, "active"),
		Notes:               input.Notes,
		Credentials:         input.Credentials,
		Balance:             input.Balance,
		BalanceCurrency:     input.BalanceCurrency,
		LowBalanceThreshold: input.LowBalanceThreshold,
		ResetSchedules:      input.ResetSchedules,
		PlanID:              planID,
		CreatedAt:           now,
		UpdatedAt:           now,
	}

	err = s.UpdateSubscriptionData(func(data *model.SubscriptionData) error {
		created.TagIDs = resolveTagIDs(data, names, now)
		data.Subscriptions = append(data.Subscriptions, created)
		return nil
	})

	if err != nil {
		return nil, err
	}
	return &created, nil
}

// RenameTag renames a tag by stable id (ADR-0008). Renaming to its current name
// is a no-op; renaming onto another tag's exact name is rejected.
func (s *Store) RenameTag(id, rawName string) (*model.Tag, error) {
	name, err := tags.ValidateName(rawName)
	if err != nil {
		return nil, err
	}

	var renamed *model.Tag
	err = s.UpdateSubscriptionData(func(data *model.SubscriptionData) error {
		index := -1
		for i := range data.Tags {
			if data.Tags[i].ID == id {
				index = i
				break
			}
		}
		if index == -1 {
			return nil
		}
		for i := range data.Tags {
			if i != index && data.Tags[i].Name == name {
				return ErrTagNameExists
			}
		}
		if data.Tags[index].Name != name {
			data.Tags[index].Name = name
			data.Tags[index].UpdatedAt = s.nowISO()
		}
		renamed = &data.Tags[index]
		return nil
	})
	if err != nil {
		return nil, err
	}
	return renamed, nil
}

// DeleteTag removes a tag and its association from every subscription,
// returning the affected subscription ids in document order.
func (s *Store) DeleteTag(id string) (*DeleteTagResult, error) {
	var result *DeleteTagResult
	err := s.UpdateSubscriptionData(func(data *model.SubscriptionData) error {
		index := -1
		for i := range data.Tags {
			if data.Tags[i].ID == id {
				index = i
				break
			}
		}
		if index == -1 {
			return nil
		}

		now := s.nowISO()
		affected := make([]string, 0, len(data.Subscriptions))
		for i := range data.Subscriptions {
			kept := make([]string, 0, len(data.Subscriptions[i].TagIDs))
			for _, tagID := range data.Subscriptions[i].TagIDs {
				if tagID != id {
					kept = append(kept, tagID)
				}
			}
			if len(kept) != len(data.Subscriptions[i].TagIDs) {
				data.Subscriptions[i].TagIDs = kept
				data.Subscriptions[i].UpdatedAt = now
				affected = append(affected, data.Subscriptions[i].ID)
			}
		}

		data.Tags = append(data.Tags[:index], data.Tags[index+1:]...)
		result = &DeleteTagResult{TagID: id, AffectedSubscriptionIDs: affected}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// DeleteSubscription removes a subscription and scrubs its id from every
// priority scene, mirroring lib/db.ts deleteSubscription.
func (s *Store) DeleteSubscription(id string) (bool, error) {
	ctx := context.Background()
	deleted := false
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "DELETE FROM subscriptions WHERE id = ?", id)
		if err != nil {
			return fmt.Errorf("delete subscription: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return nil
		}
		deleted = true
		return prunePrioritySceneItems(ctx, tx, id)
	})
	return deleted, err
}

// resolveTagIDs maps names to tag ids, creating tags that do not exist yet.
// Names are matched exactly (case-sensitive) per ADR-0008.
func resolveTagIDs(data *model.SubscriptionData, names []string, now string) []string {
	ids := make([]string, 0, len(names))
	for _, name := range names {
		found := ""
		for _, tag := range data.Tags {
			if tag.Name == name {
				found = tag.ID
				break
			}
		}
		if found == "" {
			found = newID()
			data.Tags = append(data.Tags, model.Tag{ID: found, Name: name, CreatedAt: now, UpdatedAt: now})
		}
		ids = append(ids, found)
	}
	return ids
}

func validateInput(input SubscriptionInput) error {
	if isBlank(input.Name) {
		return ErrNameRequired
	}
	if input.Price < 0 {
		return ErrPriceInvalid
	}
	if input.Balance != nil && *input.Balance < 0 {
		return ErrBalanceInvalid
	}
	if input.LowBalanceThreshold != nil && *input.LowBalanceThreshold < 0 {
		return ErrThresholdInvalid
	}
	switch input.SubscriptionType {
	case "", "recurring", "one-time":
	default:
		return errors.New("Invalid subscriptionType")
	}
	switch input.BillingCycle {
	case "", "monthly", "yearly":
	default:
		return errors.New("Invalid billingCycle")
	}
	if input.SubscriptionType == "recurring" && input.BillingCycle == "" {
		return errors.New("billingCycle is required for recurring subscriptions")
	}
	if err := assertUniqueScheduleTypes(input.ResetSchedules); err != nil {
		return err
	}
	return nil
}

// assertUniqueScheduleTypes enforces at most one schedule per type.
func assertUniqueScheduleTypes(schedules []model.ResetSchedule) error {
	seen := make(map[string]struct{}, len(schedules))
	for _, schedule := range schedules {
		if _, dup := seen[schedule.Type]; dup {
			return fmt.Errorf("Duplicate schedule type %q — each type is allowed at most once", schedule.Type)
		}
		seen[schedule.Type] = struct{}{}
	}
	return nil
}

func isBlank(value string) bool {
	for _, r := range value {
		if r != ' ' && r != '\t' && r != '\n' && r != '\r' {
			return false
		}
	}
	return true
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
