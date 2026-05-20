# 订阅优先级管理功能设计

## 概述

为 AI 订阅管理应用添加多场景优先级管理功能，允许用户为不同的使用场景（如工作日、周末、个人项目等）配置订阅服务的使用优先级顺序。

## 需求

### 功能需求
- 支持创建多个使用场景
- 每个场景可以独立配置订阅的优先级顺序
- 通过拖拽方式调整优先级
- 订阅可以属于多个场景
- 显示简约列表（仅订阅名称）

### 非功能需求
- 响应式设计，支持桌面和移动端
- 拖拽操作流畅
- 数据持久化到本地文件

## 技术设计

### 数据结构

创建独立配置文件 `data/priorities.json`：

```json
{
  "scenes": [
    {
      "id": "scene_001",
      "name": "工作日",
      "subscriptionOrder": ["sub_001", "sub_003", "sub_002"],
      "createdAt": "2026-05-20T00:00:00.000Z",
      "updatedAt": "2026-05-20T00:00:00.000Z"
    }
  ]
}
```

**设计考虑**：
- 不修改现有 `subscriptions.json` 结构
- 通过订阅 ID 引用，保持数据独立性
- 易于扩展新场景

### API 设计

#### GET /api/priorities
获取所有场景配置

**响应**：
```json
{
  "scenes": [...]
}
```

#### POST /api/priorities
创建新场景

**请求体**：
```json
{
  "name": "工作日"
}
```

**响应**：
```json
{
  "id": "scene_001",
  "name": "工作日",
  "subscriptionOrder": [],
  "createdAt": "...",
  "updatedAt": "..."
}
```

#### PUT /api/priorities/[id]
更新场景配置（重命名或调整订阅顺序）

**请求体**：
```json
{
  "name": "工作日（更新）",
  "subscriptionOrder": ["sub_001", "sub_003"]
}
```

#### DELETE /api/priorities/[id]
删除场景

### UI 组件

#### 1. PriorityManager 组件
主容器组件，包含：
- 场景选择器（下拉框）
- 场景管理按钮（添加、删除、重命名）
- 当前场景的优先级列表
- 可用订阅列表

#### 2. SortableSubscriptionList 组件
可拖拽排序的订阅列表：
- 使用 `@dnd-kit/sortable` 实现拖拽
- 显示订阅名称
- 支持移除操作

#### 3. AvailableSubscriptions 组件
未在当前场景中的订阅列表：
- 显示订阅名称
- 支持添加到场景

### 页面布局调整

修改 `app/page.tsx` 的网格布局：
- 从 `lg:grid-cols-3` 改为 `lg:grid-cols-4`
- 第1-2列：订阅列表
- 第3列：优先级管理（新）
- 第4列：图表

移动端保持垂直堆叠。

### 拖拽实现

使用 `@dnd-kit/core` 和 `@dnd-kit/sortable`：
- 流畅的拖拽动画
- 触摸设备支持
- 可访问性支持

## 用户流程

### 创建场景
1. 点击"添加场景"按钮
2. 输入场景名称
3. 场景创建成功，自动选中

### 配置优先级
1. 从"可用订阅"列表中点击订阅添加到场景
2. 拖拽调整顺序
3. 点击"保存"按钮保存配置

### 删除场景
1. 选择场景
2. 点击删除按钮
3. 确认删除

## 文件结构

```
app/
  api/
    priorities/
      route.ts          # GET, POST
      [id]/
        route.ts        # PUT, DELETE
components/
  PriorityManager.tsx   # 主容器
  SortableSubscriptionList.tsx
  AvailableSubscriptions.tsx
data/
  priorities.json       # 新文件
lib/
  priorities.ts         # 数据访问函数
```

## 错误处理

- 场景名称重复：提示错误，要求使用唯一名称
- 订阅不存在：从场景中自动移除无效 ID
- 文件读写失败：显示错误提示

## 测试考虑

- 拖拽功能在移动端的表现
- 并发场景编辑的冲突处理
- 大量订阅时的性能

## 未来扩展

- 场景切换快捷键
- 场景模板
- 导出/导入配置
- 场景使用统计