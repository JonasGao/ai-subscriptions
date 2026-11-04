package providers

import (
	"strings"
	"testing"
)

// Port of __tests__/provider-plans.test.ts (29 cases).
//
// Deviation from the old stack: subscription CRUD and the startup JSON-file
// migration belong to the storage/subscription tickets (#23/#26 under
// ADR-0017). The behavior those cases assert — plan resolution on create and
// update, and the legacy provider/plan rewrite — is ported here as the pure
// domain rules those callers must use. Subtest names keep the old case names
// for the parity matrix.

func TestResolvePlanID(t *testing.T) {
	t.Run("clears planId for one-time subscriptions", func(t *testing.T) {
		if got, err := ResolvePlanID("fangzhou", "one-time", "codingplan"); err != nil || got != "" {
			t.Errorf("fangzhou one-time = (%q, %v), want (\"\", nil)", got, err)
		}
		if got, err := ResolvePlanID("moonshot", "one-time", ""); err != nil || got != "" {
			t.Errorf("moonshot one-time = (%q, %v), want (\"\", nil)", got, err)
		}
	})

	t.Run("returns undefined for providers with no plans", func(t *testing.T) {
		if got, err := ResolvePlanID("openai", "recurring", ""); err != nil || got != "" {
			t.Errorf("openai = (%q, %v), want (\"\", nil)", got, err)
		}
		if got, err := ResolvePlanID("other", "recurring", ""); err != nil || got != "" {
			t.Errorf("other = (%q, %v), want (\"\", nil)", got, err)
		}
	})

	t.Run("auto-fills single plan (moonshot → kimi-code)", func(t *testing.T) {
		if got, err := ResolvePlanID("moonshot", "recurring", ""); err != nil || got != "kimi-code" {
			t.Errorf("moonshot = (%q, %v), want (\"kimi-code\", nil)", got, err)
		}
	})

	t.Run("keeps explicit planId for single-plan provider", func(t *testing.T) {
		if got, err := ResolvePlanID("moonshot", "recurring", "kimi-code"); err != nil || got != "kimi-code" {
			t.Errorf("moonshot = (%q, %v), want (\"kimi-code\", nil)", got, err)
		}
	})

	t.Run("throws for multi-plan provider without planId", func(t *testing.T) {
		_, err := ResolvePlanID("fangzhou", "recurring", "")
		if err == nil || !strings.Contains(err.Error(), "planId is required") {
			t.Errorf("err = %v, want containing \"planId is required\"", err)
		}
	})

	t.Run("keeps explicit planId for multi-plan provider", func(t *testing.T) {
		for _, planID := range []string{"codingplan", "agentplan"} {
			if got, err := ResolvePlanID("fangzhou", "recurring", planID); err != nil || got != planID {
				t.Errorf("fangzhou %s = (%q, %v)", planID, got, err)
			}
		}
	})

	t.Run("throws for invalid planId", func(t *testing.T) {
		_, err := ResolvePlanID("fangzhou", "recurring", "nonexistent")
		if err == nil || !strings.Contains(err.Error(), "not found") {
			t.Errorf("err = %v, want containing \"not found\"", err)
		}
	})

	t.Run("throws for alibaba multi-plan provider without planId", func(t *testing.T) {
		_, err := ResolvePlanID("alibaba", "recurring", "")
		if err == nil || !strings.Contains(err.Error(), "planId is required") {
			t.Errorf("err = %v, want containing \"planId is required\"", err)
		}
	})

	t.Run("keeps explicit planId for alibaba multi-plan provider", func(t *testing.T) {
		for _, planID := range []string{"coding-plan", "token-plan"} {
			if got, err := ResolvePlanID("alibaba", "recurring", planID); err != nil || got != planID {
				t.Errorf("alibaba %s = (%q, %v)", planID, got, err)
			}
		}
	})
}

func TestCreateSubscriptionPlanResolution(t *testing.T) {
	t.Run("auto-fills planId for single-plan provider", func(t *testing.T) {
		got, err := ResolvePlanIDOnCreate(PlanSelection{Provider: "moonshot", SubscriptionType: "recurring", PlanID: ""})
		if err != nil || got != "kimi-code" {
			t.Errorf("= (%q, %v), want (\"kimi-code\", nil)", got, err)
		}
	})

	t.Run("clears planId for one-time subscriptions", func(t *testing.T) {
		got, err := ResolvePlanIDOnCreate(PlanSelection{Provider: "moonshot", SubscriptionType: "one-time", PlanID: "kimi-code"})
		if err != nil || got != "" {
			t.Errorf("= (%q, %v), want (\"\", nil)", got, err)
		}
	})

	t.Run("throws for multi-plan provider without planId", func(t *testing.T) {
		_, err := ResolvePlanIDOnCreate(PlanSelection{Provider: "fangzhou", SubscriptionType: "recurring"})
		if err == nil || !strings.Contains(err.Error(), "planId is required") {
			t.Errorf("err = %v, want containing \"planId is required\"", err)
		}
	})

	t.Run("keeps explicit planId for multi-plan provider", func(t *testing.T) {
		got, err := ResolvePlanIDOnCreate(PlanSelection{Provider: "fangzhou", SubscriptionType: "recurring", PlanID: "codingplan"})
		if err != nil || got != "codingplan" {
			t.Errorf("= (%q, %v), want (\"codingplan\", nil)", got, err)
		}
	})
}

