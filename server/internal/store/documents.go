package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"ai-subscriptions/internal/model"
)

// ---------- priorities.json ----------

// PriorityData returns the priorities.json document shape.
func (s *Store) PriorityData() (*model.PriorityData, error) {
	return priorityData(context.Background(), s.db)
}

// WritePriorityData replaces all priority scenes atomically.
func (s *Store) WritePriorityData(data *model.PriorityData) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error { return writePriorityDataTx(ctx, tx, data) })
}

func priorityData(ctx context.Context, q querier) (*model.PriorityData, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, name, created_at, updated_at FROM priority_scenes ORDER BY rowid")
	if err != nil {
		return nil, fmt.Errorf("query priority scenes: %w", err)
	}
	defer rows.Close()

	data := &model.PriorityData{Scenes: make([]model.PriorityScene, 0)}
	for rows.Next() {
		var scene model.PriorityScene
		if err := rows.Scan(&scene.ID, &scene.Name, &scene.CreatedAt, &scene.UpdatedAt); err != nil {
			return nil, err
		}
		data.Scenes = append(data.Scenes, scene)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range data.Scenes {
		order, err := priorityOrder(ctx, q, data.Scenes[i].ID)
		if err != nil {
			return nil, err
		}
		data.Scenes[i].SubscriptionOrder = order
	}
	return data, nil
}

func priorityOrder(ctx context.Context, q querier, sceneID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT subscription_id FROM priority_scene_items
		WHERE scene_id = ? ORDER BY position`, sceneID)
	if err != nil {
		return nil, fmt.Errorf("query priority scene items: %w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func writePriorityDataTx(ctx context.Context, tx *sql.Tx, data *model.PriorityData) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM priority_scene_items"); err != nil {
		return fmt.Errorf("clear priority scene items: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM priority_scenes"); err != nil {
		return fmt.Errorf("clear priority scenes: %w", err)
	}
	for _, scene := range data.Scenes {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO priority_scenes(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)`,
			scene.ID, scene.Name, scene.CreatedAt, scene.UpdatedAt); err != nil {
			return fmt.Errorf("insert priority scene %q: %w", scene.Name, err)
		}
		for position, subscriptionID := range scene.SubscriptionOrder {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO priority_scene_items(scene_id, position, subscription_id)
				VALUES(?, ?, ?)`, scene.ID, position, subscriptionID); err != nil {
				return fmt.Errorf("insert priority scene item: %w", err)
			}
		}
	}
	return nil
}

func prunePrioritySceneItems(ctx context.Context, tx *sql.Tx, subscriptionID string) error {
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM priority_scene_items WHERE subscription_id = ?", subscriptionID); err != nil {
		return fmt.Errorf("prune priority scene items: %w", err)
	}
	return nil
}

// ---------- tools.json ----------

// ToolData returns the tools.json document shape, ordered by the tool order.
func (s *Store) ToolData() (*model.ToolData, error) {
	ctx := context.Background()
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, category, provider, provider_custom, forms_json,
		       sort_order, is_open_source, repo_url, status, notes, created_at, updated_at
		FROM tools ORDER BY sort_order, rowid`)
	if err != nil {
		return nil, fmt.Errorf("query tools: %w", err)
	}
	defer rows.Close()

	data := &model.ToolData{Tools: make([]model.Tool, 0)}
	for rows.Next() {
		var tool model.Tool
		var forms string
		var isOpenSource int
		if err := rows.Scan(
			&tool.ID, &tool.Name, &tool.Category, &tool.Provider, &tool.ProviderCustom,
			&forms, &tool.Order, &isOpenSource, &tool.RepoURL, &tool.Status,
			&tool.Notes, &tool.CreatedAt, &tool.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(forms), &tool.Forms); err != nil {
			return nil, fmt.Errorf("decode forms for tool %q: %w", tool.ID, err)
		}
		tool.IsOpenSource = isOpenSource != 0
		data.Tools = append(data.Tools, tool)
	}
	return data, rows.Err()
}

