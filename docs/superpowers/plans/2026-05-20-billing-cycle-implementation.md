# Billing Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add monthly/yearly billing cycle support to subscription management system

**Architecture:** Add `billingCycle` field to Subscription type, implement migration in db layer, update form UI with conditional billing cycle selector, modify price display and statistics calculation

**Tech Stack:** Next.js 14, TypeScript, React, JSON file storage

---

## File Structure

**Modified Files:**
- `lib/types.ts` - Add BillingCycle type and update interfaces
- `lib/db.ts` - Add validation and migration logic
- `components/SubscriptionForm.tsx` - Add billing cycle selector UI
- `components/SubscriptionCard.tsx` - Update price display format
- `components/StatsCards.tsx` - Update statistics calculation
- `app/api/subscriptions/route.ts` - Handle billingCycle in API

**Created Files:**
- None (no new files needed)

---

### Task 1: Update TypeScript Type Definitions

**Files:**
- Modify: `lib/types.ts:1-88`

- [ ] **Step 1: Add BillingCycle type**

Add the new billing cycle type definition:

```typescript
export type BillingCycle = 'monthly' | 'yearly'
```

Insert after line 18 (after `SubscriptionType` definition).

- [ ] **Step 2: Update Subscription interface**

Add billingCycle field to Subscription interface:

```typescript
export interface Subscription {
  id: string
  name: string
  category: string
  provider: string
  providerCustom?: string
  subscriptionType: 'recurring' | 'one-time'
  billingCycle?: BillingCycle
  price: number
  startDate?: string
  renewalDate?: string
  status: 'active' | 'paused' | 'cancelled'
  notes?: string
  createdAt: string
  updatedAt: string
}
```

Replace the entire Subscription interface (lines 1-15).

- [ ] **Step 3: Update SubscriptionFormData interface**

Add billingCycle field:

```typescript
export interface SubscriptionFormData {
  name: string
  category: string
  provider: string
  providerCustom?: string
  subscriptionType: SubscriptionType
  billingCycle?: BillingCycle
  price: number
  startDate?: string
  renewalDate?: string
  status: SubscriptionStatus
  notes?: string
}
```

Replace lines 61-72.

- [ ] **Step 4: Verify changes**

Run: `npm run build`
Expected: Build succeeds without TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add BillingCycle type definition"
```

---

### Task 2: Update Database Layer

**Files:**
- Modify: `lib/db.ts:1-164`

- [ ] **Step 1: Add migration in readData function**

Update the data migration logic in readData():

```typescript
data.subscriptions = data.subscriptions.map(sub => ({
  ...sub,
  subscriptionType: sub.subscriptionType || 'recurring',
  billingCycle: sub.billingCycle || 'monthly'
}))
```

Replace lines 36-39.

- [ ] **Step 2: Add billingCycle validation in createSubscription**

Add validation logic after subscriptionType validation:

```typescript
const validBillingCycles: BillingCycle[] = ['monthly', 'yearly']
if (subscriptionData.billingCycle && !validBillingCycles.includes(subscriptionData.billingCycle)) {
  throw new Error('Invalid billingCycle')
}

if (subscriptionData.subscriptionType === 'recurring' && !subscriptionData.billingCycle) {
  throw new Error('billingCycle is required for recurring subscriptions')
}
```

Insert after line 77 (after subscriptionType validation).

- [ ] **Step 3: Import BillingCycle type**

Add import at the top:

```typescript
import { Subscription, SubscriptionData, SubscriptionStatus, SubscriptionType, BillingCycle, defaultCategories, defaultProviders } from './types'
```

Replace line 3.

- [ ] **Step 4: Add billingCycle validation in updateSubscription**

Add validation logic after subscriptionType validation:

```typescript
const validBillingCycles: BillingCycle[] = ['monthly', 'yearly']
if (updates.billingCycle !== undefined && !validBillingCycles.includes(updates.billingCycle)) {
  throw new Error('Invalid billingCycle value')
}
```

Insert after line 113 (after subscriptionType validation).

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts
git commit -m "feat: add billingCycle validation and migration in db layer"
```

