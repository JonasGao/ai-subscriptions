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

## Relationships

- **Subscription → Quota Window**: A subscription may have quota windows (if not unlimited usage)
- **Quota Window → Reset Schedule**: Quota windows are tracked via reset schedules
- **Reset Schedule → Reset Time**: Each schedule calculates and stores the next reset time
- **Billing Cycle ⊥ Quota Reset**: These are independent concepts; a monthly subscription can have daily quota resets