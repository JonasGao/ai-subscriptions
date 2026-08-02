# Quota Reset Schedule Visibility by Subscription Type

Quota Reset Schedules should only be visible and configurable for Recurring Subscriptions. One-time Subscriptions have no quota reset concept (pay once, use until exhausted), so the configuration UI should be hidden.

## Status

Accepted

## Context

The AI Subscriptions system supports two subscription types:

1. **Recurring Subscriptions**: Regular billing cycles (monthly/yearly) with periodic quota resets
   - Example: OpenAI API with hourly rate limits + monthly quota allocation
   - Users need to track when quotas reset to plan usage

2. **One-time Subscriptions**: Single payment, consumption-based usage
   - Example: DeepSeek prepaid credits, use until balance exhausted
   - No quota reset concept - just use what you paid for

Currently, the `ResetScheduleConfig` component is displayed for all subscription types in the subscription form. This creates confusion because:

- One-time subscriptions have no quota reset concept
- Users might mistakenly configure reset schedules for one-time subscriptions
- The UI should reflect the actual domain model

## Considered Options

1. **Frontend-only hiding** — Hide the component for one-time subscriptions, preserve data in memory
2. **Backend validation** — Prevent saving reset schedules for one-time subscriptions
3. **Data-level enforcement** — Automatically clear reset schedules for one-time subscriptions on save
4. **Type system separation** — Split `Subscription` into `RecurringSubscription` and `OneTimeSubscription` types

## Decision

**Frontend-only hiding with data preservation in memory.**

Implementation:

- Use conditional rendering: `{isRecurring && <ResetScheduleConfig />}`
- When user switches from Recurring to One-time: hide component, keep `resetSchedules` in form state
- When user switches back to Recurring: restore the previously configured schedules
- Backend: No changes, no validation, no data cleaning

**Rationale:**

- Minimal code change (single conditional render)
- Preserves user work during form editing (no data loss on type switching)
- Reflects domain model accurately (reset schedules are for recurring only)
- Allows flexibility for future requirements (backend can enforce later if needed)

## Consequences

### Positive

- UI accurately reflects domain model
- Users won't be confused by irrelevant configuration options
- Minimal implementation effort
- No data migration required

### Negative

- Backend could technically accept reset schedules for one-time subscriptions
- Data model doesn't enforce the constraint (optional field on all subscriptions)

### Neutral

- Existing data with reset schedules on one-time subscriptions will be preserved
- No automatic cleanup of potentially invalid data

## Implementation Details

**File**: `components/SubscriptionForm.tsx`

**Current code (lines 315-318)**:

```typescript
<div className="grid gap-2">
  <ResetScheduleConfig
    schedules={formData.resetSchedules || []}
    onChange={(schedules) => setFormData(prev => ({ ...prev, resetSchedules: schedules }))}
  />
</div>
```

**New code**:

```typescript
{isRecurring && (
  <div className="grid gap-2">
    <ResetScheduleConfig
      schedules={formData.resetSchedules || []}
      onChange={(schedules) => setFormData(prev => ({ ...prev, resetSchedules: schedules }))}
    />
  </div>
)}
```

**Variable**: `isRecurring` is already defined at line 103:

```typescript
const isRecurring = formData.subscriptionType === "recurring";
```

No other changes needed.

## Related Decisions

- [ADR-0001: Per-Subscription Quota Reset Schedules](0001-per-subscription-quota-reset.md) — Established the quota reset feature
- Domain model defined in `docs/UBIQUITOUS_LANGUAGE.md`