---

### Task 3: Update Subscription Form UI

**Files:**
- Modify: `components/SubscriptionForm.tsx:1-257`

- [ ] **Step 1: Import BillingCycle type**

Add BillingCycle to imports:

```typescript
import { Subscription, SubscriptionFormData, SubscriptionStatus, SubscriptionType, BillingCycle, defaultCategories, Provider, defaultProviders } from "@/lib/types"
```

Replace line 21.

- [ ] **Step 2: Update initialFormData**

Add billingCycle field:

```typescript
const initialFormData: SubscriptionFormData = {
  name: '',
  category: defaultCategories[0],
  provider: 'other',
  providerCustom: '',
  subscriptionType: 'recurring',
  billingCycle: 'monthly',
  price: 0,
  startDate: '',
  renewalDate: '',
  status: 'active',
  notes: ''
}
```

Replace lines 31-42.

- [ ] **Step 3: Update form data mapping in useEffect**

Add billingCycle mapping when editing:

```typescript
setFormData({
  name: subscription.name,
  category: subscription.category,
  provider: subscription.provider || 'other',
  providerCustom: subscription.providerCustom || '',
  subscriptionType: subscription.subscriptionType || 'recurring',
  billingCycle: subscription.billingCycle || 'monthly',
  price: subscription.price,
  startDate: subscription.startDate || '',
  renewalDate: subscription.renewalDate || '',
  status: subscription.status,
  notes: subscription.notes || '',
})
```

Replace lines 63-74.

- [ ] **Step 4: Add billingCycle state variable**

Add after isRecurring variable:

```typescript
const billingCycle = formData.billingCycle || 'monthly'
```

Insert after line 94.

- [ ] **Step 5: Update priceLabel calculation**

Update price label based on billing cycle:

```typescript
const priceLabel = isRecurring 
  ? (billingCycle === 'yearly' ? '价格 (¥/年)' : '价格 (¥/月)')
  : '充值金额 (¥)'
```

Replace line 96.

- [ ] **Step 6: Add billing cycle selector UI**

Add billing cycle selector after subscriptionType selector:

```typescript
{isRecurring && (
  <div className="grid gap-2">
    <Label htmlFor="billingCycle">计费周期 *</Label>
    <Select
      value={billingCycle}
      onValueChange={(value) => handleInputChange('billingCycle', value as BillingCycle)}
    >
      <SelectTrigger>
        <SelectValue placeholder="选择计费周期" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="monthly">月度</SelectItem>
        <SelectItem value="yearly">年度</SelectItem>
      </SelectContent>
    </Select>
  </div>
)}
```

Insert after line 181 (after subscriptionType selector).

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add components/SubscriptionForm.tsx
git commit -m "feat: add billing cycle selector in subscription form"
```

---

### Task 4: Update Subscription Card Display

**Files:**
- Modify: `components/SubscriptionCard.tsx`

- [ ] **Step 1: Read current file**

First read the file to understand structure:
```bash
Read: components/SubscriptionCard.tsx
```

- [ ] **Step 2: Update price display format**

Find the price display section and update format based on billingCycle:

```typescript
{subscription.subscriptionType === 'one-time' 
  ? `¥${subscription.price}` 
  : subscription.billingCycle === 'yearly' 
    ? `¥${subscription.price}/年` 
    : `¥${subscription.price}/月`}
```

Replace the existing price display format.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add components/SubscriptionCard.tsx
git commit -m "feat: update price display with billing cycle format"
```

---

### Task 5: Update Statistics Cards

**Files:**
- Modify: `components/StatsCards.tsx`

- [ ] **Step 1: Read current file**

Read the file to understand current calculation logic.

- [ ] **Step 2: Update monthly total calculation**

Find monthly total calculation and update:

```typescript
const monthlyTotal = subscriptions
  .filter(s => s.status === 'active' && s.subscriptionType === 'recurring')
  .reduce((sum, s) => {
    const monthlyPrice = s.billingCycle === 'yearly' 
      ? s.price / 12 
      : s.price
    return sum + monthlyPrice
  }, 0)
```

Replace existing monthly total calculation.

- [ ] **Step 3: Update yearly total calculation**

Find yearly total calculation and update:

```typescript
const yearlyTotal = subscriptions
  .filter(s => s.status === 'active' && s.subscriptionType === 'recurring')
  .reduce((sum, s) => {
    const yearlyPrice = s.billingCycle === 'monthly' 
      ? s.price * 12 
      : s.price
    return sum + yearlyPrice
  }, 0)
```

Replace existing yearly total calculation.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add components/StatsCards.tsx
git commit -m "feat: update statistics calculation for billing cycles"
```

---

### Task 6: Update API Route

**Files:**
- Modify: `app/api/subscriptions/route.ts`

- [ ] **Step 1: Read current file**

Read the file to understand API structure.

- [ ] **Step 2: Ensure billingCycle is passed through**

Verify POST handler passes billingCycle from request body to createSubscription:

```typescript
const subscription = await createSubscription({
  name: body.name,
  category: body.category,
  provider: body.provider,
  providerCustom: body.providerCustom,
  subscriptionType: body.subscriptionType,
  billingCycle: body.billingCycle,
  price: body.price,
  startDate: body.startDate,
  renewalDate: body.renewalDate,
  status: body.status,
  notes: body.notes,
})
```

Ensure billingCycle is included in the call.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add app/api/subscriptions/route.ts
git commit -m "feat: pass billingCycle through API route"
```

---

### Task 7: Testing and Verification

- [ ] **Step 1: Start development server**

Run: `source ~/.nvm/nvm.sh && npm run dev`
Expected: Server starts at http://localhost:3000

- [ ] **Step 2: Test monthly billing subscription**

1. Open http://localhost:3000
2. Add new subscription with:
   - Name: "Test Monthly"
   - Subscription Type: "周期性订阅"
   - Billing Cycle: "月度"
   - Price: 100
3. Verify price displays as "¥100/月"
4. Check statistics show ¥100 monthly, ¥1200 yearly

- [ ] **Step 3: Test yearly billing subscription**

1. Add new subscription with:
   - Name: "Test Yearly"
   - Subscription Type: "周期性订阅"
   - Billing Cycle: "年度"
   - Price: 1200
2. Verify price displays as "¥1200/年"
3. Check statistics show ¥100 monthly (1200/12), ¥1200 yearly

- [ ] **Step 4: Test existing data migration**

1. Check existing subscriptions in the list
2. Verify they display with "/月" suffix (default monthly)
3. Verify statistics are unchanged for existing data

- [ ] **Step 5: Test edit functionality**

1. Edit an existing subscription
2. Change billing cycle from monthly to yearly
3. Save and verify display updates correctly
4. Verify statistics update accordingly

- [ ] **Step 6: Test one-time subscriptions**

1. Add one-time subscription
2. Verify billing cycle selector is hidden
3. Verify price displays as plain ¥XX (no suffix)

- [ ] **Step 7: Stop development server**

Stop the dev server process.

- [ ] **Step 8: Final build verification**

Run: `npm run build`
Expected: Production build succeeds

- [ ] **Step 9: Final commit if needed**

If any files were modified during testing:

```bash
git add -A
git commit -m "fix: any adjustments from testing"
```

---

## Success Criteria

1. ✅ Monthly subscriptions display "¥XX/月"
2. ✅ Yearly subscriptions display "¥XX/年"
3. ✅ Statistics correctly calculate monthly/yearly totals
4. ✅ Existing data defaults to monthly billing cycle
5. ✅ Form validation prevents invalid billingCycle values
6. ✅ One-time subscriptions don't show billing cycle selector
7. ✅ Production build succeeds