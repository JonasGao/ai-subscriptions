package providers

import "strings"

// MigrateProviderPlans applies the ADR-0005 startup migration to legacy
// subscription records in place and reports whether anything changed.
//
// Old stack: lib/migrations.ts migrated the on-disk subscriptions.json at
// startup. The new stack imports JSON into SQLite once (#23), so the importer
// applies this rewrite to the records it reads instead of rewriting the legacy
// file in place. Rules are identical:
//
//   - legacy pseudo-providers fangzhou-codingplan / fangzhou-agentplan →
//     provider "fangzhou" + the matching planId
//   - recurring moonshot subscriptions without a planId → kimi-code
//   - recurring alibaba subscriptions without a planId → infer coding-plan /
//     token-plan from the subscription name ("coding" / "token")
//
// Idempotent: a second run reports false and changes nothing.
func MigrateProviderPlans(records []map[string]any) bool {
	changed := false

	for _, record := range records {
		provider, _ := record["provider"].(string)

		switch provider {
		case "fangzhou-codingplan":
			record["provider"] = "fangzhou"
			record["planId"] = "codingplan"
			changed = true
			continue
		case "fangzhou-agentplan":
			record["provider"] = "fangzhou"
			record["planId"] = "agentplan"
			changed = true
			continue
		}

		if planID, _ := record["planId"].(string); planID != "" {
			continue
		}
		if record["subscriptionType"] != "recurring" {
			continue
		}

		switch provider {
		case "moonshot":
			record["planId"] = "kimi-code"
			changed = true
		case "alibaba":
			name, _ := record["name"].(string)
			lower := strings.ToLower(name)
			switch {
			case strings.Contains(lower, "coding"):
				record["planId"] = "coding-plan"
				changed = true
			case strings.Contains(lower, "token"):
				record["planId"] = "token-plan"
				changed = true
			}
		}
	}

	return changed
}
