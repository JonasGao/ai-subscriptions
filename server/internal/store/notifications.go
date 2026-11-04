package store

// Notification-channel CRUD and settings, ported from the storage half of
// lib/notifications/storage.ts. The old stack rewrote notifications.json on
// every edit; here each channel is a row, so a toggle is a single UPDATE and
// concurrent edits cannot lose unrelated channels. Document-level import and
// export stay in documents.go (ADR-0017).

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"ai-subscriptions/internal/model"
)

// NotificationChannelInput is the writable form of a channel on create. The
// caller validates type-specific fields first (route-level validation, exactly
// like the old createChannel contract).
type NotificationChannelInput struct {
	Type          string
	Name          string
	URL           string
	Secret        string
	AppID         string
	AppSecret     string
	ReceiveID     string
	ReceiveIDType string
	// Enabled defaults to true when nil (createChannel's `enabled ?? true`).
	Enabled *bool
}

// NotificationChannelPatch is a partial update. Nil means "not supplied"
// (leave unchanged); a non-nil empty string clears the field.
type NotificationChannelPatch struct {
	Type          *string
	Name          *string
	URL           *string
	Secret        *string
	AppID         *string
	AppSecret     *string
	ReceiveID     *string
	ReceiveIDType *string
	Enabled       *bool
}

// NotificationChannels returns every channel in document (insertion) order.
func (s *Store) NotificationChannels() ([]model.NotificationChannel, error) {
	return notificationChannels(context.Background(), s.db)
}

// NotificationChannelByID returns one channel, or nil when it does not exist.
func (s *Store) NotificationChannelByID(id string) (*model.NotificationChannel, error) {
	return notificationChannelByID(context.Background(), s.db, id)
}

// CreateNotificationChannel mints an id and timestamps and persists the row.
func (s *Store) CreateNotificationChannel(input NotificationChannelInput) (*model.NotificationChannel, error) {
	now := s.nowISO()
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	channel := model.NotificationChannel{
		ID:            newID(),
		Type:          input.Type,
		Name:          input.Name,
		URL:           input.URL,
		Secret:        input.Secret,
		AppID:         input.AppID,
		AppSecret:     input.AppSecret,
		ReceiveID:     input.ReceiveID,
		ReceiveIDType: input.ReceiveIDType,
		Enabled:       enabled,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	_, err := s.db.ExecContext(context.Background(), `
		INSERT INTO notification_channels(
			id, type, name, url, secret, app_id, app_secret, receive_id,
			receive_id_type, enabled, last_send_json, created_at, updated_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
		channel.ID, channel.Type, channel.Name, channel.URL, channel.Secret,
		channel.AppID, channel.AppSecret, channel.ReceiveID, channel.ReceiveIDType,
		boolInt(channel.Enabled), channel.CreatedAt, channel.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert notification channel %q: %w", channel.Name, err)
	}
	return &channel, nil
}

// UpdateNotificationChannel merges a patch and refreshes updatedAt. It returns
// nil (no error) when the id does not exist, matching updateChannel. The read
// and the write share one transaction so concurrent edits cannot interleave.
func (s *Store) UpdateNotificationChannel(id string, patch NotificationChannelPatch) (*model.NotificationChannel, error) {
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}

	existing, err := notificationChannelByID(ctx, tx, id)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if existing == nil {
		_ = tx.Rollback()
		return nil, nil
	}

	applyChannelPatch(existing, patch)
	existing.UpdatedAt = s.nowISO()

	_, err = tx.ExecContext(ctx, `
		UPDATE notification_channels SET
			type = ?, name = ?, url = ?, secret = ?, app_id = ?, app_secret = ?,
			receive_id = ?, receive_id_type = ?, enabled = ?, updated_at = ?
		WHERE id = ?`,
		existing.Type, existing.Name, existing.URL, existing.Secret,
		existing.AppID, existing.AppSecret, existing.ReceiveID,
		existing.ReceiveIDType, boolInt(existing.Enabled), existing.UpdatedAt, id)
	if err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("update notification channel %q: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return existing, nil
}

func applyChannelPatch(channel *model.NotificationChannel, patch NotificationChannelPatch) {
	if patch.Type != nil {
		channel.Type = *patch.Type
	}
	if patch.Name != nil {
		channel.Name = *patch.Name
	}
	if patch.URL != nil {
		channel.URL = *patch.URL
	}
	if patch.Secret != nil {
		channel.Secret = *patch.Secret
	}
	if patch.AppID != nil {
		channel.AppID = *patch.AppID
	}
	if patch.AppSecret != nil {
		channel.AppSecret = *patch.AppSecret
	}
	if patch.ReceiveID != nil {
		channel.ReceiveID = *patch.ReceiveID
	}
	if patch.ReceiveIDType != nil {
		channel.ReceiveIDType = *patch.ReceiveIDType
	}
	if patch.Enabled != nil {
		channel.Enabled = *patch.Enabled
	}
}

// DeleteNotificationChannel removes the row, reporting whether it existed.
func (s *Store) DeleteNotificationChannel(id string) (bool, error) {
	result, err := s.db.ExecContext(context.Background(),
		"DELETE FROM notification_channels WHERE id = ?", id)
	if err != nil {
		return false, fmt.Errorf("delete notification channel %q: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

// ToggleNotificationChannel flips enabled in one UPDATE statement (no
// read-modify-write) and returns the refreshed channel, or nil when absent.
func (s *Store) ToggleNotificationChannel(id string) (*model.NotificationChannel, error) {
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE notification_channels
		SET enabled = CASE enabled WHEN 0 THEN 1 ELSE 0 END, updated_at = ?
		WHERE id = ?`, s.nowISO(), id)
	if err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("toggle notification channel %q: %w", id, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if affected == 0 {
		_ = tx.Rollback()
		return nil, nil
	}
	refreshed, err := notificationChannelByID(ctx, tx, id)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return refreshed, nil
}

// SetNotificationChannelSendResult records the last send outcome. Unknown ids
// are a silent no-op, and updatedAt is intentionally untouched — the old
// updateChannelSendResult only wrote lastSendResult.
func (s *Store) SetNotificationChannelSendResult(id string, result model.SendResult) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encode lastSendResult: %w", err)
	}
	_, err = s.db.ExecContext(context.Background(),
		"UPDATE notification_channels SET last_send_json = ? WHERE id = ?", string(encoded), id)
	if err != nil {
		return fmt.Errorf("record notification send result %q: %w", id, err)
	}
	return nil
}

