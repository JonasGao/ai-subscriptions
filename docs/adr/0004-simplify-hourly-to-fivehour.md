# Simplify Reset Schedule — hourly(N) → fiveHour

Replace the configurable `hourly(N)` reset schedule type with a fixed `fiveHour` type (hardcoded 5-hour interval). This removes the `intervalHours` field entirely and prepares the schedule model for linking with the subscription usage feature.

## Status

Accepted

## Context

The original `"hourly"` schedule type allowed arbitrary hourly intervals (e.g., every 1h, every 3h, every 6h) via an `intervalHours` field. In practice, nearly all subscriptions use a 5-hour interval — matching the typical session/rate-limit window of AI API providers.

This flexibility had costs:

1. **Unnecessary complexity**: The `intervalHours` number input added UI clutter and validation code that almost never varied from "5".
2. **Model mismatch for usage integration**: The upcoming usage-subscription link needs a fixed set of schedule windows to map against usage query results (fiveHour/weekly/monthly). Arbitrary hourly intervals would bloat the mapping.
3. **Semantic drift**: "hourly" as a type name misleadingly suggested "every hour" when the real meaning was "every N hours".

## Considered Options

1. **Keep hourly(N) flexible** — Keep `intervalHours` and add fiveHour as a preset
   - Backward compatible but keeps the complexity
   - Usage mapping would need to handle arbitrary N-hour windows

2. **Add fiveHour as a new type alongside hourly** — Three becomes four types
   - No migration needed but fragments the schedule taxonomy
   - Old hourly types live on indefinitely

3. **Replace hourly with fiveHour entirely (selected)** — Drop `intervalHours`, hardcode 5h
   - Cleanest model, eliminates entire category of edge cases
   - Requires users to manually rebuild old hourly schedules
   - Aligns schedule windows 1:1 with usage result windows

## Decision

**Replace `"hourly"` with `"fiveHour"`, hardcode 5-hour interval.**

### Type change

```typescript
// before
export type ResetScheduleType = "hourly" | "weekly" | "monthly";
export interface ResetSchedule {
  intervalHours?: number; // removed
  // ...
}

// after
export type ResetScheduleType = "fiveHour" | "weekly" | "monthly";
export interface ResetSchedule {
  // intervalHours removed
  // ...
}
```

### Hardcoded interval

`calculateNextFiveHourReset` uses a fixed `const intervalMs = 5 * 60 * 60 * 1000` with no configurable parameter. The anchor-based drift prevention (using `previousNextResetTime` instead of `now`) is preserved unchanged.

### Display order

Schedules are always displayed in fixed order: fiveHour → weekly → monthly, via a `sortResetSchedules()` utility backed by a `SCHEDULE_TYPE_ORDER` constant. This is applied at both display sites (`ResetScheduleConfig` and `SubscriptionCard`), independent of creation order.

### Old data handling

- **No automatic migration**: Old `"hourly"` schedules remain on disk as-is
- **No compat reading/filtering**: They appear as bare `"hourly"` text in the UI; users can delete them manually
- **Scheduler tolerance**: `processResetTick` wraps `updateResetScheduleNextTime` in try-catch — unknown schedule types are warned and skipped rather than crashing the entire tick

### What stays the same

- Input methods (offset "从现在起" and direct "直接输入") — unchanged
- Weekly and monthly schedule types — completely untouched
- Interaction flow, UI layout, styles — unchanged
- Subscription usage feature — unchanged (but now ready for linking)

## Consequences

### Positive

- Simpler data model: one less optional field across types, DB, form data, and API
- UI simplification: interval hours number input removed (17 lines of JSX deleted)
- Type name is self-documenting: `"fiveHour"` exactly describes the behavior
- Fixed 3-window taxonomy (fiveHour/weekly/monthly) maps cleanly to usage result fields
- Net code reduction: -39 lines across 7 files

### Negative

- Users with non-5-hour intervals must rebuild their schedules
- Old `"hourly"` data lingers on disk (non-destructive, manually cleanable)
- If a future provider needs a different interval, this would need revisiting

### Neutral

- The 5-hour value is hardcoded — changing it requires a code change, but this matches the reality that all current subscriptions use 5 hours

## Implementation Notes

**Files changed (7):** `lib/types.ts`, `lib/reset-schedule.ts`, `lib/db.ts`, `lib/utils.ts`, `lib/notifications/payload.ts`, `components/ResetScheduleConfig.tsx`, `__tests__/payload.test.ts`

**Key changes:**

1. Rename type + delete `intervalHours` from all interfaces
2. Rename `calculateNextHourlyReset` → `calculateNextFiveHourReset` with hardcoded 5h
3. Add `sortResetSchedules` utility + `SCHEDULE_TYPE_ORDER` constant
4. Add try-catch in `processResetTick` for unknown schedule type tolerance
5. Update labels: "每小时"/"每N小时" → "每5小时"
6. Remove interval hours input from `ResetScheduleConfig`

## Related Decisions

- [ADR-0001: Per-Subscription Quota Reset Schedules](0001-per-subscription-quota-reset.md) — Established the quota reset feature with hourly/weekly/monthly types
- [ADR-0003: Schedule Creation Input Methods](0003-schedule-creation-input-methods.md) — Input methods (offset/direct) that this change preserves unchanged
