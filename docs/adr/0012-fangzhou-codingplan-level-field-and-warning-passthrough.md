# Fangzhou CodingPlan Usage — Level Field Correction, Cap-Based Limit, and Parse-Warning Passthrough

The fangzhou `codingplan` usage handler matched quota rows on a `Label` field that has never existed in the real `GetCodingPlanUsage` response — the actual field is `Level`. Every query therefore silently returned all-null windows. The fix corrects the field name, maps `Percent` (0–100) and `Cap` (limit) directly per the documented sample shape, and introduces a `warnings` channel on `UsageResult` so server-side parse anomalies (skipped unknown-`Level` rows) reach the frontend as toasts instead of vanishing into server logs.

## Status

Accepted

## Context

`POST https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01` (Volcengine V4-style HMAC signature, account-level AK/SK) returns, per production capture (2026-09-20) and three independent community samples (CodexBar issue #1724, dsh-quota-panel, blog.want.biz):

```json
{
  "ResponseMetadata": {
    "RequestId": "...",
    "Action": "GetCodingPlanUsage",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Status": "Running",
    "UpdateTimestamp": 1789872783,
    "QuotaUsage": [
      {
        "Level": "session",
        "Percent": 0.000029,
        "ResetTimestamp": 1789889755,
        "Cap": 100,
        "RewardTotalPercent": 0
      },
      {
        "Level": "weekly",
        "Percent": 0.0000039,
        "ResetTimestamp": 1789920000,
        "Cap": 100,
        "RewardTotalPercent": 0
      },
      {
        "Level": "monthly",
        "Percent": 0.0000019,
        "ResetTimestamp": 1792511999,
        "Cap": 100,
        "RewardTotalPercent": 0
      }
    ],
    "HasReward": false
  }
}
```

Facts established during diagnosis:

- The field is **`Level`** (`session`/`weekly`/`monthly`), never `Label`. The handler had used `Label` since its introduction (c9dc9c3); **the handler was broken from day one** — no API change, no regression. Three `find` calls all returned `undefined` → all three buckets `null` → the card rendered empty. No error fired because the throw branch only guards an _empty_ `QuotaUsage` array, and the array had three rows.
- The existing test mock (`__tests__/providers.test.ts`) had copied the same wrong `Label` field, so CI stayed green — the test validated itself, never the real API.
- `Percent` is a **0–100 percentage** (community raw samples: 2.1 / 38.2 / 46.7). The near-zero production values (`0.000029`) are genuine near-zero usage — the user's account barely uses CodingPlan while AgentPlan shows heavy use (`GetAFPUsage` on the same AK/SK returns 10493/35000 weekly). The console UI confirms: all windows display 0. Displayed near-zero after the fix is _correct_, matching the console.
- `Cap` is the percent-scale limit (100); `ResetTimestamp` is epoch **seconds**; `RewardTotalPercent`/`HasReward`/`Status`/`UpdateTimestamp` are currently unused.
- AgentPlan (`GetAFPUsage`) on the same credentials returns full data — signature, endpoint, and AK/SK were never in question.

## Considered Options

1. **`Level ?? Label` defensive matching** — rejected. `Label` was never observed in any real response; it was a guess in the original implementation. A fallback for a hallucinated field is untestable speculation (same reasoning as ADR-0011 rejecting `TOKENS_LIMIT` compat). If the API renames the field again, the zero-mapped-window outcome fails visibly via the `warnings`/empty-card path.
2. **Hardcoded `limit: "100"`** (ADR-0010 percent synthesis) — rejected. The response carries an explicit `Cap`; using it costs nothing and stays truthful if the cap ever changes. `Cap` missing → fall back to `"100"`.
3. **`console.warn`-only for skipped rows** (zhipu's current behavior) — rejected for this handler. This bug survived _because_ a silent channel hid a real mismatch; parse anomalies now go to the user via the `warnings` passthrough.
4. **Required `warnings: string[]` on `UsageResult`** — rejected. An optional field avoids churning all seven existing handlers; absent means "no warnings".

## Decision

- **Field correction**: match rows by `Level` only. Fixtures replay the real captured response, including the newer fields (`Cap`, `RewardTotalPercent`, `HasReward`, `Status`, `UpdateTimestamp`).
- **Mapping**: `session → fiveHour`, `weekly → weekly`, `monthly → monthly`; `used = String(Percent)`, `limit = String(Cap ?? 100)`, `remaining = String(Cap − Percent)` (Cap fallback applied consistently), `resetTime = ResetTimestamp × 1000 → ISO`, with `ResetTimestamp: 0` → `null` (same convention as opencode's absent `resetsAt`). `Status` is not checked; an empty `QuotaUsage` array still throws "Account not subscribed to CodingPlan".
- **Parse warnings contract**: `UsageResult` gains `warnings?: string[]`. The usage API route passes the handler result through as JSON, so no route change is needed. Fangzhou populates it when rows are skipped due to unrecognized `Level` values; `console.warn` is kept alongside (logs stay greppable). `testConnection`'s `{ok, message}` contract is unchanged.
- **Frontend surfacing**: `SubscriptionCard` reads `warnings` from the usage response and raises a single sonner warning toast (one line per warning). sonner is introduced as the toast primitive — the repo's shadcn/radix stack has no toast library today.
- **Zhipu retrofit**: zhipu's skipped-row `console.warn` (ADR-0011) is additionally pushed into `warnings`, so the contract is exercised by two providers from day one.
- **Tests**: the `Label`-based mock in `__tests__/providers.test.ts` is corrected to `Level`; a dedicated `__tests__/fangzhou-codingplan.test.ts` suite (~21 cases, following the zhipu/opencode structure) covers real-fixture mapping, unknown-`Level` skip + warning, `ResetTimestamp: 0`, empty `QuotaUsage`, non-2xx, malformed envelope, and `testCodingPlanConnection`.
- **No subscription migration**: the fix touches only the provider layer; existing CodingPlan subscriptions gain working queries automatically.

## Consequences

### Positive

- The usage card starts showing real data for a handler that has never worked; near-zero values now match the console.
- The `warnings` contract turns "server parsed something it didn't understand" from invisible log noise into user-visible signal — the failure mode that hid this bug for months is now loud by construction.
- The contract is generic: any provider that tolerates unknown rows can surface them without frontend changes.

### Negative

- `warnings` is a soft channel: nothing enforces that providers populate it, and providers that silently drop data without warning (e.g., AgentPlan ignoring `AFPDaily`) still can. It covers only anomalies a handler chooses to report.
- If the API ever renames `Level`, queries return empty buckets with no explicit error again (the throw only fires on an empty array) — mitigated by the warnings contract only if the handler is updated to emit one; documented here as the accepted residual risk.

### Neutral

- `HasReward` / `RewardTotalPercent` / `Status` / `UpdateTimestamp` are ignored; a future reward-bearing subscription may revisit.
- Zhipu users will now see a toast when their account returns unrecognized limit rows, where previously nothing surfaced.

## Related Decisions

- [ADR-0010: Percent-Only Usage Window Synthesis](0010-percent-only-usage-window-synthesis.md) — not applied: the response carries an explicit `Cap`, so `limit` comes from data, not synthesis.
- [ADR-0011: Zhipu CREDIT_LIMIT Window Decoding](0011-zhipu-credit-limit-window-decoding.md) — the skipped-row warning behavior it established via `console.warn` is upgraded to the `warnings` passthrough in this ADR.
- [ADR-0007: Usage-Driven Auto-Exhaust](0007-usage-driven-auto-exhaust.md) — with `used = Percent` on the 0–100 scale and `limit = Cap`, the `used >= limit` auto-exhaust threshold fires exactly at 100% consumption.
