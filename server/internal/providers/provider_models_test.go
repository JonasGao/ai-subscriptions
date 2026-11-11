package providers

import (
	"context"
	"sort"
	"testing"
)

// Port of __tests__/provider-models.test.ts (15 cases): the registry's
// modelsApiUrl declarations at provider and plan level, the exact set of
// models-capable providers, and the ModelsHandler contract.
//
// Deviation: the two type-contract cases ("ModelsHandler is satisfiable by
// fetchModels alone", "ModelsResult matches { models: string[] }") are
// TypeScript shape assertions with no runtime analogue. The Go interface
// guarantees the first structurally (a single-method interface), and the wire
// shape is pinned by the route test in internal/httpapi/models_test.go.

func planModelsAPIURL(t *testing.T, providerID, planID string) string {
	t.Helper()
	for _, plan := range findProvider(t, providerID).Plans {
		if plan.ID == planID {
			return plan.ModelsAPIURL
		}
	}
	t.Fatalf("plan %q not found for provider %q", planID, providerID)
	return ""
}

func TestDefaultProvidersModelsAPIURLProviderLevel(t *testing.T) {
	t.Run("github uses the Copilot models endpoint", func(t *testing.T) {
		if got := findProvider(t, "github").ModelsAPIURL; got != "https://api.githubcopilot.com/models" {
			t.Errorf("= %q", got)
		}
	})

	t.Run("deepseek uses the standard models endpoint", func(t *testing.T) {
		if got := findProvider(t, "deepseek").ModelsAPIURL; got != "https://api.deepseek.com/models" {
			t.Errorf("= %q", got)
		}
	})

	t.Run("siliconflow uses the v1 models endpoint", func(t *testing.T) {
		if got := findProvider(t, "siliconflow").ModelsAPIURL; got != "https://api.siliconflow.cn/v1/models" {
			t.Errorf("= %q", got)
		}
	})

	t.Run("openrouter uses the public catalog endpoint", func(t *testing.T) {
		if got := findProvider(t, "openrouter").ModelsAPIURL; got != "https://openrouter.ai/api/v1/models" {
			t.Errorf("= %q", got)
		}
	})

	t.Run("fangzhou uses the shared control-plane ListFoundationModels endpoint (both plans)", func(t *testing.T) {
		provider := findProvider(t, "fangzhou")
		if provider.ModelsAPIURL != "https://open.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01" {
			t.Errorf("provider modelsApiUrl = %q", provider.ModelsAPIURL)
		}
		// Plans have their own modelsApiUrl for plan-specific model list APIs.
		if got := planModelsAPIURL(t, "fangzhou", "codingplan"); !contains(got, "ListArkCodeLatestModel") {
			t.Errorf("codingplan = %q, want ListArkCodeLatestModel", got)
		}
		if got := planModelsAPIURL(t, "fangzhou", "agentplan"); !contains(got, "ListAgentPlanLatestModel") {
			t.Errorf("agentplan = %q, want ListAgentPlanLatestModel", got)
		}
	})

	t.Run("moonshot platform key uses the platform models endpoint", func(t *testing.T) {
		if got := findProvider(t, "moonshot").ModelsAPIURL; got != "https://api.moonshot.cn/v1/models" {
			t.Errorf("= %q", got)
		}
	})
}

