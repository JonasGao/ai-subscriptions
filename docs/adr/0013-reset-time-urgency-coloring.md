# Reset-Time Urgency Coloring for Weekly/Monthly Usage Windows

The subscription card's per-window reset-time text ("N天后重置") encodes time urgency for weekly and monthly usage windows by shifting color from pale yellow to deep red as the next reset approaches. Weekly windows warn within 3 days and turn red within 1 day; monthly windows warn within 10 days and turn red within 5 days. The color is a continuous HSL interpolation, fully independent of the usage-percentage progress bar tiers.

## Status

Accepted

## Context

Usage queries return a next `resetTime` per usage window (`UsageResult.fiveHour/weekly/monthly`). The card already renders this as muted gray text with a Clock icon (`UsageProgressBar` in `SubscriptionCard.tsx`), re-computed every 60 s via `useNow`. The progress bar separately encodes consumption ratio (amber ≥ 70 %, red > 90 %). Time urgency — "your quota resets soon" — was not visually encoded at all, even though a user nearing a weekly reset has different urgency than one 6 days away. The requirement asked for yellow/red warning colors with a smooth pale-yellow → orange-yellow → red gradient, scoped to weekly and monthly windows only.

## Decision

- **Scope**: only the weekly and monthly usage windows' reset-time text + Clock icon in `SubscriptionCard`. Five-hour windows, locally configured reset-schedule rows, and other surfaces (priority scenes, dialogs) are excluded.
- **Thresholds** (millisecond-strict `<`; the gradient is continuous at both ends): exactly `yellowHours` renders nothing (uncolored, same as above the band); exactly `redHours` renders the deepest red — the interpolation endpoint, seamless with the red clamp just below it. "Looser tier" governs band membership only, never overrides the gradient value.
  - weekly: `< 24 h` → red tier; `24 h ≤ remaining < 72 h` → yellow tier; `≥ 72 h` → uncolored.
  - monthly: `< 120 h` → red tier; `120 h ≤ remaining < 240 h` → yellow tier; `≥ 240 h` → uncolored.
- **Overdue** (`resetTime` in the past, text reads "即将重置") renders deepest red. `resetTime: null` stays uncolored (existing "—").
- **Gradient**: normalized exponential easing (front-slow, back-fast) across the yellow tier. Let x = (yellowMs − remaining) / (yellowMs − redMs) ∈ [0,1] (elapsed ratio); t' = 2^x − 1 (convex easing, t'(0)=0, t'(1)=1). H/S/L share t': H = 48(1−t'), S = 95−30t', L = 72−17t'. Endpoints: `hsl(48, 95%, 72%)` (pale yellow at yellow threshold) → `hsl(0, 65%, 55%)` (soft red at red threshold); hue, saturation, and lightness move together on the same curve. The curve lingers near pale yellow on entry to the yellow tier and rushes toward red only near the red threshold, so most of the warning band looks gently yellow and only the final hours before reset appear urgent. Below the red threshold the color clamps at soft red `hsl(0, 65%, 55%)`. No discrete color steps.
  - _Revision 2026-09-20_: changed from linear interpolation to 2^x−1 exponential easing; red endpoint softened from `hsl(0, 80%, 50%)` to `hsl(0, 65%, 55%)` (user-requested gentler red).
- **Carrier**: color replaces `text-muted-foreground` on both the text span and the Clock icon via inline `style`; the reset-time tooltip stays neutral. Uncolored windows keep the existing gray.
- **Independence**: the time-urgency color and the usage-percent progress-bar tiers (ADR-0007 lineage, `PROGRESS_WARNING/DANGER_THRESHOLD`) encode orthogonal dimensions with no coupling — no "low usage suppresses warning" logic.
- **Implementation**: pure function `getResetUrgencyColor(kind, resetTime, now?)` in `lib/utils.ts` alongside the other usage-display helpers, with `RESET_URGENCY_THRESHOLDS` as exported config; `UsageBlock` gains an explicit `kind` prop (never inferred from label text). Dark mode uses the same fixed colors.

## Consequences

### Positive

- Time urgency is visible at a glance, and the continuous gradient makes "how close" readable without reading the text.
- All logic lives in one injectable-clock pure function; component change is a style passthrough; boundary and monotonicity tests are trivial to write.

### Negative

- Fixed inline HSL colors are not dark-mode-adapted — on a dark background the pale-yellow end may look brighter than intended (accepted; warning colors are conventionally fixed).
- The color refreshes at `useNow`'s 60 s cadence, so the gradient is perceived in one-minute steps, not continuously (accepted; per-second re-rendering all cards is not worth it).

### Neutral

- Five-hour windows may show a reset minutes away in gray while a weekly window 2 days away shows yellow — intentional per the scope decision.
- Providers whose monthly bucket lacks a resetTime (e.g. zhipu returns `monthly: null`) simply never trigger the warning.

## Related Decisions

- [ADR-0007: Usage-Driven Auto-Exhaust](0007-usage-driven-auto-exhaust.md) — the progress bar tiers it interacts with stay independent; this ADR adds the orthogonal time dimension.
