# Percent-Only Usage Providers — Synthesize into UsageWindow

opencode Go is the first usage provider whose API exposes only a usage **percentage** per window, not absolute used/limit values. Rather than extend the shared `UsageWindow` type, the handler synthesizes percent into the existing `{ limit, used, remaining, resetTime }` shape (`limit="100"`, `used=percent`, `remaining=100-percent`).

## Status

Accepted

## Context

The OpenCode Go usage API (`GET https://opencode.ai/zen/go/v1/usage`, Bearer token) returns, per window:

```json
{
  "usage": {
    "rolling": {
      "status": "ok",
      "percent": 0,
      "resetsAt": "2026-09-13T11:26:17.325Z"
    },
    "weekly": {
      "status": "ok",
      "percent": 23,
      "resetsAt": "2026-09-14T00:00:00.325Z"
    },
    "monthly": {
      "status": "ok",
      "percent": 11,
      "resetsAt": "2026-10-10T11:03:46.325Z"
    }
  }
}
```

Each window carries only `status`, `percent` (0–100+), and `resetsAt` (ISO). There is **no** `used`/`limit` absolute value. This is the first provider in the system whose usage API is percent-only — every prior provider (GitHub Copilot, Moonshot, Ark Coding/Agent Plan, Alibaba Token Plan) returns absolute used/limit (credits, dollars, or counts).

The shared `UsageWindow` type is `{ limit, used, remaining, resetTime }` (all strings; `resetTime` ISO). Two consumers depend on numeric `used`/`limit`:

- `SubscriptionCard.UsageProgressBar` computes the fill percentage via `getUsagePercent(window.used, window.limit)` = `used/limit*100`, then renders a bar and an `"X.X%"` label.
- Auto-exhaust (ADR-0007) marks the matching reset schedule exhausted when `limit > 0 && used >= limit`.

> Note: `.firecrawl/opencode-usage-api.md` describes a different response shape (`{plan, windows:[{name,usagePercent,resetInSec,used,limit}], useBalance}`). That doc was derived from PR #32913 source and does **not** match the live endpoint (verified via `.firecrawl/test-usage-api.sh`, a plain `curl` passthrough). The doc is treated as stale and left unannotated per the user's call (it is a temporary reference).

## Considered Options

1. **Synthesize into the existing UsageWindow** (chosen) — `limit="100"`, `used=String(percent)`, `remaining=String(max(0,100-percent))`, `resetTime=resetsAt`. The card's `getUsagePercent` already computes percent from `used/limit`, so the bar fills to `percent%` and the label reads `"percent%"` with no change. Auto-exhaust's `used>=limit` becomes `percent>=100`, working unchanged. Zero changes to the shared type, the card, or the auto-exhaust logic — the mapping is entirely handler-local.
2. **Extend UsageWindow with optional `percent`/`status`** — add fields, render percent-based in the card, change auto-exhaust to check `percent>=100`. Touches the shared type + card + auto-exhaust (three surfaces) to serve a single provider's need that the existing shape can already express.
3. **Store percent in `used` with empty `limit`** — rejected: auto-exhaust's `limit > 0` guard would skip the window, and the progress bar (`getUsagePercent` returns null without a limit) would not render.

## Decision

**Option 1.** Percent-only providers synthesize into the existing `UsageWindow` shape: `limit="100"`, `used=String(percent)`, `remaining=String(max(0,100-percent))`, `resetTime=resetsAt`. The synthesis is handler-local; `UsageWindow`, `SubscriptionCard`, and the ADR-0007 auto-exhaust logic are unchanged. Future percent-only providers follow the same handler-local pattern.

Two opencode-specific rules ride on this synthesis:

- **`rolling` → `fiveHour` bucket.** opencode's `rolling` window (a short rolling window) maps to the system's `fiveHour` slot — the generic short-rolling bucket already used by Alibaba Token Plan (`<30h → fiveHour`). `weekly`→`weekly`, `monthly`→`monthly`. Missing windows are `null`.
- **`status:"rate-limited"` forces exhaustion.** When a window is `rate-limited`, `used = String(max(percent, 100))` so `used >= limit` holds and auto-exhaust fires even when `percent < 100` (rate-limited = throttled = effectively exhausted). The `max` preserves a true `percent > 100` overage rather than understating it.

## Consequences

### Positive

- Zero shared-surface-area: no shared-type change, no card change, no auto-exhaust change. The card renders opencode windows identically to other providers (bar + `"X.X%"` label + "已用 X · 剩余 Y").
- Reuses the existing `getUsagePercent(used, limit)` computation and the ADR-0007 threshold — percent-only is just another input shape to the same pipeline.
- Sets a reusable pattern for future percent-only providers (handler-local synthesis, no model churn).

### Negative

- A future reader sees `limit="100"` hardcoded in the opencode handler and may wonder why until they reach this ADR. Mitigated by this ADR and a handler comment.
- The amount display reads "已用 23 · 剩余 77" rather than "23%". Acceptable: the `"X.X%"` bar label contextualizes it, and other providers also show raw used/remaining without a unit.

### Neutral

- `percent > 100` (overage without rate-limit) maps to `used > limit`; the progress bar clips at 100% width in its `overflow-hidden` container, the label shows the real `"105.0%"`, and auto-exhaust fires. Honest display of overage.

## Related Decisions

- [ADR-0005: Provider Plans](0005-provider-plans.md) — opencode declares plans `go`/`zen`; credentials stay provider-level.
- [ADR-0007: Usage-Driven Auto-Exhaust](0007-usage-driven-auto-exhaust.md) — the `used>=limit` threshold this synthesis preserves.
- [ADR-0004: Simplify Hourly to FiveHour](0004-simplify-hourly-to-fivehour.md) — the `fiveHour` bucket opencode's `rolling` window reuses.
