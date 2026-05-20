# 计费周期支持设计文档

## 概述

为订阅管理系统添加月度和年度计费周期支持，允许用户为周期性订阅选择计费周期（月度或年度），并根据选择填写对应的价格。

## 背景

当前系统只支持单一价格字段，默认以"¥/月"为单位显示周期性订阅价格。实际使用中，部分订阅按年度计费（如 GitHub Copilot、某些云服务等），需要更灵活的计费周期支持。

## 设计目标

1. 支持月度和年度两种计费周期
2. 向后兼容现有数据（默认为月度）
3. 保持简单直观的用户体验
4. 统计计算准确反映不同计费周期的费用

## 技术方案

### 方案选择

采用方案 A：添加独立 `billingCycle` 字段，保持现有 `price` 字段不变。

**理由：**
- 改动最小，向后兼容性最好
- 符合 YAGNI 原则，不过度设计
- 实现简单，风险低

### 数据结构变更

#### TypeScript 类型定义

**文件：** `lib/types.ts`

```typescript
// 新增计费周期类型
export type BillingCycle = 'monthly' | 'yearly'

export interface Subscription {
  id: string
  name: string
  category: string
  provider: string
  providerCustom?: string
  subscriptionType: 'recurring' | 'one-time'
  billingCycle?: BillingCycle  // 新增：周期性订阅必填
  price: number
  startDate?: string
  renewalDate?: string
  status: 'active' | 'paused' | 'cancelled'
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface SubscriptionFormData {
  name: string
  category: string
  provider: string
  providerCustom?: string
  subscriptionType: SubscriptionType
  billingCycle?: BillingCycle  // 新增
  price: number
  startDate?: string
  renewalDate?: string
  status: SubscriptionStatus
  notes?: string
}
```

**说明：**
- `billingCycle` 为可选字段，因为一次性充值不需要此字段
- 周期性订阅创建/更新时，前端必须填写此字段

### 数据库层变更

**文件：** `lib/db.ts`

#### 迁移策略

在 `readData()` 函数中，为历史数据自动补充默认计费周期：

```typescript
data.subscriptions = data.subscriptions.map(sub => ({
  ...sub,
  subscriptionType: sub.subscriptionType || 'recurring',
  billingCycle: sub.billingCycle || 'monthly'  // 新增默认值
}))
```

#### 验证逻辑

**createSubscription():**
- 当 `subscriptionType === 'recurring'` 时，验证 `billingCycle` 必须存在且为合法值

**updateSubscription():**
- 验证 `billingCycle` 值必须为 `'monthly'` 或 `'yearly'`（如果提供）

```typescript
const validBillingCycles: BillingCycle[] = ['monthly', 'yearly']
if (subscriptionData.billingCycle && !validBillingCycles.includes(subscriptionData.billingCycle)) {
  throw new Error('Invalid billingCycle')
}

if (subscriptionData.subscriptionType === 'recurring' && !subscriptionData.billingCycle) {
  throw new Error('billingCycle is required for recurring subscriptions')
}
```

### 表单 UI 变更

**文件：** `components/SubscriptionForm.tsx`

#### 字段顺序
```
名称 → 分类 → 提供商 → 订阅类型 → [计费周期] → 价格 → 开始日期 → 续费日期 → 状态 → 备注
```

#### 显示逻辑

- **订阅类型 = 'recurring'：**
  - 显示计费周期下拉框（月度/年度）
  - 显示开始日期和续费日期字段
  - 价格标签动态显示：
    - 月度 → "价格 (¥/月)"
    - 年度 → "价格 (¥/年)"

- **订阅类型 = 'one-time'：**
  - 隐藏计费周期字段
  - 隐藏开始日期和续费日期字段
  - 价格标签显示为 "充值金额 (¥)"

#### 初始值

- 新建周期性订阅时，`billingCycle` 默认为 `'monthly'`
- 编辑订阅时，使用订阅数据的 `billingCycle` 值

#### UI 实现

