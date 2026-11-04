package store

import (
	"testing"

	"ai-subscriptions/internal/model"
)

// modelDataForSnapshot is the minimal document used by the engine tests.
func modelDataForSnapshot() *model.SubscriptionData {
	return &model.SubscriptionData{
		Subscriptions: []model.Subscription{{
			ID:               "sub-snapshot",
			Name:             "Snapshot Subject",
			Category:         "官方订阅",
			Provider:         "openai",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
			Price:            20,
			Status:           "active",
			CreatedAt:        "2024-01-01T00:00:00.000Z",
			UpdatedAt:        "2024-01-01T00:00:00.000Z",
		}},
		Categories: []string{"官方订阅"},
		Tags:       []model.Tag{},
	}
}

// openStoreIn opens the data directory's database; the importer picks up any
// legacy JSON documents that live beside it.
func openStoreIn(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := Open(dir + "/app.db")
	if err != nil {
		t.Fatalf("Open(%s): %v", dir, err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
