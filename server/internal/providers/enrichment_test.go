package providers

import "testing"

// Port of __tests__/enrichment.test.ts (23 cases). Subtest names mirror the
// old describes/its so the parity matrix can map case by case.

func TestSupportsUsageQuery(t *testing.T) {
	t.Run("deepseek: no usage handler → false", func(t *testing.T) {
		if SupportsUsageQuery("deepseek") {
			t.Error("SupportsUsageQuery(deepseek) = true, want false")
		}
	})
	t.Run("moonshot: plan-level handler (moonshot:kimi-code) → true", func(t *testing.T) {
		if !SupportsUsageQuery("moonshot") {
			t.Error("SupportsUsageQuery(moonshot) = false, want true")
		}
	})
	t.Run("fangzhou: plan-level handlers (fangzhou:agentplan, fangzhou:codingplan) → true", func(t *testing.T) {
		if !SupportsUsageQuery("fangzhou") {
			t.Error("SupportsUsageQuery(fangzhou) = false, want true")
		}
	})
	t.Run("openai: no handlers at all → false", func(t *testing.T) {
		if SupportsUsageQuery("openai") {
			t.Error("SupportsUsageQuery(openai) = true, want false")
		}
	})
	t.Run("unknown provider → false", func(t *testing.T) {
		if SupportsUsageQuery("nonexistent") {
			t.Error("SupportsUsageQuery(nonexistent) = true, want false")
		}
	})
}

func TestSupportsBalanceQuery(t *testing.T) {
	t.Run("deepseek: has balance handler → true", func(t *testing.T) {
		if !SupportsBalanceQuery("deepseek") {
			t.Error("SupportsBalanceQuery(deepseek) = false, want true")
		}
	})
	t.Run("moonshot: has balance handler → true", func(t *testing.T) {
		if !SupportsBalanceQuery("moonshot") {
			t.Error("SupportsBalanceQuery(moonshot) = false, want true")
		}
	})
	t.Run("fangzhou: no balance handler → false", func(t *testing.T) {
		if SupportsBalanceQuery("fangzhou") {
			t.Error("SupportsBalanceQuery(fangzhou) = true, want false")
		}
	})
	t.Run("openai: no handlers → false", func(t *testing.T) {
		if SupportsBalanceQuery("openai") {
			t.Error("SupportsBalanceQuery(openai) = true, want false")
		}
	})
}

func TestSupportsModelsQuery(t *testing.T) {
	t.Run("deepseek: provider-level modelsApiUrl → true", func(t *testing.T) {
		p := Provider{ID: "deepseek", Name: "DeepSeek", ModelsAPIURL: "https://api.deepseek.com/models"}
		if !SupportsModelsQuery(p) {
			t.Error("SupportsModelsQuery = false, want true")
		}
	})
	t.Run("moonshot: provider-level + plan-level modelsApiUrl → true", func(t *testing.T) {
		p := Provider{
			ID:           "moonshot",
			Name:         "Moonshot",
			ModelsAPIURL: "https://api.moonshot.cn/v1/models",
			Plans: []PlanDefinition{
				{ID: "kimi-code", Name: "Kimi Code", ModelsAPIURL: "https://api.kimi.com/coding/v1/models"},
			},
		}
		if !SupportsModelsQuery(p) {
			t.Error("SupportsModelsQuery = false, want true")
		}
	})
	t.Run("zhipu: plan-level modelsApiUrl only (no provider-level) → true", func(t *testing.T) {
		p := Provider{
			ID:   "zhipu",
			Name: "Zhipu",
			Plans: []PlanDefinition{
				{ID: "coding-plan", Name: "Coding Plan", ModelsAPIURL: "https://open.bigmodel.cn/api/coding/paas/v4/models"},
			},
		}
		if !SupportsModelsQuery(p) {
			t.Error("SupportsModelsQuery = false, want true")
		}
	})
	t.Run("openai: no modelsApiUrl anywhere → false", func(t *testing.T) {
		p := Provider{ID: "openai", Name: "OpenAI"}
		if SupportsModelsQuery(p) {
			t.Error("SupportsModelsQuery = true, want false")
		}
	})
	t.Run("provider with modelsApiUrl but NOT in handler registry → still true (key difference from usage/balance)", func(t *testing.T) {
		p := Provider{ID: "siliconflow", Name: "SiliconFlow", ModelsAPIURL: "https://api.siliconflow.cn/v1/models"}
		if !SupportsModelsQuery(p) {
			t.Error("SupportsModelsQuery = false, want true")
		}
	})
	t.Run("provider with plans but none have modelsApiUrl → false", func(t *testing.T) {
		p := Provider{
			ID:   "alibaba",
			Name: "Alibaba",
			Plans: []PlanDefinition{
				{ID: "coding-plan", Name: "Coding Plan"},
				{ID: "token-plan", Name: "Token Plan"},
			},
		}
		if SupportsModelsQuery(p) {
			t.Error("SupportsModelsQuery = true, want false")
		}
	})
}