// DefaultLowBalanceThreshold returns the global threshold, defaulting to 10
// when the settings row has never been written.
func (s *Store) DefaultLowBalanceThreshold() (float64, error) {
	threshold := float64(model.DefaultLowBalanceThreshold)
	err := s.db.QueryRowContext(context.Background(),
		"SELECT default_low_balance_threshold FROM notification_settings WHERE id = 1").Scan(&threshold)
	if err != nil && !isNoRows(err) {
		return 0, fmt.Errorf("read notification settings: %w", err)
	}
	return threshold, nil
}

// SetDefaultLowBalanceThreshold persists the global threshold.
func (s *Store) SetDefaultLowBalanceThreshold(value float64) error {
	_, err := s.db.ExecContext(context.Background(), `
		INSERT INTO notification_settings(id, default_low_balance_threshold) VALUES(1, ?)
		ON CONFLICT (id) DO UPDATE SET default_low_balance_threshold = excluded.default_low_balance_threshold`,
		value)
	if err != nil {
		return fmt.Errorf("write notification settings: %w", err)
	}
	return nil
}

// BalanceTransitionState returns the last above/below observation for a
// subscription, or nil when none exists.
func (s *Store) BalanceTransitionState(subscriptionID string) (*model.BalanceTransitionState, error) {
	var state model.BalanceTransitionState
	err := s.db.QueryRowContext(context.Background(), `
		SELECT status, updated_at FROM balance_transition_states WHERE subscription_id = ?`,
		subscriptionID).Scan(&state.Status, &state.UpdatedAt)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read balance transition state %q: %w", subscriptionID, err)
	}
	return &state, nil
}

// SetBalanceTransitionState upserts the above/below observation.
func (s *Store) SetBalanceTransitionState(subscriptionID string, state model.BalanceTransitionState) error {
	_, err := s.db.ExecContext(context.Background(), `
		INSERT INTO balance_transition_states(subscription_id, status, updated_at) VALUES(?, ?, ?)
		ON CONFLICT (subscription_id) DO UPDATE SET
			status = excluded.status, updated_at = excluded.updated_at`,
		subscriptionID, state.Status, state.UpdatedAt)
	if err != nil {
		return fmt.Errorf("write balance transition state %q: %w", subscriptionID, err)
	}
	return nil
}

// ---------- shared reads ----------

func notificationChannels(ctx context.Context, q querier) ([]model.NotificationChannel, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, type, name, url, secret, app_id, app_secret, receive_id,
		       receive_id_type, enabled, last_send_json, created_at, updated_at
		FROM notification_channels ORDER BY rowid`)
	if err != nil {
		return nil, fmt.Errorf("query notification channels: %w", err)
	}
	defer rows.Close()

	channels := make([]model.NotificationChannel, 0)
	for rows.Next() {
		channel, err := scanNotificationChannel(rows)
		if err != nil {
			return nil, err
		}
		channels = append(channels, *channel)
	}
	return channels, rows.Err()
}

func notificationChannelByID(ctx context.Context, q querier, id string) (*model.NotificationChannel, error) {
	row := q.QueryRowContext(ctx, `
		SELECT id, type, name, url, secret, app_id, app_secret, receive_id,
		       receive_id_type, enabled, last_send_json, created_at, updated_at
		FROM notification_channels WHERE id = ?`, id)
	channel, err := scanNotificationChannel(row)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("query notification channel %q: %w", id, err)
	}
	return channel, nil
}

func scanNotificationChannel(row interface {
	Scan(dest ...any) error
}) (*model.NotificationChannel, error) {
	var channel model.NotificationChannel
	var enabled int
	var lastSend sql.NullString
	if err := row.Scan(
		&channel.ID, &channel.Type, &channel.Name, &channel.URL, &channel.Secret,
		&channel.AppID, &channel.AppSecret, &channel.ReceiveID, &channel.ReceiveIDType,
		&enabled, &lastSend, &channel.CreatedAt, &channel.UpdatedAt,
	); err != nil {
		return nil, err
	}
	channel.Enabled = enabled != 0
	if lastSend.Valid {
		var result model.SendResult
		if err := json.Unmarshal([]byte(lastSend.String), &result); err != nil {
			return nil, fmt.Errorf("decode lastSendResult for channel %q: %w", channel.ID, err)
		}
		channel.LastSendResult = &result
	}
	return &channel, nil
}
