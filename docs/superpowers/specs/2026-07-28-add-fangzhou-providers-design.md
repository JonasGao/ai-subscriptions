# 设计文档：添加火山方舟提供商

**日期**: 2026-07-28
**状态**: 已批准

## 概述

在 AI 订阅管理应用中添加两个新的模型提供商：火山方舟 CodingPlan 和 火山方舟 AgentPlan。

## 背景

火山方舟是字节跳动旗下的模型服务平台，提供多种模型服务。CodingPlan 和 AgentPlan 是该平台的不同服务类型，需要作为独立的提供商选项供用户选择。

## 需求

- 添加两个新的提供商到 `defaultProviders` 数组
- 每个提供商有独立的 ID、名称、描述和网站
- 保持与现有代码结构一致

## 设计方案

### 数据结构

在 `lib/types.ts` 文件的 `defaultProviders` 数组中添加：

```typescript
{ id: 'fangzhou-codingplan', name: '火山方舟 CodingPlan', description: '火山方舟 CodingPlan 模型服务', website: 'https://www.volcengine.com/product/ark' },
{ id: 'fangzhou-agentplan', name: '火山方舟 AgentPlan', description: '火山方舟 AgentPlan 模型服务', website: 'https://www.volcengine.com/product/ark' },
```

### 插入位置

在 `byteDance` 提供商之后插入，逻辑上将字节跳动相关的提供商组织在一起：

```typescript
{ id: 'byteDance', name: '字节跳动', description: '豆包系列', website: 'https://doubao.com' },
{ id: 'fangzhou-codingplan', name: '火山方舟 CodingPlan', description: '火山方舟 CodingPlan 模型服务', website: 'https://www.volcengine.com/product/ark' },
{ id: 'fangzhou-agentplan', name: '火山方舟 AgentPlan', description: '火山方舟 AgentPlan 模型服务', website: 'https://www.volcengine.com/product/ark' },
```

### 命名规范

- **ID**: 使用 `fangzhou-` 前缀 + 小写服务类型（`codingplan`, `agentplan`）
- **名称**: "火山方舟" + 空格 + 服务类型（`CodingPlan`, `AgentPlan`）
- **描述**: "火山方舟" + 空格 + 服务类型 + "模型服务"
- **网站**: 统一使用火山引擎产品页 `https://www.volcengine.com/product/ark`

## 影响范围

### 前端
- 提供商选择下拉框自动显示新选项
- 无需额外 UI 修改

### 数据
- 现有订阅数据不受影响
- 新订阅可以选择新提供商

### 兼容性
- 向后兼容
- 无破坏性变更

## 实施步骤

1. 修改 `lib/types.ts` 文件中的 `defaultProviders` 数组
2. 在 `byteDance` 提供商后插入两个新提供商对象
3. 验证前端显示正常

## 测试计划

- 手动测试：在订阅表单中选择新提供商
- 验证：创建订阅后，提供商字段正确保存和显示

## 风险评估

**风险**: 无

这是简单的数据添加操作，不涉及复杂的逻辑变更。

## 审批记录

- **用户**: 已批准设计方案
- **日期**: 2026-07-28