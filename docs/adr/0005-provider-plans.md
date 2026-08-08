# Provider Plans — Subdividing a Provider's Recurring Subscriptions

A provider's recurring subscriptions subdivide into distinct **Plans** (e.g., Volcengine Ark's Coding Plan and Agent Plan) that differ in how usage is queried. Providers now declare the Plans they offer (`plans[]`), and a recurring subscription records its chosen Plan (`planId`).

## Status

Accepted

## Context

Volcengine Ark offers two recurring subscription types — Coding Plan and Agent Plan — whose usage is queried through different signed API actions (`GetCodingPlanUsage` vs `GetAFPUsage`). The system previously modeled these as two separate pseudo-providers (`fangzhou-codingplan`, `fangzhou-agentplan`), which broke down as soon as "which provider is this?" and "which plan of that provider?" became different questions.

Moonshot is the second case: its usage query (`api.kimi.com/coding/v1/usages`) is specifically the Kimi Code plan's API, so Moonshot declares a single `kimi-code` Plan.

## Considered Options

1. **Plan-level capability declaration, dual-track lookup** (chosen) — Providers with `plans[]` declare `usageApiUrl` per Plan; providers without Plans keep their provider-level `usageApiUrl`. Handler registry keys are `providerId:planId` for plans, bare `providerId` otherwise.
2. **Unified Plans everywhere** — Force every provider (even Moonshot's balance-only peers) to declare an implicit single Plan, eliminating the dual track. Rejected: it would force a rework of all existing providers and stored subscriptions for a need that doesn't exist yet.
3. **Lazy migration on read** — Rewrite legacy provider ids when subscriptions.json is read. Rejected in favor of an explicit one-shot migration function run at server startup (`instrumentation.ts`), which is easier to reason about and remove later.

## Decision

- `Provider` gains `plans?: PlanDefinition[]`; each Plan has an id (unique within the provider), a display name, and its own usage capability declaration. **Credentials stay provider-level** (Ark's two Plans share the same `ak`/`sk`); per-Plan credentials are deferred until a real provider needs them.
- `Subscription` gains `planId?`. Plan selection is only meaningful for **recurring** subscriptions; switching to one-time **clears** `planId` (unlike `resetSchedules`, there is no value in preserving it — see ADR-0002 for the contrasting rule).
- **Multiple Plans → the user must choose** (required select in the form, shown directly under the provider selector). **Single Plan → implicitly assigned by the backend** on create/update, so stored data is always explicit and the query path has no "infer the only plan" branch. **No Plans → no subdivision, nothing changes.**
- **Startup migration** (run once from `instrumentation.ts`): rewrite `provider: "fangzhou-codingplan"` → `provider: "fangzhou", planId: "codingplan"` (and `agentplan` likewise); backfill `planId: "kimi-code"` on existing recurring Moonshot subscriptions.
- Plan definitions remain hardcoded in `defaultProviders` in `lib/types.ts`; user-configurable providers are out of scope.

## Consequences

- Two pseudo-providers collapse into one `fangzhou` provider; every place that recognized the old ids (forms, cards, query routes) keys off `provider + planId` instead.
- Usage capability checks (`hasUsageQuery`) must look at `plan.usageApiUrl` when a subscription has a `planId`, falling back to the provider-level URL — this dual track is deliberate (see rejected option 2).
- The usage handler registry (`lib/providers/index.ts`) indexes plan handlers by `providerId:planId`; the existing Ark handler files are reused unchanged, only their registration keys change.
- Subscription cards display the Plan name (e.g. "Coding Plan"), otherwise Ark subscriptions would be indistinguishable in the list.

## Related Decisions

- [ADR-0002: Quota Reset Schedule Visibility by Subscription Type](0002-quota-reset-visibility-by-subscription-type.md) — the contrasting "hide UI, preserve data" rule; Plans deliberately do the opposite (clear on type switch)
- Domain model defined in `CONTEXT.md` and `docs/UBIQUITOUS_LANGUAGE.md`