func TestUpdateSubscriptionPlanResolution(t *testing.T) {
	t.Run("clears planId when switching to one-time", func(t *testing.T) {
		current := PlanSelection{Provider: "moonshot", SubscriptionType: "recurring", PlanID: "kimi-code"}
		oneTime := "one-time"
		got, err := ResolvePlanIDOnUpdate(current, PlanChanges{SubscriptionType: &oneTime})
		if err != nil || got != "" {
			t.Errorf("= (%q, %v), want (\"\", nil)", got, err)
		}
	})

	t.Run("auto-fills planId when switching provider to single-plan", func(t *testing.T) {
		current := PlanSelection{Provider: "openai", SubscriptionType: "recurring", PlanID: ""}
		moonshot := "moonshot"
		got, err := ResolvePlanIDOnUpdate(current, PlanChanges{Provider: &moonshot})
		if err != nil || got != "kimi-code" {
			t.Errorf("= (%q, %v), want (\"kimi-code\", nil)", got, err)
		}
	})
}

// TestMigrateProviderPlans ports updateSubscription plan resolution and the
// startup legacy rewrite. See the file comment for the seam deviation.
func TestMigrateProviderPlans(t *testing.T) {
	t.Run("rewrites fangzhou-codingplan → fangzhou + planId", func(t *testing.T) {
		records := []map[string]any{legacySub("sub-1", "fangzhou-codingplan", "", "")}
		if !MigrateProviderPlans(records) {
			t.Fatal("MigrateProviderPlans reported no change")
		}
		if got := records[0]["provider"]; got != "fangzhou" {
			t.Errorf("provider = %v, want fangzhou", got)
		}
		if got := records[0]["planId"]; got != "codingplan" {
			t.Errorf("planId = %v, want codingplan", got)
		}
	})

	t.Run("rewrites fangzhou-agentplan → fangzhou + planId", func(t *testing.T) {
		records := []map[string]any{legacySub("sub-2", "fangzhou-agentplan", "", "")}
		if !MigrateProviderPlans(records) {
			t.Fatal("MigrateProviderPlans reported no change")
		}
		if got := records[0]["provider"]; got != "fangzhou" {
			t.Errorf("provider = %v, want fangzhou", got)
		}
		if got := records[0]["planId"]; got != "agentplan" {
			t.Errorf("planId = %v, want agentplan", got)
		}
	})

	t.Run("backfills planId for recurring moonshot subscriptions", func(t *testing.T) {
		records := []map[string]any{legacySub("sub-3", "moonshot", "recurring", "")}
		if !MigrateProviderPlans(records) {
			t.Fatal("MigrateProviderPlans reported no change")
		}
		if got := records[0]["planId"]; got != "kimi-code" {
			t.Errorf("planId = %v, want kimi-code", got)
		}
	})

	t.Run("does NOT backfill planId for one-time moonshot subscriptions", func(t *testing.T) {
		records := []map[string]any{legacySub("sub-4", "moonshot", "one-time", "")}
		if MigrateProviderPlans(records) {
			t.Error("MigrateProviderPlans reported a change, want none")
		}
		if _, ok := records[0]["planId"]; ok {
			t.Errorf("planId = %v, want absent", records[0]["planId"])
		}
	})

	t.Run("is idempotent — running twice produces no further changes", func(t *testing.T) {
		records := []map[string]any{
			legacySub("sub-5", "fangzhou-codingplan", "recurring", ""),
			legacySub("sub-6", "moonshot", "recurring", ""),
		}
		if !MigrateProviderPlans(records) {
			t.Fatal("first run reported no change")
		}
		if MigrateProviderPlans(records) {
			t.Error("second run reported a change, want none")
		}
		if records[0]["provider"] != "fangzhou" || records[0]["planId"] != "codingplan" {
			t.Errorf("record 0 = %v, want fangzhou/codingplan", records[0])
		}
		if records[1]["planId"] != "kimi-code" {
			t.Errorf("record 1 planId = %v, want kimi-code", records[1]["planId"])
		}
	})

	t.Run("does nothing when file does not exist", func(t *testing.T) {
		// The file-level seam is owned by the JSON→SQLite migrator (#23); with
		// no records the rewrite is a no-op and never fails.
		if MigrateProviderPlans(nil) {
			t.Error("MigrateProviderPlans(nil) = true, want false")
		}
	})

	t.Run("backfills planId for alibaba recurring subscriptions by name", func(t *testing.T) {
		records := []map[string]any{
			legacySub("sub-alibaba-1", "alibaba", "recurring", "阿里云 Coding Plan"),
			legacySub("sub-alibaba-2", "alibaba", "recurring", "阿里云 Token Plan"),
			legacySub("sub-alibaba-3", "alibaba", "recurring", "其他方案"),
		}
		MigrateProviderPlans(records)
		if got := records[0]["planId"]; got != "coding-plan" {
			t.Errorf("coding plan = %v, want coding-plan", got)
		}
		if got := records[1]["planId"]; got != "token-plan" {
			t.Errorf("token plan = %v, want token-plan", got)
		}
		if _, ok := records[2]["planId"]; ok {
			t.Errorf("no-match planId = %v, want absent", records[2]["planId"])
		}
	})
}

