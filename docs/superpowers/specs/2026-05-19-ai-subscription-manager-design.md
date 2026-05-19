# AI 订阅管理工具 - 设计文档

**日期**: 2026-05-19  
**状态**: 待审核

## 概述

构建一个个人 AI 服务订阅管理工具，用于跟踪、管理和分析多个 AI 服务的订阅信息、费用和到期时间。

## 目标用户

- 使用多个 AI 服务订阅的个人用户
- 需要跟踪订阅费用和续费日期
- 希望了解订阅支出分布

## 核心功能

### 1. 订阅管理

- **新增订阅**: 添加新的 AI 服务订阅
- **编辑订阅**: 修改现有订阅信息
- **删除订阅**: 移除订阅记录
- **订阅状态**: 支持活跃、暂停、已取消三种状态

### 2. 分类管理

- **预设分类**: AI助手、图像生成、代码工具、写作工具、数据分析等
- **自定义分类**: 用户可添加新分类
- **分类筛选**: 按分类查看订阅列表

### 3. 费用统计

- **月度总费用**: 当前月份所有活跃订阅的总费用
- **年度总费用**: 预计年度订阅支出
- **分类费用**: 各分类的费用占比

### 4. 图表分析

- **分类占比饼图**: 展示各分类订阅费用占比
- **月度趋势图**: 显示订阅费用的月度变化（可选）

### 5. 到期提醒

- **即将到期**: 7天内到期的订阅高亮显示
- **状态指示**: 不同状态使用不同颜色标识

## 技术架构

### 技术栈

- **框架**: Next.js 14+ (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS + shadcn/ui
- **图表**: Recharts
- **ID生成**: UUID
- **数据存储**: JSON 文件 (项目内 `data/subscriptions.json`)

### 项目结构

```
ai-subscriptions/
├── app/
│   ├── layout.tsx              # 全局布局
│   ├── page.tsx                # 首页（订阅列表+统计）
│   ├── api/
│   │   └── subscriptions/
│   │       ├── route.ts        # GET /api/subscriptions (列表)
│   │       │                    # POST /api/subscriptions (新增)
│   │       └── [id]/
│   │           └── route.ts     # GET/PUT/DELETE 单个订阅
│   └── globals.css              # 全局样式
├── components/
│   ├── ui/                     # shadcn/ui 组件
│   ├── SubscriptionList.tsx    # 订阅列表组件
│   ├── SubscriptionCard.tsx    # 订阅卡片组件
│   ├── SubscriptionForm.tsx    # 新增/编辑表单
│   ├── StatsCard.tsx           # 统计卡片
│   ├── CategoryPieChart.tsx    # 分类饼图
│   └── CategoryFilter.tsx      # 分类筛选器
├── lib/
│   ├── db.ts                   # JSON 文件读写操作
│   ├── types.ts                # TypeScript 类型定义
│   └── utils.ts                # 工具函数
├── data/
│   └── subscriptions.json       # 数据存储文件
├── public/                     # 静态资源
├── docs/                       # 文档
├── tailwind.config.ts          # Tailwind 配置
├── next.config.js              # Next.js 配置
└── package.json
```

## 数据模型

### Subscription（订阅）

```typescript
interface Subscription {
  id: string;              // 唯一标识符
  name: string;            // 服务名称，如 "ChatGPT Plus"
  category: string;        // 分类，如 "AI助手"
  price: number;           // 月费（人民币）
  startDate: string;       // 订阅开始日期 (ISO 8601)
  renewalDate: string;      // 下次续费日期 (ISO 8601)
  status: 'active' | 'paused' | 'cancelled';  // 订阅状态
  notes?: string;          // 可选备注
  createdAt: string;       // 创建时间 (ISO 8601)
  updatedAt: string;       // 更新时间 (ISO 8601)
}
```

### Category（分类）

```typescript
// 预设分类
const defaultCategories = [
  'AI助手',
  '图像生成',
  '代码工具',
  '写作工具',
  '数据分析',
  '其他'
];
```

### 数据文件结构

```json
{
  "subscriptions": [
    {
      "id": "uuid-1",
      "name": "ChatGPT Plus",
      "category": "AI助手",
      "price": 145,
      "startDate": "2024-01-15",
      "renewalDate": "2025-02-15",
      "status": "active",
      "notes": "个人使用",
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:00:00Z"
    }
  ],
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

## API 设计

### 订阅管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/subscriptions` | 获取所有订阅列表 |
| POST | `/api/subscriptions` | 创建新订阅 |
| GET | `/api/subscriptions/:id` | 获取单个订阅详情 |
| PUT | `/api/subscriptions/:id` | 更新订阅信息 |
| DELETE | `/api/subscriptions/:id` | 删除订阅 |

### 分类管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/categories` | 获取所有分类 |
| POST | `/api/categories` | 添加新分类 |

## UI 设计

### 首页布局

```
┌─────────────────────────────────────────────┐
│  AI 订阅管理                    [新增订阅]  │
├─────────────────────────────────────────────┤
│  统计卡片                                   │
│  ┌──────┐  ┌──────┐  ┌──────┐              │
│  │月费用│  │年费用│  │活跃数│              │
│  └──────┘  └──────┘  └──────┘              │
├─────────────────────────────────────────────┤
│  [分类筛选]  [状态筛选]                     │
├───────────────────┬─────────────────────────┤
│  订阅列表          │  分类占比图表           │
│  ┌─────────────┐  │                         │
│  │ 订阅卡片 1  │  │     [饼图]              │
│  ├─────────────┤  │                         │
│  │ 订阅卡片 2  │  │                         │
│  ├─────────────┤  │                         │
│  │ 订阅卡片 3  │  │                         │
│  └─────────────┘  │                         │
└───────────────────┴─────────────────────────┘
```

### 订阅卡片

```
┌─────────────────────────────────┐
│ ChatGPT Plus       [编辑][删除] │
│ AI助手 | 活跃                    │
│ ¥145/月                          │
│ 续费: 2025-02-15 (7天后)        │
└─────────────────────────────────┘
```

### 颜色方案

- **状态颜色**:
  - 活跃: 绿色
  - 暂停: 黄色
  - 已取消: 灰色
- **即将到期**: 橙色高亮（7天内）

## 文件操作逻辑

### 读取订阅数据

1. 检查 `data/subscriptions.json` 是否存在
2. 不存在则创建默认数据结构
3. 读取并解析 JSON
4. 返回数据

### 写入订阅数据

1. 读取现有数据
2. 修改数据（添加/更新/删除）
3. 更新 `updatedAt` 时间戳
4. 写回 JSON 文件

## 错误处理

- **文件不存在**: 自动创建默认数据结构
- **JSON 解析失败**: 返回错误，记录日志
- **验证失败**: 返回 400 错误和具体错误信息
- **ID 不存在**: 返回 404 错误

## 性能考虑

- 数据量小（个人订阅），直接读写 JSON 文件即可
- 无需缓存或数据库优化
- 客户端状态管理使用 React useState（无需 Redux）

## 部署说明

- 使用 `next dev` 开发模式运行
- 生产环境可使用 `next start` 或部署到 Vercel
- `data/` 目录需要读写权限

## 未来扩展（不在本次范围）

- 导入/导出功能
- 多币种支持
- 订阅周期自定义（月/季/年）
- 自动续费提醒（邮件/通知）
- 移动端适配优化