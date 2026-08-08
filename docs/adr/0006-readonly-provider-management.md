# Read-Only Provider Management — No CRUD Until Query Handlers Are Decoupled

The provider management UI (`/providers`) is **read-only**: users can browse the predefined providers and inspect their full configuration, but cannot create, edit, or delete providers. CRUD is deliberately deferred because usage/balance query handlers are hard-bound to provider definitions in code.

## Status

Accepted

## Context

The 21 predefined providers live in the `defaultProviders` constant (`lib/types.ts`) with no persistence and no management UI. A management UI was requested, and a full-CRUD design was worked out (seed `defaultProviders` into `data/providers.json` at initialization, then treat all providers as equally editable, with cascade deletes).

That design has a hard blocker: the usage/balance query handlers in `lib/providers/index.ts` are registered by hardcoded provider/plan ids and expect specific credential field keys (e.g. Moonshot's handler reads `apiKey`; Ark's reads `ak`/`sk`). A user-edited or user-created provider therefore cannot gain query capability without code changes, and editing a handler-backed provider's credentials or plans can silently break its queries. Allowing CRUD over data while the behavior stays hardcoded would present a false affordance.

## Considered Options

1. **Read-only management UI** (chosen) — Ship browsing/inspection now: full field display, query-capability badges derived from the handler registry, reference counts (subscriptions/tools using each provider), and a read-only list of in-use `providerCustom` names. No persistence is introduced; the page reads the existing `GET /api/providers`, which serves the `defaultProviders` constant.
2. **Full CRUD with seeding** — Seed providers into `data/providers.json` and allow editing everything. Rejected for now: it requires first decoupling the handler registry from hardcoded ids (e.g. a generic HTTP query capability with response mapping), which is a much larger piece of work; shipping CRUD without it lets users break queries silently.
3. **CRUD for metadata only, handler-bound fields locked** — Allow editing names/websites while locking `credentialFields` and plan URLs on handler-backed providers. Rejected: the locking rules are subtle enough that the UI would need to explain them constantly; a clean read-only page is more honest and is a strict subset of the future CRUD UI.

## Decision

- `/providers` is a standalone read-only page (the notifications-page precedent), linked from the home header. No edit affordances are shown — no disabled buttons that promise unscheduled work.
- Display per provider: all `Provider` fields (name, description, website, `balanceApiUrl`, `usageApiUrl`, credential field _definitions_ — never values, which live on subscriptions), and the plans list.
- Display derived information: capability badges ("supports balance query" / "supports usage query") derived from the `balanceHandlers`/`usageHandlers` registries, and reference counts (N subscriptions, M tools).
- A separate read-only section lists the distinct `providerCustom` values in use (from `provider: "other"` subscriptions and tools) with counts — this inventories the "unregistered" providers users would want to create if CRUD ever ships.
- The `provider: "other"` + `providerCustom` escape hatch stays exactly as-is; no migration.

## Consequences

- When CRUD is revisited, the prerequisite is decoupling query handlers from provider definitions; the seeding/merge design (seed at init, insert-missing-only on upgrades, never overwrite user edits) from the deferred design remains available and should be recorded in that future ADR.
- `SubscriptionCard`/`ToolList` continue to read the bundled `defaultProviders` constant; since the list is immutable, the existing inconsistency (forms fetch the API, cards use the constant) is harmless for now.

## Related Decisions

- [ADR-0005: Provider Plans](0005-provider-plans.md) — introduced the handler registry keyed by `providerId:planId` that this decision treats as the hard-binding blocker
- Domain model defined in `CONTEXT.md` and `docs/UBIQUITOUS_LANGUAGE.md`
