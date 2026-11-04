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
| provider-plans.test.ts            |   29 | providers 注册表               | ☑    |
| reset-alignment.test.ts           |   27 | 重置对齐/校准                  | ☐    |
| payload.test.ts                   |   27 | 飞书消息构造                   | ☐    |
| models-resolver.test.ts           |   26 | 模型查询解析                   | ☐    |
| alibaba-tokenplan.test.ts         |   26 | provider: alibaba（ACS3 签名） | ☐    |
| github.test.ts                    |   25 | provider: github（token 交换） | ☐    |
| fangzhou-codingplan.test.ts       |   24 | provider: fangzhou             | ☐    |
| opencode.test.ts                  |   23 | provider: opencode             | ☐    |
| enrichment.test.ts                |   23 | providers 能力标记             | ☑    |
| zhipu.test.ts                     |   22 | provider: zhipu（窗口解码）    | ☐    |
| feishu-app.test.ts                |   21 | 飞书应用机器人                 | ☐    |
| provider-models.test.ts           |   15 | providers 模型查询             | ☐    |
| fangzhou-models.test.ts           |   15 | provider: fangzhou 模型列表    | ☐    |
| feishu-listener.test.ts           |   13 | 飞书 WS 监听                   | ☐    |
| feishu-helpers.test.ts            |   13 | 飞书辅助                       | ☐    |
| signing.test.ts                   |   12 | 火山 V4 签名                   | ☐    |
| reset-schedule-uniqueness.test.ts |   10 | 重置计划唯一性                 | ☐    |
| notifications-storage.test.ts     |   10 | 通知存储                       | ☐    |
| providers.test.ts                 |    9 | providers 注册表               | ☑    |
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

### 已闭合文件的用例级对账（#25）

`provider-plans.test.ts` → `server/internal/providers/plan_test.go`（子测试名逐字沿用旧用例名）：

| 旧 describe             | 例数 | Go 测试                                                                 |
| ----------------------- | ---: | ----------------------------------------------------------------------- |
| resolvePlanId           |    9 | `TestResolvePlanID`                                                     |
| createSubscription      |    4 | `TestCreateSubscriptionPlanResolution`                                  |
| updateSubscription      |    2 | `TestUpdateSubscriptionPlanResolution`                                  |
| migrateProviderPlans    |    7 | `TestMigrateProviderPlans`                                              |
| resolveUsageHandlerKey  |    2 | `TestResolveUsageHandlerKey`                                            |
| resolveUsageApiUrl      |    3 | `TestResolveUsageAPIURL`                                                |
| usageHandlers 注册      |    2 | `TestUsageHandlersRegistration`                                         |

偏差：旧用例经 `db.createSubscription`/`db.updateSubscription` 与
`subscriptions.json` 文件迁移落地；新栈的存储与 CRUD 属 #23/#26，故这 11 例在
领域规则 seam 上平移（`ResolvePlanIDOnCreate`/`OnUpdate`、
`MigrateProviderPlans(records)`），行为断言不变。

`providers.test.ts` → `server/internal/providers/providers_test.go`：

| 旧 describe        | 例数 | Go 测试              |
| ------------------ | ---: | -------------------- |
| fangzhou-agentplan |    3 | `TestAgentPlanUsage` |
| fangzhou-codingplan|    2 | `TestCodingPlanUsage`|
| moonshot           |    4 | `TestMoonshotUsage`  |

`enrichment.test.ts` → `server/internal/providers/enrichment_test.go`：

| 旧 describe                 | 例数 | Go 测试                       |
| --------------------------- | ---: | ----------------------------- |
| supportsUsageQuery          |    5 | `TestSupportsUsageQuery`      |
| supportsBalanceQuery        |    4 | `TestSupportsBalanceQuery`    |
| supportsModelsQuery         |    6 | `TestSupportsModelsQuery`     |
| enrichProviders             |    4 | `TestEnrichProviders`         |
| getUnregisteredProviderNames|    4 | `TestUnregisteredProviderNames` |

### #24 认证闭环：无旧栈对应用例，行为由新用例锁定

旧栈 `__tests__/` 44 个文件里没有 auth / middleware / login / change-password 的用例
（`lib/auth.ts`、`lib/auth.config.ts`、`middleware.ts` 与 `app/api/auth/**` 全无测试），因此本票
在矩阵中不占用既有 `☐` 行，也不把其他文件的行标为闭合；认证语义以旧栈实现为规范，由下列新用例锁定：