func makeProvider(id string) Provider { return Provider{ID: id, Name: id} }

func sub(provider, providerCustom string) ProviderRef {
	return ProviderRef{Provider: provider, ProviderCustom: providerCustom}
}

func TestEnrichProviders(t *testing.T) {
	t.Run("derives capability flags from handler registries and modelsApiUrl", func(t *testing.T) {
		providers := []Provider{
			{ID: "deepseek", Name: "DeepSeek", ModelsAPIURL: "https://api.deepseek.com/models"},
			{
				ID:           "moonshot",
				Name:         "Moonshot",
				ModelsAPIURL: "https://api.moonshot.cn/v1/models",
				Plans: []PlanDefinition{
					{ID: "kimi-code", Name: "Kimi Code", ModelsAPIURL: "https://api.kimi.com/coding/v1/models"},
				},
			},
			{
				ID:           "fangzhou",
				Name:         "Fangzhou",
				ModelsAPIURL: "https://ark.cn-beijing.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01",
				Plans: []PlanDefinition{
					{ID: "codingplan", Name: "Coding Plan"},
					{ID: "agentplan", Name: "Agent Plan"},
				},
			},
			{ID: "openai", Name: "OpenAI"},
		}

		result := EnrichProviders(providers, nil, nil)

		want := []struct {
			id                     string
			balance, usage, models bool
		}{
			{"deepseek", true, false, true},
			{"moonshot", true, true, true},
			{"fangzhou", false, true, true},
			{"openai", false, false, false},
		}
		for i, w := range want {
			got := result[i]
			if got.ID != w.id ||
				got.SupportsBalanceQuery != w.balance ||
				got.SupportsUsageQuery != w.usage ||
				got.SupportsModelsQuery != w.models {
				t.Errorf("result[%d] = {id:%q balance:%v usage:%v models:%v}, want {id:%q balance:%v usage:%v models:%v}",
					i, got.ID, got.SupportsBalanceQuery, got.SupportsUsageQuery, got.SupportsModelsQuery,
					w.id, w.balance, w.usage, w.models)
			}
		}
	})

	t.Run("counts subscriptions per provider", func(t *testing.T) {
		subs := []ProviderRef{
			sub("deepseek", ""),
			sub("deepseek", ""),
			sub("moonshot", ""),
			sub("other", "Foo"),
		}
		result := EnrichProviders([]Provider{makeProvider("deepseek"), makeProvider("moonshot")}, subs, nil)
		if result[0].SubscriptionCount != 2 {
			t.Errorf("deepseek subscriptionCount = %d, want 2", result[0].SubscriptionCount)
		}
		if result[1].SubscriptionCount != 1 {
			t.Errorf("moonshot subscriptionCount = %d, want 1", result[1].SubscriptionCount)
		}
	})

	t.Run("counts tools per provider", func(t *testing.T) {
		tools := []ProviderRef{
			sub("openai", ""),
			sub("openai", ""),
			sub("openai", ""),
			sub("other", "Bar"),
		}
		result := EnrichProviders([]Provider{makeProvider("openai")}, nil, tools)
		if result[0].ToolCount != 3 {
			t.Errorf("openai toolCount = %d, want 3", result[0].ToolCount)
		}
	})

	t.Run("returns zero counts for providers with no refs", func(t *testing.T) {
		result := EnrichProviders([]Provider{makeProvider("openai")}, nil, nil)
		if result[0].SubscriptionCount != 0 || result[0].ToolCount != 0 {
			t.Errorf("counts = (%d, %d), want (0, 0)", result[0].SubscriptionCount, result[0].ToolCount)
		}
	})
}

