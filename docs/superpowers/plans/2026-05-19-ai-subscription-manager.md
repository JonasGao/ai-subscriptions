# AI 订阅管理工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个个人 AI 服务订阅管理工具，支持订阅管理、分类筛选、费用统计和图表分析。

**Architecture:** Next.js 14 App Router + TypeScript + Tailwind CSS + shadcn/ui，数据存储在本地 JSON 文件，通过 API Routes 进行读写操作。

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, Recharts, UUID

---

## File Structure

### 创建的文件

```
ai-subscriptions/
├── package.json                         # 项目配置和依赖
├── tsconfig.json                        # TypeScript 配置
├── next.config.js                       # Next.js 配置
├── tailwind.config.ts                   # Tailwind 配置
├── postcss.config.js                    # PostCSS 配置
├── app/
│   ├── layout.tsx                       # 全局布局
│   ├── page.tsx                         # 首页
│   ├── globals.css                      # 全局样式
│   └── api/
│       ├── subscriptions/
│       │   ├── route.ts                 # 订阅列表 API
│       │   └── [id]/route.ts            # 单个订阅 API
│       └── categories/
│           └── route.ts                 # 分类 API
├── components/
│   ├── ui/                              # shadcn/ui 组件
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── select.tsx
│   │   └── badge.tsx
│   ├── SubscriptionList.tsx             # 订阅列表
│   ├── SubscriptionCard.tsx             # 订阅卡片
│   ├── SubscriptionForm.tsx             # 订阅表单
│   ├── StatsCard.tsx                    # 统计卡片
│   ├── CategoryPieChart.tsx             # 分类饼图
│   └── CategoryFilter.tsx               # 分类筛选
├── lib/
│   ├── types.ts                         # 类型定义
│   ├── db.ts                            # 数据库操作
│   └── utils.ts                         # 工具函数
└── data/
    └── subscriptions.json                # 数据文件（初始为空）
```

---

## Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.js`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `app/globals.css`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "ai-subscriptions",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7",
    "uuid": "^9.0.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.3.0",
    "lucide-react": "^0.378.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "@types/react": "^18.3.2",
    "@types/react-dom": "^18.3.0",
    "@types/uuid": "^9.0.8",
    "typescript": "^5.4.5",
    "tailwindcss": "^3.4.3",
    "postcss": "^8.4.38",
    "autoprefixer": "^10.4.19",
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.3"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: 创建 next.config.js**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {}

module.exports = nextConfig
```

- [ ] **Step 4: 创建 tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 5: 创建 postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 6: 创建 app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 7: 安装依赖**

Run: `source ~/.nvm/nvm.sh && npm install`

Expected: 安装完成，无错误

- [ ] **Step 8: Commit 初始化配置**

```bash
git add package.json tsconfig.json next.config.js tailwind.config.ts postcss.config.js app/globals.css
git commit -m "feat: initialize Next.js project with TypeScript and Tailwind"
```

---

## Task 2: 类型定义和工具函数

**Files:**
- Create: `lib/types.ts`
- Create: `lib/utils.ts`
- Create: `lib/db.ts`
- Create: `data/subscriptions.json`

- [ ] **Step 1: 创建 lib/types.ts**

```typescript
export interface Subscription {
  id: string
  name: string
  category: string
  price: number
  startDate: string
  renewalDate: string
  status: 'active' | 'paused' | 'cancelled'
  notes?: string
  createdAt: string
  updatedAt: string
}

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'

export interface SubscriptionData {
  subscriptions: Subscription[]
  categories: string[]
}

export const defaultCategories: string[] = [
  'AI助手',
  '图像生成',
  '代码工具',
  '写作工具',
  '数据分析',
  '其他'
]

export interface SubscriptionFormData {
  name: string
  category: string
  price: number
  startDate: string
  renewalDate: string
  status: SubscriptionStatus
  notes?: string
}
```

- [ ] **Step 2: 创建 lib/utils.ts**

```typescript
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Subscription } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateMonthlyTotal(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(s => s.status === 'active')
    .reduce((total, s) => total + s.price, 0)
}

export function calculateYearlyTotal(subscriptions: Subscription[]): number {
  return calculateMonthlyTotal(subscriptions) * 12
}

