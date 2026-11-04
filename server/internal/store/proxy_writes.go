package store

// Proxy-subscription CRUD, ported from the mutation half of
// lib/proxy-subscriptions.ts. Proxy subscriptions and their tags are a separate
// entity family (ADR-0009): their own table set, their own tag catalog, and
// their own status vocabulary. All writes run in one transaction, so a
// validation or tag-resolution failure never leaves a partial record.

import (
	"context"
	"database/sql"
	"sort"
	"strings"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/proxy"
)

// ProxySubscriptionInput is the writable form of a proxy subscription. Every
// field is optional so the same type drives both create and partial update:
// nil means "not supplied" (default on create, leave unchanged on update).
type ProxySubscriptionInput struct {
	Name           *string
	MonthlyPrice   *float64
	ExpirationDate *string
	Website        *string
	Notes          *string
	Status         *string
	// TagNames, when non-nil, replaces the subscription's tag set and creates
	// any missing catalog entries.
	TagNames *[]string
}

// DeleteProxyTagResult reports the removed tag and the proxy subscriptions
// that lost it (affectedSubscriptionIds on the wire).
type DeleteProxyTagResult struct {
	TagID                   string   `json:"tagId"`
	AffectedSubscriptionIDs []string `json:"affectedSubscriptionIds"`
}

// ProxySubscriptions returns every proxy subscription in document order.
func (s *Store) ProxySubscriptions() ([]model.ProxySubscription, error) {
	data, err := s.ProxySubscriptionData()
	if err != nil {
		return nil, err
	}
	return data.Subscriptions, nil
}

// ProxySubscriptionByID returns one proxy subscription, or nil when absent.
func (s *Store) ProxySubscriptionByID(id string) (*model.ProxySubscription, error) {
	subscriptions, err := s.ProxySubscriptions()
	if err != nil {
		return nil, err
	}
	for i := range subscriptions {
		if subscriptions[i].ID == id {
			return &subscriptions[i], nil
		}
	}
	return nil, nil
}

// ProxyTags returns the proxy tag catalog newest first (getProxyTags sorts by
// createdAt descending, keeping insertion order for equal timestamps).
func (s *Store) ProxyTags() ([]model.ProxySubscriptionTag, error) {
	data, err := s.ProxySubscriptionData()
	if err != nil {
		return nil, err
	}
	tags := append([]model.ProxySubscriptionTag(nil), data.Tags...)
	sort.SliceStable(tags, func(i, j int) bool {
		return tags[j].CreatedAt < tags[i].CreatedAt
	})
	return tags, nil
}