| 新用例文件 | 例数 | 覆盖的旧栈行为 |
| ---------- | ---: | -------------- |
| `server/internal/auth/auth_test.go` | 16 | 种子账号 admin/admin123 与 bcrypt cost 10、首启 isInitial、改密规则（新密码≥6 位先于校验原密码、原密码错、成功后清标记并更新时间戳）、登录限流 5 次/15 分（窗口过期、成功登录清零、按 IP 隔离）、会话 7 天且跨实例存活、改密后旧会话全部失效而调用者拿到绑定新哈希的替换令牌、篡改/异密钥令牌拒绝、`NEXTAUTH_SECRET` 缺省随机兜底 |
| `server/internal/httpapi/auth_test.go` | 17 | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/session`（ADR-0018 形状例外）；`is-initial` / `change-password` 形状不变（含 `未登录` / `请填写完整` / `密码长度至少6位` / `原密码错误` 文案）；改密成功为调用者重签发 cookie（非强制流保持登录，旧 cookie 仍失效）；`/api/auth/session` 沿用 NextAuth 的 `Cache-Control: private, no-cache, no-store` + `Pragma`/`Expires`（@auth/core），未登录/已登录两种响应均不可缓存；登出拒绝跨站来源（Origin / Sec-Fetch-Site），替代 NextAuth signout 的 CSRF 令牌；除 auth 白名单（`/api/auth/{login,logout,session,is-initial}` 与 `/api/health`）外所有 API（含未知路径）经会话门禁 401 |
| `web/src/auth/login.test.tsx` | 4 | 登录页：isInitial 提示、按 isInitial 分流 `/change-password?force=1` 或 `/subscriptions`、凭据错误与 429 限流文案 |
| `web/src/auth/change-password.test.tsx` | 6 | 改密页：force=1 标题与「默认密码」提示、两次不一致/少于 6 位本地拦截、原密码错误透传、非强制态返回首页入口、强制流改密成功后登出回登录页、非强制流改密成功后保持登录落 `/subscriptions` |
| `web/src/auth/session-gate.test.tsx` | 6 | 路由门禁：未登录访问任意页→`/login`、种子密码会话→强制改密、已登录访问 `/login`→`/subscriptions`、`/`→`/subscriptions`、登出后回登录页 |
| `web/src/App.test.tsx` | 1 | 应用外壳：未登录进入即落登录页 |

偏差：① 会话端点形状为新设（ADR-0018 例外），未登录的 `GET /api/auth/session` 返回 `{}` 而非
NextAuth 的 `null`，保持容器 healthcheck 拿到 200；② 登录限流键用 peer 地址而非
`x-forwarded-for`（旧栈取该头，但部署直接暴露 3000 端口，该头可伪造出无限配额）；③ 旧栈
`/api/auth/[...nextauth]` 流程不移植（由三端点替代）；④ `/api/health` 保持免登录——
distroless 镜像的 healthcheck 走二进制子命令（#41），它不带会话 cookie，且该端点只回 `{"status":"ok"}`；
⑤ 改密成功的会话处理按旧栈分流：强制流（`force=1`）前端登出并回 `/login`，非强制流为调用者重签发
绑定新哈希的 cookie 并落 `/subscriptions`——其余全部旧会话依然立即失效（票面验收项「改密后旧会话失效」）；
⑥ 登出的跨站防护用 Origin / `Sec-Fetch-Site` 校验替代 NextAuth signout 的 CSRF 双提交令牌（同源浏览器请求
与 curl 等非浏览器客户端不受影响）。

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

## 部署契约（#41，矩阵外新增）

旧栈部署没有任何测试文件，本票**不关闭矩阵行**（582 例去向不变），改为把 ADR-0018 的部署面契约写成可执行断言，防止漂移：

| Go 测试                                     | 覆盖契约                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `deploycontract` `TestDockerfileBuildsWebThenGoThenDistroless` | 三阶段（node→go→distroless）、`CGO_ENABLED=0`、`go:embed` 暂存、运行阶段无构建工具 |
| `deploycontract` `TestDockerfileKeepsDataVolumeWritableForContractUser` | `/data` 归属 `1000:1000`、运行镜像非 root                          |
| `deploycontract` `TestComposePreservesExternalContract` | 端口 3000、`./data:/data`、`DATA_DIR`、`user 1000:1000`、1CPU/512M、env_file、healthcheck 节奏、日志上限、网络名 |
| `deploycontract` `TestComposeHealthcheckWorksInDistroless` | healthcheck 不依赖 shell/wget/curl（改走二进制子命令）              |
| `deploycontract` `TestVolumeDestinationMatchesDataDir` | 卷挂载目标与 `DATA_DIR` 一致（SQLite 库与 `backups/` 快照落在卷上） |
| `deploycontract` `TestRootMakefileKeepsCommandFamily` / `TestDockerMakefileBuildsNewStackImage` | make 命令族不变、镜像标签与 `--project-directory`、构建参数透传 |
| `deploycontract` `TestSystemdServiceRunsSingleBinary` / `TestSystemdReadmeDocumentsInstallPath` | unit 只 exec 单二进制、安装路径文档化                       |
| `healthcheck` `TestProbeAcceptsHealthyServer` 等 7 例 | distroless 内健康探测语义：2xx 才健康、非 2xx/不可达/PORT 非法均非 0 |
