package providers

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/models-generic-fetch.test.ts (8 cases): the OpenAI-compatible
// fallback used by every provider without a bespoke model-list API.

// recordingHTTPDoer captures the outbound request and replies with a canned body
// so the fallback's URL/header behaviour can be asserted.
type recordingHTTPDoer struct {
	statusCode int
	body       string
	requests   []*http.Request
}

func (r *recordingHTTPDoer) Do(req *http.Request) (*http.Response, error) {
	r.requests = append(r.requests, req)
	status := r.statusCode
	if status == 0 {
		status = http.StatusOK
	}
	return &http.Response{
		StatusCode: status,
		Status:     httpStatusLine(status),
		Body:       nopCloser(r.body),
		Header:     make(http.Header),
	}, nil
}

func fetchGeneric(t *testing.T, providerID, planID, body string, credentials map[string]string) ([]string, *recordingHTTPDoer) {
	t.Helper()
	client := &recordingHTTPDoer{body: body}
	handler, _, ok := ResolveModelsHandler(findProvider(t, providerID), planID, client)
	if !ok {
		t.Fatalf("ResolveModelsHandler(%s, %s) not ok", providerID, planID)
	}
	models, err := handler.FetchModels(context.Background(), credentials)
	if err != nil {
		t.Fatalf("FetchModels: %v", err)
	}
	return models, client
}

func TestGenericOpenAIFetchModels(t *testing.T) {
	t.Run("extracts data[].id from OpenAI-shaped response", func(t *testing.T) {
		body := `{"data":[{"id":"gpt-4","object":"model"},{"id":"gpt-3.5-turbo","object":"model"},{"id":"gpt-4","object":"model"}]}`

		models, _ := fetchGeneric(t, "deepseek", "", body, map[string]string{"apiKey": "test-key"})

		// Handler returns raw ids; normalizeModels dedupes later in the route.
		assertStrings(t, models, []string{"gpt-4", "gpt-3.5-turbo", "gpt-4"})
	})

	t.Run("throws on HTTP error", func(t *testing.T) {
		client := &recordingHTTPDoer{statusCode: http.StatusUnauthorized, body: "Unauthorized"}
		handler, _, ok := ResolveModelsHandler(findProvider(t, "deepseek"), "", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		_, err := handler.FetchModels(context.Background(), map[string]string{"apiKey": "bad-key"})
		if err == nil || !strings.Contains(err.Error(), "Models query failed: 401 Unauthorized") {
			t.Errorf("err = %v, want Models query failed: 401 Unauthorized", err)
		}
	})

	t.Run("throws on invalid response shape (missing data array)", func(t *testing.T) {
		handler, _, ok := ResolveModelsHandler(findProvider(t, "deepseek"), "", &recordingHTTPDoer{body: `{"models":["gpt-4"]}`})
		if !ok {
			t.Fatal("ok = false, want true")
		}
		_, err := handler.FetchModels(context.Background(), map[string]string{"apiKey": "test-key"})
		if err == nil || !strings.Contains(err.Error(), "Invalid models response: missing data array") {
			t.Errorf("err = %v, want invalid-shape", err)
		}
	})

	t.Run("sends Bearer token when apiKey is provided", func(t *testing.T) {
		_, client := fetchGeneric(t, "deepseek", "", `{"data":[{"id":"model-1"}]}`, map[string]string{"apiKey": "test-api-key"})

		if len(client.requests) != 1 {
			t.Fatalf("requests = %d, want 1", len(client.requests))
		}
		req := client.requests[0]
		if req.URL.String() != "https://api.deepseek.com/models" {
			t.Errorf("url = %q", req.URL.String())
		}
		if req.Method != http.MethodGet {
			t.Errorf("method = %q, want GET", req.Method)
		}
		if got := req.Header.Get("Authorization"); got != "Bearer test-api-key" {
			t.Errorf("Authorization = %q, want Bearer test-api-key", got)
		}
	})

	t.Run("works without credentials for public endpoints", func(t *testing.T) {
		_, client := fetchGeneric(t, "openrouter", "", `{"data":[{"id":"model-1"}]}`, map[string]string{})

		if len(client.requests) != 1 {
			t.Fatalf("requests = %d, want 1", len(client.requests))
		}
		req := client.requests[0]
		if req.URL.String() != "https://openrouter.ai/api/v1/models" {
			t.Errorf("url = %q", req.URL.String())
		}
		if got := req.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization = %q, want absent", got)
		}
	})

	t.Run("filters out items without id", func(t *testing.T) {
		body := `{"data":[{"id":"model-1","object":"model"},{"object":"model"},{"id":"model-2","object":"model"},{"id":null,"object":"model"},{"id":"","object":"model"}]}`

		models, _ := fetchGeneric(t, "deepseek", "", body, map[string]string{"apiKey": "test-key"})

		assertStrings(t, models, []string{"model-1", "model-2"})
	})

	t.Run("alibaba token-plan uses generic OpenAI fallback with Bearer token", func(t *testing.T) {
		body := `{"object":"list","data":[{"id":"qwen3.7","object":"model","created":1234567890,"owned_by":"alibaba"},{"id":"deepseek-v3.2","object":"model","created":1234567890,"owned_by":"deepseek"},{"id":"qwen3.7","object":"model","created":1234567890,"owned_by":"alibaba"}],"first_id":"qwen3.7","last_id":"qwen3.7","has_more":false}`

		models, client := fetchGeneric(t, "alibaba", "token-plan", body, map[string]string{"apiKey": "test-api-key"})

		assertStrings(t, models, []string{"qwen3.7", "deepseek-v3.2", "qwen3.7"})

		if len(client.requests) != 1 {
			t.Fatalf("requests = %d, want 1 (no pagination)", len(client.requests))
		}
		req := client.requests[0]
		if req.URL.String() != "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models" {
			t.Errorf("url = %q", req.URL.String())
		}
		if got := req.Header.Get("Authorization"); got != "Bearer test-api-key" {
			t.Errorf("Authorization = %q", got)
		}

		// After normalizeModels: dedup + locale sort
		assertStrings(t, NormalizeModels(models), []string{"deepseek-v3.2", "qwen3.7"})
	})

	t.Run("alibaba coding-plan works without any auth (ak/sk-only credentials)", func(t *testing.T) {
		// The coding.dashscope endpoint is public: a subscription configured with
		// only ak/sk (for usage query) must not block model listing on a missing
		// apiKey — the generic fallback omits the Authorization header entirely.
		body := `{"object":"list","data":[{"id":"qwen3-coder-plus","object":"model","created":1772196763,"ownedBy":"system"},{"id":"glm-5","object":"model","created":1781449043,"ownedBy":"system"}],"firstId":"model-id-0","lastId":"model-id-9","hasMore":false}`

		models, client := fetchGeneric(t, "alibaba", "coding-plan", body, map[string]string{"ak": "test-ak", "sk": "test-sk"})

		assertStrings(t, models, []string{"qwen3-coder-plus", "glm-5"})

		if len(client.requests) != 1 {
			t.Fatalf("requests = %d, want 1", len(client.requests))
		}
		req := client.requests[0]
		if req.URL.String() != "https://coding.dashscope.aliyuncs.com/v1/models" {
			t.Errorf("url = %q", req.URL.String())
		}
		if got := req.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization = %q, want absent (public endpoint)", got)
		}
	})
}
