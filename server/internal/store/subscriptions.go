package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"ai-subscriptions/internal/model"
)

// SubscriptionData is the in-memory form of the old subscriptions.json
// document: subscriptions plus their categories and tag catalog.
//
// Reading and writing it atomically replaces the old "read the whole file,
// mutate, rewrite the whole file" style; SQLite's transaction closes the
// lost-update window the old stack had.
func (s *Store) ReadSubscriptionData() (*model.SubscriptionData, error) {
	ctx := context.Background()
	data := &model.SubscriptionData{}

	categories, err := s.categories(ctx, s.db)
	if err != nil {
		return nil, err
	}
	data.Categories = categories

	tags, err := s.tags(ctx, s.db)
	if err != nil {
		return nil, err
	}
	data.Tags = tags

	subscriptions, err := s.subscriptions(ctx, s.db)
	if err != nil {
		return nil, err
	}
	data.Subscriptions = subscriptions
	return data, nil
}

// WriteSubscriptionData replaces the whole document atomically.
func (s *Store) WriteSubscriptionData(data *model.SubscriptionData) error {
	if data == nil {
		return errors.New("store: nil subscription data")
	}
	return s.withTx(context.Background(), func(tx *sql.Tx) error {
		return s.writeSubscriptionData(context.Background(), tx, data)
	})
}

// UpdateSubscriptionData runs a read-modify-write cycle in one transaction.
// The callback may return an error to abort without persisting anything —
// this is how partial tag-resolution failures stay partial-write-free.
func (s *Store) UpdateSubscriptionData(fn func(*model.SubscriptionData) error) error {
	return s.updateSubscriptionData(func(data *model.SubscriptionData) (bool, error) {
		if err := fn(data); err != nil {
			return false, err
		}
		return true, nil
	})
}

// updateSubscriptionData commits only when the callback reports a change, so a
// no-op pass (the 5-minute reset tick with nothing due) costs one read.
func (s *Store) updateSubscriptionData(fn func(*model.SubscriptionData) (bool, error)) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error {
		data, err := s.readSubscriptionDataTx(ctx, tx)
		if err != nil {
			return err
		}
		dirty, err := fn(data)
		if err != nil {
			return err
		}
		if !dirty {
			return nil
		}
		return s.writeSubscriptionData(ctx, tx, data)
	})
}

// Subscriptions returns all subscriptions in document order.
func (s *Store) Subscriptions() ([]model.Subscription, error) {
	return s.subscriptions(context.Background(), s.db)
}

