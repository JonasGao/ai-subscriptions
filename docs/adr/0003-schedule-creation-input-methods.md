# Schedule Creation Input Methods

Support two input methods for creating reset schedules: offset-based ("从现在起") and direct input ("直接输入"). Each method presents different UI controls and calculation logic to match different user mental models.

## Status

Accepted

## Context

Users create reset schedules to track when their quota windows will renew. Different users have different mental models:

1. **Offset-based thinking**: "My quota will reset in 3 days and 5 hours from now"
   - User knows relative duration but not the exact day/time
   - System should infer dayOfWeek/dayOfMonth and timeOfDay from the offset
   - Future resets follow the inferred schedule pattern

2. **Direct input thinking**: "My quota resets every Thursday at 15:00"
   - User knows the exact schedule pattern
   - System should calculate the next reset time based on selected day/time
   - User has explicit control over schedule parameters

The previous UI showed both offset input and day/time fields simultaneously, which was confusing and redundant. Users had to mentally calculate which values to enter for their use case.

## Considered Options

1. **Offset-only input** — Remove day/time fields, always infer from offset
   - Simple UI but loses explicit control
   - Users can't say "reset every Thursday" without calculating offset

2. **Direct input only** — Remove offset, always require day/time selection
   - Explicit control but requires mental calculation for relative durations
   - Users can't say "reset in 3 days" without calculating which day that is

3. **Two input methods (selected)** — Support both offset-based and direct input
   - Accommodates both mental models
   - Requires input method selector switch
   - More complex UI but better UX

## Decision

**Support two input methods with intelligent switching behavior.**

### Input Method Behavior

**Offset-Based ("从现在起"):**

- Hide dayOfWeek/dayOfMonth and timeOfDay fields
- Show offset duration input (e.g., "3d 5h 44m")
- Show real-time preview of inferred schedule (debounced 500ms)
- System infers and stores day/time values from offset
- Preview format:
  - Weekly/Monthly: "将持续在 每周X/每月X日 HH:MM 重置 (timezone)"
  - Hourly: "下次重置将在 X天X小时后 (YYYY-MM-DD HH:MM) (timezone)"
- Always show timezone (abbreviation format: "上海时间", "UTC", etc.)

**Direct Input ("直接输入"):**

- Show dayOfWeek/dayOfMonth and timeOfDay fields
- Hide offset duration input
- User manually selects schedule properties
- System calculates nextResetTime based on selected day/time
- No preview needed (values are explicit)

### Switching Behavior

**Between schedule types (hourly/weekly/monthly):**

- Preserve offset input across switches
- Preview recalculates for new schedule type
- Example: offset "3d 5h" works for any type, preview updates accordingly

**Between input methods:**

- "从现在起" → "直接输入": Pre-fill day/time fields with inferred values from offset
- "直接输入" → "从现在起": Clear all fields (cannot reliably reverse-calculate offset)

### Preview Calculation

- Debounced 500ms after user stops typing
- No preview when offset is empty (initial state)
- Show timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`, fallback to UTC
- Display timezone abbreviation: "上海时间", "UTC", etc.

### Edge Cases

**Monthly schedule day-of-month calculation:**

- Store the actual calculated day from offset (e.g., dayOfMonth=18)
- Not the "idealized" day (e.g., dayOfMonth=31 with backend clamping)
- User sees "18日" in preview, that's what gets stored

**Weekly schedule offset > 7 days:**

- Wrap to the next occurrence of that weekday
- Offset "10d" from Monday → Thursday (10 days later)
- Store dayOfWeek=4 (Thursday), future resets every Thursday

**Minimum offset:**

- No minimum validation (allow any offset ≥ 1 minute)
- User might legitimately want "reset tomorrow, then weekly/monthly"

**Timezone detection failure:**

- Fallback to UTC
- Show "(UTC)" in preview to be explicit

## Consequences

### Positive

- Accommodates both user mental models (relative vs absolute)
- Reduces cognitive load (user doesn't need to calculate offset ↔ day/time conversion)
- Preview provides immediate feedback and catches errors early
- Consistent behavior across schedule types

### Negative

- More complex UI (input method selector switch)
- Requires preview calculation logic with debouncing
- Switching behavior needs careful implementation

### Neutral

- Backend unchanged (still receives dayOfWeek/dayOfMonth/timeOfDay values)
- No data migration needed (existing schedules work as before)
- Preview is display-only, doesn't affect stored data

## Implementation Notes

**UI Component:** `components/ResetScheduleConfig.tsx`

**Key changes:**

1. Add input method state: `inputMethod: "offset" | "direct"`
2. Conditionally show/hide fields based on input method
3. Implement debounced preview calculation (500ms delay)
4. Handle input method and schedule type switching
5. Format preview text with timezone abbreviation

**Calculation functions:**

- Extract dayOfWeek/dayOfMonth and timeOfDay from offset-based nextResetTime
- Already have `calculateNextResetTime()` for direct input
- Preview uses same timezone formatting as existing schedule display

## Related Decisions

- [ADR-0001: Per-Subscription Quota Reset Schedules](0001-per-subscription-quota-reset.md) — Established the quota reset feature
- [ADR-0002: Quota Reset Visibility by Subscription Type](0002-quota-reset-visibility-by-subscription-type.md) — Hide reset schedules for one-time subscriptions
