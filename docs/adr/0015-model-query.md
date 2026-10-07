# 模型查询（Model Query）

订阅卡片此前只有两类查询且按订阅类型互斥划分：recurring → Usage Query、one-time → Balance Query（共享 60s 冷却、挂载自动查、balance 落盘）。我们决定新增第三类 **Model Query**：调用 Provider 的模型列表端点，把模型 id 以弹窗列表（搜索框 + 计数 + 更新时间 + 手动刷新）展示，并且**与订阅类型正交**——模型目录是 API key / Provider 的属性，与计费方式无关，门控仅为"Provider（或 Plan）配置了 `modelsApiUrl` 且订阅有凭据"。行为上刻意偏离现有两类查询：**不挂载自动查、不落盘、不触发 Query Cooldown**（用户按需点击，会话内缓存，重开弹窗用缓存）。

## Considered Options

- **正交资格（选定）**：两类订阅都显示"模型"按钮。若沿用 recurring/one-time 划分，one-time 的 API 充值 key（DeepSeek / SiliconFlow 等）恰恰是"这把 key 能调什么模型"最相关的场景，划入任何一边都错。
- **handler 注册表只放例外（选定）**：`modelsHandlers` 仅收录非 OpenAI 形状者——github（PAT→Copilot token 交换）、fangzhou（V4 签名 + 分页）；其余 Provider 由解析出的 `modelsApiUrl` 驱动通用 OpenAI 兼容 fetch 兜底。代价：`supportsModelsQuery` 旗标不能像 usage/balance 那样从注册表推导（通用兜底者不在表里），改由 `modelsApiUrl` 存在性推导。
- **逐 Provider 显式注册**：与 usage/balance 模式一致，但 6 个标准形状 Provider 要写 6 份相同包装。否决。
- **列表语义——授权优先、目录兜底（选定）**：github 用响应自带的 `policy.state === "enabled"` 过滤并排除 embeddings（授权感知是免费的）；openrouter / opencode 返回全局目录、不随 key 过滤，原样展示（"可用过滤"需逐模型计费查询，成本不成比例）；siliconflow 不筛类型。

## Consequences

- 服务端归一化：各家形状（`data[].id` / `Result.Items[].Name` / `models[].model`）在 handler 内抽成 `string[]`，路由去重 + locale 排序后返回 `{ models: string[] }`——openrouter 约 774KB 的原始响应到客户端只剩 id 列表。
- `Provider.modelsApiUrl` + 可选 `Plan.modelsApiUrl` 覆盖，解析镜像 `resolveUsageApiUrl`（moonshot kimi-code 与 zhipu coding-plan 的模型端点与其平台 key 不同，必须 plan 级）。
- moonshot `/coding/v1/models` 与 zhipu `/api/coding/paas/v4/models` 属实测存在但官方未文档化，实现时需用真实 key 校验响应形状。
- 未配置任何查询链路的 Provider（anthropic / openai / google 等纯目录项）不配 `modelsApiUrl`。
- UI 为独立 `ModelListDialog` 组件，卡片只持开关状态；只读 Provider 管理页镜像补齐 `supportsModelsQuery` 徽章与"模型查询 API" UrlRow。

## Revisions

### 2026-10-07: 阿里云 Token Plan 改用 OpenAI 兼容端点（#18）

**变更**：alibaba `token-plan` 的 `modelsApiUrl` 由百炼 ACS3 `ListModels` 端点改为 OpenAI 兼容端点 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models`；从 `modelsHandlers` 注册表中移除 `alibaba` 项；alibaba provider 新增 `apiKey` 凭据字段（与既有 ak/sk/workspaceId 并存，前者供用量查询的 ACS3 使用，后者供模型查询使用）。

**原因**：Token Plan 自身暴露的 OpenAI 兼容端点返回的是**套餐实际授权的模型集**（26 个），而非百炼平台级 `ListModels` 的全量目录。前者与通用兜底的响应形状逐字节吻合（`data[].id`），使得 alibaba 不再需要专用 handler，例外 handler 由 3 个（github / fangzhou / alibaba）减为 2 个（github / fangzhou）。

**影响**：

- alibaba token-plan 订阅需补填 API Key 才能查模型；未填时行为与"未配凭据"一致（点「模型」按钮打开编辑弹窗）。
- 用量查询链路（`fetchTokenPlanUsage` / `testTokenPlanConnection` 及其 ACS3 签名工具）保持不动。
- `supportsModelsQuery` 仍由 `modelsApiUrl` 存在性推导，与 handler 注册表无关——alibaba 依然为真。
- alibaba `coding-plan` 未探明兼容端点，本次保持无 `modelsApiUrl`。

### 2026-10-07: 阿里云 Coding Plan 接入公开模型端点

**变更**：alibaba `coding-plan` 配置 `modelsApiUrl: https://coding.dashscope.aliyuncs.com/v1/models`。未注册任何例外 handler，直接落进通用 OpenAI 兼容兜底。

**原因**：实测该端点公开可用——无 Authorization 返回 200，携带伪造 Bearer 亦返回 200（鉴权被忽略）；响应为 OpenAI 形状 `data[].id`（另带 `firstId`/`lastId`/`hasMore` 字段，但 `limit`/`pageSize` 参数被忽略、始终全量返回，单次 fetch 即完整）。返回的是套餐授权模型清单（qwen3-coder 系列等 10 个），与 Token Plan 端点各自独立。

**影响**：

- coding-plan 订阅即使只配 ak/sk（用量查询用）、没有 apiKey，模型查询也可用——通用兜底仅在 apiKey 存在时附带 Authorization，此处直接省略。
- 两个 plan 的模型端点域名不同（`coding.dashscope` vs `token-plan.cn-beijing.maas`），各自 plan 级配置，provider 级保持空。