// SubscriptionByID returns one subscription, or nil when it does not exist.
func (s *Store) SubscriptionByID(id string) (*model.Subscription, error) {
	subscriptions, err := s.Subscriptions()
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

// Categories returns the category list in document order.
func (s *Store) Categories() ([]string, error) {
	return s.categories(context.Background(), s.db)
}

// ReorderSubscriptions assigns sort_order = index for each supplied id
// (unknown ids are ignored) and returns the full list sorted by order.
func (s *Store) ReorderSubscriptions(ids []string) ([]model.Subscription, error) {
	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		for index, id := range ids {
			if _, err := tx.ExecContext(ctx,
				"UPDATE subscriptions SET sort_order = ?, updated_at = ? WHERE id = ?",
				index, s.nowISO(), id); err != nil {
				return fmt.Errorf("reorder subscription: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Subscriptions()
}

// ---------- row <-> model mapping ----------

func (s *Store) readSubscriptionDataTx(ctx context.Context, tx *sql.Tx) (*model.SubscriptionData, error) {
	categories, err := s.categories(ctx, tx)
	if err != nil {
		return nil, err
	}
	tags, err := s.tags(ctx, tx)
	if err != nil {
		return nil, err
	}
	subscriptions, err := s.subscriptions(ctx, tx)
	if err != nil {
		return nil, err
	}
	return &model.SubscriptionData{Subscriptions: subscriptions, Categories: categories, Tags: tags}, nil
}

// querier is the shared surface of *sql.DB and *sql.Tx.
type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func (s *Store) categories(ctx context.Context, q querier) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT name FROM categories ORDER BY position, name")
	if err != nil {
		return nil, fmt.Errorf("query categories: %w", err)
	}
	defer rows.Close()

	categories := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		categories = append(categories, name)
	}
	return categories, rows.Err()
}

func (s *Store) tags(ctx context.Context, q querier) ([]model.Tag, error) {
	rows, err := q.QueryContext(ctx,
		"SELECT id, name, created_at, updated_at FROM tags ORDER BY rowid")
	if err != nil {
		return nil, fmt.Errorf("query tags: %w", err)
	}
	defer rows.Close()

	tags := make([]model.Tag, 0)
	for rows.Next() {
		var tag model.Tag
		if err := rows.Scan(&tag.ID, &tag.Name, &tag.CreatedAt, &tag.UpdatedAt); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func (s *Store) subscriptions(ctx context.Context, q querier) ([]model.Subscription, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, name, category, provider, provider_custom, subscription_type,
		       billing_cycle, price, start_date, renewal_date, status, notes,
		       credentials, balance, balance_currency, low_balance_threshold,
		       plan_id, sort_order, created_at, updated_at
		FROM subscriptions
		ORDER BY sort_order, rowid`)
	if err != nil {
		return nil, fmt.Errorf("query subscriptions: %w", err)
	}
	defer rows.Close()

	subscriptions := make([]model.Subscription, 0)
	for rows.Next() {
		var sub model.Subscription
		var balance, lowBalance sql.NullFloat64
		if err := rows.Scan(
			&sub.ID, &sub.Name, &sub.Category, &sub.Provider, &sub.ProviderCustom,
			&sub.SubscriptionType, &sub.BillingCycle, &sub.Price, &sub.StartDate,
			&sub.RenewalDate, &sub.Status, &sub.Notes, &sub.Credentials,
			&balance, &sub.BalanceCurrency, &lowBalance, &sub.PlanID,
			&sub.SortOrder, &sub.CreatedAt, &sub.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if balance.Valid {
			value := balance.Float64
			sub.Balance = &value
		}
		if lowBalance.Valid {
			value := lowBalance.Float64
			sub.LowBalanceThreshold = &value
		}
		subscriptions = append(subscriptions, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Close before issuing per-subscription queries: the store serialises on a
	// single connection, so an open rows set would deadlock the child query.
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(subscriptions) == 0 {
		return subscriptions, nil
	}

	for i := range subscriptions {
		schedules, err := s.resetSchedules(ctx, q, subscriptions[i].ID)
		if err != nil {
			return nil, err
		}
		subscriptions[i].ResetSchedules = schedules

		tagIDs, err := s.tagIDsFor(ctx, q, subscriptions[i].ID)
		if err != nil {
			return nil, err
		}
		subscriptions[i].TagIDs = tagIDs
	}
	return subscriptions, nil
}

func (s *Store) resetSchedules(ctx context.Context, q querier, subscriptionID string) ([]model.ResetSchedule, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, enabled, type, time_of_day, timezone, day_of_week, day_of_month,
		       next_reset_time, exhausted, created_at, updated_at
		FROM reset_schedules
		WHERE subscription_id = ?
		ORDER BY rowid`, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("query reset schedules: %w", err)
	}
	defer rows.Close()

	schedules := make([]model.ResetSchedule, 0)
	for rows.Next() {
		var schedule model.ResetSchedule
		var enabled, exhausted int
		var timeOfDay, timezone sql.NullString
		var dayOfWeek, dayOfMonth sql.NullInt64
		if err := rows.Scan(
			&schedule.ID, &enabled, &schedule.Type, &timeOfDay, &timezone,
			&dayOfWeek, &dayOfMonth, &schedule.NextResetTime, &exhausted,
			&schedule.CreatedAt, &schedule.UpdatedAt,
		); err != nil {
			return nil, err
		}
		schedule.Enabled = enabled != 0
		schedule.Exhausted = exhausted != 0
		schedule.TimeOfDay = timeOfDay.String
		schedule.Timezone = timezone.String
		if dayOfWeek.Valid {
			value := int(dayOfWeek.Int64)
			schedule.DayOfWeek = &value
		}
		if dayOfMonth.Valid {
			value := int(dayOfMonth.Int64)
			schedule.DayOfMonth = &value
		}
		schedules = append(schedules, schedule)
	}
	return schedules, rows.Err()
}

func (s *Store) tagIDsFor(ctx context.Context, q querier, subscriptionID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT tag_id FROM subscription_tags
		WHERE subscription_id = ?
		ORDER BY position`, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("query subscription tags: %w", err)
	}
	defer rows.Close()

	tagIDs := make([]string, 0)
	for rows.Next() {
		var tagID string
		if err := rows.Scan(&tagID); err != nil {
			return nil, err
		}
		tagIDs = append(tagIDs, tagID)
	}
	return tagIDs, rows.Err()
}

func (s *Store) writeSubscriptionData(ctx context.Context, tx *sql.Tx, data *model.SubscriptionData) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM subscription_tags"); err != nil {
		return fmt.Errorf("clear subscription tags: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM reset_schedules"); err != nil {
		return fmt.Errorf("clear reset schedules: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM subscriptions"); err != nil {
		return fmt.Errorf("clear subscriptions: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM tags"); err != nil {
		return fmt.Errorf("clear tags: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM categories"); err != nil {
		return fmt.Errorf("clear categories: %w", err)
	}

	for position, name := range data.Categories {
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO categories(name, position) VALUES(?, ?)", name, position); err != nil {
			return fmt.Errorf("insert category %q: %w", name, err)
		}
	}

	for _, tag := range data.Tags {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tags(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)`,
			tag.ID, tag.Name, tag.CreatedAt, tag.UpdatedAt); err != nil {
			return fmt.Errorf("insert tag %q: %w", tag.Name, err)
		}
	}

	for _, sub := range data.Subscriptions {
		if err := s.insertSubscription(ctx, tx, sub); err != nil {
			return err
		}
		for position, tagID := range sub.TagIDs {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO subscription_tags(subscription_id, tag_id, position)
				VALUES(?, ?, ?)`, sub.ID, tagID, position); err != nil {
				return fmt.Errorf("link tag %q to subscription %q: %w", tagID, sub.ID, err)
			}
		}
	}
	return nil
}

func (s *Store) insertSubscription(ctx context.Context, tx *sql.Tx, sub model.Subscription) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO subscriptions(
			id, name, category, provider, provider_custom, subscription_type,
			billing_cycle, price, start_date, renewal_date, status, notes,
			credentials, balance, balance_currency, low_balance_threshold,
			plan_id, sort_order, created_at, updated_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sub.ID, sub.Name, sub.Category, sub.Provider, sub.ProviderCustom,
		sub.SubscriptionType, sub.BillingCycle, sub.Price, sub.StartDate,
		sub.RenewalDate, sub.Status, sub.Notes, sub.Credentials,
		nullableFloat(sub.Balance), sub.BalanceCurrency, nullableFloat(sub.LowBalanceThreshold),
		sub.PlanID, sub.SortOrder, sub.CreatedAt, sub.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert subscription %q: %w", sub.Name, err)
	}
	for _, schedule := range sub.ResetSchedules {
		if err := s.insertResetSchedule(ctx, tx, sub.ID, schedule); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) insertResetSchedule(ctx context.Context, tx *sql.Tx, subscriptionID string, schedule model.ResetSchedule) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO reset_schedules(
			id, subscription_id, type, enabled, time_of_day, timezone,
			day_of_week, day_of_month, next_reset_time, exhausted,
			created_at, updated_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		schedule.ID, subscriptionID, schedule.Type, boolInt(schedule.Enabled),
		nullableString(schedule.TimeOfDay), nullableString(schedule.Timezone),
		nullableInt(schedule.DayOfWeek), nullableInt(schedule.DayOfMonth),
		schedule.NextResetTime, boolInt(schedule.Exhausted),
		schedule.CreatedAt, schedule.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert reset schedule %q: %w", schedule.ID, err)
	}
	return nil
}

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