// legacySub builds a minimal legacy subscription record. name is only set when
// non-empty so the alibaba name heuristic applies.
func legacySub(id, provider, subscriptionType, name string) map[string]any {
	record := map[string]any{
		"id":       id,
		"name":     name,
		"provider": provider,
	}
	if subscriptionType != "" {
		record["subscriptionType"] = subscriptionType
	}
	return record
}

func TestResolveUsageHandlerKey(t *testing.T) {
	t.Run("returns providerId:planId for plan-based subscriptions", func(t *testing.T) {
		cases := []struct{ provider, planID, want string }{
			{"fangzhou", "codingplan", "fangzhou:codingplan"},
			{"fangzhou", "agentplan", "fangzhou:agentplan"},
			{"moonshot", "kimi-code", "moonshot:kimi-code"},
		}
		for _, c := range cases {
			if got := ResolveUsageHandlerKey(c.provider, c.planID); got != c.want {
				t.Errorf("ResolveUsageHandlerKey(%q, %q) = %q, want %q", c.provider, c.planID, got, c.want)
			}
		}
	})

	t.Run("returns bare provider id when no planId", func(t *testing.T) {
		if got := ResolveUsageHandlerKey("openai", ""); got != "openai" {
			t.Errorf("= %q, want openai", got)
		}
		if got := ResolveUsageHandlerKey("fangzhou", ""); got != "fangzhou" {
			t.Errorf("= %q, want fangzhou", got)
		}
	})
}

func TestResolveUsageAPIURL(t *testing.T) {
	t.Run("returns plan-level URL when planId is set", func(t *testing.T) {
		provider := Provider{
			ID:   "fangzhou",
			Name: "火山方舟",
			Plans: []PlanDefinition{
				{ID: "codingplan", Name: "Coding Plan", UsageAPIURL: "https://example.com/coding"},
				{ID: "agentplan", Name: "Agent Plan", UsageAPIURL: "https://example.com/agent"},
			},
		}
		if got := ResolveUsageAPIURL(provider, "codingplan"); got != "https://example.com/coding" {
			t.Errorf("codingplan = %q", got)
		}
		if got := ResolveUsageAPIURL(provider, "agentplan"); got != "https://example.com/agent" {
			t.Errorf("agentplan = %q", got)
		}
	})

	t.Run("falls back to provider-level URL when no planId", func(t *testing.T) {
		provider := Provider{ID: "test", Name: "Test", UsageAPIURL: "https://example.com/usage"}
		if got := ResolveUsageAPIURL(provider, ""); got != "https://example.com/usage" {
			t.Errorf("= %q", got)
		}
	})

	t.Run("returns undefined when no URL is available", func(t *testing.T) {
		provider := Provider{ID: "test", Name: "Test"}
		if got := ResolveUsageAPIURL(provider, ""); got != "" {
			t.Errorf("= %q, want empty", got)
		}
		if got := ResolveUsageAPIURL(provider, "nonexistent"); got != "" {
			t.Errorf("nonexistent = %q, want empty", got)
		}
	})
}

func TestUsageHandlersRegistration(t *testing.T) {
	t.Run("has handlers registered under providerId:planId keys", func(t *testing.T) {
		handlers := UsageHandlers()
		for _, key := range []string{"fangzhou:codingplan", "fangzhou:agentplan", "moonshot:kimi-code"} {
			if handlers[key] == nil {
				t.Errorf("usageHandlers[%q] is nil", key)
			}
		}
	})

	t.Run("no longer has old bare-key registrations", func(t *testing.T) {
		handlers := UsageHandlers()
		for _, key := range []string{"fangzhou-codingplan", "fangzhou-agentplan", "moonshot"} {
			if handlers[key] != nil {
				t.Errorf("usageHandlers[%q] = %v, want nil", key, handlers[key])
			}
		}
	})
}

// Supplementary guard (not a parity case): every implemented handler must be
// registered in the old stack's key set, so capability flags can never claim
// support for a provider/plan the registry does not know.
func TestUsageHandlerKeysCoverImplementedHandlers(t *testing.T) {
	registered := make(map[string]bool)
	for _, key := range usageHandlerKeys() {
		registered[key] = true
	}
	for key := range UsageHandlers() {
		if !registered[key] {
			t.Errorf("implemented handler %q is missing from usageHandlerKeys", key)
		}
	}
}
