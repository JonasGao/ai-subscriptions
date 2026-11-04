# 测试 Parity 矩阵（cutover gate 产物）

Go + SolidJS 重写（ADR-0018）的行为规范对账表：旧栈 **582 个用例（44 文件）** 逐条登记去向，cutover 前本表必须闭合——每一条要么有对应用例，要么标注「不适用 + 理由」。

- 去向 `Go` = 领域/服务层用例移植为 Go 表驱动测试（`server/` 内，逐条映射）
- 去向 `solid` = 组件/hook 用例以 vitest + @solidjs/testing-library 重写（`web/` 内）
- 状态：`☐ 未开始` → `◑ 移植中` → `☑ 闭合`（每文件一行，行内用例级对账在移植该文件时展开为子表）

**小计**：Go 35 文件 / 508 例；solid 9 文件 / 74 例；不适用通道当前为空（图表功能移除不产生行，图表本无测试）。

## → Go（server/）

| 测试文件                          | 用例 | 目标区域                       | 状态 |
| --------------------------------- | ---: | ------------------------------ | ---- |
| dispatcher.test.ts                |   36 | notifications 调度器           | ☐    |
| utils.test.ts                     |   34 | 领域工具                       | ☐    |
| provider-plans.test.ts            |   29 | providers 注册表               | ☐    |
| reset-alignment.test.ts           |   27 | 重置对齐/校准                  | ☐    |
| payload.test.ts                   |   27 | 飞书消息构造                   | ☐    |
| models-resolver.test.ts           |   26 | 模型查询解析                   | ☐    |
| alibaba-tokenplan.test.ts         |   26 | provider: alibaba（ACS3 签名） | ☐    |
| github.test.ts                    |   25 | provider: github（token 交换） | ☐    |
| fangzhou-codingplan.test.ts       |   24 | provider: fangzhou             | ☐    |
| opencode.test.ts                  |   23 | provider: opencode             | ☐    |
| enrichment.test.ts                |   23 | providers 能力标记             | ☐    |
| zhipu.test.ts                     |   22 | provider: zhipu（窗口解码）    | ☐    |
| feishu-app.test.ts                |   21 | 飞书应用机器人                 | ☐    |
| provider-models.test.ts           |   15 | providers 模型查询             | ☐    |
| fangzhou-models.test.ts           |   15 | provider: fangzhou 模型列表    | ☐    |
| feishu-listener.test.ts           |   13 | 飞书 WS 监听                   | ☐    |
| feishu-helpers.test.ts            |   13 | 飞书辅助                       | ☐    |
| signing.test.ts                   |   12 | 火山 V4 签名                   | ☐    |
| reset-schedule-uniqueness.test.ts |   10 | 重置计划唯一性                 | ☐    |
| notifications-storage.test.ts     |   10 | 通知存储                       | ☐    |
| providers.test.ts                 |    9 | providers 注册表               | ☐    |
| models-generic-fetch.test.ts      |    8 | 通用模型获取回退               | ☐    |
| github-models.test.ts             |    8 | provider: github 模型列表      | ☐    |
| feishu-credentials.test.ts        |    8 | 飞书凭据                       | ☐    |
| proxy-subscriptions.test.ts       |    7 | 代理订阅                       | ☐    |
| volcengine-signer.test.ts         |    6 | 火山 HMAC 签名器               | ☐    |
| tags.test.ts                      |    6 | 标签稳定标识                   | ☑    |
| db.test.ts                        |    6 | 存储层（SQLite，ADR-0017）     | ☑    |
| balance-handlers.test.ts          |    5 | 余额查询注册表                 | ☐    |
| subscription-status-edit.test.ts  |    4 | 订阅状态编辑                   | ☐    |
| status-policy.test.ts             |    3 | 状态策略                       | ☐    |
| models-route.test.ts              |    3 | 模型查询路由                   | ☐    |
| usage-route.test.ts               |    2 | 用量查询路由                   | ☐    |
| tags-api-cache.test.ts            |    1 | 标签 API 缓存                  | ☐    |
| proxy-tags-route.test.ts          |    1 | 代理标签路由                   | ☐    |

### 已闭合文件的用例级对账（#23）

`db.test.ts` → `server/internal/store/reset_test.go`（旧用例名逐字沿用为 Go 测试名）：

| 旧 describe                            | 例数 | Go 测试                                                                                                                       |
| -------------------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------- |
| processResetTick filtering             |    4 | `TestResetTickSkipsCancelledSubscriptions` / `…SkipsDisabledSchedules` / `…AdvancesWithoutTriggeringWhenNotExhausted` / `…TriggersAndClearsExhaustion` |
| schedule exhaustion status transitions |    2 | `TestToggleScheduleExhaustedPausesActiveSubscription` / `…RestoresActiveStatus`                                               |

`tags.test.ts` → `server/internal/store/tags_test.go` + `import_test.go`：

| 旧 describe       | 例数 | Go 测试                                                                                              |
| ----------------- | ---: | ---------------------------------------------------------------------------------------------------- |
| subscription tags |    6 | 首例（空标签目录迁移）落在 `TestImportLegacyDataWithoutTags`，其余 5 例在 `tags_test.go`（增删改与上限） |

评审补强（#23 阻塞项）：`readData` 的「AI助手」→「官方订阅」重命名同时作用于类别表与
每条订阅的 `category` 引用，迁移器此前只改前者，单向导入 + 完成标记会让悬空引用永久
固化（含从 JSON 快照恢复的灾难恢复路径）。现由
`TestImportRenamesRetiredCategoryEverywhere` 覆盖逐订阅引用；`migration-drill` 的
`verify()` 新增逐订阅 `category` 对账与「引用必须存在于导入后类别表」检查
（`TestVerifyReportsSubscriptionCategoryMismatch` / `TestVerifyAcceptsNormalizedCategories`
锁定该检查本身有效且无误报）。

## → solid（web/）

| 测试文件                            | 用例 | 目标区域               | 状态 |
| ----------------------------------- | ---: | ---------------------- | ---- |
| SubscriptionCard.test.tsx           |   18 | SubscriptionCard       | ☐    |
| model-button.test.tsx               |   18 | 模型查询按钮           | ☐    |
| SortablePriorityList.test.tsx       |   13 | 优先级拖拽列表         | ☐    |
| auto-exhaust.test.tsx               |   10 | 自动用尽标记（卡片侧） | ☐    |
| TagInput.test.tsx                   |    6 | 标签输入               | ☐    |
| useNow.test.ts                      |    5 | 时间信号原语           | ☐    |
| query-calibration-callback.test.tsx |    2 | 校准回调局部更新       | ☐    |
| ProxySubscriptionTab.test.tsx       |    1 | 代理订阅页签           | ☐    |
| MainPageShell.test.tsx              |    1 | 主页骨架               | ☐    |

## 不适用

| 测试文件 | 用例 | 理由                                                      | 状态 |
| -------- | ---: | --------------------------------------------------------- | ---- |
| （空）   |      | 图表功能移除（ADR-0018 范围修订 ②）不产生行：图表本无测试 |      |
