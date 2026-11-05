package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"ai-subscriptions/internal/store"
)

// Port of __tests__/models-route.test.ts (3 cases): credential gating and
// decryption/forwarding for GET /api/subscriptions/{id}/models.

func seedOneTimeSubscription(t *testing.T, f subscriptionQueryFixture, input store.SubscriptionInput) string {
	t.Helper()
	if input.Name == "" {
		input.Name = "Test Sub"
	}
	if input.Category == "" {
		input.Category = "官方订阅"
	}
	if input.SubscriptionType == "" {
		input.SubscriptionType = "one-time"
	}
	if input.Status == "" {
		input.Status = "active"
	}
	sub, err := f.db.CreateSubscription(input, nil)
	if err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	return sub.ID
}

func decodeModels(t *testing.T, raw []byte) []string {
	t.Helper()
	var body struct {
		Models []string `json:"models"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal models response: %v (body=%q)", err, raw)
	}
	return body.Models
}

func TestModelsRouteCredentialsGating(t *testing.T) {
	t.Run("serves models without credentials for public endpoints (alibaba coding-plan)", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{"object":"list","data":[{"id":"qwen3-coder-plus"},{"id":"glm-5"}]}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:         "alibaba",
			PlanID:           "coding-plan",
			SubscriptionType: "recurring",
			BillingCycle:     "monthly",
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/models", "", f.cookie)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		if got := decodeModels(t, rec.Body.Bytes()); len(got) != 2 || got[0] != "glm-5" || got[1] != "qwen3-coder-plus" {
			t.Errorf("models = %v, want sorted [glm-5 qwen3-coder-plus]", got)
		}

		// Outbound call hits the public endpoint with no auth header.
		if len(f.client.requests) != 1 {
			t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
		}
		req := f.client.requests[0]
		if req.URL.String() != "https://coding.dashscope.aliyuncs.com/v1/models" {
			t.Errorf("url = %q", req.URL.String())
		}
		if req.Method != http.MethodGet {
			t.Errorf("method = %q, want GET", req.Method)
		}
		if got := req.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization = %q, want absent", got)
		}
	})

	t.Run("rejects credential-less subscriptions for auth-required endpoints", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{"data":[{"id":"deepseek-chat"}]}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{Provider: "deepseek"})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/models", "", f.cookie)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body.String())
		}
		if body := rec.Body.String(); !containsText(body, "Credentials") {
			t.Errorf("body = %q, want containing Credentials", body)
		}
		if len(f.client.requests) != 0 {
			t.Errorf("outbound requests = %d, want 0", len(f.client.requests))
		}
	})

	t.Run("decrypts and forwards credentials for auth-required endpoints", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{"data":[{"id":"deepseek-chat"}]}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:    "deepseek",
			Credentials: f.encrypt(t, map[string]string{"apiKey": "decrypted-key"}),
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/models", "", f.cookie)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body.String())
		}
		if got := decodeModels(t, rec.Body.Bytes()); len(got) != 1 || got[0] != "deepseek-chat" {
			t.Errorf("models = %v, want [deepseek-chat]", got)
		}

		if len(f.client.requests) != 1 {
			t.Fatalf("outbound requests = %d, want 1", len(f.client.requests))
		}
		req := f.client.requests[0]
		if req.URL.String() != "https://api.deepseek.com/models" {
			t.Errorf("url = %q", req.URL.String())
		}
		if got := req.Header.Get("Authorization"); got != "Bearer decrypted-key" {
			t.Errorf("Authorization = %q, want Bearer decrypted-key", got)
		}
	})
}

// Supplementary guards (old stack had no route-level tests for these): status
// mapping, no-store caching, dedupe/normalisation and guard ordering.
func TestModelsRouteBehaviour(t *testing.T) {
	t.Run("normalises, dedupes and disables caching", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"z-model"}]}`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:    "deepseek",
			Credentials: f.encrypt(t, map[string]string{"apiKey": "k"}),
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/models", "", f.cookie)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("Cache-Control = %q, want no-store", got)
		}
		body := rec.Body.String()
		if body != `{"models":["a-model","z-model"]}` {
			t.Errorf("body = %q", body)
		}
	})

	t.Run("reports a provider handler failure as 502 with its message", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `not-json`)
		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{
			Provider:    "deepseek",
			Credentials: f.encrypt(t, map[string]string{"apiKey": "k"}),
		})

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/models", "", f.cookie)
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502 (body %s)", rec.Code, rec.Body.String())
		}
	})

	t.Run("404s an unknown subscription and 400s a provider without a models endpoint", func(t *testing.T) {
		f := newSubscriptionQueryFixture(t, `{}`)

		rec := request(t, f.srv, http.MethodGet, "/api/subscriptions/nope/models", "", f.cookie)
		if rec.Code != http.StatusNotFound {
			t.Errorf("unknown id status = %d, want 404", rec.Code)
		}

		id := seedOneTimeSubscription(t, f, store.SubscriptionInput{Provider: "anthropic"})
		rec = request(t, f.srv, http.MethodGet, "/api/subscriptions/"+id+"/models", "", f.cookie)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("anthropic status = %d, want 400", rec.Code)
		}
		if body := rec.Body.String(); !containsText(body, "Model query not supported for anthropic") {
			t.Errorf("body = %q", body)
		}
	})
}

func containsText(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && indexOfText(haystack, needle) >= 0)
}

func indexOfText(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
