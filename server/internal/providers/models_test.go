package providers

import (
	"context"
	"testing"
)

// Port of __tests__/models-resolver.test.ts (26 cases): handler-key resolution,
// the models handler resolution order (plan exception → provider exception →
// generic fallback), the credentials-required flag, and normalizeModels.
//
// Deviation: the old stack registers bespoke exception handlers for github and
// fangzhou (whose bodies land with #32/#30). Their registry keys are absent
// here, so the tests that assert "an exception handler wins over the generic
// fallback" drive ResolveModelsHandlerWith with an explicit registry instead of
// asserting on the production one. The resolution rule under test is identical;
// once those bodies land they only add entries to ModelsHandlers().

func findProvider(t *testing.T, id string) Provider {
	t.Helper()
	provider, ok := ProviderByID(id)
	if !ok {
		t.Fatalf("provider %q not found in DefaultProviders", id)
	}
	return provider
}

func TestResolveModelsHandlerKey(t *testing.T) {
	t.Run("returns provider:planId when planId is provided", func(t *testing.T) {
		if got := ResolveModelsHandlerKey("moonshot", "kimi-code"); got != "moonshot:kimi-code" {
			t.Errorf("= %q, want moonshot:kimi-code", got)
		}
	})

	t.Run("returns bare provider when planId is undefined", func(t *testing.T) {
		if got := ResolveModelsHandlerKey("deepseek", ""); got != "deepseek" {
			t.Errorf("= %q, want deepseek", got)
		}
	})

	t.Run("returns bare provider when planId is empty string", func(t *testing.T) {
		if got := ResolveModelsHandlerKey("deepseek", ""); got != "deepseek" {
			t.Errorf("= %q, want deepseek", got)
		}
	})
}

