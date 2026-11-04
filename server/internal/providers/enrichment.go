package providers

import (
	"sort"
	"strings"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// ProviderRef is the projection of a subscription or tool that provider
// enrichment needs: which provider it references, plus the free-form name used
// when provider is "other". The full domain types arrive with the
// subscription/tool tickets; both map onto this projection.
type ProviderRef struct {
	Provider       string
	ProviderCustom string
}

// EnrichedProvider is a registry entry plus the read-only metadata shown by the
// /api/providers endpoint (ADR-0006): capability flags derived from the handler
// registries and reference counts from subscriptions/tools.
//
// Field order matters: the JSON shape must stay byte-aligned with the old
// stack's `{...provider, supportsBalanceQuery, supportsUsageQuery,
// supportsModelsQuery, subscriptionCount, toolCount}`.
type EnrichedProvider struct {
	Provider
	SupportsBalanceQuery bool `json:"supportsBalanceQuery"`
	SupportsUsageQuery   bool `json:"supportsUsageQuery"`
	SupportsModelsQuery  bool `json:"supportsModelsQuery"`
	SubscriptionCount    int  `json:"subscriptionCount"`
	ToolCount            int  `json:"toolCount"`
}

// SupportsUsageQuery reports whether any usage handler key equals the provider
// id (bare key) or starts with "<id>:" (plan-level key).
func SupportsUsageQuery(providerID string) bool {
	for _, key := range usageHandlerKeys() {
		if key == providerID || hasPlanPrefix(key, providerID) {
			return true
		}
	}
	return false
}

// SupportsBalanceQuery applies the same rule over the balance handler registry.
func SupportsBalanceQuery(providerID string) bool {
	for key := range balanceHandlerKeys() {
		if key == providerID || hasPlanPrefix(key, providerID) {
			return true
		}
	}
	return false
}

func hasPlanPrefix(key, providerID string) bool {
	return len(key) > len(providerID) && key[:len(providerID)] == providerID && key[len(providerID)] == ':'
}

// SupportsModelsQuery is derived from URL existence, NOT from the models
// handler registry (the generic fallback handler is not registered there).
func SupportsModelsQuery(provider Provider) bool {
	if provider.ModelsAPIURL != "" {
		return true
	}
	for _, plan := range provider.Plans {
		if plan.ModelsAPIURL != "" {
			return true
		}
	}
	return false
}

// EnrichProviders augments providers with capability flags and reference
// counts. Pure: callers supply the registry and the current references.
func EnrichProviders(providers []Provider, subscriptions, tools []ProviderRef) []EnrichedProvider {
	subscriptionCounts := make(map[string]int, len(subscriptions))
	for _, sub := range subscriptions {
		subscriptionCounts[sub.Provider]++
	}

	toolCounts := make(map[string]int, len(tools))
	for _, tool := range tools {
		toolCounts[tool.Provider]++
	}

	enriched := make([]EnrichedProvider, 0, len(providers))
	for _, provider := range providers {
		enriched = append(enriched, EnrichedProvider{
			Provider:             provider,
			SupportsBalanceQuery: SupportsBalanceQuery(provider.ID),
			SupportsUsageQuery:   SupportsUsageQuery(provider.ID),
			SupportsModelsQuery:  SupportsModelsQuery(provider),
			SubscriptionCount:    subscriptionCounts[provider.ID],
			ToolCount:            toolCounts[provider.ID],
		})
	}
	return enriched
}

// UnregisteredProviderName is a distinct in-use providerCustom name
// (provider === "other") with its combined usage count.
type UnregisteredProviderName struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// UnregisteredProviderNames lists distinct providerCustom values in use by
// subscriptions/tools whose provider is "other", sorted by count descending
// then name ascending.
func UnregisteredProviderNames(subscriptions, tools []ProviderRef) []UnregisteredProviderName {
	counts := make(map[string]int)

	add := func(ref ProviderRef) {
		if ref.Provider != "other" {
			return
		}
		name := strings.TrimSpace(ref.ProviderCustom)
		if name == "" {
			return
		}
		counts[name]++
	}

	for _, sub := range subscriptions {
		add(sub)
	}
	for _, tool := range tools {
		add(tool)
	}

	names := make([]UnregisteredProviderName, 0, len(counts))
	for name, count := range counts {
		names = append(names, UnregisteredProviderName{Name: name, Count: count})
	}

	// The old stack sorts ties with name.localeCompare (ICU en-US). Mirror
	// that collation so mixed-case names order identically. Equal collation
	// keys (canonically equivalent spellings) fall back to byte order to keep
	// the result deterministic despite random map iteration. A Collator is not
	// safe for concurrent use, so build one per call.
	collator := collate.New(language.AmericanEnglish)
	sort.SliceStable(names, func(i, j int) bool {
		if names[i].Count != names[j].Count {
			return names[i].Count > names[j].Count
		}
		if cmp := collator.CompareString(names[i].Name, names[j].Name); cmp != 0 {
			return cmp < 0
		}
		return names[i].Name < names[j].Name
	})
	return names
}