export function calculateCategoryStats(subscriptions: Subscription[]): Record<string, number> {
  const stats: Record<string, number> = {}
  
  subscriptions
    .filter(s => s.status === 'active')
    .forEach(s => {
      if (!stats[s.category]) {
        stats[s.category] = 0
      }
      stats[s.category] += s.price
    })
  
  return stats
}

export function getDaysUntilRenewal(renewalDate: string): number {
  const renewal = new Date(renewalDate)
  const today = new Date()
  const diffTime = renewal.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}

export function isExpiringSoon(renewalDate: string): boolean {
  const days = getDaysUntilRenewal(renewalDate)
  return days >= 0 && days <= 7
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
```

- [ ] **Step 3: 创建 lib/db.ts**

```typescript
import fs from 'fs'
import path from 'path'
import { Subscription, SubscriptionData, defaultCategories } from './types'
import { v4 as uuidv4 } from 'uuid'

const dataDir = path.join(process.cwd(), 'data')
const dataFile = path.join(dataDir, 'subscriptions.json')

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function getInitialData(): SubscriptionData {
  return {
    subscriptions: [],
    categories: defaultCategories
  }
}

export function readData(): SubscriptionData {
  ensureDataDir()
  
  if (!fs.existsSync(dataFile)) {
    const initialData = getInitialData()
    fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2))
    return initialData
  }
  
  const fileContent = fs.readFileSync(dataFile, 'utf-8')
  return JSON.parse(fileContent) as SubscriptionData
}

export function writeData(data: SubscriptionData): void {
  ensureDataDir()
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2))
}

export function getSubscriptions(): Subscription[] {
  const data = readData()
  return data.subscriptions
}

export function getSubscriptionById(id: string): Subscription | null {
  const subscriptions = getSubscriptions()
  return subscriptions.find(s => s.id === id) || null
}

