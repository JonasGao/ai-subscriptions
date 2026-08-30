# AI Subscriptions

A subscription management system for AI services with quota tracking and automatic reset scheduling.

## Language

**Subscription**:
A recurring or one-time service subscription to an AI provider.
_Avoid_: Account. ("Plan" was formerly avoided as a synonym for Subscription; it is now a distinct term — see below.)

**Proxy Subscription**:
A separately managed purchase of proxy access, tracked by its name, duration, start date, monthly price, website, notes, and manual usage status. A Proxy Subscription is not an AI Subscription and does not have a Provider, Plan, quota window, or usage query.
_Avoid_: Proxy Account, Proxy Plan

**Proxy Subscription Tag**:
A reusable, case-sensitive descriptor used only to comment on or mark Proxy Subscriptions. Proxy Subscription Tags are a separate vocabulary from AI Subscription Tags.
_Avoid_: Proxy label, Proxy category

**Proxy Subscription Status**:
The manually maintained lifecycle state of a Proxy Subscription: Unused, In Use, or Expired. The status is not inferred from dates.
_Avoid_: Proxy subscription state

**Proxy Subscription Expiration**:
The calendar date through which a Proxy Subscription is available. Only this date is persisted; a start date and subscription duration may be used as temporary form inputs to calculate it. Expiration is displayed as date information and does not change Proxy Subscription Status automatically.
_Avoid_: Proxy renewal date, proxy reset date

**Proxy Subscription Date Notice**:
An informational notice derived from the persisted expiration date. It is shown for an In Use Proxy Subscription when its expiration date has passed, but is not shown for an Unused Proxy Subscription and never changes status.
_Avoid_: Automatic expiration status

**Tag**:
A reusable, case-sensitive descriptor for evaluating or characterizing subscriptions. A Tag may describe zero or more subscriptions and remains part of the available vocabulary while unused.
_Avoid_: Category, label

**Provider**:
An AI service vendor (e.g., Volcengine Ark, Moonshot, OpenAI). A provider statically declares which Plans it offers. Provider definitions are currently read-only: usage/balance query logic is hard-bound to specific provider definitions in code, so providers cannot be created, edited, or deleted through the UI.
_Avoid_: Vendor, service

**Plan**:
A distinct subscription offering within a provider's recurring subscriptions (e.g., Volcengine Ark offers the Coding Plan and the Agent Plan). Plans differ in how usage is queried. A provider declares zero or more Plans: multiple Plans mean the user must pick one for a recurring subscription; a single Plan is selected implicitly; no Plans means no subdivision exists. A subscription records its chosen Plan via `planId`.
_Avoid_: 套餐 (package/tier), subscription tier

**Quota Window**:
A time period during which a subscription has available credits or usage allowance. Quota windows reset on fixed schedules (e.g., every 5 hours, daily, weekly, monthly).
_Avoid_: Credit period, usage window

**Quota Exhaustion**:
The state when a subscription's quota is depleted. Exhaustion is marked per Reset Schedule — either manually by the user, or automatically when a Usage Query reports the matching window fully consumed. An enabled exhausted schedule makes the subscription paused until the schedule's reset time passes.
_Avoid_: Out of credits, limit reached

**Reset Schedule**:
A configuration that defines when a subscription's quota window renews. A subscription can track several reset intervals (5-hour, weekly, monthly) — at most one schedule per interval — operating independently.
_Avoid_: Renewal timer, refresh schedule

**Reset Time**:
The specific timestamp when a quota window renews and the subscription becomes available again.
_Avoid_: Refresh time, renewal time

**Billing Cycle**:
The frequency at which a subscription is charged (monthly or yearly). Independent from quota reset schedules.
_Avoid_: Payment cycle

**Usage Query**:
An on-demand request to a provider's API for a recurring subscription's usage data. The result is a set of usage buckets (five-hour, weekly, monthly) plus optional provider-specific blocks, each with used/remaining limits and a reset time. Only recurring subscriptions support usage queries. When a queried bucket is fully consumed, the subscription's reset schedule for that interval (if one exists) is automatically marked exhausted — one-way only; recovery still follows the schedule's reset time.
_Avoid_: usage window (a result bucket is a snapshot of usage, not the Quota Window time period itself), usage check

**Balance Query**:
An on-demand request to a provider's API for a one-time subscription's remaining balance (e.g., API credits). One-time subscriptions support balance queries; recurring subscriptions support usage queries.
_Avoid_: credit check

**Query Cooldown**:
The brief window after a successful Usage Query or Balance Query during which the quota query button remains clickable but requires an explicit confirmation before issuing another query. Confirming re-runs the query and restarts the window; failed queries neither start nor restart it.
_Avoid_: Rate limit, throttle

**Offset-Based Schedule Creation**:
A method of creating reset schedules where the user specifies a duration from the current time (e.g., "3d 5h"), and the system infers the schedule properties (dayOfWeek/dayOfMonth, timeOfDay) from that offset. The inferred values are stored permanently, and future resets follow the calculated schedule pattern.
_Avoid_: Relative schedule creation, duration-based schedule

**Direct Input Schedule Creation**:
A method of creating reset schedules where the user manually selects schedule properties (dayOfWeek/dayOfMonth, timeOfDay) and the system calculates the next reset time. This is the traditional approach where users have explicit control over each schedule parameter.
_Avoid_: Absolute schedule creation, manual schedule input

**Schedule Creation Input Method**:
The choice between offset-based and direct input methods for creating reset schedules. The system supports both methods to accommodate different user mental models: "when will it reset?" (offset) vs "what day/time should it reset?" (direct).

**Priority Scene**:
A named usage context in which subscriptions are arranged independently by preference. A subscription may appear in multiple priority scenes.
_Avoid_: Priority list, usage scene

**Priority Rank**:
A subscription's relative position within a Priority Scene. The first subscription has the highest priority and the last has the lowest; rank is not an absolute priority level.
_Avoid_: Priority level, priority score

## Relationships

- **Provider → Plan**: A provider declares the Plans it offers (if any)
- **Subscription → Plan**: A recurring subscription may record the chosen Plan (`planId`) when its provider offers Plans
- **Subscription → Quota Window**: A subscription may have quota windows (if not unlimited usage)
- **Quota Window → Reset Schedule**: Quota windows are tracked via reset schedules
- **Reset Schedule → Reset Time**: Each schedule calculates and stores the next reset time
- **Billing Cycle ⊥ Quota Reset**: These are independent concepts; a monthly subscription can have daily quota resets
- **Subscription → Usage Query**: recurring subscriptions support usage queries
- **Usage Query → Reset Schedule**: a fully-consumed usage bucket marks the matching reset schedule exhausted
- **Subscription → Balance Query**: one-time subscriptions support balance queries
- **Usage Query / Balance Query → Query Cooldown**: a successful query starts a query cooldown
- **Priority Scene → Subscription**: a priority scene orders subscriptions by relative Priority Rank
- **Subscription ↔ Tag**: a subscription may have zero or more Tags, and a Tag may describe zero or more subscriptions
- **Category ⊥ Tag**: a subscription has one Category for primary grouping; Tags provide additional, flexible characterization
- **Proxy Subscription ↔ Proxy Subscription Tag**: a Proxy Subscription may have zero or more Proxy Subscription Tags, and a Proxy Subscription Tag may describe zero or more Proxy Subscriptions
- **Proxy Subscription ⊥ Subscription**: Proxy Subscriptions and AI Subscriptions are independently managed entities with separate status and tag vocabularies
