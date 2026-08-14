# Usage-Driven Auto-Exhaust Marking

When a usage query reveals that a quota window is fully consumed (used >= limit), the frontend automatically marks the corresponding reset schedule as "exhausted" by invoking the same toggle handler the manual button uses. This makes a read-only action (querying usage) produce a state change, which is counter-intuitive but desirable: users see "已用尽" immediately without having to find and click the toggle button after every query.

## Status

Accepted

## Context

Reset schedules track when a subscription's quota resets. Each schedule has an `exhausted` flag that, when true, contributes to the subscription's "paused" status (via `recomputeStatus`). Users previously had to manually click the "可用/用尽" toggle button after noticing their usage was at 100%.

Two observations drove this change:

1. The usage query already computes whether each window (fiveHour/weekly/monthly) is fully consumed — the information is right there.
2. The manual toggle is a single click, but it's easy to miss: users see the progress bar hit 100% and may not realize they need to also flip the toggle to pause the subscription.

The auto-exhaust feature closes this gap: after a successful usage query, if any window shows used >= limit, the corresponding enabled, non-exhausted schedule is automatically toggled to exhausted.

## Considered Options

1. **Pure frontend, reusing the toggle handler** (chosen) — After a successful usage query in `SubscriptionCard`, iterate over the three windows. For each non-null window with `limit > 0` and `used >= limit`, find the matching schedule (by type, enabled, not exhausted) and call the existing `handleScheduleToggle(scheduleId, true)`. This goes through the same API call (`POST /api/subscriptions/[id]/schedules/[scheduleId]/toggle`) and state update path as the manual button.
2. **Backend-side, in the usage query handler** — After fetching usage from the provider, check for exhaustion and update the schedule server-side. Rejected: it would require the usage handler to know about schedule state, couples two concerns, and makes the side effect invisible to the frontend until the next data refresh. The frontend approach reuses the existing optimistic-update-via-refetch pattern.
3. **Dedicated auto-exhaust API endpoint** — Create a new endpoint that the frontend calls after detecting exhaustion. Rejected: unnecessary complexity; the toggle endpoint already does exactly what's needed, and adding a new endpoint duplicates logic.
4. **Scheduler-based** — Add a cron job that periodically checks usage and marks exhaustion. Rejected: adds polling overhead, introduces a new timing concern, and diverges from the user-initiated query model. The frontend approach piggybacks on queries the user (or the mount-time auto-query) already makes.

## Decision

- **Pure frontend, triggered by usage query success.** The logic lives in `SubscriptionCard.tsx`'s `runQuery` function, immediately after `setUsage(data)`. No new timers, no new endpoints, no new state.
- **Reuses the manual toggle handler.** `handleScheduleToggle(scheduleId, true)` is called identically to how the button calls it. This means the same API endpoint, the same `toggleScheduleExhausted` db function, the same status recomputation, and the same subscription-state refresh in the parent component.
- **One-directional: only sets exhausted = true.** If usage drops below 100% (e.g. after a manual reset), the schedule is NOT automatically un-exhausted. Clearing exhausted is the scheduler's job (via `processResetTick` when `nextResetTime` arrives) or the user's job (manual toggle). This avoids flapping: a query that momentarily shows 99.9% would not undo the exhaustion the user just observed at 100%.
- **Eligibility rules.** A schedule is auto-exhausted only if: the window is non-null, `limit > 0`, `used >= limit`, the schedule exists for that type, `enabled === true`, and `exhausted === false`. No schedule is auto-created.
- **Scope: recurring subscriptions only.** One-time subscriptions use the balance query (not usage query), which has no window concept. The auto-exhaust logic is inside the `subscriptionType === "recurring"` branch of `runQuery`.
- **No UI feedback.** No toast, no notification. The schedule button changes from "可用" to "已用尽" as a side effect of the subscription state refresh, which is the same visual outcome as a manual toggle.

## Consequences

### Positive

- Users no longer need to remember to manually toggle after seeing 100% usage; the system does it for them.
- The subscription status flips to "已用尽" (paused) immediately after the query, preventing accidental over-use.
- Zero new infrastructure: no new endpoints, no new timers, no new state machines.

### Negative

- **Read-then-write is counter-intuitive.** A "query" action (which users think of as read-only) now has a write side effect. This is mitigated by the fact that the write is deterministic (only fires when usage is genuinely at 100%) and matches what the user would have done manually.
- **Multiple toggles per query.** If multiple windows are exhausted simultaneously (e.g. fiveHour + weekly + monthly all hit 100%), the frontend fires multiple toggle calls in sequence. Each is a separate API call and state update. This is acceptable because the calls are independent and the UI refreshes once with the final state.
- **No automatic recovery.** If usage drops below 100% without a reset (e.g. provider-side adjustment), the schedule stays exhausted until the scheduler fires or the user toggles manually. This is intentional — automatic recovery would risk flapping.

### Neutral

- The uniqueness constraint on schedule types (one per type per subscription) is enforced separately and is orthogonal to this ADR. It prevents the ambiguity of "which weekly schedule should be auto-exhausted" by construction.
