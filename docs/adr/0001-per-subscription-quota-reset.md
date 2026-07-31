# Per-Subscription Quota Reset Schedules

Replace the global monthly reset with per-subscription quota reset schedules. Users can configure multiple independent reset schedules per subscription (e.g., 5-hour, daily, weekly, monthly) to track when quota windows renew. Each schedule stores its next reset time, and a single global scheduler checks all subscriptions every 5 minutes to perform resets.

## Status

Accepted

## Context

AI subscription services have quota limits that reset on fixed schedules (5-hour windows, daily, weekly, monthly). Users need to track when quotas renew so they know when subscriptions become available again. The previous global monthly reset (reset all paused subscriptions on the 1st) was too coarse-grained and didn't match real quota renewal patterns.

## Considered Options

1. **Keep global monthly reset** — Simple but doesn't match actual quota windows
2. **Per-subscription quota tracking** — Flexible, matches real usage patterns
3. **Hybrid approach** — Global monthly default + per-subscription overrides

## Decision

Per-subscription quota reset schedules. Each subscription can have multiple schedules configured. The global monthly reset is removed entirely (clean break migration).

Key behaviors:
- Multiple schedules per subscription (e.g., 5-hour + daily + weekly + monthly)
- Individual enable/disable toggle per schedule
- Each schedule stores `nextResetTime` timestamp
- Single global scheduler runs every 5 minutes
- When reset time arrives: paused → active (if paused), no-op if already active
- Editing a schedule recalculates `nextResetTime` immediately
- Timezone: browser's local timezone (auto-detected), stored as UTC

## Consequences

- More granular control over quota tracking
- Removes global monthly reset entirely
- Requires UI changes: reset schedule configuration in subscription cards
- Requires migration: `last-monthly-reset.json` removed, no automatic schedule migration
- Users must manually configure reset schedules for existing subscriptions