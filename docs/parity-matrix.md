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
| feishu-app.test.ts                |   21 | 飞书应用机器人                 | ☑    |
| provider-models.test.ts           |   15 | providers 模型查询             | ☐    |
| fangzhou-models.test.ts           |   15 | provider: fangzhou 模型列表    | ☐    |
| feishu-listener.test.ts           |   13 | 飞书 WS 监听                   | ☑    |
| feishu-helpers.test.ts            |   13 | 飞书辅助                       | ☑    |
| signing.test.ts                   |   12 | 火山 V4 签名                   | ☐    |
| reset-schedule-uniqueness.test.ts |   10 | 重置计划唯一性                 | ☐    |
| notifications-storage.test.ts     |   10 | 通知存储                       | ☑    |
| providers.test.ts                 |    9 | providers 注册表               | ☑    |
| models-generic-fetch.test.ts      |    8 | 通用模型获取回退               | ☐    |
| github-models.test.ts             |    8 | provider: github 模型列表      | ☐    |
| feishu-credentials.test.ts        |    8 | 飞书凭据                       | ☑    |
| proxy-subscriptions.test.ts       |    7 | 代理订阅                       | ☑    |
| volcengine-signer.test.ts         |    6 | 火山 HMAC 签名器               | ☐    |
| tags.test.ts                      |    6 | 标签稳定标识                   | ☑    |
| db.test.ts                        |    6 | 存储层（SQLite，ADR-0017）     | ☑    |
| balance-handlers.test.ts          |    5 | 余额查询注册表                 | ☐    |
| subscription-status-edit.test.ts  |    4 | 订阅状态编辑                   | ☑    |
| status-policy.test.ts             |    3 | 状态策略                       | ☑    |
| models-route.test.ts              |    3 | 模型查询路由                   | ☐    |
| usage-route.test.ts               |    2 | 用量查询路由                   | ☐    |
| tags-api-cache.test.ts            |    1 | 标签 API 缓存                  | ☑    |
| proxy-tags-route.test.ts          |    1 | 代理标签路由                   | ☑    |

### 已闭合文件的用例级对账（#23）

`db.test.ts` → `server/internal/store/reset_test.go`（旧用例名逐字沿用为 Go 测试名）：

| 旧 describe                            | 例数 | Go 测试                                                                                                                                                |
| -------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| processResetTick filtering             |    4 | `TestResetTickSkipsCancelledSubscriptions` / `…SkipsDisabledSchedules` / `…AdvancesWithoutTriggeringWhenNotExhausted` / `…TriggersAndClearsExhaustion` |
| schedule exhaustion status transitions |    2 | `TestToggleScheduleExhaustedPausesActiveSubscription` / `…RestoresActiveStatus`                                                                        |

`tags.test.ts` → `server/internal/store/tags_test.go` + `import_test.go`：

| 旧 describe       | 例数 | Go 测试                                                                                                  |
| ----------------- | ---: | -------------------------------------------------------------------------------------------------------- |
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

| 旧 describe            | 例数 | Go 测试                                |
| ---------------------- | ---: | -------------------------------------- |
| resolvePlanId          |    9 | `TestResolvePlanID`                    |
| createSubscription     |    4 | `TestCreateSubscriptionPlanResolution` |
| updateSubscription     |    2 | `TestUpdateSubscriptionPlanResolution` |
| migrateProviderPlans   |    7 | `TestMigrateProviderPlans`             |
| resolveUsageHandlerKey |    2 | `TestResolveUsageHandlerKey`           |
| resolveUsageApiUrl     |    3 | `TestResolveUsageAPIURL`               |
| usageHandlers 注册     |    2 | `TestUsageHandlersRegistration`        |

偏差：旧用例经 `db.createSubscription`/`db.updateSubscription` 与
`subscriptions.json` 文件迁移落地；新栈的存储与 CRUD 属 #23/#26，故这 11 例在
领域规则 seam 上平移（`ResolvePlanIDOnCreate`/`OnUpdate`、
`MigrateProviderPlans(records)`），行为断言不变。

`providers.test.ts` → `server/internal/providers/providers_test.go`：

| 旧 describe         | 例数 | Go 测试               |
| ------------------- | ---: | --------------------- |
| fangzhou-agentplan  |    3 | `TestAgentPlanUsage`  |
| fangzhou-codingplan |    2 | `TestCodingPlanUsage` |
| moonshot            |    4 | `TestMoonshotUsage`   |

`enrichment.test.ts` → `server/internal/providers/enrichment_test.go`：