// CreateProxySubscription validates the input, mints tag ids for the requested
// names, and persists the record atomically.
func (s *Store) CreateProxySubscription(input ProxySubscriptionInput) (*model.ProxySubscription, error) {
	if err := input.fields().Validate(); err != nil {
		return nil, err
	}
	if input.Name == nil {
		return nil, proxy.ErrNameRequired
	}
	if input.MonthlyPrice == nil {
		return nil, proxy.ErrPriceRequired
	}
	names, err := input.validatedTagNames()
	if err != nil {
		return nil, err
	}

	now := s.nowISO()
	created := model.ProxySubscription{
		ID:             newID(),
		Name:           strings.TrimSpace(*input.Name),
		MonthlyPrice:   *input.MonthlyPrice,
		ExpirationDate: derefString(input.ExpirationDate),
		Website:        derefString(input.Website),
		Notes:          derefString(input.Notes),
		Status:         defaultString(derefString(input.Status), proxy.Unused),
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	err = s.updateProxyData(func(data *model.ProxySubscriptionData) error {
		created.TagIDs = resolveProxyTagIDs(data, names, now)
		data.Subscriptions = append(data.Subscriptions, created)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &created, nil
}

// UpdateProxySubscription applies a partial update. It returns (nil, nil) when
// the id does not exist, mirroring updateProxySubscription returning null.
func (s *Store) UpdateProxySubscription(id string, input ProxySubscriptionInput) (*model.ProxySubscription, error) {
	if err := input.fields().Validate(); err != nil {
		return nil, err
	}
	names, err := input.validatedTagNames()
	if err != nil {
		return nil, err
	}

	var updated *model.ProxySubscription
	err = s.updateProxyData(func(data *model.ProxySubscriptionData) error {
		index := -1
		for i := range data.Subscriptions {
			if data.Subscriptions[i].ID == id {
				index = i
				break
			}
		}
		if index == -1 {
			return nil
		}
		existing := data.Subscriptions[index]
		next := existing

		if input.Name != nil {
			next.Name = strings.TrimSpace(*input.Name)
		}
		if input.MonthlyPrice != nil {
			next.MonthlyPrice = *input.MonthlyPrice
		}
		if input.ExpirationDate != nil {
			next.ExpirationDate = *input.ExpirationDate
		}
		if input.Website != nil {
			next.Website = *input.Website
		}
		if input.Notes != nil {
			next.Notes = *input.Notes
		}
		if input.Status != nil {
			next.Status = *input.Status
		}
		if input.TagNames != nil {
			next.TagIDs = resolveProxyTagIDs(data, names, s.nowISO())
		} else {
			next.TagIDs = existing.TagIDs
		}
		next.UpdatedAt = s.nowISO()

		data.Subscriptions[index] = next
		copied := next
		updated = &copied
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// DeleteProxySubscription removes a record; false means it did not exist.
func (s *Store) DeleteProxySubscription(id string) (bool, error) {
	deleted := false
	err := s.updateProxyData(func(data *model.ProxySubscriptionData) error {
		kept := make([]model.ProxySubscription, 0, len(data.Subscriptions))
		for _, subscription := range data.Subscriptions {
			if subscription.ID == id {
				deleted = true
				continue
			}
			kept = append(kept, subscription)
		}
		data.Subscriptions = kept
		return nil
	})
	if err != nil {
		return false, err
	}
	return deleted, nil
}

// RenameProxyTag renames a proxy tag by stable id. It returns (nil, nil) when
// the tag is absent and proxy.ErrTagNameExists for a duplicate name.
func (s *Store) RenameProxyTag(id, rawName string) (*model.ProxySubscriptionTag, error) {
	name, err := proxy.ValidateTagNames([]string{rawName})
	if err != nil {
		return nil, err
	}
	var renamed *model.ProxySubscriptionTag
	err = s.updateProxyData(func(data *model.ProxySubscriptionData) error {
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
			if i != index && data.Tags[i].Name == name[0] {
				return proxy.ErrTagNameExists
			}
		}
		data.Tags[index].Name = name[0]
		data.Tags[index].UpdatedAt = s.nowISO()
		copied := data.Tags[index]
		renamed = &copied
		return nil
	})
	if err != nil {
		return nil, err
	}
	return renamed, nil
}

// DeleteProxyTag removes a proxy tag from the catalog and from every proxy
// subscription that referenced it.
func (s *Store) DeleteProxyTag(id string) (*DeleteProxyTagResult, error) {
	var result *DeleteProxyTagResult
	err := s.updateProxyData(func(data *model.ProxySubscriptionData) error {
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
		affected := make([]string, 0)
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
		result = &DeleteProxyTagResult{TagID: id, AffectedSubscriptionIDs: affected}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// updateProxyData runs a read-modify-write cycle in one transaction.
func (s *Store) updateProxyData(fn func(*model.ProxySubscriptionData) error) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error {
		data, err := proxyData(ctx, tx)
		if err != nil {
			return err
		}
		if err := fn(data); err != nil {
			return err
		}
		return writeProxyDataTx(ctx, tx, data)
	})
}

// resolveProxyTagIDs maps names to proxy tag ids, creating missing catalog
// entries in order. Names are compared exactly (ADR-0008 semantics).
func resolveProxyTagIDs(data *model.ProxySubscriptionData, names []string, now string) []string {
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
			data.Tags = append(data.Tags, model.ProxySubscriptionTag{
				ID: found, Name: name, CreatedAt: now, UpdatedAt: now,
			})
		}
		ids = append(ids, found)
	}
	return ids
}

func (input ProxySubscriptionInput) fields() proxy.Fields {
	return proxy.Fields{
		Name:           input.Name,
		MonthlyPrice:   input.MonthlyPrice,
		ExpirationDate: input.ExpirationDate,
		Website:        input.Website,
		Notes:          input.Notes,
		Status:         input.Status,
	}
}

func (input ProxySubscriptionInput) validatedTagNames() ([]string, error) {
	if input.TagNames == nil {
		return nil, nil
	}
	return proxy.ValidateTagNames(*input.TagNames)
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
