package store

// Priority-scene storage (#35), ported from lib/priority-scene.ts — the shared
// scene manager behind lib/priorities.ts and lib/tool-priorities.ts. Reads keep
// the old document shape; mutations write the scene/items rows directly inside
// one transaction instead of rewriting the whole JSON document.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"ai-subscriptions/internal/model"
)

// Scene-creation/rename errors carry the old stack's messages because the HTTP
// layer surfaces them to the user verbatim.
var (
	ErrSceneNameRequired = errors.New("Scene name is required")
	ErrSceneNameInvalid  = errors.New("Scene name must be a non-empty string")
	ErrSceneNameExists   = errors.New("Scene name already exists")
)

// PriorityScenes returns every subscription-priority scene in insertion order.
func (s *Store) PriorityScenes() ([]model.PriorityScene, error) {
	data, err := s.PriorityData()
	if err != nil {
		return nil, err
	}
	return data.Scenes, nil
}

// PrioritySceneByID returns one scene, or nil when absent.
func (s *Store) PrioritySceneByID(id string) (*model.PriorityScene, error) {
	scenes, err := s.PriorityScenes()
	if err != nil {
		return nil, err
	}
	for i := range scenes {
		if scenes[i].ID == id {
			return &scenes[i], nil
		}
	}
	return nil, nil
}