| 旧 describe                  | 例数 | Go 测试                         |
| ---------------------------- | ---: | ------------------------------- |
| supportsUsageQuery           |    5 | `TestSupportsUsageQuery`        |
| supportsBalanceQuery         |    4 | `TestSupportsBalanceQuery`      |
| supportsModelsQuery          |    6 | `TestSupportsModelsQuery`       |
| enrichProviders              |    4 | `TestEnrichProviders`           |
| getUnregisteredProviderNames |    4 | `TestUnregisteredProviderNames` |

### #24 认证闭环：无旧栈对应用例，行为由新用例锁定

旧栈 `__tests__/` 44 个文件里没有 auth / middleware / login / change-password 的用例
（`lib/auth.ts`、`lib/auth.config.ts`、`middleware.ts` 与 `app/api/auth/**` 全无测试），因此本票
在矩阵中不占用既有 `☐` 行，也不把其他文件的行标为闭合；认证语义以旧栈实现为规范，由下列新用例锁定：

| 新用例文件                              | 例数 | 覆盖的旧栈行为                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/internal/auth/auth_test.go`     |   16 | 种子账号 admin/admin123 与 bcrypt cost 10、首启 isInitial、改密规则（新密码≥6 位先于校验原密码、原密码错、成功后清标记并更新时间戳）、登录限流 5 次/15 分（窗口过期、成功登录清零、按 IP 隔离）、会话 7 天且跨实例存活、改密后旧会话全部失效而调用者拿到绑定新哈希的替换令牌、篡改/异密钥令牌拒绝、`NEXTAUTH_SECRET` 缺省随机兜底                                                                                                                                                                                                                                                                                                                   |
| `server/internal/httpapi/auth_test.go`  |   17 | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/session`（ADR-0018 形状例外）；`is-initial` / `change-password` 形状不变（含 `未登录` / `请填写完整` / `密码长度至少6位` / `原密码错误` 文案）；改密成功为调用者重签发 cookie（非强制流保持登录，旧 cookie 仍失效）；`/api/auth/session` 沿用 NextAuth 的 `Cache-Control: private, no-cache, no-store` + `Pragma`/`Expires`（@auth/core），未登录/已登录两种响应均不可缓存；登出拒绝跨站来源（Origin / Sec-Fetch-Site），替代 NextAuth signout 的 CSRF 令牌；除 auth 白名单（`/api/auth/{login,logout,session,is-initial}` 与 `/api/health`）外所有 API（含未知路径）经会话门禁 401 |
| `web/src/auth/login.test.tsx`           |    4 | 登录页：isInitial 提示、按 isInitial 分流 `/change-password?force=1` 或 `/subscriptions`、凭据错误与 429 限流文案                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `web/src/auth/change-password.test.tsx` |    6 | 改密页：force=1 标题与「默认密码」提示、两次不一致/少于 6 位本地拦截、原密码错误透传、非强制态返回首页入口、强制流改密成功后登出回登录页、非强制流改密成功后保持登录落 `/subscriptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `web/src/auth/session-gate.test.tsx`    |    6 | 路由门禁：未登录访问任意页→`/login`、种子密码会话→强制改密、已登录访问 `/login`→`/subscriptions`、`/`→`/subscriptions`、登出后回登录页                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `web/src/App.test.tsx`                  |    1 | 应用外壳：未登录进入即落登录页                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

偏差：① 会话端点形状为新设（ADR-0018 例外），未登录的 `GET /api/auth/session` 返回 `{}` 而非
NextAuth 的 `null`，保持容器 healthcheck 拿到 200；② 登录限流键用 peer 地址而非
`x-forwarded-for`（旧栈取该头，但部署直接暴露 3000 端口，该头可伪造出无限配额）；③ 旧栈
`/api/auth/[...nextauth]` 流程不移植（由三端点替代）；④ `/api/health` 保持免登录——
distroless 镜像的 healthcheck 走二进制子命令（#41），它不带会话 cookie，且该端点只回 `{"status":"ok"}`；
⑤ 改密成功的会话处理按旧栈分流：强制流（`force=1`）前端登出并回 `/login`，非强制流为调用者重签发
绑定新哈希的 cookie 并落 `/subscriptions`——其余全部旧会话依然立即失效（票面验收项「改密后旧会话失效」）；
⑥ 登出的跨站防护用 Origin / `Sec-Fetch-Site` 校验替代 NextAuth signout 的 CSRF 双提交令牌（同源浏览器请求
与 curl 等非浏览器客户端不受影响）。

### 已闭合文件的用例级对账（#37）

`notifications-storage.test.ts`（10 例）→ `server/internal/store/notifications_test.go`（旧用例名逐字沿用为 Go 测试名）：

| 旧 describe                                    | 旧用例（逐字）                                                  | 例数 | Go 测试                                                  |
| ---------------------------------------------- | --------------------------------------------------------------- | ---: | -------------------------------------------------------- |
| notification storage: channel CRUD             | createChannel assigns id, timestamps, and defaults enabled=true |    1 | `TestCreateChannelAssignsIDTimestampsAndDefaultsEnabled` |
| notification storage: channel CRUD             | createChannel preserves explicit enabled=false and secret       |    1 | `TestCreateChannelPreservesExplicitDisabledAndSecret`    |
| notification storage: channel CRUD             | getChannelById returns the channel or null                      |    1 | `TestGetChannelByIDReturnsChannelOrNil`                  |
| notification storage: channel CRUD             | updateChannel merges fields and refreshes updatedAt             |    1 | `TestUpdateChannelMergesFieldsAndRefreshesUpdatedAt`     |
| notification storage: channel CRUD             | updateChannel returns null for unknown id                       |    1 | `TestUpdateChannelReturnsNilForUnknownID`                |
| notification storage: channel CRUD             | deleteChannel removes and returns true; false for unknown       |    1 | `TestDeleteChannelRemovesAndReturnsTrueFalseForUnknown`  |
| notification storage: channel CRUD             | toggleChannelEnabled flips state in a single read+write         |    1 | `TestToggleChannelEnabledFlipsState`                     |
| notification storage: channel CRUD             | toggleChannelEnabled performs one read and one write            |    1 | `TestToggleChannelEnabledPerformsSingleUpdate`           |
| notification storage: global default threshold | defaults to DEFAULT_LOW_BALANCE_THRESHOLD (10)                  |    1 | `TestDefaultLowBalanceThresholdDefaultsToTen`            |
| notification storage: global default threshold | setter persists the new value                                   |    1 | `TestSetDefaultLowBalanceThresholdPersists`              |

偏差：第 8 例在旧栈用 `fs.readFileSync`/`writeFileSync` 调用次数守卫「单次读+写」；SQLite 没有对应 syscall 层，本票把该保证改为结构断言——toggle 用单条 `UPDATE` 语句完成翻转（不存在读后写），测试断言 `changes()` 恰为 1 且其它列未被扰动。

存储层补强（矩阵外新增）：`TestUpdateChannelSendResultPersists`（lastSendResult 落库且不改 `updatedAt`，未知 id 静默忽略）、`TestBalanceTransitionStateRoundTrip`、`TestNotificationChannelsKeepInsertionOrder`。
路由形状（旧栈无路由测试，按旧 handler 实现锁定）：`server/internal/httpapi/notifications_test.go` 30 例——GET 列表/阈值、创建校验文案（8 条）、feishu-app 字段校验与 secrets 脱敏、PUT 合并/清空/400/404、DELETE、toggle、未知 action、阈值 PUT、以及签名测试发送端到端（钉钉 URL 签名、飞书 body 签名、通用 webhook payload、失败 502 与 lastSendResult 记录、禁用渠道拒绝）。

偏差与边界：① `feishu-app` 的测试发送需要应用机器人发送器，随 #38 提供；本票端点形状不变，该类型测试发送以 502 记录明确的失败原因，不静默成功。② `payload` 构造只移植了测试发送所需的 low-balance 分支；`payload.test.ts`（27 例）与 `dispatcher.test.ts`（36 例）行仍归 #39，本票未关闭。③ 旧 `toLocaleString("zh-CN")` 的本地化依赖运行时 ICU，新栈用 `2006/1/2 15:04:05`（服务器本地时区）近似；精确字节语义留给 #39 的 payload 对账钉住。④ feishu-app 的 appSecret 守卫逐字移植了旧 handler 的兜底行为（显式清空若已有存量值则先通过），未按注释意图「修正」。

### 已闭合文件的用例级对账（#38）

四份飞书用例全部落在 `server/internal/notify`（领域层）与 `server/internal/httpapi`（路由层）。旧栈的 `now()`/`fetchFn`/`WSClient` 注入缝在新栈对应 `FeishuClient` 的 `HTTPDoer`+`now` 与 `ListenerManager` 的 `Scheduler`/`Now`/`NewID`/`SocketFactory`，因此每条用例仍是同一接缝上的行为断言。

`feishu-app.test.ts`（21 例）→ `server/internal/notify/feishu_app_test.go`：

| 旧 describe | 旧用例（逐字） | 例数 | Go 测试 |
| --- | --- | ---: | --- |
| getTenantToken | fetches a token on first call | 1 | `TestFeishuTenantTokenFetchesOnFirstCall` |
| getTenantToken | returns cached token on subsequent calls within expiry | 1 | `TestFeishuTenantTokenReturnsCachedTokenWithinExpiry` |
| getTenantToken | refreshes token after expiry buffer is reached | 1 | `TestFeishuTenantTokenRefreshesAfterExpiryBuffer` |
| getTenantToken | forceRefresh bypasses cache | 1 | `TestFeishuTenantTokenForceRefreshBypassesCache` |
| getTenantToken | throws when token response has non-zero code | 1 | `TestFeishuTenantTokenRejectsNonZeroCode` |
| getTenantToken | throws when HTTP response is not ok | 1 | `TestFeishuTenantTokenRejectsHTTPFailure` |
| getTenantToken | caches tokens per appId - different apps have separate caches | 1 | `TestFeishuTenantTokenCachesPerAppID` |
| getTenantToken | clearTokenCache(appId) clears only that app's cache | 1 | `TestFeishuClearTokenCacheClearsOneApp` |
| getTenantToken | clearTokenCache() without args clears all caches | 1 | `TestFeishuClearTokenCacheClearsAll` |
| buildFeishuAppCard | builds a valid interactive card JSON string for low-balance event | 1 | `TestBuildFeishuAppCardRendersLowBalance` |
| buildFeishuAppCard | builds a valid card for reset event | 1 | `TestBuildFeishuAppCardRendersReset` |
| buildFeishuAppCard | does not include keyword in title (feishu-app uses credential auth) | 1 | `TestBuildFeishuAppCardOmitsKeywordTitle` |
| sendFeishuAppMessage | sends a message with the fetched token | 1 | `TestSendFeishuAppMessageUsesFetchedToken` |
| sendFeishuAppMessage | retries once on 401 with fresh token | 1 | `TestSendFeishuAppMessageRetriesOn401` |
| sendFeishuAppMessage | retries once on code 99991663 even with 200 status | 1 | `TestSendFeishuAppMessageRetriesOnTokenExpiredCode` |
| sendFeishuAppMessage | throws after retry also fails | 1 | `TestSendFeishuAppMessageFailsAfterRetry` |
| sendFeishuAppMessage | uses chat_id receive_id_type when configured | 1 | `TestSendFeishuAppMessageUsesChatIDReceiveType` |
| dispatchEvent with feishu-app | routes feishu-app channel to feishuAppSender, others to httpSender | 1 | `TestFeishuAppSenderRoutesChannelToAppBot` |
| feishuAppCredentials | extracts credentials from a valid feishu-app channel | 1 | `TestFeishuAppCredentialsExtractsFields` |
| feishuAppCredentials | throws when channel is not feishu-app type | 1 | `TestFeishuAppCredentialsRejectsOtherType` |
| feishuAppCredentials | throws when required fields are missing | 1 | `TestFeishuAppCredentialsRejectsMissingFields` |

`feishu-listener.test.ts`（13 例）→ `server/internal/notify/feishu_listener_test.go`：

| 旧用例（逐字） | 例数 | Go 测试 |
| --- | ---: | --- |
| starts a listener and returns status with listenId and ttlSeconds | 1 | `TestListenerStartReturnsStatusWithListenIDAndTTL` |
| returns existing status when listener already active (idempotent) | 1 | `TestListenerStartIsIdempotentWhileActive` |
| prevents race condition on concurrent starts | 1 | `TestListenerStartSerialisesConcurrentStarts` |
| isListenerActive returns correct state | 1 | `TestListenerIsActiveTracksState` |
| stops a listener and keeps tombstone state | 1 | `TestListenerStopKeepsTombstone` |
| can stop by listenId (snapshot from start response) | 1 | `TestListenerCanStopByListenID` |
| stop returns false when no listener exists | 1 | `TestListenerStopUnknownReturnsFalse` |
| auto-stops after TTL expires with timeout reason | 1 | `TestListenerAutoStopsAfterTTL` |
| tombstone is cleaned up after 30 seconds | 1 | `TestListenerTombstoneExpiresAfterGrace` |
| receives messages and stores them | 1 | `TestListenerRecordsReceivedMessages` |
| getListenerMessages returns empty array for nonexistent listener | 1 | `TestListenerMessagesEmptyForUnknownListener` |
| multiple appIds have isolated listeners | 1 | `TestListenerKeepsAppIDsIsolated` |
| uses custom ttlSeconds when provided | 1 | `TestListenerHonoursCustomTTL` |

`feishu-helpers.test.ts`（13 例）→ `server/internal/notify/feishu_helpers_test.go`（13 例逐条对应，另有 1 例矩阵外新增）：

| 旧 describe | 旧用例（逐字） | 例数 | Go 测试 |
| --- | --- | ---: | --- |
| translateFeishuError | translates known error codes to human-readable messages | 1 | `TestTranslateFeishuErrorTokenInvalid` |
| translateFeishuError | translates tenant token errors | 1 | `TestTranslateFeishuErrorTenantToken` |
| translateFeishuError | translates permission error code | 1 | `TestTranslateFeishuErrorPermissionDenied` |
| translateFeishuError | translates 99991672 scope error with raw msg | 1 | `TestTranslateFeishuErrorScopeNames` |
| translateFeishuError | returns null for unknown error codes | 1 | `TestTranslateFeishuErrorUnknownCode` |
| listFeishuChats | fetches chat list with token auth | 1 | `TestFeishuListChatsFetchesWithTokenAuth` |
| listFeishuChats | supports pagination with page_token | 1 | `TestFeishuListChatsSupportsPagination` |
| listFeishuChats | throws translated error on non-zero code | 1 | `TestFeishuListChatsTranslatesNonZeroCode` |
| listFeishuChats | throws on HTTP error | 1 | `TestFeishuListChatsTranslatesHTTPError` |
| lookupFeishuUserByPhone | looks up user by phone number | 1 | `TestFeishuLookupUserByPhone` |
| lookupFeishuUserByPhone | throws when mobiles array is empty | 1 | `TestFeishuLookupUserByPhoneRejectsEmptyList` |
| lookupFeishuUserByPhone | throws translated error on permission denied | 1 | `TestFeishuLookupUserByPhoneTranslatesPermissionError` |
| lookupFeishuUserByPhone | returns empty user_list when no match found | 1 | `TestFeishuLookupUserByPhoneReturnsEmptyList` |

`feishu-credentials.test.ts`（8 例）→ `server/internal/notify/feishu_credentials_test.go`：

| 旧用例（逐字） | 例数 | Go 测试 |
| --- | ---: | --- |
| returns direct credentials from body when both appId and appSecret present | 1 | `TestResolveFeishuCredentialsUsesDirectBody` |
| uses stored credentials when channelId provided and stored channel has appSecret | 1 | `TestResolveFeishuCredentialsUsesStoredChannel` |
| uses body appId with stored appSecret when only appId provided in body | 1 | `TestResolveFeishuCredentialsUsesBodyAppIDWithStoredSecret` |
| throws when neither direct credentials nor channelId provided | 1 | `TestResolveFeishuCredentialsRequiresAppIDAndSecretOrChannelID` |
| throws when channelId does not exist | 1 | `TestResolveFeishuCredentialsRejectsUnknownChannel` |
| throws when channel is not feishu-app type | 1 | `TestResolveFeishuCredentialsRejectsNonFeishuAppChannel` |
| throws when stored channel has no appSecret | 1 | `TestResolveFeishuCredentialsRejectsStoredChannelWithoutAppSecret` |
| trims whitespace from credentials | 1 | `TestResolveFeishuCredentialsTrimsWhitespace` |

路由形状（旧栈无路由测试，按旧 handler 实现锁定）：`server/internal/httpapi/feishu_test.go` 17 例（14 个顶层用例 + lookup-user 入参校验的 3 个表驱动子例）——chats 直连凭据/已存凭据/凭据错误/飞书错误透传、lookup-user 手机号反查与三条入参校验文案、listen 启停轮询闭环/自定义 TTL/缺参 400/未知 404/未知停止 success=false/凭据错误 500、以及 feishu-app 测试发送成功与失败 502（含 lastSendResult 落库）。

偏差与理由：① 旧栈用 `@larksuiteoapi/node-sdk` 的 `WSClient` + `EventDispatcher`；新栈按 ADR-0018 用 oapi-sdk-go v3，WS 长连接走其 Channel 模块（`channel.NewChannel` + `ws.Client`），在 `feishu_socket.go` 里以 `FeishuSocket`（`Connect`/`Close`）适配，监听器本体（TTL/墓碑/多 appId 隔离/幂等/并发启停）逐条沿用旧语义。② Channel 默认策略是「群聊必须 @机器人、且拒绝 @所有人」，而本监听的用途是从任意消息里取 open_id（旧栈同样记录所有 `im.message.receive_v1`），因此显式把 `RequireMention=false`、`RespondToMentionAll=true`、`DMMode=open`。③ 旧 `getListenerStatus` 的 `ttlSeconds` 是常量返回值（源码注释即「Simplified」），新栈改为按实际启动参数返回，因此自定义 TTL 的用例能自洽；默认 TTL 仍为 120。④ 旧 `stopFeishuListener` 会先做 listenId→appId 反查再按 appId 停止，新栈保留同一解析顺序（listenId 优先），页面据此可用启动响应里的快照 id 停止。⑤ 票面要求「按手机号/邮箱解析用户」，旧栈只有 `byPhone`；新栈 `LookupUsers` 同时支持 `mobiles`/`emails`（飞书 `contact/v3/users/batch_get_id` 原生支持两者），`mobiles` 的校验文案逐字保留，新增 `TestFeishuLookupUsersByEmail` 覆盖邮箱路径。⑥ 旧 `feishu-app.test.ts` 末条的 `dispatchEvent` 扇出用例在第 38 票只断言「feishu-app 渠道走应用机器人发送器」这一路由事实；完整的事件调度器（含 lastSendResult 记录与回滚）归 #39。

### 已闭合文件的用例级对账（#26）

`subscription-status-edit.test.ts` → `server/internal/httpapi/subscriptions_test.go`（经真实 store + PUT 路由执行，沿用旧用例语义）：

| 旧用例                                                                   | 例数 | Go 测试                                                              |
| ------------------------------------------------------------------------ | ---: | -------------------------------------------------------------------- |
| keeps an explicitly chosen active status even with exhausted schedules   |    1 | `TestPutSubscriptionKeepsExplicitActiveStatusWithExhaustedSchedules` |
| keeps the manually chosen status after saving the edit form              |    1 | `TestPutSubscriptionKeepsChosenStatusFromFormPayload`                |
| keeps the chosen status even when the subscription has healthy schedules |    1 | `TestPutSubscriptionKeepsChosenStatusWithHealthySchedules`           |
| still recomputes status when only schedules change                       |    1 | `TestPutSubscriptionRecomputesStatusWhenOnlySchedulesChange`         |

`status-policy.test.ts` → `server/internal/status/status_test.go`（同一策略函数）。

`tags-api-cache.test.ts` → `server/internal/httpapi/tags_categories_test.go`：旧断言是 Next 的
`dynamic = "force-dynamic"`（可变目录禁止构建期快照）；Go 侧等价语义由
`TestTagsRouteIsNeverCached` 锁定——响应 `Cache-Control: no-store`，且写后立即 GET 能看到新标签。

`TagInput.test.tsx` → `web/src/components/TagInput.test.tsx`：6 例逐条沿用（点击历史标签、
大小写不敏感搜索并复用精确名、Enter 创建与中英文逗号批量、待提交文本回调、表单保存未确认文本、
超长标签跳过并提示）。React 的合成 `onChange` 对应 Solid 的 `onInput`，断言不变。

`SubscriptionCard.test.tsx` 拆分（行内子表，本票只闭合渲染基线，余下随查询/调度/收尾票）：

| 旧 describe           | 例数 | 去向                                                           |
| --------------------- | ---: | -------------------------------------------------------------- |
| deletion confirmation |    2 | **#26** 闭合（`web/src/components/SubscriptionCard.test.tsx`） |
| tags                  |    1 | **#26** 闭合（标签按关联顺序渲染）                             |
| auto-query on mount   |    9 | #28（查询框架/余额/用量），#29（用尽联动）                     |
| quota query cooldown  |    5 | #28                                                            |
| balance display       |    4 | #28                                                            |

#26 另新增 4 条渲染基线断言（标识/方案/类型/价格、一次性充值金额、用尽标记、状态徽标切换），
属新栈自有用例，不占旧行。注：按 `it.each` 展开后该文件实际 21 例（矩阵原记 18 例）。

#26 偏差与说明：

- 空的可选字段（`notes`/`providerCustom`/空 `resetSchedules`）在响应中省略（Go `omitempty`），
  旧栈在表单显式提交空串/空数组时会保留 `""`/`[]`；语义等价，前端按可选处理。`tagIds`
  始终输出为数组（旧栈创建路径也总带该键）。
- `usage`/`models` 占位路由只移植旧栈的守卫链（404、not-recurring、不支持、凭据缺失文案逐字对齐）；
  终端查询分支返回旧栈 handler 失败族的 502（`Usage query failed` / `Model query failed`），
  providers 查询框架与校准由 #28/#29/#34 接入。
- 分类路由（`/api/categories` GET/POST/DELETE）与标签改名/删除路由（`/api/tags/{id}` PATCH/DELETE）
  没有旧测试行；行为按 `lib/db.ts` 与旧路由移植，由新用例锁定（含「在用分类不可删」「重名标签保旧 ID」）。
- 首启播种默认分类用 `app_state` 标记保证只播种一次；旧栈语义是「数据文件不存在时播种」，
  删除全部分类后重启不会复活默认值。

## → solid（web/）

| 测试文件                            | 用例 | 目标区域               | 状态 |
| ----------------------------------- | ---: | ---------------------- | ---- |
| SubscriptionCard.test.tsx           |   18 | SubscriptionCard       | ◑    |
| model-button.test.tsx               |   18 | 模型查询按钮           | ☐    |
| SortablePriorityList.test.tsx       |   13 | 优先级拖拽列表         | ☑    |
| auto-exhaust.test.tsx               |   10 | 自动用尽标记（卡片侧） | ☐    |
| TagInput.test.tsx                   |    6 | 标签输入               | ☑    |
| useNow.test.ts                      |    5 | 时间信号原语           | ☐    |
| query-calibration-callback.test.tsx |    2 | 校准回调局部更新       | ☐    |
| ProxySubscriptionTab.test.tsx       |    1 | 代理订阅页签           | ☑    |
| MainPageShell.test.tsx              |    1 | 主页骨架               | ☐    |

### 已闭合文件的用例级对账（#36）

`proxy-subscriptions.test.ts`（7 例）→ `server/internal/proxy/proxy_test.go` 5 例 + `server/internal/store/proxy_test.go` 2 例。
前置 `lib/proxy-utils.ts` 的日期规则与新栈 `internal/proxy` 同源，故五例日期规则落在该包，两例存储语义落在 SQLite 存储层（ADR-0017 取代 JSON 读写）：

| 旧 describe                   | 旧用例（逐字）                                                   | 例数 | Go 测试                                                             |
| ----------------------------- | ---------------------------------------------------------------- | ---: | ------------------------------------------------------------------- |
| proxy subscription date rules | calculates an inclusive expiration date                          |    1 | `TestCalculateProxyExpirationDateIsInclusive`                       |
| proxy subscription date rules | skips expiration notices for unused subscriptions                |    1 | `TestDateNoticeSkipsUnusedSubscriptions`                            |
| proxy subscription date rules | skips expiration notices for unlimited in-use subscriptions      |    1 | `TestDateNoticeSkipsUnlimitedInUseSubscriptions`                    |
| proxy subscription date rules | reports overdue days only for in-use subscriptions               |    1 | `TestDateNoticeReportsOverdueDaysOnlyForInUse`                      |
| proxy subscription date rules | uses China calendar dates around UTC midnight                    |    1 | `TestTodayDateUsesChinaCalendarAroundUTCMidnight`                   |
| proxy subscription storage    | creates, updates, and deletes independent proxy tags             |    1 | `TestCreateUpdateDeleteProxySubscriptionsWithIndependentProxyTags`  |
| proxy subscription storage    | supports unlimited subscriptions and clearing an expiration date |    1 | `TestCreateProxySubscriptionSupportsUnlimitedAndClearingExpiration` |

`proxy-tags-route.test.ts`（1 例）→ `server/internal/httpapi/proxy_test.go`：
旧用例断言 Next.js 的 `dynamic = "force-dynamic"` 导出；Go 路由没有该开关（每次请求直读 SQLite，静态快照问题不存在），故改为断言可观察行为——写入后立刻可读到最新标签：

| 旧用例（逐字）                       | 例数 | Go 测试                                         |
| ------------------------------------ | ---: | ----------------------------------------------- |
| reads mutable proxy tags dynamically |    1 | `TestProxyTagsRouteReadsMutableTagsDynamically` |

`ProxySubscriptionTab.test.tsx`（1 例）→ `web/src/proxy/ProxySubscriptionTab.test.tsx`：

| 旧用例（逐字）                                                 | 例数 | 新用例                              |
| -------------------------------------------------------------- | ---: | ----------------------------------- |
| saves a typed tag when the user submits without pressing Enter |    1 | 同名用例（`ProxySubscriptionForm`） |

偏差：① 同上，`force-dynamic` 无对应物，改为行为断言；② 旧组件自取数据（`useEffect` + fetch），新栈由路由页持有数据、页签只渲染 props，故 `ProxySubscriptionTab` 的取数路径由路由级用例覆盖；③ 旧表单的 Dialog/Select/RadioGroup 来自 shadcn+Radix，新栈用原生 `dialog` 结构与原生 `select`/`radio`，`getByLabelText`/`placeholder` 定位保持不变。另补 `server/internal/httpapi/proxy_test.go` 的 4 例路由级用例（CRUD 回环、清空到期日、400 校验文案、会话门禁）——旧栈这五个 handler 无路由测试，本票按「行为以旧栈实现为规范」补锁定。

### 已闭合文件的用例级对账（#35）

`SortablePriorityList.test.tsx`（13 例）→ `web/src/priorities/SortablePriorityList.test.tsx`（13 例，Solid + solid-dnd 通过 `./dnd` 接缝以 mock 方式对齐旧栈的 `@dnd-kit/sortable` mock）：

| 旧 describe                       | 旧用例（逐字）                                                                                        | 例数 | 新用例                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ---: | --------------------------------------------------- |
| priority indicators               | numbers visible subscriptions continuously and spans the full color range                             |    1 | 同名用例                                            |
| priority indicators               | uses the highest-priority color for a one-item scene                                                  |    1 | 同名用例                                            |
| priority indicators               | moves the rank and color with a subscription after reordering                                         |    1 | 同名用例（通过重建组件覆盖重排）                      |
| exhausted scope labels            | does not render a scope label when no resetSchedules exist                                            |    1 | 同名用例                                            |
| exhausted scope labels            | does not render a scope label when schedules exist but none are exhausted                             |    1 | 同名用例                                            |
| exhausted scope labels            | does not render a scope label when exhausted schedule is disabled                                     |    1 | 同名用例                                            |
| exhausted scope labels            | renders the matching scope label when a single schedule is exhausted                                  |    1 | 同名用例                                            |
| exhausted scope labels            | renders the largest scope when multiple schedules are exhausted (monthly > weekly > fiveHour)           |    1 | 同名用例                                            |
| exhausted scope labels            | picks weekly over fiveHour when both are exhausted                                                    |    1 | 同名用例                                            |
| exhausted scope labels            | does not render a scope label for cancelled subscriptions                                             |    1 | 同名用例                                            |
| exhausted scope labels            | does not render a scope label for paused subscription without exhausted schedules                     |    1 | 同名用例                                            |
| exhausted scope labels            | renders the scope label with red styling                                                              |    1 | 同名用例                                            |
| exhausted scope labels            | places the scope label before the status badge                                                        |    1 | 同名用例                                            |

路由级新增用例（旧栈无对应行）→ `server/internal/httpapi/priorities_tools_test.go`（`TestPrioritySceneRoutesRoundTrip`、`TestToolPrioritySceneRoutesRoundTrip`、`TestToolRoutesRoundTrip`，合计覆盖订阅/工具优先级场景的完整 CRUD 回环、PATCH 重排序、空名/重名/缺失场景的 4xx 校验、工具的 PUT/DELETE/PATCH 校验与排序回环）；存储级新增 `server/internal/store/priorities_test.go`（场景 CRUD + 重排序，订阅与工具两族）与 `server/internal/store/tools_test.go`（工具 CRUD、重排序、删除后从工具优先级场景中剪除）。

偏差：
- 新栈 `@thisbeyond/solid-dnd` 替代旧栈的 `@dnd-kit/sortable`；`./dnd` 提供可 mock 的 `useSortableRow` 接缝，parity 测试保持与旧栈相同的 mock 结构。
- 场景名在 `create` 时 trim 后存储；`rename`（PUT）也 trim 后比较重名与存储（旧栈 `create` trim、`update` 存原值，前端两处都先 trim，故观察行为一致）。
- 工具 PUT 仅更新已声明字段（`name`/`category`/`provider`/`providerCustom`/`forms`/`isOpenSource`/`repoUrl`/`status`/`notes`）；旧栈通过 spread 接受任意字段（含 `order`），新栈通过 PATCH `/api/tools` 的 `toolIds` 进行排序。

## 不适用

| 测试文件 | 用例 | 理由                                                      | 状态 |
| -------- | ---: | --------------------------------------------------------- | ---- |
| （空）   |      | 图表功能移除（ADR-0018 范围修订 ②）不产生行：图表本无测试 |      |

## 部署契约（#41，矩阵外新增）

旧栈部署没有任何测试文件，本票**不关闭矩阵行**（582 例去向不变），改为把 ADR-0018 的部署面契约写成可执行断言，防止漂移：

| Go 测试                                                                                         | 覆盖契约                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `deploycontract` `TestDockerfileBuildsWebThenGoThenDistroless`                                  | 三阶段（node→go→distroless）、`CGO_ENABLED=0`、`go:embed` 暂存、运行阶段无构建工具                               |
| `deploycontract` `TestDockerfileKeepsDataVolumeWritableForContractUser`                         | `/data` 归属 `1000:1000`、运行镜像非 root                                                                        |
| `deploycontract` `TestComposePreservesExternalContract`                                         | 端口 3000、`./data:/data`、`DATA_DIR`、`user 1000:1000`、1CPU/512M、env_file、healthcheck 节奏、日志上限、网络名 |
| `deploycontract` `TestComposeHealthcheckWorksInDistroless`                                      | healthcheck 不依赖 shell/wget/curl（改走二进制子命令）                                                           |
| `deploycontract` `TestVolumeDestinationMatchesDataDir`                                          | 卷挂载目标与 `DATA_DIR` 一致（SQLite 库与 `backups/` 快照落在卷上）                                              |
| `deploycontract` `TestRootMakefileKeepsCommandFamily` / `TestDockerMakefileBuildsNewStackImage` | make 命令族不变、镜像标签与 `--project-directory`、构建参数透传                                                  |
| `deploycontract` `TestSystemdServiceRunsSingleBinary` / `TestSystemdReadmeDocumentsInstallPath` | unit 只 exec 单二进制、安装路径文档化                                                                            |
| `healthcheck` `TestProbeAcceptsHealthyServer` 等 7 例                                           | distroless 内健康探测语义：2xx 才健康、非 2xx/不可达/PORT 非法均非 0                                             |
