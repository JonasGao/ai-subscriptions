package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

func TestListTagsServesTheCatalog(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "官方订阅", Price: 1}, "老标签")
	seedSubscription(t, db, store.SubscriptionInput{Name: "B", Category: "官方订阅", Price: 1}, "新标签")

	rec := request(t, srv, http.MethodGet, "/api/tags", "", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	var tags []model.Tag
	if err := json.Unmarshal(rec.Body.Bytes(), &tags); err != nil {
		t.Fatalf("unmarshal: %v (body=%q)", err, rec.Body.String())
	}
	names := map[string]bool{}
	for _, tag := range tags {
		names[tag.Name] = true
		if tag.ID == "" || tag.CreatedAt == "" {
			t.Fatalf("tag = %#v, want id and createdAt", tag)
		}
	}
	if len(tags) != 2 || !names["老标签"] || !names["新标签"] {
		t.Fatalf("tags = %#v, want both names", tags)
	}
}

// tags-api-cache.test.ts parity: the tag catalogue is mutable data, so the old
// stack marked the route force-dynamic. Its server equivalent is a response
// that can never be served from a cache, plus a read-after-write that sees the
// new tag immediately.
func TestTagsRouteIsNeverCached(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)

	rec := request(t, srv, http.MethodGet, "/api/tags", "", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}

	seedSubscription(t, db, store.SubscriptionInput{Name: "Fresh", Category: "官方订阅", Price: 1}, "Fresh")
	after := request(t, srv, http.MethodGet, "/api/tags", "", session)
	if !strings.Contains(after.Body.String(), `"name":"Fresh"`) {
		t.Fatalf("body = %q, want the newly created tag", after.Body.String())
	}
}

func TestRenameTagRoute(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "官方订阅", Price: 1}, "Stable")
	tagID := sub.TagIDs[0]

	rec := request(t, srv, http.MethodPatch, "/api/tags/"+tagID, `{"name":"Reliable"}`, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	payload := decodeSubscription(t, rec.Body.Bytes())
	if payload["name"] != "Reliable" || payload["id"] != tagID {
		t.Fatalf("body = %s, want the renamed tag with its stable id", rec.Body.String())
	}

	notFound := request(t, srv, http.MethodPatch, "/api/tags/missing", `{"name":"x"}`, session)
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", notFound.Code)
	}
	if got := decodeSubscription(t, notFound.Body.Bytes())["error"]; got != "Tag not found" {
		t.Fatalf("error = %v", got)
	}
}

func TestRenameTagRouteRejectsInvalidNames(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "官方订阅", Price: 1}, "Stable", "Fast")
	stableID, fastID := sub.TagIDs[0], sub.TagIDs[1]

	conflict := request(t, srv, http.MethodPatch, "/api/tags/"+stableID, `{"name":"Fast"}`, session)
	if conflict.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", conflict.Code)
	}
	if got := decodeSubscription(t, conflict.Body.Bytes())["error"]; got != "标签名称已存在" {
		t.Fatalf("error = %v", got)
	}

	tooLong := request(t, srv, http.MethodPatch, "/api/tags/"+fastID,
		`{"name":"`+strings.Repeat("x", 31)+`"}`, session)
	if tooLong.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", tooLong.Code)
	}
	if got := decodeSubscription(t, tooLong.Body.Bytes())["error"]; got != "标签不能超过 30 个字符" {
		t.Fatalf("error = %v", got)
	}

	broken := request(t, srv, http.MethodPatch, "/api/tags/"+fastID, `{"name":`, session)
	if broken.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", broken.Code)
	}
	if got := decodeSubscription(t, broken.Body.Bytes())["error"]; got != "Invalid JSON in request body" {
		t.Fatalf("error = %v", got)
	}
}

func TestDeleteTagRouteReportsAffectedSubscriptions(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	first := seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "官方订阅", Price: 1}, "Stable")
	seedSubscription(t, db, store.SubscriptionInput{Name: "B", Category: "官方订阅", Price: 1}, "Stable")
	tagID := first.TagIDs[0]

	rec := request(t, srv, http.MethodDelete, "/api/tags/"+tagID, "", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	payload := decodeSubscription(t, rec.Body.Bytes())
	affected, _ := payload["affectedSubscriptionIds"].([]any)
	if len(affected) != 2 {
		t.Fatalf("body = %s, want two affected subscriptions", rec.Body.String())
	}

	missing := request(t, srv, http.MethodDelete, "/api/tags/missing", "", session)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", missing.Code)
	}
}