func TestUnregisteredProviderNames(t *testing.T) {
	t.Run("groups providerCustom values where provider === 'other'", func(t *testing.T) {
		subs := []ProviderRef{
			sub("other", "FooAPI"),
			sub("other", "FooAPI"),
			sub("other", "BarSvc"),
			sub("deepseek", ""),
		}
		tools := []ProviderRef{
			sub("other", "FooAPI"),
			sub("other", "BarSvc"),
			sub("other", "BarSvc"),
		}

		got := UnregisteredProviderNames(subs, tools)
		want := []UnregisteredProviderName{
			{Name: "BarSvc", Count: 3},
			{Name: "FooAPI", Count: 3},
		}
		assertUnregistered(t, got, want)
	})

	t.Run("sorts by count desc then name asc", func(t *testing.T) {
		subs := []ProviderRef{
			sub("other", "Z"),
			sub("other", "Z"),
			sub("other", "A"),
			sub("other", "A"),
			sub("other", "M"),
			sub("other", "M"),
			sub("other", "Top"),
			sub("other", "Top"),
			sub("other", "Top"),
		}
		got := UnregisteredProviderNames(subs, nil)
		want := []UnregisteredProviderName{
			{Name: "Top", Count: 3},
			{Name: "A", Count: 2},
			{Name: "M", Count: 2},
			{Name: "Z", Count: 2},
		}
		assertUnregistered(t, got, want)
	})

	t.Run("ignores empty / whitespace-only providerCustom", func(t *testing.T) {
		subs := []ProviderRef{
			sub("other", ""),
			sub("other", "   "),
			sub("other", ""),
		}
		if got := UnregisteredProviderNames(subs, nil); len(got) != 0 {
			t.Errorf("got %v, want empty", got)
		}
	})

	t.Run("returns empty when nothing is 'other'", func(t *testing.T) {
		subs := []ProviderRef{sub("deepseek", "")}
		tools := []ProviderRef{sub("openai", "")}
		if got := UnregisteredProviderNames(subs, tools); len(got) != 0 {
			t.Errorf("got %v, want empty", got)
		}
	})
}

func assertUnregistered(t *testing.T, got, want []UnregisteredProviderName) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] got %v, want %v", i, got[i], want[i])
		}
	}
}

// Supplementary (not one of the 23 parity cases): pins the tie-break order to
// the old stack's name.localeCompare (ICU en-US), which differs from Go byte
// order for mixed case. Expected list was captured from the old stack.
func TestUnregisteredProviderNamesCollation(t *testing.T) {
	subs := []ProviderRef{
		sub("other", "OpenAI"), sub("other", "openai"),
		sub("other", "Anthropic"), sub("other", "anthropic"),
		sub("other", "FooAPI"), sub("other", "bar"),
		sub("other", "Zed"), sub("other", "Alpha"),
		sub("other", "alpha"), sub("other", "ALPHA"),
	}
	got := UnregisteredProviderNames(subs, nil)

	want := []string{"alpha", "Alpha", "ALPHA", "anthropic", "Anthropic", "bar", "FooAPI", "openai", "OpenAI", "Zed"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i].Name != want[i] {
			t.Errorf("[%d] name = %q, want %q (full: %v)", i, got[i].Name, want[i], got)
		}
	}
}
