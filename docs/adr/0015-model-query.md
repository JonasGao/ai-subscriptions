# 模型查询（Model Query）

订阅卡片此前只有两类查询且按订阅类型互斥划分：recurring → Usage Query、one-time → Balance Query（共享 60s 冷却、挂载自动查、balance 落盘）。我们决定新增第三类 **Model Query**：调用 Provider 的模型列表端点，把模型 id 以弹窗列表（搜索框 + 计数 + 更新时间 + 手动刷新）展示，并且**与订阅类型正交**——模型目录是 API key / Provider 的属性，与计费方式无关，门控仅为"Provider（或 Plan）配置了 `modelsApiUrl` 且订阅有凭据"。行为上刻意偏离现有两类查询：**不挂载自动查、不落盘、不触发 Query Cooldown**（用户按需点击，会话内缓存，重开弹窗用缓存）。

## Considered Options

- **正交资格（选定）**：两类订阅都显示"模型"按钮。若沿用 recurring/one-time 划分，one-time 的 API 充值 key（DeepSeek / SiliconFlow 等）恰恰是"这把 key 能调什么模型"最相关的场景，划入任何一边都错。
- **handler 注册表只放例外（选定）**：`modelsHandlers` 仅收录非 OpenAI 形状者——github（PAT→Copilot token 交换）、fangzhou（V4 签名 + 分页）、alibaba（ACS3 签名 + nextToken 分页）；其余 Provider 由解析出的 `modelsApiUrl` 驱动通用 OpenAI 兼容 fetch 兜底。代价：`supportsModelsQuery` 旗标不能像 usage/balance 那样从注册表推导（通用兜底者不在表里），改由 `modelsApiUrl` 存在性推导。
- **逐 Provider 显式注册**：与 usage/balance 模式一致，但 6 个标准形状 Provider 要写 6 份相同包装。否决。
- **列表语义——授权优先、目录兜底（选定）**：github 用响应自带的 `policy.state === "enabled"` 过滤并排除 embeddings（授权感知是免费的）；openrouter / opencode 返回全局目录、不随 key 过滤，原样展示（"可用过滤"需逐模型计费查询，成本不成比例）；siliconflow 不筛类型。

## Consequences

- 服务端归一化：各家形状（`data[].id` / `Result.Items[].Name` / `models[].model`）在 handler 内抽成 `string[]`，路由去重 + locale 排序后返回 `{ models: string[] }`——openrouter 约 774KB 的原始响应到客户端只剩 id 列表。
- `Provider.modelsApiUrl` + 可选 `Plan.modelsApiUrl` 覆盖，解析镜像 `resolveUsageApiUrl`（moonshot kimi-code 与 zhipu coding-plan 的模型端点与其平台 key 不同，必须 plan 级）。
- moonshot `/coding/v1/models` 与 zhipu `/api/coding/paas/v4/models` 属实测存在但官方未文档化，实现时需用真实 key 校验响应形状。
- 未配置任何查询链路的 Provider（anthropic / openai / google 等纯目录项）不配 `modelsApiUrl`。
- UI 为独立 `ModelListDialog` 组件，卡片只持开关状态；只读 Provider 管理页镜像补齐 `supportsModelsQuery` 徽章与"模型查询 API" UrlRow。