func TestCategoriesRoutes(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)

	rec := request(t, srv, http.MethodGet, "/api/categories", "", session)
	if got, want := rec.Body.String(), `["官方订阅","中转站"]`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	created := request(t, srv, http.MethodPost, "/api/categories", `{"category":"  图像生成  "}`, session)
	if created.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%q)", created.Code, created.Body.String())
	}
	if got, want := created.Body.String(), `["官方订阅","中转站","图像生成"]`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	blank := request(t, srv, http.MethodPost, "/api/categories", `{"category":"   "}`, session)
	if blank.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", blank.Code)
	}
	if got := decodeSubscription(t, blank.Body.Bytes())["error"]; got != "Category must be a non-empty string" {
		t.Fatalf("error = %v", got)
	}

	missingName := request(t, srv, http.MethodDelete, "/api/categories", "", session)
	if missingName.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", missingName.Code)
	}
	if got := decodeSubscription(t, missingName.Body.Bytes())["error"]; got != "Category name is required" {
		t.Fatalf("error = %v", got)
	}

	seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "中转站", Price: 1})
	inUse := request(t, srv, http.MethodDelete, "/api/categories?name=中转站", "", session)
	if inUse.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", inUse.Code, inUse.Body.String())
	}
	if got := decodeSubscription(t, inUse.Body.Bytes())["error"]; got != "Cannot delete category with subscriptions" {
		t.Fatalf("error = %v", got)
	}

	deleted := request(t, srv, http.MethodDelete, "/api/categories?name=图像生成", "", session)
	if deleted.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", deleted.Code)
	}
	if got, want := deleted.Body.String(), `["官方订阅","中转站"]`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
}

// The usage route's guard chain is byte-aligned with the old stack. The provider
// dispatch landed with #28; these must short-circuit before any outbound call.
func TestUsageRouteGuards(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)

	notFound := request(t, srv, http.MethodGet, "/api/subscriptions/missing/usage", "", session)
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", notFound.Code)
	}
	if got := decodeSubscription(t, notFound.Body.Bytes())["error"]; got != "Subscription not found" {
		t.Fatalf("error = %v", got)
	}

	oneTime := seedSubscription(t, db, store.SubscriptionInput{
		Name: "One-time", Category: "官方订阅", Provider: "moonshot",
		SubscriptionType: "one-time", Price: 1,
	})
	rec := request(t, srv, http.MethodGet, "/api/subscriptions/"+oneTime.ID+"/usage", "", session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != "Usage query is only supported for recurring subscriptions" {
		t.Fatalf("error = %v", got)
	}

	noURL := seedSubscription(t, db, store.SubscriptionInput{
		Name: "OpenAI", Category: "官方订阅", Provider: "openai",
		SubscriptionType: "recurring", BillingCycle: "monthly", Price: 1,
	})
	rec = request(t, srv, http.MethodGet, "/api/subscriptions/"+noURL.ID+"/usage", "", session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != "Usage query not supported for openai" {
		t.Fatalf("error = %v", got)
	}

	noCredentials := seedSubscription(t, db, store.SubscriptionInput{
		Name: "Kimi", Category: "官方订阅", Provider: "moonshot",
		SubscriptionType: "recurring", BillingCycle: "monthly", Price: 1, PlanID: "kimi-code",
	})
	rec = request(t, srv, http.MethodGet, "/api/subscriptions/"+noCredentials.ID+"/usage", "", session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != "Credentials are not configured for this subscription" {
		t.Fatalf("error = %v", got)
	}
}

// Same treatment for the models route: identical guards, provider query in #28.
func TestModelsRouteGuards(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)

	notFound := request(t, srv, http.MethodGet, "/api/subscriptions/missing/models", "", session)
	if notFound.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", notFound.Code)
	}

	noURL := seedSubscription(t, db, store.SubscriptionInput{
		Name: "Anthropic", Category: "官方订阅", Provider: "anthropic",
		SubscriptionType: "recurring", BillingCycle: "monthly", Price: 1,
	})
	rec := request(t, srv, http.MethodGet, "/api/subscriptions/"+noURL.ID+"/models", "", session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != "Model query not supported for anthropic" {
		t.Fatalf("error = %v", got)
	}

	requiresCredentials := seedSubscription(t, db, store.SubscriptionInput{
		Name: "DeepSeek", Category: "官方订阅", Provider: "deepseek",
		SubscriptionType: "one-time", Price: 1,
	})
	rec = request(t, srv, http.MethodGet, "/api/subscriptions/"+requiresCredentials.ID+"/models", "", session)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != "Credentials are not configured for this subscription" {
		t.Fatalf("error = %v", got)
	}
}
