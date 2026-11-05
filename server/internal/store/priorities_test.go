package store

// Priority-scene storage (#35), ported from lib/priority-scene.ts — the shared
// scene manager behind lib/priorities.ts and lib/tool-priorities.ts. The Go
// store keeps the old document shape (scenes + ordered item ids) but writes
// rows directly instead of rewriting the whole JSON document.

import (
	"errors"
	"testing"
	"time"
)

func TestPrioritySceneCRUDAndReorder(t *testing.T) {
	s, advance := openClockStore(t)

	scenes, err := s.PriorityScenes()
	if err != nil {
		t.Fatalf("PriorityScenes: %v", err)
	}
	if len(scenes) != 0 {
		t.Fatalf("scenes = %#v, want empty", scenes)
	}

	created, err := s.CreatePriorityScene(" 工作 ")
	if err != nil {
		t.Fatalf("CreatePriorityScene: %v", err)
	}
	if created.Name != "工作" {
		t.Fatalf("name = %q, want trimmed %q", created.Name, "工作")
	}
	if created.ID == "" || created.CreatedAt == "" || created.UpdatedAt == "" {
		t.Fatalf("scene = %#v, want id and timestamps", created)
	}
	if created.SubscriptionOrder == nil || len(created.SubscriptionOrder) != 0 {
		t.Fatalf("subscriptionOrder = %#v, want empty array", created.SubscriptionOrder)
	}

	if _, err := s.CreatePriorityScene("   "); !errors.Is(err, ErrSceneNameRequired) {
		t.Fatalf("blank name error = %v, want ErrSceneNameRequired", err)
	}
	if _, err := s.CreatePriorityScene("工作"); !errors.Is(err, ErrSceneNameExists) {
		t.Fatalf("duplicate name error = %v, want ErrSceneNameExists", err)
	}

	second, err := s.CreatePriorityScene("生活")
	if err != nil {
		t.Fatalf("CreatePriorityScene(second): %v", err)
	}

	advance(time.Date(2026, 8, 30, 1, 0, 0, 0, time.UTC))
	renamed, err := s.RenamePriorityScene(created.ID, "工作二")
	if err != nil {
		t.Fatalf("RenamePriorityScene: %v", err)
	}
	if renamed.Name != "工作二" || renamed.UpdatedAt == created.UpdatedAt {
		t.Fatalf("renamed = %#v, want new name and updatedAt", renamed)
	}
	if _, err := s.RenamePriorityScene(created.ID, "生活"); !errors.Is(err, ErrSceneNameExists) {
		t.Fatalf("rename duplicate error = %v, want ErrSceneNameExists", err)
	}
	if _, err := s.RenamePriorityScene("missing", "x"); err != nil {
		t.Fatalf("rename missing error = %v, want nil", err)
	}

	reordered, err := s.SetPrioritySceneOrder(created.ID, []string{second.ID, created.ID})
	if err != nil {
		t.Fatalf("SetPrioritySceneOrder: %v", err)
	}
	if len(reordered.SubscriptionOrder) != 2 ||
		reordered.SubscriptionOrder[0] != second.ID ||
		reordered.SubscriptionOrder[1] != created.ID {
		t.Fatalf("order = %#v, want [second, created]", reordered.SubscriptionOrder)
	}

	scenes, err = s.PriorityScenes()
	if err != nil {
		t.Fatalf("PriorityScenes after reorder: %v", err)
	}
	if len(scenes) != 2 || scenes[0].ID != created.ID {
		t.Fatalf("scenes = %#v, want insertion order with created first", scenes)
	}
	if got := scenes[0].SubscriptionOrder; len(got) != 2 || got[0] != second.ID {
		t.Fatalf("persisted order = %#v, want [second, created]", got)
	}

	deleted, err := s.DeletePriorityScene(second.ID)
	if err != nil || !deleted {
		t.Fatalf("DeletePriorityScene = (%v, %v), want (true, nil)", deleted, err)
	}
	deleted, err = s.DeletePriorityScene(second.ID)
	if err != nil || deleted {
		t.Fatalf("second delete = (%v, %v), want (false, nil)", deleted, err)
	}
}

func TestToolPrioritySceneCRUDAndReorder(t *testing.T) {
	s, _ := openClockStore(t)

	created, err := s.CreateToolPriorityScene("日常")
	if err != nil {
		t.Fatalf("CreateToolPriorityScene: %v", err)
	}
	if created.Name != "日常" || created.ToolOrder == nil {
		t.Fatalf("scene = %#v, want name and empty toolOrder", created)
	}
	if _, err := s.CreateToolPriorityScene("日常"); !errors.Is(err, ErrSceneNameExists) {
		t.Fatalf("duplicate error = %v, want ErrSceneNameExists", err)
	}

	if _, err := s.SetToolPrioritySceneOrder(created.ID, []string{"tool-a", "tool-b"}); err != nil {
		t.Fatalf("SetToolPrioritySceneOrder: %v", err)
	}
	byID, err := s.ToolPrioritySceneByID(created.ID)
	if err != nil || byID == nil {
		t.Fatalf("ToolPrioritySceneByID = (%#v, %v)", byID, err)
	}
	if len(byID.ToolOrder) != 2 || byID.ToolOrder[1] != "tool-b" {
		t.Fatalf("toolOrder = %#v, want [tool-a tool-b]", byID.ToolOrder)
	}

	scenes, err := s.ToolPriorityScenes()
	if err != nil || len(scenes) != 1 {
		t.Fatalf("ToolPriorityScenes = (%#v, %v), want one scene", scenes, err)
	}

	deleted, err := s.DeleteToolPriorityScene(created.ID)
	if err != nil || !deleted {
		t.Fatalf("DeleteToolPriorityScene = (%v, %v), want (true, nil)", deleted, err)
	}
}