func TestDefaultProvidersModelsAPIURLPlanLevel(t *testing.T) {
	t.Run("moonshot kimi-code plan overrides with its coding endpoint", func(t *testing.T) {
		if got := planModelsAPIURL(t, "moonshot", "kimi-code"); got != "https://api.kimi.com/coding/v1/models" {
			t.Errorf("= %q", got)
		}
	})

	t.Run("zhipu coding-plan uses the coding endpoint (plan level only)", func(t *testing.T) {
		if got := planModelsAPIURL(t, "zhipu", "coding-plan"); got != "https://open.bigmodel.cn/api/coding/paas/v4/models" {
			t.Errorf("= %q", got)
		}
		// Zhipu has no platform-key models endpoint: plan-level only.
		if got := findProvider(t, "zhipu").ModelsAPIURL; got != "" {
			t.Errorf("provider modelsApiUrl = %q, want empty", got)
		}
	})

	t.Run("alibaba plans use their own OpenAI-compatible endpoints (plan level only)", func(t *testing.T) {
		if got := planModelsAPIURL(t, "alibaba", "token-plan"); got != "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models" {
			t.Errorf("token-plan = %q", got)
		}
		if got := planModelsAPIURL(t, "alibaba", "coding-plan"); got != "https://coding.dashscope.aliyuncs.com/v1/models" {
			t.Errorf("coding-plan = %q", got)
		}
		if got := findProvider(t, "alibaba").ModelsAPIURL; got != "" {
			t.Errorf("provider modelsApiUrl = %q, want empty", got)
		}
	})

	t.Run("alibaba has apiKey credential field for models query (alongside ak/sk/workspaceId for usage)", func(t *testing.T) {
		fields := findProvider(t, "alibaba").CredentialFields
		if len(fields) != 4 {
			t.Fatalf("credentialFields = %d, want 4", len(fields))
		}
		keys := make([]string, len(fields))
		for i, field := range fields {
			keys[i] = field.Key
		}
		for _, want := range []string{"ak", "sk", "workspaceId", "apiKey"} {
			if !containsString(keys, want) {
				t.Errorf("credentialFields keys = %v, missing %q", keys, want)
			}
		}
		for _, field := range fields {
			if field.Key == "apiKey" && field.Type != "password" {
				t.Errorf("apiKey type = %q, want password", field.Type)
			}
		}
	})

	t.Run("opencode go plan uses the zen go models endpoint", func(t *testing.T) {
		if got := planModelsAPIURL(t, "opencode", "go"); got != "https://opencode.ai/zen/go/v1/models" {
			t.Errorf("= %q", got)
		}
	})
}

func TestModelsQueryCoverage(t *testing.T) {
	t.Run("exactly the 12 query-plumbed providers are models-capable", func(t *testing.T) {
		capable := []string{}
		for _, provider := range DefaultProviders() {
			if SupportsModelsQuery(provider) {
				capable = append(capable, provider.ID)
			}
		}
		sort.Strings(capable)

		want := []string{"github", "alibaba", "moonshot", "deepseek", "zhipu", "siliconflow", "openrouter", "fangzhou", "opencode", "dddai", "fastai", "morphapi"}
		sort.Strings(want)
		assertStrings(t, capable, want)
	})

	t.Run("catalog-only providers have no models endpoint at any level", func(t *testing.T) {
		catalogOnly := []string{"anthropic", "openai", "google", "minimax", "byteDance", "baidu", "xiaomi", "xunfei", "ollama", "lmstudio", "local", "other"}
		for _, id := range catalogOnly {
			provider := findProvider(t, id)
			if provider.ModelsAPIURL != "" {
				t.Errorf("%s provider modelsApiUrl = %q, want empty", id, provider.ModelsAPIURL)
			}
			for _, plan := range provider.Plans {
				if plan.ModelsAPIURL != "" {
					t.Errorf("%s plan %s modelsApiUrl = %q, want empty", id, plan.ID, plan.ModelsAPIURL)
				}
			}
		}
	})
}

func TestModelsHandlerContract(t *testing.T) {
	t.Run("is satisfiable by fetchModels alone (no testConnection)", func(t *testing.T) {
		// A bare function-backed type satisfies ModelsHandler: the interface has
		// exactly one method, so no testConnection requirement can creep in.
		var handler ModelsHandler = modelsHandlerFunc(func(_ context.Context, credentials map[string]string) ([]string, error) {
			if len(credentials) != 1 || credentials["apiKey"] != "test-key" {
				t.Errorf("credentials = %v, want {apiKey: test-key}", credentials)
			}
			return []string{"model-b", "model-a"}, nil
		})

		models, err := handler.FetchModels(context.Background(), map[string]string{"apiKey": "test-key"})
		if err != nil {
			t.Fatalf("FetchModels: %v", err)
		}
		assertStrings(t, models, []string{"model-b", "model-a"})
	})
}

type modelsHandlerFunc func(context.Context, map[string]string) ([]string, error)

func (f modelsHandlerFunc) FetchModels(ctx context.Context, credentials map[string]string) ([]string, error) {
	return f(ctx, credentials)
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
