# 筛选区域间隔修复与 localStorage 持久化设计

## 问题

1. 分类筛选和状态筛选组件缺少与上下内容的间隔，视觉上贴在一起
2. 筛选值没有持久化，页面刷新后会丢失用户的选择

## 设计方案

### 1. 修复间隔

在 `app/page.tsx` 中，为 CategoryFilter 组件添加 `mb-4` class，使其与下方订阅列表保持标准间隔（16px）。

由于 StatsCards 组件本身已有底部间隔，上方间隔已经足够，只需添加底部间隔即可。

### 2. localStorage 持久化

修改 `app/page.tsx`：

- 使用 useState 初始化函数从 localStorage 读取初始值
- 创建包装函数处理状态更新和 localStorage 保存
- 将包装函数传递给 CategoryFilter 组件

localStorage keys:
- `selectedCategory`: 分类筛选值
- `selectedStatus`: 状态筛选值

## 实现要点

- 需要处理 SSR 场景：初始化时检查 `typeof window !== 'undefined'`
- 默认值仍为 `'all'`（如果没有 localStorage 值）
- 两个独立的处理函数，分别处理分类和状态的更新