```tsx
{isRecurring && (
  <div className="grid gap-2">
    <Label htmlFor="billingCycle">计费周期 *</Label>
    <Select
      value={formData.billingCycle || 'monthly'}
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

### 展示层变更

#### 订阅卡片

**文件：** `components/SubscriptionCard.tsx`

价格显示逻辑：
- 周期性订阅 + 月度：显示 "¥XX/月"
- 周期性订阅 + 年度：显示 "¥XX/年"
- 一次性充值：显示 "¥XX"

```tsx
const formatPrice = (subscription: Subscription) => {
  if (subscription.subscriptionType === 'one-time') {
    return `¥${subscription.price}`
  }
  return subscription.billingCycle === 'yearly' 
    ? `¥${subscription.price}/年`
    : `¥${subscription.price}/月`
}
```

#### 统计卡片

**文件：** `components/StatsCards.tsx`

统计计算逻辑：
- **月度消费：**
  - 月度计费订阅：价格直接计入
  - 年度计费订阅：价格 ÷ 12 计入
  
- **年度消费：**
  - 月度计费订阅：价格 × 12
  - 年度计费订阅：价格直接计入

```typescript
const calculateMonthlyTotal = (subscriptions: Subscription[]) => {
  return subscriptions
    .filter(s => s.status === 'active' && s.subscriptionType === 'recurring')
    .reduce((sum, s) => {
      const monthlyPrice = s.billingCycle === 'yearly' 
        ? s.price / 12 
        : s.price
      return sum + monthlyPrice
    }, 0)
}

const calculateYearlyTotal = (subscriptions: Subscription[]) => {
  return subscriptions
    .filter(s => s.status === 'active' && s.subscriptionType === 'recurring')
    .reduce((sum, s) => {
      const yearlyPrice = s.billingCycle === 'monthly' 
        ? s.price * 12 
        : s.price
      return sum + yearlyPrice
    }, 0)
}
```

#### 订阅列表

**文件：** `components/SubscriptionList.tsx`

使用相同的 `formatPrice` 函数显示价格。

### API 层变更

**文件：** `app/api/subscriptions/route.ts`, `app/api/subscriptions/[id]/route.ts`

#### POST /api/subscriptions
- 接收包含 `billingCycle` 的请求体
- 调用 `createSubscription()` 时传递完整数据

#### PUT /api/subscriptions/[id]
- 接收包含 `billingCycle` 的更新数据
- 调用 `updateSubscription()` 时传递完整数据

#### GET /api/subscriptions
- 返回包含 `billingCycle` 字段的订阅列表（迁移后的数据）

## 数据迁移

### 现有数据处理

- 所有现有订阅的 `billingCycle` 自动设置为 `'monthly'`
- 用户无需手动操作，系统启动时自动完成迁移
- 数据文件无需修改，`readData()` 函数处理兼容性

### 测试数据验证

- 启动系统后检查现有订阅的计费周期显示
- 验证统计数据计算正确

## 实现顺序

1. 类型定义更新 (`lib/types.ts`)
2. 数据库层更新 (`lib/db.ts`)
3. 表单 UI 更新 (`components/SubscriptionForm.tsx`)
4. 展示层更新 (`components/SubscriptionCard.tsx`, `components/StatsCards.tsx`)
5. API 层更新 (`app/api/subscriptions/*`)
6. 测试验证

## 测试要点

### 功能测试
- 创建月度计费订阅，验证价格显示和统计
- 创建年度计费订阅，验证价格显示和统计
- 编辑订阅修改计费周期，验证数据更新
- 查看历史订阅，验证默认计费周期正确

### 数据验证
- 验证 `billingCycle` 字段必填逻辑（周期性订阅）
- 验证非法 `billingCycle` 值被拒绝
- 验证一次性充值不显示计费周期选项

### UI 测试
- 验证价格标签根据计费周期动态显示
- 验证计费周期选择器仅在周期性订阅时显示
- 验证统计卡片计算正确

## 限制与边界

- 不支持同时填写月度和年度价格（单选模式）
- 计费周期仅适用于周期性订阅
- 历史数据默认为月度，无手动迁移选项

## 未来扩展可能性

- 如果需要支持一个订阅有多种计费方式，可考虑方案 B（价格对象化）
- 可添加计费周期转换工具（月度 ↔ 年度）
- 可添加价格比较功能（月度 vs 年度优惠分析）