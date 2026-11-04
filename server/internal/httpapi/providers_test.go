package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"ai-subscriptions/internal/providers"
)

// stubProviderRefs feeds canned subscription/tool references.
type stubProviderRefs struct {
	subscriptions []providers.ProviderRef
	tools         []providers.ProviderRef
}

func (s stubProviderRefs) SubscriptionRefs() []providers.ProviderRef { return s.subscriptions }
func (s stubProviderRefs) ToolRefs() []providers.ProviderRef         { return s.tools }

func getJSON(t *testing.T, handler http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d, want 200 (body=%q)", path, rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	return rec
}

func TestProvidersRoutesServeEmptyInstallShape(t *testing.T) {
	srv := New(Options{})

	providersRec := getJSON(t, srv, "/api/providers")
	providersWant, err := os.ReadFile("testdata/old_stack_providers_enriched.json")
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	if !bytes.Equal(providersRec.Body.Bytes(), providersWant) {
		t.Errorf("/api/providers body differs from old stack\n got: %s\nwant: %s",
			providersRec.Body.Bytes(), providersWant)
	}

	unregisteredRec := getJSON(t, srv, "/api/providers/unregistered")
	if got, want := unregisteredRec.Body.String(), "[]"; got != want {
		t.Errorf("/api/providers/unregistered body = %q, want %q", got, want)
	}
}

func TestProvidersRouteEnrichesReferenceCounts(t *testing.T) {
	srv := New(Options{ProviderRefs: stubProviderRefs{
		subscriptions: []providers.ProviderRef{
			{Provider: "deepseek"},
			{Provider: "deepseek"},
			{Provider: "moonshot", ProviderCustom: ""},
			{Provider: "other", ProviderCustom: "FooAPI"},
		},
		tools: []providers.ProviderRef{
			{Provider: "moonshot"},
			{Provider: "other", ProviderCustom: "FooAPI"},
		},
	}})

	rec := getJSON(t, srv, "/api/providers")

	var body []struct {
		ID                string `json:"id"`
		SubscriptionCount int    `json:"subscriptionCount"`
		ToolCount         int    `json:"toolCount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body=%q)", err, rec.Body.String())
	}

	byID := make(map[string]int, len(body))
	for i, provider := range body {
		byID[provider.ID] = i
	}

	for _, tc := range []struct {
		id                   string
		subscriptions, tools int
	}{
		{"deepseek", 2, 0},
		{"moonshot", 1, 1},
		{"openai", 0, 0},
	} {
		index, ok := byID[tc.id]
		if !ok {
			t.Fatalf("provider %q missing from response", tc.id)
		}
		got := body[index]
		if got.SubscriptionCount != tc.subscriptions || got.ToolCount != tc.tools {
			t.Errorf("%s counts = (%d, %d), want (%d, %d)",
				tc.id, got.SubscriptionCount, got.ToolCount, tc.subscriptions, tc.tools)
		}
	}
}

func TestUnregisteredProvidersRoute(t *testing.T) {
	srv := New(Options{ProviderRefs: stubProviderRefs{
		subscriptions: []providers.ProviderRef{
			{Provider: "other", ProviderCustom: "FooAPI"},
			{Provider: "other", ProviderCustom: "FooAPI"},
			{Provider: "deepseek"},
		},
		tools: []providers.ProviderRef{
			{Provider: "other", ProviderCustom: "BarSvc"},
		},
	}})

	rec := getJSON(t, srv, "/api/providers/unregistered")
	if got, want := rec.Body.String(), `[{"name":"FooAPI","count":2},{"name":"BarSvc","count":1}]`; got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

func TestProvidersRoutesRejectNonGET(t *testing.T) {
	srv := New(Options{})

	for _, path := range []string{"/api/providers", "/api/providers/unregistered"} {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("POST %s status = %d, want 405", path, rec.Code)
		}
	}
}
