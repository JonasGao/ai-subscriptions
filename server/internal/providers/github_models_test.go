package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/github-models.test.ts (8 cases): PAT → Copilot token
// exchange, the models query, and the per-PAT cache.

// githubScriptedDoer dispatches canned responses by URL substring so a single
// client can drive the two-call exchange-then-models flow.
type githubScriptedDoer struct {
	candidates []struct {
		contains string
		status   int
		body     string
	}
	// handle overrides candidates when set. Tests that need to derive the
	// response from the request (e.g. per-PAT token body) assign this.
	handle   func(*http.Request) (*http.Response, error)
	requests []*http.Request
}

func (d *githubScriptedDoer) Do(req *http.Request) (*http.Response, error) {
	d.requests = append(d.requests, req)
	if d.handle != nil {
		return d.handle(req)
	}
	url := req.URL.String()
	for _, candidate := range d.candidates {
		if strings.Contains(url, candidate.contains) {
			return githubHTTPResponse(candidate.status, candidate.body), nil
		}
	}
	return githubHTTPResponse(http.StatusInternalServerError, `{"message":"unhandled url"}`), nil
}

func newGithubScriptedDoer() *githubScriptedDoer {
	return &githubScriptedDoer{}
}

func (d *githubScriptedDoer) add(contains string, status int, body string) *githubScriptedDoer {
	d.candidates = append(d.candidates, struct {
		contains string
		status   int
		body     string
	}{contains: contains, status: status, body: body})
	return d
}

