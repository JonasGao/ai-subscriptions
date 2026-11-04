package store

// Parity port of the "proxy subscription storage" describe block in
// __tests__/proxy-subscriptions.test.ts (2 cases). The file's five
// "proxy subscription date rules" cases live in server/internal/proxy.

import (
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func textPtr(v string) *string          { return &v }
func pricePtr(v float64) *float64       { return &v }
func tagNamesPtr(v ...string) *[]string { return &v }

// openProxyTestStore opens a store whose clock advances 1ms per read. The old
// tag test asserts newest-first ordering; real wall-clock reads inside one
// millisecond would collide and fall back to insertion order.
func openProxyTestStore(t *testing.T) *Store {
	t.Helper()
	var mu sync.Mutex
	current := time.Date(2026, 8, 30, 0, 0, 0, 0, time.UTC)
	clock := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		current = current.Add(time.Millisecond)
		return current
	}
	s, err := Open(filepath.Join(t.TempDir(), "proxy.db"), WithClock(clock))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// proxy-subscriptions.test.ts: "creates, updates, and deletes independent proxy
// tags".
func TestCreateUpdateDeleteProxySubscriptionsWithIndependentProxyTags(t *testing.T) {
	s := openProxyTestStore(t)

	created, err := s.CreateProxySubscription(ProxySubscriptionInput{
		Name:           textPtr("Relay"),
		MonthlyPrice:   pricePtr(19.9),
		ExpirationDate: textPtr("2026-09-30"),
		Status:         textPtr("unused"),
		TagNames:       tagNamesPtr("备用"),
	})
	if err != nil {
		t.Fatalf("CreateProxySubscription: %v", err)
	}

	tags, err := s.ProxyTags()
	if err != nil {
		t.Fatalf("ProxyTags: %v", err)
	}
	if len(tags) != 1 {
		t.Fatalf("proxy tags = %#v, want 1 tag", tags)
	}
	if len(created.TagIDs) != 1 {
		t.Fatalf("created tagIds = %#v, want 1 id", created.TagIDs)
	}

	updated, err := s.UpdateProxySubscription(created.ID, ProxySubscriptionInput{
		Status:   textPtr("in-use"),
		TagNames: tagNamesPtr("工作"),
	})
	if err != nil {
		t.Fatalf("UpdateProxySubscription: %v", err)
	}
	if updated == nil || updated.Status != "in-use" {
		t.Fatalf("updated = %#v, want status in-use", updated)
	}

	tags, err = s.ProxyTags()
	if err != nil {
		t.Fatalf("ProxyTags after update: %v", err)
	}
	gotNames := make([]string, len(tags))
	for i, tag := range tags {
		gotNames[i] = tag.Name
	}
	if want := []string{"工作", "备用"}; !reflect.DeepEqual(gotNames, want) {
		t.Fatalf("proxy tag names = %#v, want %#v (newest first)", gotNames, want)
	}

	currentTagID := updated.TagIDs[0]
	deleted, err := s.DeleteProxyTag(currentTagID)
	if err != nil {
		t.Fatalf("DeleteProxyTag: %v", err)
	}
	if deleted == nil {
		t.Fatal("DeleteProxyTag returned nil for an existing tag")
	}
	if deleted.TagID != currentTagID {
		t.Fatalf("deleted tag id = %q, want %q", deleted.TagID, currentTagID)
	}
	if want := []string{created.ID}; !reflect.DeepEqual(deleted.AffectedSubscriptionIDs, want) {
		t.Fatalf("affected = %#v, want %#v", deleted.AffectedSubscriptionIDs, want)
	}

	current, err := s.ProxySubscriptionByID(created.ID)
	if err != nil {
		t.Fatalf("ProxySubscriptionByID: %v", err)
	}
	if current == nil || len(current.TagIDs) != 0 {
		t.Fatalf("tagIds after tag delete = %#v, want none", current)
	}

	ok, err := s.DeleteProxySubscription(created.ID)
	if err != nil {
		t.Fatalf("DeleteProxySubscription: %v", err)
	}
	if !ok {
		t.Fatal("DeleteProxySubscription = false, want true")
	}
}

// proxy-subscriptions.test.ts: "supports unlimited subscriptions and clearing
// an expiration date".
func TestCreateProxySubscriptionSupportsUnlimitedAndClearingExpiration(t *testing.T) {
	s := openProxyTestStore(t)

	created, err := s.CreateProxySubscription(ProxySubscriptionInput{
		Name:         textPtr("Traffic Relay"),
		MonthlyPrice: pricePtr(10),
		Status:       textPtr("in-use"),
	})
	if err != nil {
		t.Fatalf("CreateProxySubscription: %v", err)
	}
	if created.ExpirationDate != "" {
		t.Fatalf("expirationDate = %q, want empty (unlimited traffic)", created.ExpirationDate)
	}

	updated, err := s.UpdateProxySubscription(created.ID, ProxySubscriptionInput{
		ExpirationDate: textPtr(""),
	})
	if err != nil {
		t.Fatalf("UpdateProxySubscription: %v", err)
	}
	if updated == nil || updated.ExpirationDate != "" {
		t.Fatalf("updated = %#v, want empty expirationDate", updated)
	}
}
