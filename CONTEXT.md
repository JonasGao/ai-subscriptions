# AI Subscriptions

A subscription management system for AI services with quota tracking and automatic reset scheduling.

## Language

**Subscription**:
A recurring or one-time service subscription to an AI provider.
_Avoid_: Account, plan

**Quota Window**:
A time period during which a subscription has available credits or usage allowance. Quota windows reset on fixed schedules (e.g., every 5 hours, daily, weekly, monthly).
_Avoid_: Credit period, usage window

**Quota Exhaustion**:
The state when a subscription's quota is depleted. User manually marks subscription as paused to indicate exhausted quota.
_Avoid_: Out of credits, limit reached

**Reset Schedule**:
A configuration that defines when a subscription's quota window renews. Each subscription can have multiple schedules (e.g., 5-hour, daily, weekly, monthly) operating independently.
_Avoid_: Renewal timer, refresh schedule

**Reset Time**:
The specific timestamp when a quota window renews and the subscription becomes available again.
_Avoid_: Refresh time, renewal time

**Billing Cycle**:
The frequency at which a subscription is charged (monthly or yearly). Independent from quota reset schedules.
_Avoid_: Payment cycle

**Offset-Based Schedule Creation**:
A method of creating reset schedules where the user specifies a duration from the current time (e.g., "3d 5h"), and the system infers the schedule properties (dayOfWeek/dayOfMonth, timeOfDay) from that offset. The inferred values are stored permanently, and future resets follow the calculated schedule pattern.
_Avoid_: Relative schedule creation, duration-based schedule

**Direct Input Schedule Creation**:
A method of creating reset schedules where the user manually selects schedule properties (dayOfWeek/dayOfMonth, timeOfDay) and the system calculates the next reset time. This is the traditional approach where users have explicit control over each schedule parameter.
_Avoid_: Absolute schedule creation, manual schedule input

**Schedule Creation Input Method**:
The choice between offset-based and direct input methods for creating reset schedules. The system supports both methods to accommodate different user mental models: "when will it reset?" (offset) vs "what day/time should it reset?" (direct).

## Relationships

- **Subscription → Quota Window**: A subscription may have quota windows (if not unlimited usage)
- **Quota Window → Reset Schedule**: Quota windows are tracked via reset schedules
- **Reset Schedule → Reset Time**: Each schedule calculates and stores the next reset time
- **Billing Cycle ⊥ Quota Reset**: These are independent concepts; a monthly subscription can have daily quota resets
