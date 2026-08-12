# Ubiquitous Language - AI Subscriptions Domain

This document defines the core domain concepts and terminology used in the AI Subscriptions system.

## Core Concepts

### Subscription (订阅)

A subscription represents a user's access to an AI service. It tracks:

- Billing and payment information
- Usage quotas and balances
- Reset schedules for quota tracking

**Types:**

- **Recurring Subscription (周期性订阅)**: Regular billing cycle (monthly/yearly), quota resets periodically. May support live **Usage** queries from provider APIs.
- **One-time Subscription (一次性订阅)**: Single payment, use until balance exhausted, no quota reset. May support live **Balance** queries from provider APIs.

### Subscription Type (订阅类型)

Determines the billing model and quota behavior:

- **Recurring**: Periodic billing with automatic quota renewal
  - Has `billingCycle` (monthly/yearly)
  - Has `startDate` and `renewalDate`
  - Can have **Quota Reset Schedules**
  - Can query **Usage** from provider API (if provider supports it)
  - Examples: Kimi Code monthly plan, OpenAI monthly subscription, Claude Pro yearly plan

- **One-time**: Single payment, consumption-based
  - Has `balance` field to track remaining credits
  - Can query **Balance** from provider API (if provider supports it)
  - No quota reset concept
  - Examples: DeepSeek prepaid credits, OpenRouter pay-per-use

### Quota Reset Schedule (额度重置计划)

A schedule that tracks when an AI service's quota/rate limit will reset.

**Purpose:**

- Observability tool for users to know when their quota will be available again
- Does NOT perform actual resets (only tracks timing)
- Helps users plan their API usage

**Properties:**

- `type`: Reset interval (hourly, weekly, monthly)
- `nextResetTime`: When the next quota reset will occur
- `enabled`: Whether to track this schedule
- `timezone`: User's timezone for display
- `exhausted`: Whether quota has been used up

**Applicability:**

- **Only for Recurring Subscriptions**: One-time subscriptions have no quota reset concept
- Multiple schedules can be configured per subscription (e.g., hourly API limit + monthly billing reset)

### Billing Cycle (计费周期)

For recurring subscriptions, defines how often billing occurs:

- **Monthly**: Billed every month
- **Yearly**: Billed once per year

### Balance (余额)

For one-time subscriptions, tracks remaining prepaid credits:

- Decreases as user consumes the service
- No automatic reset or renewal
- User must manually recharge when exhausted
- Can be queried live from provider APIs that support `balanceApiUrl`
- Same dual trigger as Usage: auto-queried once on list-page open, plus manual refresh; a successful query also persists the total balance back to the subscription

### Usage (用量)

For recurring subscriptions, represents live quota consumption data queried from provider APIs:

- Snapshot of current usage window (limit / used / remaining / reset time)
- Provider-specific windows: e.g. 5-hour rolling rate limit, 7-day weekly quota
- May include auxiliary data: booster wallet balance, monthly spending, parallel limit, membership tier
- **Dual trigger** — auto-queried once when the subscription list page opens (active, query-capable subscriptions only), plus manual refresh via the card button; never polled on a timer
- **Frontend-only** — not persisted; each query fetches fresh data
- Available only for providers that expose `usageApiUrl` — declared at the **Plan** level when the provider offers Plans, otherwise at the provider level

**Difference from Reset Schedule:**

- Usage is live data from provider APIs; Reset Schedule is manually configured local tracking
- Usage shows actual consumption numbers; Reset Schedule only tracks reset timing
- Usage may be replaced by Reset Schedule integration in the future

### Offset-Based Schedule Creation (基于偏移的计划创建)

A method of creating reset schedules where the user specifies a duration from the current time (e.g., "3d 5h"), and the system infers the schedule properties from that offset:

- User enters: offset duration (e.g., "3d 5h 44m")
- System calculates: next reset time = now + offset
- System infers: dayOfWeek/dayOfMonth and timeOfDay from calculated time
- Stored values: inferred day/time values (not the offset)
- Future behavior: repeats on the inferred schedule

**Example:**

- Current: Monday 10:00, offset "3d 5h"
- Weekly schedule: inferred as Thursday 15:00 → resets every Thursday at 15:00

### Direct Input Schedule Creation (直接输入计划创建)

A method of creating reset schedules where the user manually selects schedule properties:

- User selects: dayOfWeek/dayOfMonth and timeOfDay
- System calculates: next reset time based on selected values
- Stored values: user-selected day/time values
- Future behavior: repeats on the selected schedule

**Example:**

- User selects: Thursday 15:00
- Weekly schedule: resets every Thursday at 15:00

## Business Rules

### Quota Reset Schedule Visibility

**Rule**: Quota Reset Schedules are only visible and configurable for Recurring Subscriptions.

**Rationale**:

- Recurring subscriptions have periodic quota resets (API rate limits, monthly allowances)
- One-time subscriptions are consumption-based with no reset concept
- Users pay once and use until balance is exhausted

**Implementation**:

- Frontend: Hide Reset Schedule configuration for one-time subscriptions
- Backend: No validation (allow data to exist for flexibility)
- Data migration: Not required (existing data can be preserved)

### Subscription Type Transitions

When editing a subscription:

- Switching from Recurring to One-time: Hide reset schedules in UI, preserve data in memory; **`planId` is cleared** (Plans are a recurring-only concept, and unlike reset schedules there is no value in preserving the selection)
- Switching from One-time to Recurring: Show reset schedule configuration (with previously saved data if any); Plan selection starts fresh (re-picked by the user, or re-assigned implicitly if the provider has a single Plan)

## Examples

### Recurring Subscription Scenario

**User**: Subscribes to OpenAI GPT-4 API

- **Billing**: $20/month
- **Quota**: 60 requests per minute (rate limit)
- **Reset Schedule**: Hourly reset (tracks when rate limit window expires)
- **User need**: Know when they can make requests again after hitting the limit

**Another Reset Schedule**:

- Monthly quota allocation (e.g., $100 worth of API calls per month)
- Resets on billing date
- User wants to track both hourly rate limit and monthly quota

### One-time Subscription Scenario

**User**: Purchases DeepSeek credits

- **Payment**: ¥100 one-time
- **Balance**: Starts at ¥100, decreases with usage
- **Behavior**: Use until exhausted, then manually recharge
- **No reset schedule needed**: No periodic quota renewal

## Provider

### Provider (提供商)

An AI service provider. Defines identity and supported query capabilities:

- `id`, `name`, `description`, `website` — identity
- `balanceApiUrl?` — endpoint for live balance queries (one-time subscriptions)
- `usageApiUrl?` — endpoint for live usage queries (recurring subscriptions), used when the provider has no Plans
- `plans?` — the provider's Plan offerings (see below)

The presence of a Query URL indicates the provider supports that query type. A provider may support neither, one, or both. The unified "额度" button on subscription cards auto-selects the query type based on the subscription's type, its `planId` (if any), and the configured URLs.

### Plan (订阅方案)

A distinct subscription offering within a provider's **recurring** subscriptions. Plans differ in how usage is queried:

- `id` — unique within the provider (e.g. `codingplan`, `agentplan`, `kimi-code`)
- `name` — display name, kept in the provider's original wording (Coding Plan, Agent Plan, Kimi Code)
- `usageApiUrl?` — the Plan's own usage query endpoint

**Selection rules:**

- **Multiple Plans** — the user must pick one when creating a recurring subscription (required field)
- **Single Plan** — no picker is shown; the backend implicitly assigns it (`planId` is always stored explicitly)
- **No Plans** — no subdivision; usage capability stays at the provider level

**Applicability:**

- Plans are only meaningful for **Recurring Subscriptions**; switching a subscription to one-time **clears** `planId`
- **Not called "套餐"** — the canonical term is Plan (订阅方案)

## Relationships

```
Subscription
├── Recurring
│   ├── billingCycle: Monthly | Yearly
│   ├── startDate: Date
│   ├── renewalDate: Date
│   ├── planId?: Plan  (when the provider offers Plans)
│   ├── resetSchedules: QuotaResetSchedule[] (optional)
│   └── usage (frontend-only, queried from Plan.usageApiUrl or Provider.usageApiUrl)
│
└── One-time
    ├── balance: number (remaining credits)
    └── balance (live, queried from Provider.balanceApiUrl)

Provider
├── balanceApiUrl?: string  → supports balance query for one-time subs
├── usageApiUrl?: string    → supports usage query for recurring subs (no Plans)
└── plans?: Plan[]
    └── usageApiUrl?: string → supports usage query for that Plan
```

## Glossary

| Chinese      | English                | Definition                                                                             |
| ------------ | ---------------------- | -------------------------------------------------------------------------------------- |
| 订阅         | Subscription           | User's access to an AI service                                                         |
| 周期性订阅   | Recurring Subscription | Regular billing cycle, periodic quota reset                                            |
| 一次性订阅   | One-time Subscription  | Single payment, use until exhausted                                                    |
| 额度重置计划 | Quota Reset Schedule   | Manually configured local tracking for quota reset timing                              |
| 计费周期     | Billing Cycle          | Payment frequency (monthly/yearly)                                                     |
| 余额         | Balance                | Prepaid credits for one-time subscriptions, can be live-queried                        |
| 用量         | Usage                  | Live quota consumption data from provider API for recurring subs                       |
| 提供商       | Provider               | AI service provider with optional query endpoint configuration                         |
| 订阅方案     | Plan                   | A provider's distinct recurring subscription offering (e.g. Coding Plan); never "套餐" |
| 分类         | Category               | Subscription grouping (AI助手, 图像生成, etc.)                                         |
