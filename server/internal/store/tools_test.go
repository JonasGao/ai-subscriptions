package store

// Tool CRUD storage (#35), ported from lib/tools.ts: create appends with
// order = max+1, updates patch in place, delete also scrubs the tool from every
// tool-priority scene, and reorder rewrites the sort_order column.

import (
	"errors"
	"testing"
	"time"
)

func TestToolCRUDOrderingAndScenePruning(t *testing.T) {
	s, advance := openClockStore(t)

	tools, err := s.Tools()
	if err != nil {
		t.Fatalf("Tools: %v", err)
	}
	if len(tools) != 0 {
		t.Fatalf("tools = %#v, want empty", tools)
	}

	if _, err := s.CreateTool(ToolInput{Name: "   "}); !errors.Is(err, ErrToolNameRequired) {
		t.Fatalf("blank name error = %v, want ErrToolNameRequired", err)
	}

	first, err := s.CreateTool(ToolInput{
		Name:     "Claude Code",
		Category: "AI助手",
		Provider: "anthropic",
		Forms:    []string{"CLI / TUI"},
		RepoURL:  "https://github.com/anthropics/claude-code",
		Status:   "active",
	})
	if err != nil {
		t.Fatalf("CreateTool: %v", err)
	}
	if first.Order != 1 {
		t.Fatalf("order = %d, want 1 (max+1 on the empty list)", first.Order)
	}
	if first.ID == "" || first.CreatedAt == "" {
		t.Fatalf("tool = %#v, want id and createdAt", first)
	}

	advance(time.Date(2026, 8, 30, 2, 0, 0, 0, time.UTC))
	second, err := s.CreateTool(ToolInput{Name: "Cursor", Category: "AI助手", Provider: "other"})
	if err != nil {
		t.Fatalf("CreateTool(second): %v", err)
	}
	if second.Order != 2 {
		t.Fatalf("order = %d, want 2", second.Order)
	}
	if second.Status != "active" {
		t.Fatalf("status = %q, want default active", second.Status)
	}

	updated, err := s.UpdateTool(first.ID, ToolUpdates{Name: strPtr("Claude Code CLI")})
	if err != nil {
		t.Fatalf("UpdateTool: %v", err)
	}
	if updated == nil || updated.Name != "Claude Code CLI" || updated.UpdatedAt == first.UpdatedAt {
		t.Fatalf("updated = %#v, want new name and updatedAt", updated)
	}
	if _, err := s.UpdateTool(first.ID, ToolUpdates{Name: strPtr("  ")}); !errors.Is(err, ErrToolNameInvalid) {
		t.Fatalf("blank update error = %v, want ErrToolNameInvalid", err)
	}
	if updated, err := s.UpdateTool("missing", ToolUpdates{Name: strPtr("x")}); err != nil || updated != nil {
		t.Fatalf("update missing = (%#v, %v), want (nil, nil)", updated, err)
	}

	scene, err := s.CreateToolPriorityScene("日常")
	if err != nil {
		t.Fatalf("CreateToolPriorityScene: %v", err)
	}
	if _, err := s.SetToolPrioritySceneOrder(scene.ID, []string{first.ID, second.ID}); err != nil {
		t.Fatalf("SetToolPrioritySceneOrder: %v", err)
	}

	reordered, err := s.ReorderTools([]string{second.ID, first.ID})
	if err != nil {
		t.Fatalf("ReorderTools: %v", err)
	}
	if len(reordered) != 2 || reordered[0].ID != second.ID || reordered[0].Order != 0 {
		t.Fatalf("reordered = %#v, want second first with order 0", reordered)
	}

	deleted, err := s.DeleteTool(first.ID)
	if err != nil || !deleted {
		t.Fatalf("DeleteTool = (%v, %v), want (true, nil)", deleted, err)
	}
	scene, err = s.ToolPrioritySceneByID(scene.ID)
	if err != nil || scene == nil {
		t.Fatalf("ToolPrioritySceneByID = (%#v, %v)", scene, err)
	}
	if len(scene.ToolOrder) != 1 || scene.ToolOrder[0] != second.ID {
		t.Fatalf("toolOrder = %#v, want only the surviving tool", scene.ToolOrder)
	}

	deleted, err = s.DeleteTool(first.ID)
	if err != nil || deleted {
		t.Fatalf("second delete = (%v, %v), want (false, nil)", deleted, err)
	}
}