// WriteToolData replaces all tools atomically.
func (s *Store) WriteToolData(data *model.ToolData) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error { return writeToolDataTx(ctx, tx, data) })
}

func writeToolDataTx(ctx context.Context, tx *sql.Tx, data *model.ToolData) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM tools"); err != nil {
		return fmt.Errorf("clear tools: %w", err)
	}
	for _, tool := range data.Tools {
		forms, err := json.Marshal(tool.Forms)
		if err != nil {
			return fmt.Errorf("encode forms for tool %q: %w", tool.ID, err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tools(
				id, name, category, provider, provider_custom, forms_json,
				sort_order, is_open_source, repo_url, status, notes, created_at, updated_at
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			tool.ID, tool.Name, tool.Category, tool.Provider, tool.ProviderCustom,
			string(forms), tool.Order, boolInt(tool.IsOpenSource), tool.RepoURL,
			tool.Status, tool.Notes, tool.CreatedAt, tool.UpdatedAt,
		); err != nil {
			return fmt.Errorf("insert tool %q: %w", tool.Name, err)
		}
	}
	return nil
}

// ---------- tool-priorities.json ----------

// ToolPriorityData returns the tool-priorities.json document shape.
func (s *Store) ToolPriorityData() (*model.ToolPriorityData, error) {
	ctx := context.Background()
	rows, err := s.db.QueryContext(ctx, "SELECT id, name, created_at, updated_at FROM tool_priority_scenes ORDER BY rowid")
	if err != nil {
		return nil, fmt.Errorf("query tool priority scenes: %w", err)
	}
	defer rows.Close()

	data := &model.ToolPriorityData{Scenes: make([]model.ToolPriorityScene, 0)}
	for rows.Next() {
		var scene model.ToolPriorityScene
		if err := rows.Scan(&scene.ID, &scene.Name, &scene.CreatedAt, &scene.UpdatedAt); err != nil {
			return nil, err
		}
		data.Scenes = append(data.Scenes, scene)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range data.Scenes {
		order, err := toolPriorityOrder(ctx, s.db, data.Scenes[i].ID)
		if err != nil {
			return nil, err
		}
		data.Scenes[i].ToolOrder = order
	}
	return data, nil
}

func toolPriorityOrder(ctx context.Context, q querier, sceneID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT tool_id FROM tool_priority_scene_items
		WHERE scene_id = ? ORDER BY position`, sceneID)
	if err != nil {
		return nil, fmt.Errorf("query tool priority items: %w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// WriteToolPriorityData replaces all tool priority scenes atomically.
func (s *Store) WriteToolPriorityData(data *model.ToolPriorityData) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error { return writeToolPriorityDataTx(ctx, tx, data) })
}

func writeToolPriorityDataTx(ctx context.Context, tx *sql.Tx, data *model.ToolPriorityData) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM tool_priority_scene_items"); err != nil {
		return fmt.Errorf("clear tool priority items: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM tool_priority_scenes"); err != nil {
		return fmt.Errorf("clear tool priority scenes: %w", err)
	}
	for _, scene := range data.Scenes {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO tool_priority_scenes(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)`,
			scene.ID, scene.Name, scene.CreatedAt, scene.UpdatedAt); err != nil {
			return fmt.Errorf("insert tool priority scene %q: %w", scene.Name, err)
		}
		for position, toolID := range scene.ToolOrder {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO tool_priority_scene_items(scene_id, position, tool_id)
				VALUES(?, ?, ?)`, scene.ID, position, toolID); err != nil {
				return fmt.Errorf("insert tool priority item: %w", err)
			}
		}
	}
	return nil
}

// ---------- proxy-subscriptions.json ----------

// ProxySubscriptionData returns the proxy-subscriptions.json document shape.
func (s *Store) ProxySubscriptionData() (*model.ProxySubscriptionData, error) {
	return proxyData(context.Background(), s.db)
}

func proxyData(ctx context.Context, q querier) (*model.ProxySubscriptionData, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, name, monthly_price, expiration_date, website, notes, status,
		       created_at, updated_at
		FROM proxy_subscriptions ORDER BY rowid`)
	if err != nil {
		return nil, fmt.Errorf("query proxy subscriptions: %w", err)
	}
	defer rows.Close()

	data := &model.ProxySubscriptionData{
		Subscriptions: make([]model.ProxySubscription, 0),
		Tags:          make([]model.ProxySubscriptionTag, 0),
	}
	for rows.Next() {
		var sub model.ProxySubscription
		if err := rows.Scan(
			&sub.ID, &sub.Name, &sub.MonthlyPrice, &sub.ExpirationDate,
			&sub.Website, &sub.Notes, &sub.Status, &sub.CreatedAt, &sub.UpdatedAt,
		); err != nil {
			return nil, err
		}
		data.Subscriptions = append(data.Subscriptions, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range data.Subscriptions {
		tagIDs, err := proxyTagIDs(ctx, q, data.Subscriptions[i].ID)
		if err != nil {
			return nil, err
		}
		data.Subscriptions[i].TagIDs = tagIDs
	}

	tagRows, err := q.QueryContext(ctx, "SELECT id, name, created_at, updated_at FROM proxy_tags ORDER BY rowid")
	if err != nil {
		return nil, fmt.Errorf("query proxy tags: %w", err)
	}
	defer tagRows.Close()
	for tagRows.Next() {
		var tag model.ProxySubscriptionTag
		if err := tagRows.Scan(&tag.ID, &tag.Name, &tag.CreatedAt, &tag.UpdatedAt); err != nil {
			return nil, err
		}
		data.Tags = append(data.Tags, tag)
	}
	return data, tagRows.Err()
}

func proxyTagIDs(ctx context.Context, q querier, subscriptionID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT tag_id FROM proxy_subscription_tags
		WHERE proxy_subscription_id = ? ORDER BY position`, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("query proxy tags link: %w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// WriteProxySubscriptionData replaces the proxy documents atomically.
func (s *Store) WriteProxySubscriptionData(data *model.ProxySubscriptionData) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error { return writeProxyDataTx(ctx, tx, data) })
}

func writeProxyDataTx(ctx context.Context, tx *sql.Tx, data *model.ProxySubscriptionData) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM proxy_subscription_tags"); err != nil {
		return fmt.Errorf("clear proxy tag links: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM proxy_subscriptions"); err != nil {
		return fmt.Errorf("clear proxy subscriptions: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM proxy_tags"); err != nil {
		return fmt.Errorf("clear proxy tags: %w", err)
	}

	for _, tag := range data.Tags {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO proxy_tags(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)`,
			tag.ID, tag.Name, tag.CreatedAt, tag.UpdatedAt); err != nil {
			return fmt.Errorf("insert proxy tag %q: %w", tag.Name, err)
		}
	}
	for _, sub := range data.Subscriptions {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO proxy_subscriptions(
				id, name, monthly_price, expiration_date, website, notes, status,
				created_at, updated_at
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			sub.ID, sub.Name, sub.MonthlyPrice, sub.ExpirationDate, sub.Website,
			sub.Notes, sub.Status, sub.CreatedAt, sub.UpdatedAt,
		); err != nil {
			return fmt.Errorf("insert proxy subscription %q: %w", sub.Name, err)
		}
		for position, tagID := range sub.TagIDs {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO proxy_subscription_tags(proxy_subscription_id, tag_id, position)
				VALUES(?, ?, ?)`, sub.ID, tagID, position); err != nil {
				return fmt.Errorf("link proxy tag: %w", err)
			}
		}
	}
	return nil
}

// ---------- notifications.json ----------

// NotificationData returns notifications.json's shape with the old stack's
// defaults applied when the document (or its settings row) is absent.
func (s *Store) NotificationData() (*model.NotificationData, error) {
	ctx := context.Background()
	data := &model.NotificationData{
		Channels:                   make([]model.NotificationChannel, 0),
		DefaultLowBalanceThreshold: model.DefaultLowBalanceThreshold,
		BalanceTransitionStates:    map[string]model.BalanceTransitionState{},
	}

	if err := s.readNotificationSettings(ctx, data); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, type, name, url, secret, app_id, app_secret, receive_id,
		       receive_id_type, enabled, last_send_json, created_at, updated_at
		FROM notification_channels ORDER BY rowid`)
	if err != nil {
		return nil, fmt.Errorf("query notification channels: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var channel model.NotificationChannel
		var enabled int
		var lastSend sql.NullString
		if err := rows.Scan(
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
		data.Channels = append(data.Channels, channel)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	states, err := s.db.QueryContext(ctx, "SELECT subscription_id, status, updated_at FROM balance_transition_states")
	if err != nil {
		return nil, fmt.Errorf("query balance transition states: %w", err)
	}
	defer states.Close()
	for states.Next() {
		var subscriptionID string
		var state model.BalanceTransitionState
		if err := states.Scan(&subscriptionID, &state.Status, &state.UpdatedAt); err != nil {
			return nil, err
		}
		data.BalanceTransitionStates[subscriptionID] = state
	}
	return data, states.Err()
}

func (s *Store) readNotificationSettings(ctx context.Context, data *model.NotificationData) error {
	var threshold float64
	err := s.db.QueryRowContext(ctx,
		"SELECT default_low_balance_threshold FROM notification_settings WHERE id = 1").Scan(&threshold)
	if err == nil {
		data.DefaultLowBalanceThreshold = threshold
		return nil
	}
	if !isNoRows(err) {
		return fmt.Errorf("read notification settings: %w", err)
	}
	return nil
}

// WriteNotificationData replaces the notifications document atomically.
func (s *Store) WriteNotificationData(data *model.NotificationData) error {
	ctx := context.Background()
	return s.withTx(ctx, func(tx *sql.Tx) error { return writeNotificationDataTx(ctx, tx, data) })
}

func writeNotificationDataTx(ctx context.Context, tx *sql.Tx, data *model.NotificationData) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM notification_channels"); err != nil {
		return fmt.Errorf("clear notification channels: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM balance_transition_states"); err != nil {
		return fmt.Errorf("clear balance transition states: %w", err)
	}

	threshold := data.DefaultLowBalanceThreshold
	if threshold == 0 {
		threshold = model.DefaultLowBalanceThreshold
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT OR REPLACE INTO notification_settings(id, default_low_balance_threshold)
		VALUES(1, ?)`, threshold); err != nil {
		return fmt.Errorf("write notification settings: %w", err)
	}

	for _, channel := range data.Channels {
		var lastSend any
		if channel.LastSendResult != nil {
			encoded, err := json.Marshal(channel.LastSendResult)
			if err != nil {
				return fmt.Errorf("encode lastSendResult: %w", err)
			}
			lastSend = string(encoded)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO notification_channels(
				id, type, name, url, secret, app_id, app_secret, receive_id,
				receive_id_type, enabled, last_send_json, created_at, updated_at
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			channel.ID, channel.Type, channel.Name, channel.URL, channel.Secret,
			channel.AppID, channel.AppSecret, channel.ReceiveID, channel.ReceiveIDType,
			boolInt(channel.Enabled), lastSend, channel.CreatedAt, channel.UpdatedAt,
		); err != nil {
			return fmt.Errorf("insert notification channel %q: %w", channel.Name, err)
		}
	}

	for subscriptionID, state := range data.BalanceTransitionStates {
		if _, err := tx.ExecContext(ctx, `
			INSERT OR REPLACE INTO balance_transition_states(subscription_id, status, updated_at)
			VALUES(?, ?, ?)`, subscriptionID, state.Status, state.UpdatedAt); err != nil {
			return fmt.Errorf("write balance transition state: %w", err)
		}
	}
	return nil
}