func TestResolveModelsHandler(t *testing.T) {
	client := cannedHTTPDoer{body: `{"data":[{"id":"model-1"}]}`}

	t.Run("returns no-models-api-url when provider has no modelsApiUrl", func(t *testing.T) {
		_, _, ok := ResolveModelsHandler(findProvider(t, "anthropic"), "", client)
		if ok {
			t.Error("ok = true, want false (no-models-api-url)")
		}
	})

	t.Run("returns no-models-api-url when plan has no modelsApiUrl and provider has none", func(t *testing.T) {
		_, _, ok := ResolveModelsHandler(findProvider(t, "anthropic"), "some-plan", client)
		if ok {
			t.Error("ok = true, want false (no-models-api-url)")
		}
	})

	t.Run("resolves provider-level modelsApiUrl when no planId", func(t *testing.T) {
		handler, url, ok := ResolveModelsHandler(findProvider(t, "deepseek"), "", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if url != "https://api.deepseek.com/models" {
			t.Errorf("url = %q, want https://api.deepseek.com/models", url)
		}
		if handler == nil {
			t.Error("handler = nil, want generic fallback")
		}
	})

	t.Run("resolves plan-level modelsApiUrl over provider-level", func(t *testing.T) {
		_, url, ok := ResolveModelsHandler(findProvider(t, "moonshot"), "kimi-code", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if url != "https://api.kimi.com/coding/v1/models" {
			t.Errorf("url = %q, want the kimi-code plan endpoint", url)
		}
	})

	t.Run("falls back to provider-level when plan has no modelsApiUrl", func(t *testing.T) {
		// moonshot has a provider-level modelsApiUrl; a nonexistent plan must
		// not change that.
		_, url, ok := ResolveModelsHandler(findProvider(t, "moonshot"), "nonexistent-plan", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if url != "https://api.moonshot.cn/v1/models" {
			t.Errorf("url = %q, want https://api.moonshot.cn/v1/models", url)
		}
	})

	t.Run("returns no-models-api-url when plan exists but has no modelsApiUrl and provider has none", func(t *testing.T) {
		// zhipu has no provider-level modelsApiUrl, only plan-level.
		_, _, ok := ResolveModelsHandler(findProvider(t, "zhipu"), "nonexistent-plan", client)
		if ok {
			t.Error("ok = true, want false")
		}
	})

	t.Run("resolves plan-level modelsApiUrl for zhipu coding-plan", func(t *testing.T) {
		_, url, ok := ResolveModelsHandler(findProvider(t, "zhipu"), "coding-plan", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if url != "https://open.bigmodel.cn/api/coding/paas/v4/models" {
			t.Errorf("url = %q", url)
		}
	})

	t.Run("resolves plan-level modelsApiUrl for alibaba token-plan", func(t *testing.T) {
		_, url, ok := ResolveModelsHandler(findProvider(t, "alibaba"), "token-plan", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if url != "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models" {
			t.Errorf("url = %q", url)
		}
	})

	t.Run("resolves plan-level modelsApiUrl for alibaba coding-plan", func(t *testing.T) {
		_, url, ok := ResolveModelsHandler(findProvider(t, "alibaba"), "coding-plan", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if url != "https://coding.dashscope.aliyuncs.com/v1/models" {
			t.Errorf("url = %q", url)
		}
	})

	t.Run("uses generic fallback handler when no exception handler registered", func(t *testing.T) {
		handler, _, ok := ResolveModelsHandler(findProvider(t, "deepseek"), "", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if handler == nil {
			t.Fatal("handler = nil, want the generic fallback")
		}
		if _, isGeneric := handler.(genericModelsHandler); !isGeneric {
			t.Errorf("handler = %T, want genericModelsHandler", handler)
		}
	})

	t.Run("resolves fangzhou codingplan to the plan-specific exception handler", func(t *testing.T) {
		// The old stack registers "fangzhou:codingplan" so that plan queries hit
		// ListArkCodeLatestModel rather than the provider-wide handler. The body
		// lands with #30; the resolution rule is pinned here with an explicit
		// registry.
		planHandler := stubModelsHandler{}
		providerHandler := stubModelsHandler{}
		providers := map[string]ModelsHandler{
			"fangzhou:codingplan": planHandler,
			"fangzhou":            providerHandler,
		}

		handler, _, ok := ResolveModelsHandlerWith(findProvider(t, "fangzhou"), "codingplan", providers, client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if _, isPlan := handler.(stubModelsHandler); !isPlan {
			t.Fatalf("handler = %T, want the registered exception handler", handler)
		}
		if handler != ModelsHandler(planHandler) {
			t.Error("handler is not the plan-specific registry entry")
		}
	})

	t.Run("resolves alibaba token-plan to generic fallback handler (no exception handler)", func(t *testing.T) {
		// After removing the alibaba exception handler, token-plan must resolve
		// to the generic OpenAI-compatible fallback.
		handler, _, ok := ResolveModelsHandler(findProvider(t, "alibaba"), "token-plan", client)
		if !ok {
			t.Fatal("ok = false, want true")
		}
		if ModelsHandlers()["alibaba"] != nil {
			t.Error("modelsHandlers[alibaba] is registered, want absent")
		}
		if _, isGeneric := handler.(genericModelsHandler); !isGeneric {
			t.Errorf("handler = %T, want genericModelsHandler", handler)
		}
	})
}

// stubModelsHandler is an exception-handler stand-in; tests only compare
// identity, never call it.
type stubModelsHandler struct{}

func (stubModelsHandler) FetchModels(context.Context, map[string]string) ([]string, error) {
	return nil, nil
}

func TestResolveModelsRequireCredentials(t *testing.T) {
	t.Run("defaults to true when neither plan nor provider configures the flag", func(t *testing.T) {
		if !ResolveModelsRequireCredentials(findProvider(t, "deepseek"), "") {
			t.Error("= false, want true")
		}
	})

	t.Run("returns false for alibaba coding-plan (public endpoint)", func(t *testing.T) {
		if ResolveModelsRequireCredentials(findProvider(t, "alibaba"), "coding-plan") {
			t.Error("= true, want false")
		}
	})

	t.Run("returns true for alibaba token-plan (flag absent falls back to default)", func(t *testing.T) {
		if !ResolveModelsRequireCredentials(findProvider(t, "alibaba"), "token-plan") {
			t.Error("= false, want true")
		}
	})

	t.Run("plan-level flag overrides the provider-level flag", func(t *testing.T) {
		provider := Provider{
			ID:                       "synthetic",
			Name:                     "Synthetic",
			ModelsAPIURL:             "https://example.com/v1/models",
			ModelsRequireCredentials: boolPtr(false),
			Plans: []PlanDefinition{
				{ID: "auth-plan", Name: "Auth", ModelsRequireCredentials: boolPtr(true)},
				{ID: "anon-plan", Name: "Anon"},
			},
		}
		if !ResolveModelsRequireCredentials(provider, "auth-plan") {
			t.Error("auth-plan = false, want true")
		}
		if ResolveModelsRequireCredentials(provider, "anon-plan") {
			t.Error("anon-plan = true, want false (inherits provider)")
		}
		if ResolveModelsRequireCredentials(provider, "") {
			t.Error("no plan = true, want false")
		}
	})
}

func TestNormalizeModels(t *testing.T) {
	t.Run("deduplicates model ids", func(t *testing.T) {
		got := NormalizeModels([]string{"model-a", "model-b", "model-a", "model-c", "model-b"})
		assertStrings(t, got, []string{"model-a", "model-b", "model-c"})
	})

	t.Run("sorts model ids by localeCompare", func(t *testing.T) {
		got := NormalizeModels([]string{"model-c", "model-a", "model-b"})
		assertStrings(t, got, []string{"model-a", "model-b", "model-c"})
	})

	t.Run("deduplicates and sorts", func(t *testing.T) {
		got := NormalizeModels([]string{"zebra", "alpha", "zebra", "beta", "alpha"})
		assertStrings(t, got, []string{"alpha", "beta", "zebra"})
	})

	t.Run("handles empty array", func(t *testing.T) {
		if got := NormalizeModels([]string{}); len(got) != 0 {
			t.Errorf("= %v, want empty", got)
		}
	})

	t.Run("handles single element", func(t *testing.T) {
		assertStrings(t, NormalizeModels([]string{"only-one"}), []string{"only-one"})
	})

	t.Run("handles case-sensitive sorting (lowercase first in localeCompare)", func(t *testing.T) {
		got := NormalizeModels([]string{"Zebra", "alpha", "Beta"})
		assertStrings(t, got, []string{"alpha", "Beta", "Zebra"})
	})

	t.Run("preserves model id format (no transformation)", func(t *testing.T) {
		got := NormalizeModels([]string{"gpt-4", "claude-3-opus", "gemini-pro"})
		assertStrings(t, got, []string{"claude-3-opus", "gemini-pro", "gpt-4"})
	})
}

func assertStrings(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("= %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("= %v, want %v", got, want)
		}
	}
}