func TestGithubModels(t *testing.T) {
	baseCreds := map[string]string{"token": "ghp_test_token"}

	t.Cleanup(func() { defaultGithubTokenCache.reset() })
	defaultGithubTokenCache.reset()

	t.Run("throws when token is missing", func(t *testing.T) {
		for _, credentials := range []map[string]string{{}, {"token": ""}} {
			_, err := fetchGithubModelsWithCache(context.Background(), newGithubScriptedDoer(), defaultGithubTokenCache, credentials)
			if err == nil || err.Error() != "Token 未配置" {
				t.Errorf("err = %v, want Token 未配置", err)
			}
		}
	})

	t.Run("exchanges PAT for Copilot token then fetches models", func(t *testing.T) {
		defaultGithubTokenCache.reset()
		client := newGithubScriptedDoer().
			add("copilot_internal/v2/token", http.StatusOK, `{"token":"copilot_token_123","expires_at":1730000000000,"endpoints":{"api":"https://api.githubcopilot.com"}}`).
			add("githubcopilot.com/models", http.StatusOK, `{"data":[{"id":"gpt-4","name":"GPT-4","capabilities":{"type":"chat"},"policy":{"state":"enabled"}},{"id":"gpt-3.5","name":"GPT-3.5","capabilities":{"type":"chat"},"policy":{"state":"enabled"}}]}`)

		models, err := fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubModels: %v", err)
		}
		assertStrings(t, models, []string{"gpt-4", "gpt-3.5"})

		if len(client.requests) != 2 {
			t.Fatalf("requests = %d, want 2", len(client.requests))
		}
		exchange := client.requests[0]
		if exchange.URL.String() != "https://api.github.com/copilot_internal/v2/token" {
			t.Errorf("exchange url = %q", exchange.URL.String())
		}
		if got := exchange.Header.Get("Authorization"); got != "token ghp_test_token" {
			t.Errorf("exchange Authorization = %q, want token ghp_test_token", got)
		}
		if got := exchange.Header.Get("Editor-Version"); got != "vscode/1.96.2" {
			t.Errorf("exchange Editor-Version = %q", got)
		}
		modelsReq := client.requests[1]
		if modelsReq.URL.String() != "https://api.githubcopilot.com/models" {
			t.Errorf("models url = %q", modelsReq.URL.String())
		}
		if got := modelsReq.Header.Get("Authorization"); got != "Bearer copilot_token_123" {
			t.Errorf("models Authorization = %q, want Bearer copilot_token_123", got)
		}
	})

	t.Run("filters by policy.state=enabled and capabilities.type=chat", func(t *testing.T) {
		defaultGithubTokenCache.reset()
		client := newGithubScriptedDoer().
			add("copilot_internal/v2/token", http.StatusOK, `{"token":"copilot_token","expires_at":1730000000000}`).
			add("githubcopilot.com/models", http.StatusOK, `{"data":[{"id":"gpt-4","capabilities":{"type":"chat"},"policy":{"state":"enabled"}},{"id":"embedding-ada","capabilities":{"type":"embeddings"},"policy":{"state":"enabled"}},{"id":"gpt-3.5-disabled","capabilities":{"type":"chat"},"policy":{"state":"disabled"}},{"id":"claude","capabilities":{"type":"chat"},"policy":{"state":"enabled"}}]}`)

		models, err := fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubModels: %v", err)
		}
		assertStrings(t, models, []string{"gpt-4", "claude"})
	})

	t.Run("returns empty array when no models pass filter", func(t *testing.T) {
		defaultGithubTokenCache.reset()
		client := newGithubScriptedDoer().
			add("copilot_internal/v2/token", http.StatusOK, `{"token":"copilot_token","expires_at":1730000000000}`).
			add("githubcopilot.com/models", http.StatusOK, `{"data":[{"id":"embedding-ada","capabilities":{"type":"embeddings"},"policy":{"state":"enabled"}}]}`)

		models, err := fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubModels: %v", err)
		}
		if len(models) != 0 {
			t.Errorf("models = %v, want empty", models)
		}
	})

	t.Run("throws on token exchange failure", func(t *testing.T) {
		defaultGithubTokenCache.reset()
		client := newGithubScriptedDoer().
			add("copilot_internal/v2/token", http.StatusUnauthorized, `{"message":"bad credentials"}`)

		_, err := fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, baseCreds)
		if err == nil || err.Error() != "Token exchange API returned 401" {
			t.Errorf("err = %v, want Token exchange API returned 401", err)
		}
	})

	t.Run("throws on models API failure", func(t *testing.T) {
		defaultGithubTokenCache.reset()
		client := newGithubScriptedDoer().
			add("copilot_internal/v2/token", http.StatusOK, `{"token":"copilot_token","expires_at":1730000000000}`).
			add("githubcopilot.com/models", http.StatusForbidden, `{"message":"forbidden"}`)

		_, err := fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, baseCreds)
		if err == nil || err.Error() != "Copilot models API returned 403" {
			t.Errorf("err = %v, want Copilot models API returned 403", err)
		}
	})

	t.Run("handles missing data field gracefully", func(t *testing.T) {
		defaultGithubTokenCache.reset()
		client := newGithubScriptedDoer().
			add("copilot_internal/v2/token", http.StatusOK, `{"token":"copilot_token","expires_at":1730000000000}`).
			add("githubcopilot.com/models", http.StatusOK, `{}`)

		models, err := fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, baseCreds)
		if err != nil {
			t.Fatalf("FetchGithubModels: %v", err)
		}
		if len(models) != 0 {
			t.Errorf("models = %v, want empty", models)
		}
	})

	t.Run("does not reuse the cached Copilot token across different PATs", func(t *testing.T) {
		defaultGithubTokenCache.reset()
		// Short-lived cache: expires_at far in the future, same-PAT reuse within TTL.
		client := &githubScriptedDoer{}
		client.candidates = append(client.candidates,
			struct {
				contains string
				status   int
				body     string
			}{
				contains: "copilot_internal/v2/token",
				status:   http.StatusOK,
				body:     "dynamic",
			},
			struct {
				contains string
				status   int
				body     string
			}{
				contains: "githubcopilot.com/models",
				status:   http.StatusOK,
				body:     `{"data":[{"id":"claude-sonnet-4","capabilities":{"type":"chat"},"policy":{"state":"enabled"}}]}`,
			},
		)
		// Override handle so the exchange endpoint returns a token derived from the Authorization header (the PAT).
		client.handle = func(req *http.Request) (*http.Response, error) {
			if strings.Contains(req.URL.String(), "copilot_internal/v2/token") {
				pat := strings.TrimPrefix(req.Header.Get("Authorization"), "token ")
				body, _ := json.Marshal(map[string]any{
					"token":      "copilot_for_" + pat,
					"expires_at": float64(9_999_999_999_999),
					"endpoints":  map[string]string{"api": "https://api.githubcopilot.com"},
				})
				return githubHTTPResponse(http.StatusOK, string(body)), nil
			}
			if strings.Contains(req.URL.String(), "githubcopilot.com/models") {
				return githubHTTPResponse(http.StatusOK, `{"data":[{"id":"claude-sonnet-4","capabilities":{"type":"chat"},"policy":{"state":"enabled"}}]}`), nil
			}
			return githubHTTPResponse(http.StatusInternalServerError, ""), nil
		}

		_, err := fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, map[string]string{"token": "ghp_AAA"})
		if err != nil {
			t.Fatalf("first call: %v", err)
		}
		_, err = fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, map[string]string{"token": "ghp_BBB"})
		if err != nil {
			t.Fatalf("second call: %v", err)
		}

		// Two distinct PATs → two exchanges.
		exchanges := 0
		var exchangeAuths []string
		for _, req := range client.requests {
			if strings.Contains(req.URL.String(), "copilot_internal/v2/token") {
				exchanges++
				exchangeAuths = append(exchangeAuths, req.Header.Get("Authorization"))
			}
		}
		if exchanges != 2 {
			t.Fatalf("exchanges = %d, want 2 (auths %v)", exchanges, exchangeAuths)
		}
		if exchangeAuths[0] != "token ghp_AAA" || exchangeAuths[1] != "token ghp_BBB" {
			t.Errorf("exchange auths = %v", exchangeAuths)
		}

		// Same PAT within TTL reuses the cache — no third exchange.
		_, err = fetchGithubModelsWithCache(context.Background(), client, defaultGithubTokenCache, map[string]string{"token": "ghp_BBB"})
		if err != nil {
			t.Fatalf("third call: %v", err)
		}
		exchanges = 0
		for _, req := range client.requests {
			if strings.Contains(req.URL.String(), "copilot_internal/v2/token") {
				exchanges++
			}
		}
		if exchanges != 2 {
			t.Errorf("exchanges after reuse = %d, want 2", exchanges)
		}
	})
}
