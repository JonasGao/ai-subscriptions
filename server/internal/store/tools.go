package store

// Tool storage (#35), ported from lib/tools.ts. Create appends with
// order = max+1, update patches in place, and reorder rewrites sort_order for
// the supplied ids.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"ai-subscriptions/internal/model"
)

// Tool errors carry the old stack's messages (the HTTP layer surfaces them).
var (
	ErrToolNameRequired = errors.New("Tool name is required")
	ErrToolNameInvalid  = errors.New("Tool name must be a non-empty string")
)

// ToolInput is the writable part of a tool on create.
type ToolInput struct {
	Name           string
	Category       string
	Provider       string
	ProviderCustom string
	Forms          []string
	IsOpenSource   bool
	RepoURL        string
	Status         string
	Notes          string
}

// ToolUpdates is a partial update: nil fields are left unchanged.
type ToolUpdates struct {
	Name           *string
	Category       *string
	Provider       *string
	ProviderCustom *string
	Forms          *[]string
	IsOpenSource   *bool
	RepoURL        *string
	Status         *string
	Notes          *string
}

// Tools returns every tool ordered by its sort field (lib/tools.ts getTools).
func (s *Store) Tools() ([]model.Tool, error) {
	data, err := s.ToolData()
	if err != nil {
		return nil, err
	}
	for i := range data.Tools {
		// readToolData defaulted a missing status to active; imported documents
		// may carry an empty string.
		if data.Tools[i].Status == "" {
			data.Tools[i].Status = "active"
		}
		if data.Tools[i].Forms == nil {
			data.Tools[i].Forms = []string{}
		}
	}
	return data.Tools, nil
}

// ToolByID returns one tool, or nil when absent.
func (s *Store) ToolByID(id string) (*model.Tool, error) {
	tools, err := s.Tools()
	if err != nil {
		return nil, err
	}
	for i := range tools {
		if tools[i].ID == id {
			return &tools[i], nil
		}
	}
	return nil, nil
}

// CreateTool validates the name and appends a tool with the next order value.
func (s *Store) CreateTool(input ToolInput) (*model.Tool, error) {
	if strings.TrimSpace(input.Name) == "" {
		return nil, ErrToolNameRequired
	}

	now := s.nowISO()
	forms := input.Forms
	if forms == nil {
		forms = []string{}
	}
	status := input.Status
	if status == "" {
		status = "active"
	}

	tool := model.Tool{
		ID:             newID(),
		Name:           input.Name,
		Category:       input.Category,
		Provider:       input.Provider,
		ProviderCustom: input.ProviderCustom,
		Forms:          forms,
		IsOpenSource:   input.IsOpenSource,
		RepoURL:        input.RepoURL,
		Status:         status,
		Notes:          input.Notes,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var maxOrder int
		if err := tx.QueryRowContext(ctx,
			"SELECT COALESCE(MAX(sort_order), 0) FROM tools").Scan(&maxOrder); err != nil {
			return fmt.Errorf("read max tool order: %w", err)
		}
		tool.Order = maxOrder + 1
		formsJSON, err := json.Marshal(tool.Forms)
		if err != nil {
			return fmt.Errorf("encode forms: %w", err)
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO tools(
				id, name, category, provider, provider_custom, forms_json,
				sort_order, is_open_source, repo_url, status, notes, created_at, updated_at
			) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			tool.ID, tool.Name, tool.Category, tool.Provider, tool.ProviderCustom,
			string(formsJSON), tool.Order, boolInt(tool.IsOpenSource), tool.RepoURL,
			tool.Status, tool.Notes, tool.CreatedAt, tool.UpdatedAt)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &tool, nil
}

// UpdateTool applies a partial update. It returns (nil, nil) when the id does
// not exist, mirroring updateTool returning null.
func (s *Store) UpdateTool(id string, updates ToolUpdates) (*model.Tool, error) {
	if updates.Name != nil && strings.TrimSpace(*updates.Name) == "" {
		return nil, ErrToolNameInvalid
	}

	existing, err := s.ToolByID(id)
	if err != nil || existing == nil {
		return nil, err
	}

	next := *existing
	if updates.Name != nil {
		next.Name = *updates.Name
	}
	if updates.Category != nil {
		next.Category = *updates.Category
	}
	if updates.Provider != nil {
		next.Provider = *updates.Provider
	}
	if updates.ProviderCustom != nil {
		next.ProviderCustom = *updates.ProviderCustom
	}
	if updates.Forms != nil {
		next.Forms = *updates.Forms
		if next.Forms == nil {
			next.Forms = []string{}
		}
	}
	if updates.IsOpenSource != nil {
		next.IsOpenSource = *updates.IsOpenSource
	}
	if updates.RepoURL != nil {
		next.RepoURL = *updates.RepoURL
	}
	if updates.Status != nil {
		next.Status = *updates.Status
	}
	if updates.Notes != nil {
		next.Notes = *updates.Notes
	}
	next.UpdatedAt = s.nowISO()

	formsJSON, err := json.Marshal(next.Forms)
	if err != nil {
		return nil, fmt.Errorf("encode forms: %w", err)
	}
	ctx := context.Background()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE tools SET name = ?, category = ?, provider = ?, provider_custom = ?,
			forms_json = ?, is_open_source = ?, repo_url = ?, status = ?, notes = ?,
			updated_at = ?
		WHERE id = ?`,
		next.Name, next.Category, next.Provider, next.ProviderCustom, string(formsJSON),
		boolInt(next.IsOpenSource), next.RepoURL, next.Status, next.Notes, next.UpdatedAt,
		id); err != nil {
		return nil, fmt.Errorf("update tool: %w", err)
	}
	return &next, nil
}

// DeleteTool removes a tool from the catalog.
func (s *Store) DeleteTool(id string) (bool, error) {
	ctx := context.Background()
	deleted := false
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "DELETE FROM tools WHERE id = ?", id)
		if err != nil {
			return fmt.Errorf("delete tool: %w", err)
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

// ReorderTools assigns order = index for each supplied id (unknown ids are
// ignored) and returns the full list sorted by order, like reorderTools.
func (s *Store) ReorderTools(ids []string) ([]model.Tool, error) {
	ctx := context.Background()
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		for index, id := range ids {
			if _, err := tx.ExecContext(ctx,
				"UPDATE tools SET sort_order = ?, updated_at = ? WHERE id = ?",
				index, s.nowISO(), id); err != nil {
				return fmt.Errorf("reorder tool: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Tools()
}