// CreatePriorityScene validates the name, rejects duplicates and appends a
// scene with an empty order. Like lib/priority-scene.ts the duplicate test
// compares the request's raw name against the stored (trimmed) names.
func (s *Store) CreatePriorityScene(name string) (*model.PriorityScene, error) {
	if strings.TrimSpace(name) == "" {
		return nil, ErrSceneNameRequired
	}

	now := s.nowISO()
	scene := model.PriorityScene{
		ID:                newID(),
		Name:              strings.TrimSpace(name),
		SubscriptionOrder: []string{},
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	err := s.withTx(context.Background(), func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(context.Background(),
			"SELECT COUNT(*) FROM priority_scenes WHERE name = ?", name).Scan(&count); err != nil {
			return fmt.Errorf("check priority scene name: %w", err)
		}
		if count > 0 {
			return ErrSceneNameExists
		}
		_, err := tx.ExecContext(context.Background(), `
			INSERT INTO priority_scenes(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)`,
			scene.ID, scene.Name, scene.CreatedAt, scene.UpdatedAt)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &scene, nil
}

// RenamePriorityScene updates the name (stored verbatim, like updateScene).
// It returns (nil, nil) when the id does not exist.
func (s *Store) RenamePriorityScene(id, name string) (*model.PriorityScene, error) {
	if strings.TrimSpace(name) == "" {
		return nil, ErrSceneNameInvalid
	}

	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		exists, err := sceneExists(ctx, tx, "priority_scenes", id)
		if err != nil || !exists {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM priority_scenes WHERE name = ? AND id <> ?", name, id).Scan(&count); err != nil {
			return fmt.Errorf("check priority scene name: %w", err)
		}
		if count > 0 {
			return ErrSceneNameExists
		}
		_, err = tx.ExecContext(ctx,
			"UPDATE priority_scenes SET name = ?, updated_at = ? WHERE id = ?", name, s.nowISO(), id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.PrioritySceneByID(id)
}

// DeletePriorityScene removes a scene and its ordered items.
func (s *Store) DeletePriorityScene(id string) (bool, error) {
	return deleteScene(context.Background(), s, "priority_scenes", id)
}

// SetPrioritySceneOrder replaces the scene's ordered subscription ids.
func (s *Store) SetPrioritySceneOrder(id string, order []string) (*model.PriorityScene, error) {
	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		exists, err := sceneExists(ctx, tx, "priority_scenes", id)
		if err != nil || !exists {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE priority_scenes SET updated_at = ? WHERE id = ?", s.nowISO(), id); err != nil {
			return err
		}
		return replaceSceneItems(ctx, tx, "priority_scene_items", "subscription_id", id, order)
	})
	if err != nil {
		return nil, err
	}
	return s.PrioritySceneByID(id)
}

// ToolPriorityScenes returns every tool-priority scene in insertion order.
func (s *Store) ToolPriorityScenes() ([]model.ToolPriorityScene, error) {
	data, err := s.ToolPriorityData()
	if err != nil {
		return nil, err
	}
	return data.Scenes, nil
}

// ToolPrioritySceneByID returns one scene, or nil when absent.
func (s *Store) ToolPrioritySceneByID(id string) (*model.ToolPriorityScene, error) {
	scenes, err := s.ToolPriorityScenes()
	if err != nil {
		return nil, err
	}
	for i := range scenes {
		if scenes[i].ID == id {
			return &scenes[i], nil
		}
	}
	return nil, nil
}

// CreateToolPriorityScene mirrors CreatePriorityScene for the tool family.
func (s *Store) CreateToolPriorityScene(name string) (*model.ToolPriorityScene, error) {
	if strings.TrimSpace(name) == "" {
		return nil, ErrSceneNameRequired
	}

	now := s.nowISO()
	scene := model.ToolPriorityScene{
		ID:        newID(),
		Name:      strings.TrimSpace(name),
		ToolOrder: []string{},
		CreatedAt: now,
		UpdatedAt: now,
	}
	err := s.withTx(context.Background(), func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(context.Background(),
			"SELECT COUNT(*) FROM tool_priority_scenes WHERE name = ?", name).Scan(&count); err != nil {
			return fmt.Errorf("check tool priority scene name: %w", err)
		}
		if count > 0 {
			return ErrSceneNameExists
		}
		_, err := tx.ExecContext(context.Background(), `
			INSERT INTO tool_priority_scenes(id, name, created_at, updated_at) VALUES(?, ?, ?, ?)`,
			scene.ID, scene.Name, scene.CreatedAt, scene.UpdatedAt)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &scene, nil
}

// RenameToolPriorityScene updates the name. It returns (nil, nil) when the id
// does not exist.
func (s *Store) RenameToolPriorityScene(id, name string) (*model.ToolPriorityScene, error) {
	if strings.TrimSpace(name) == "" {
		return nil, ErrSceneNameInvalid
	}

	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		exists, err := sceneExists(ctx, tx, "tool_priority_scenes", id)
		if err != nil || !exists {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM tool_priority_scenes WHERE name = ? AND id <> ?", name, id).Scan(&count); err != nil {
			return fmt.Errorf("check tool priority scene name: %w", err)
		}
		if count > 0 {
			return ErrSceneNameExists
		}
		_, err = tx.ExecContext(ctx,
			"UPDATE tool_priority_scenes SET name = ?, updated_at = ? WHERE id = ?", name, s.nowISO(), id)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.ToolPrioritySceneByID(id)
}

// DeleteToolPriorityScene removes a scene and its ordered items.
func (s *Store) DeleteToolPriorityScene(id string) (bool, error) {
	return deleteScene(context.Background(), s, "tool_priority_scenes", id)
}

// SetToolPrioritySceneOrder replaces the scene's ordered tool ids.
func (s *Store) SetToolPrioritySceneOrder(id string, order []string) (*model.ToolPriorityScene, error) {
	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		exists, err := sceneExists(ctx, tx, "tool_priority_scenes", id)
		if err != nil || !exists {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE tool_priority_scenes SET updated_at = ? WHERE id = ?", s.nowISO(), id); err != nil {
			return err
		}
		return replaceSceneItems(ctx, tx, "tool_priority_scene_items", "tool_id", id, order)
	})
	if err != nil {
		return nil, err
	}
	return s.ToolPrioritySceneByID(id)
}

func sceneExists(ctx context.Context, q querier, table, id string) (bool, error) {
	var count int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE id = ?", id).Scan(&count); err != nil {
		return false, fmt.Errorf("check scene %q: %w", id, err)
	}
	return count > 0, nil
}

func deleteScene(ctx context.Context, s *Store, table, id string) (bool, error) {
	deleted := false
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE id = ?", id)
		if err != nil {
			return fmt.Errorf("delete scene: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		deleted = affected > 0
		return nil
	})
	return deleted, err
}

// replaceSceneItems rewrites the (scene_id, position, item_id) rows. The table
// and item column are internal constants, never request input.
func replaceSceneItems(ctx context.Context, tx *sql.Tx, table, itemColumn, sceneID string, order []string) error {
	if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE scene_id = ?", sceneID); err != nil {
		return fmt.Errorf("clear scene items: %w", err)
	}
	for position, itemID := range order {
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO "+table+"(scene_id, position, "+itemColumn+") VALUES(?, ?, ?)",
			sceneID, position, itemID); err != nil {
			return fmt.Errorf("insert scene item: %w", err)
		}
	}
	return nil
}