export function createSubscription(subscriptionData: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Subscription {
  const data = readData()
  const now = new Date().toISOString()
  
  const newSubscription: Subscription = {
    ...subscriptionData,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now
  }
  
  data.subscriptions.push(newSubscription)
  writeData(data)
  
  return newSubscription
}

export function updateSubscription(id: string, updates: Partial<Omit<Subscription, 'id' | 'createdAt'>>): Subscription | null {
  const data = readData()
  const index = data.subscriptions.findIndex(s => s.id === id)
  
  if (index === -1) {
    return null
  }
  
  data.subscriptions[index] = {
    ...data.subscriptions[index],
    ...updates,
    updatedAt: new Date().toISOString()
  }
  
  writeData(data)
  return data.subscriptions[index]
}

export function deleteSubscription(id: string): boolean {
  const data = readData()
  const index = data.subscriptions.findIndex(s => s.id === id)
  
  if (index === -1) {
    return false
  }
  
  data.subscriptions.splice(index, 1)
  writeData(data)
  return true
}

export function getCategories(): string[] {
  const data = readData()
  return data.categories
}

export function addCategory(category: string): string[] {
  const data = readData()
  
  if (data.categories.includes(category)) {
    return data.categories
  }
  
  data.categories.push(category)
  writeData(data)
  return data.categories
}
```

- [ ] **Step 4: 创建 data 目录和初始数据文件**

```bash
mkdir -p data
```

然后创建 `data/subscriptions.json`:

```json
{
  "subscriptions": [],
  "categories": [
    "AI助手",
    "图像生成",
    "代码工具",
    "写作工具",
    "数据分析",
    "其他"
  ]
}
```

- [ ] **Step 5: Commit 类型定义和数据库操作**

```bash
git add lib/types.ts lib/utils.ts lib/db.ts data/subscriptions.json
git commit -m "feat: add types, utils and database operations"
```

---

## Task 3: API Routes - 订阅管理

**Files:**
- Create: `app/api/subscriptions/route.ts`
- Create: `app/api/subscriptions/[id]/route.ts`

- [ ] **Step 1: 创建 app/api/subscriptions/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptions, createSubscription } from '@/lib/db'
import { SubscriptionFormData } from '@/lib/types'

export async function GET() {
  try {
    const subscriptions = getSubscriptions()
    return NextResponse.json(subscriptions)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SubscriptionFormData = await request.json()
    
    if (!body.name || !body.category || !body.price || !body.startDate || !body.renewalDate) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }
    
    const newSubscription = createSubscription({
      name: body.name,
      category: body.category,
      price: body.price,
      startDate: body.startDate,
      renewalDate: body.renewalDate,
      status: body.status || 'active',
      notes: body.notes
    })
    
    return NextResponse.json(newSubscription)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: 创建 app/api/subscriptions/[id]/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptionById, updateSubscription, deleteSubscription } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const subscription = getSubscriptionById(params.id)
    
    if (!subscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(subscription)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch subscription' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const updatedSubscription = updateSubscription(params.id, body)
    
    if (!updatedSubscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(updatedSubscription)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update subscription' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = deleteSubscription(params.id)
    
    if (!deleted) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete subscription' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Commit 订阅 API**

```bash
git add app/api/subscriptions/route.ts app/api/subscriptions/[id]/route.ts
git commit -m "feat: add subscriptions API routes"
```

---

## Task 4: API Routes - 分类管理

**Files:**
- Create: `app/api/categories/route.ts`

- [ ] **Step 1: 创建 app/api/categories/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getCategories, addCategory } from '@/lib/db'

export async function GET() {
  try {
    const categories = getCategories()
    return NextResponse.json(categories)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    if (!body.category) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      )
    }
    
    const categories = addCategory(body.category)
    return NextResponse.json(categories)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to add category' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Commit 分类 API**

```bash
git add app/api/categories/route.ts
git commit -m "feat: add categories API route"
```

---

## Task 5: shadcn/ui 组件

**Files:**
- Create: `components/ui/button.tsx`
- Create: `components/ui/card.tsx`
- Create: `components/ui/dialog.tsx`
- Create: `components/ui/input.tsx`
- Create: `components/ui/label.tsx`
- Create: `components/ui/select.tsx`
- Create: `components/ui/badge.tsx`

- [ ] **Step 1: 创建 components/ui/button.tsx**

```typescript
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

- [ ] **Step 2: 创建 components/ui/card.tsx**

```typescript
import * as React from 'react'
import { cn } from '@/lib/utils'

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border bg-card text-card-foreground shadow-sm',
      className
    )}
    {...props}
  />
))
Card.displayName = 'Card'

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 p-6', className)}
    {...props}
  />
))
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'text-2xl font-semibold leading-none tracking-tight',
      className
    )}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
))
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center p-6 pt-0', className)}
    {...props}
  />
))
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
```

- [ ] **Step 3: 创建 components/ui/dialog.tsx**

```typescript
'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className='absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground'>
        <X className='h-4 w-4' />
        <span className='sr-only'>Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
```

- [ ] **Step 4: 安装 Radix UI dialog 依赖**

Run: `source ~/.nvm/nvm.sh && npm install @radix-ui/react-dialog`

Expected: 安装成功

- [ ] **Step 5: 创建 components/ui/input.tsx**

```typescript
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
```

- [ ] **Step 6: 创建 components/ui/label.tsx**

```typescript
'use client'

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
)

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
```

- [ ] **Step 7: 安装 Radix UI label 依赖**

Run: `source ~/.nvm/nvm.sh && npm install @radix-ui/react-label`

Expected: 安装成功

- [ ] **Step 8: 创建 components/ui/select.tsx**

```typescript
'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className='h-4 w-4 opacity-50' />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1',
      className
    )}
    {...props}
  >
    <ChevronUp className='h-4 w-4' />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1',
      className
    )}
    {...props}
  >
    <ChevronDown className='h-4 w-4' />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('py-1.5 pl-8 pr-2 text-sm font-semibold', className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className='absolute left-2 flex h-3.5 w-3.5 items-center justify-center'>
      <SelectPrimitive.ItemIndicator>
        <Check className='h-4 w-4' />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-muted', className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
```

- [ ] **Step 9: 安装 Radix UI select 依赖**

Run: `source ~/.nvm/nvm.sh && npm install @radix-ui/react-select`

Expected: 安装成功

- [ ] **Step 10: 创建 components/ui/badge.tsx**

```typescript
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        success:
          'border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        warning:
          'border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
```

- [ ] **Step 11: Commit shadcn/ui 组件**

```bash
git add components/ui/
git commit -m "feat: add shadcn/ui components"
```

---

## Task 6: 统计卡片组件

**Files:**
- Create: `components/StatsCard.tsx`

- [ ] **Step 1: 创建 components/StatsCard.tsx**

```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Subscription } from '@/lib/types'
import { calculateMonthlyTotal, calculateYearlyTotal } from '@/lib/utils'

interface StatsCardsProps {
  subscriptions: Subscription[]
}

export function StatsCards({ subscriptions }: StatsCardsProps) {
  const monthlyTotal = calculateMonthlyTotal(subscriptions)
  const yearlyTotal = calculateYearlyTotal(subscriptions)
  const activeCount = subscriptions.filter(s => s.status === 'active').length

  return (
    <div className='grid gap-4 md:grid-cols-3'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
          <CardTitle className='text-sm font-medium'>月费用</CardTitle>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            className='h-4 w-4 text-muted-foreground'
          >
            <path d='M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' />
          </svg>
        </CardHeader>
        <CardContent>
          <div className='text-2xl font-bold'>¥{monthlyTotal.toFixed(2)}</div>
          <p className='text-xs text-muted-foreground'>
            {activeCount} 个活跃订阅
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
          <CardTitle className='text-sm font-medium'>年费用</CardTitle>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            className='h-4 w-4 text-muted-foreground'
          >
            <rect width='20' height='14' x='2' y='5' rx='2' />
            <path d='M2 10h20' />
          </svg>
        </CardHeader>
        <CardContent>
          <div className='text-2xl font-bold'>¥{yearlyTotal.toFixed(2)}</div>
          <p className='text-xs text-muted-foreground'>
            预计年度支出
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
          <CardTitle className='text-sm font-medium'>活跃订阅</CardTitle>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            className='h-4 w-4 text-muted-foreground'
          >
            <path d='M22 12h-4l-3 9L9 3l-3 9H2' />
          </svg>
        </CardHeader>
        <CardContent>
          <div className='text-2xl font-bold'>{activeCount}</div>
          <p className='text-xs text-muted-foreground'>
            共 {subscriptions.length} 个订阅
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Commit 统计卡片组件**

```bash
git add components/StatsCard.tsx
git commit -m "feat: add StatsCards component"
```

---

## Task 7: 分类饼图组件

**Files:**
- Create: `components/CategoryPieChart.tsx`

- [ ] **Step 1: 创建 components/CategoryPieChart.tsx**

```typescript
'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { Subscription } from '@/lib/types'
import { calculateCategoryStats } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface CategoryPieChartProps {
  subscriptions: Subscription[]
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D']

export function CategoryPieChart({ subscriptions }: CategoryPieChartProps) {
  const categoryStats = calculateCategoryStats(subscriptions)
  
  const data = Object.entries(categoryStats).map(([name, value]) => ({
    name,
    value
  }))

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>分类费用占比</CardTitle>
        </CardHeader>
        <CardContent className='flex items-center justify-center h-[300px]'>
          <p className='text-muted-foreground'>暂无数据</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>分类费用占比</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width='100%' height={300}>
          <PieChart>
            <Pie
              data={data}
              cx='50%'
              cy='50%'
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill='#8884d8'
              dataKey='value'
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number) => `¥${value.toFixed(2)}`}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit 分类饼图组件**

```bash
git add components/CategoryPieChart.tsx
git commit -m "feat: add CategoryPieChart component"
```

---

## Task 8: 订阅卡片组件

**Files:**
- Create: `components/SubscriptionCard.tsx`

- [ ] **Step 1: 创建 components/SubscriptionCard.tsx**

```typescript
'use client'

import { Subscription } from '@/lib/types'
import { formatDate, getDaysUntilRenewal, isExpiringSoon } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2 } from 'lucide-react'

interface SubscriptionCardProps {
  subscription: Subscription
  onEdit: (subscription: Subscription) => void
  onDelete: (id: string) => void
}

const statusLabels = {
  active: '活跃',
  paused: '暂停',
  cancelled: '已取消'
}

const statusVariants = {
  active: 'success' as const,
  paused: 'warning' as const,
  cancelled: 'outline' as const
}

export function SubscriptionCard({ subscription, onEdit, onDelete }: SubscriptionCardProps) {
  const daysUntilRenewal = getDaysUntilRenewal(subscription.renewalDate)
  const expiringSoon = isExpiringSoon(subscription.renewalDate) && subscription.status === 'active'

  return (
    <Card className={expiringSoon ? 'border-orange-500' : ''}>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-lg font-medium'>{subscription.name}</CardTitle>
        <div className='flex gap-2'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => onEdit(subscription)}
          >
            <Pencil className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => onDelete(subscription.id)}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className='flex items-center gap-2 mb-2'>
          <Badge variant='outline'>{subscription.category}</Badge>
          <Badge variant={statusVariants[subscription.status]}>
            {statusLabels[subscription.status]}
          </Badge>
          {expiringSoon && (
            <Badge variant='warning'>即将到期</Badge>
          )}
        </div>
        <div className='text-2xl font-bold'>¥{subscription.price}/月</div>
        <p className='text-sm text-muted-foreground mt-2'>
          续费日期: {formatDate(subscription.renewalDate)}
          {subscription.status === 'active' && daysUntilRenewal >= 0 && (
            <span className={expiringSoon ? 'text-orange-500' : ''}>
              {' '}({daysUntilRenewal}天后)
            </span>
          )}
        </p>
        {subscription.notes && (
          <p className='text-xs text-muted-foreground mt-1'>
            备注: {subscription.notes}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Commit 订阅卡片组件**

```bash
git add components/SubscriptionCard.tsx
git commit -m "feat: add SubscriptionCard component"
```

---

## Task 9: 订阅表单组件

**Files:**
- Create: `components/SubscriptionForm.tsx`

- [ ] **Step 1: 创建 components/SubscriptionForm.tsx**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Subscription, SubscriptionFormData, SubscriptionStatus } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface SubscriptionFormProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: SubscriptionFormData) => void
  subscription?: Subscription
  categories: string[]
}

const statusOptions: { value: SubscriptionStatus; label: string }[] = [
  { value: 'active', label: '活跃' },
  { value: 'paused', label: '暂停' },
  { value: 'cancelled', label: '已取消' },
]

export function SubscriptionForm({
  open,
  onClose,
  onSubmit,
  subscription,
  categories,
}: SubscriptionFormProps) {
  const [formData, setFormData] = useState<SubscriptionFormData>({
    name: '',
    category: categories[0] || '',
    price: 0,
    startDate: '',
    renewalDate: '',
    status: 'active',
    notes: '',
  })

  useEffect(() => {
    if (subscription) {
      setFormData({
        name: subscription.name,
        category: subscription.category,
        price: subscription.price,
        startDate: subscription.startDate,
        renewalDate: subscription.renewalDate,
        status: subscription.status,
        notes: subscription.notes || '',
      })
    } else {
      setFormData({
        name: '',
        category: categories[0] || '',
        price: 0,
        startDate: '',
        renewalDate: '',
        status: 'active',
        notes: '',
      })
    }
  }, [subscription, categories])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className='sm:max-w-[425px]'>
        <DialogHeader>
          <DialogTitle>
            {subscription ? '编辑订阅' : '新增订阅'}
          </DialogTitle>
          <DialogDescription>
            {subscription ? '修改订阅信息' : '添加一个新的 AI 服务订阅'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label htmlFor='name'>服务名称</Label>
              <Input
                id='name'
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder='例如: ChatGPT Plus'
                required
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='category'>分类</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder='选择分类' />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='price'>月费 (人民币)</Label>
              <Input
                id='price'
                type='number'
                step='0.01'
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                placeholder='例如: 145'
                required
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='startDate'>订阅开始日期</Label>
              <Input
                id='startDate'
                type='date'
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='renewalDate'>下次续费日期</Label>
              <Input
                id='renewalDate'
                type='date'
                value={formData.renewalDate}
                onChange={(e) => setFormData({ ...formData, renewalDate: e.target.value })}
                required
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='status'>状态</Label>
              <Select
                value={formData.status}
                onValueChange={(value: SubscriptionStatus) =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder='选择状态' />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='notes'>备注 (可选)</Label>
              <Input
                id='notes'
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder='例如: 个人使用'
              />
            </div>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              取消
            </Button>
            <Button type='submit'>
              {subscription ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit 订阅表单组件**

```bash
git add components/SubscriptionForm.tsx
git commit -m "feat: add SubscriptionForm component"
```

---

## Task 10: 订阅列表组件

**Files:**
- Create: `components/SubscriptionList.tsx`

- [ ] **Step 1: 创建 components/SubscriptionList.tsx**

```typescript
'use client'

import { Subscription } from '@/lib/types'
import { SubscriptionCard } from './SubscriptionCard'

interface SubscriptionListProps {
  subscriptions: Subscription[]
  onEdit: (subscription: Subscription) => void
  onDelete: (id: string) => void
}

export function SubscriptionList({ subscriptions, onEdit, onDelete }: SubscriptionListProps) {
  if (subscriptions.length === 0) {
    return (
      <div className='text-center py-8'>
        <p className='text-muted-foreground'>暂无订阅</p>
      </div>
    )
  }

  return (
    <div className='grid gap-4'>
      {subscriptions.map((subscription) => (
        <SubscriptionCard
          key={subscription.id}
          subscription={subscription}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit 订阅列表组件**

```bash
git add components/SubscriptionList.tsx
git commit -m "feat: add SubscriptionList component"
```

---

## Task 11: 分类筛选组件

**Files:**
- Create: `components/CategoryFilter.tsx`

- [ ] **Step 1: 创建 components/CategoryFilter.tsx**

```typescript
'use client'

import { Subscription, SubscriptionStatus } from '@/lib/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CategoryFilterProps {
  categories: string[]
  selectedCategory: string
  selectedStatus: string
  onCategoryChange: (category: string) => void
  onStatusChange: (status: string) => void
}

const statusOptions: { value: string; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '活跃' },
  { value: 'paused', label: '暂停' },
  { value: 'cancelled', label: '已取消' },
]

export function CategoryFilter({
  categories,
  selectedCategory,
  selectedStatus,
  onCategoryChange,
  onStatusChange,
}: CategoryFilterProps) {
  return (
    <div className='flex gap-4'>
      <Select value={selectedCategory} onValueChange={onCategoryChange}>
        <SelectTrigger className='w-[180px]'>
          <SelectValue placeholder='选择分类' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>全部分类</SelectItem>
          {categories.map((category) => (
            <SelectItem key={category} value={category}>
              {category}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedStatus} onValueChange={onStatusChange}>
        <SelectTrigger className='w-[180px]'>
          <SelectValue placeholder='选择状态' />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 2: Commit 分类筛选组件**

```bash
git add components/CategoryFilter.tsx
git commit -m "feat: add CategoryFilter component"
```

---

## Task 12: 全局布局

**Files:**
- Create: `app/layout.tsx`

- [ ] **Step 1: 创建 app/layout.tsx**

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AI 订阅管理',
  description: '管理您的 AI 服务订阅',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang='zh-CN'>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Commit 全局布局**

```bash
git add app/layout.tsx
git commit -m "feat: add root layout"
```

---

## Task 13: 首页实现

**Files:**
- Create: `app/page.tsx`

- [ ] **Step 1: 创建 app/page.tsx**

```typescript
'use client'

import { useState, useEffect } from 'react'
import { Subscription, SubscriptionFormData } from '@/lib/types'
import { StatsCards } from '@/components/StatsCard'
import { CategoryPieChart } from '@/components/CategoryPieChart'
import { SubscriptionList } from '@/components/SubscriptionList'
import { SubscriptionForm } from '@/components/SubscriptionForm'
import { CategoryFilter } from '@/components/CategoryFilter'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default function Home() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingSubscription, setEditingSubscription] = useState<Subscription | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [subsRes, catsRes] = await Promise.all([
        fetch('/api/subscriptions'),
        fetch('/api/categories'),
      ])
      const subsData = await subsRes.json()
      const catsData = await catsRes.json()
      setSubscriptions(subsData)
      setCategories(catsData)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredSubscriptions = subscriptions.filter((sub) => {
    const categoryMatch = selectedCategory === 'all' || sub.category === selectedCategory
    const statusMatch = selectedStatus === 'all' || sub.status === selectedStatus
    return categoryMatch && statusMatch
  })

  const handleAdd = () => {
    setEditingSubscription(undefined)
    setFormOpen(true)
  }

  const handleEdit = (subscription: Subscription) => {
    setEditingSubscription(subscription)
    setFormOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个订阅吗？')) return

    try {
      await fetch(`/api/subscriptions/${id}`, {
        method: 'DELETE',
      })
      loadData()
    } catch (error) {
      console.error('Failed to delete subscription:', error)
    }
  }

  const handleSubmit = async (data: SubscriptionFormData) => {
    try {
      if (editingSubscription) {
        await fetch(`/api/subscriptions/${editingSubscription.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      } else {
        await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
      }
      loadData()
    } catch (error) {
      console.error('Failed to save subscription:', error)
    }
  }

  if (loading) {
    return (
      <main className='container mx-auto p-8'>
        <div className='text-center'>加载中...</div>
      </main>
    )
  }

  return (
    <main className='container mx-auto p-8'>
      <div className='flex items-center justify-between mb-8'>
        <h1 className='text-3xl font-bold'>AI 订阅管理</h1>
        <Button onClick={handleAdd}>
          <Plus className='mr-2 h-4 w-4' />
          新增订阅
        </Button>
      </div>

      <div className='space-y-8'>
        <StatsCards subscriptions={subscriptions} />

        <div className='flex items-center gap-4'>
          <CategoryFilter
            categories={categories}
            selectedCategory={selectedCategory}
            selectedStatus={selectedStatus}
            onCategoryChange={setSelectedCategory}
            onStatusChange={setSelectedStatus}
          />
        </div>

        <div className='grid gap-8 md:grid-cols-[1fr_400px]'>
          <SubscriptionList
            subscriptions={filteredSubscriptions}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
          <CategoryPieChart subscriptions={subscriptions} />
        </div>
      </div>

      <SubscriptionForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        subscription={editingSubscription}
        categories={categories}
      />
    </main>
  )
}
```

- [ ] **Step 2: Commit 首页**

```bash
git add app/page.tsx
git commit -m "feat: add main page with subscription management"
```

---

## Task 14: 验证和测试

- [ ] **Step 1: 启动开发服务器**

Run: `source ~/.nvm/nvm.sh && npm run dev`

Expected: 服务器启动成功，监听在 http://localhost:3000

- [ ] **Step 2: 测试基本功能**

手动测试:
1. 打开浏览器访问 http://localhost:3000
2. 点击"新增订阅"按钮
3. 填写表单并提交
4. 检查订阅是否出现在列表中
5. 检查统计卡片数据是否正确
6. 检查分类饼图是否显示
7. 测试编辑功能
8. 测试删除功能
9. 测试筛选功能

- [ ] **Step 3: 检查代码质量**

Run: `source ~/.nvm/nvm.sh && npm run lint`

Expected: 无 lint 错误

- [ ] **Step 4: 构建测试**

Run: `source ~/.nvm/nvm.sh && npm run build`

Expected: 构建成功

---

## Task 15: 创建 README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 创建 README.md**

```markdown
# AI 订阅管理工具

一个用于管理个人 AI 服务订阅的工具，支持订阅管理、分类筛选、费用统计和图表分析。

## 功能特性

- 订阅管理：新增、编辑、删除订阅
- 分类管理：预设分类和自定义分类
- 费用统计：月度、年度总费用计算
- 图表分析：分类占比饼图
- 到期提醒：即将到期的订阅高亮显示
- 状态管理：活跃、暂停、已取消三种状态

## 技术栈

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Recharts

## 安装和运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 启动生产服务器
npm start
```

## 数据存储

数据存储在 `data/subscriptions.json` 文件中。

## 使用说明

1. 点击"新增订阅"按钮添加新的订阅
2. 填写订阅信息：名称、分类、价格、日期、状态等
3. 使用分类和状态筛选器查看特定订阅
4. 点击订阅卡片上的编辑或删除按钮进行操作
5. 查看统计卡片了解月度和年度费用
6. 查看分类饼图了解费用分布

## 许可证

MIT
```

- [ ] **Step 2: Commit README**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## 完成检查

- [ ] **Step 1: 最终验证所有功能**

确保:
- 订阅管理功能正常
- 分类筛选功能正常
- 费用统计正确
- 图表显示正确
- 到期提醒正常
- 状态管理正常

- [ ] **Step 2: 最终 Commit**

```bash
git status
git log --oneline -15
```

确认所有文件都已提交。

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-ai-subscription-manager.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**