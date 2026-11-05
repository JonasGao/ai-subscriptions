# Cutover 冒烟清单记录（#42）

日期：2026-11-05
分支/提交：`t/42` @ `48c8374`（本次冒烟记录的提交在其之上）
对象：新栈单二进制（`server/bin/ai-subscriptions`，Go + 内嵌 SolidJS SPA）
数据：生产 JSON 副本（只读源目录 `~/docker/ai-subscriptions/data`；仓库内 `data/` 不存在）
运行目录：`/tmp/smoke-42`，监听 `127.0.0.1:3999`（**未使用 3000，未触碰运行中的 Docker 容器/生产服务**）

迁移演练与资源指标已分别记录在 [cutover-migration-drill.md](cutover-migration-drill.md) 与本票的资源指标记录中，
本文只补评审指出的六项功能冒烟。

## 安全与留痕约定

- 所有命令只连接本机 `3999` 上的临时二进制；外发请求仅限应用日常的 provider 只读查询与飞书 WS 被动连接。
- 文档不记录任何密钥/token/密码/会话 cookie 明文；响应中的 `appSecret`、`Set-Cookie` 已省略或打码。
- 数字额度、HTTP 状态、耗时与行数原样保留。
- 飞书**测试发送未执行**（会外发真实消息），见第 6 节。

## 0. 构建与启动

```bash
cd /home/god/ai-subscriptions-wt/t42
make build
# ... vite build 成功
# cd server && go build -trimpath -o bin/ai-subscriptions ./cmd/server
# built server/bin/ai-subscriptions
```

准备数据副本（`auth.json` 不纳入副本，见下方偏差说明）：

```bash
mkdir -p /tmp/smoke-42
cp <源目录>/{subscriptions,priorities,tools,tool-priorities,proxy-subscriptions,notifications,last-monthly-reset}.json \
   /tmp/smoke-42/
```

启动（`NEXTAUTH_SECRET` 只 source、不打印，保证迁移来的凭据密文可解）：

```bash
set -a; source ~/docker/ai-subscriptions/.env; set +a
PORT=3999 DATA_DIR=/tmp/smoke-42 ./server/bin/ai-subscriptions
```

服务日志摘录：

```text
backup snapshot: /tmp/smoke-42/backups/ai-subscriptions.2026-11-05T00-00-00-410Z.db
listening on :3999 (data dir: /tmp/smoke-42)
```

```text
GET /api/health -> HTTP 200 {"status":"ok"}
```

结论：**通过**。单二进制在空闲端口启动，生产 JSON 自动迁移完成，启动快照生成。

## 1. 登录 / 改密 / 首登强制改密

命令（cookie 保存在临时 jar，响应只摘录正文）：

```bash
curl -sS http://127.0.0.1:3999/api/auth/is-initial
curl -sS -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' http://127.0.0.1:3999/api/auth/login
curl -sS -b cookies.txt -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"oldPassword":"admin123","newPassword":"<REDACTED_SMOKE_PASSWORD>"}' \
  http://127.0.0.1:3999/api/auth/change-password
curl -sS -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<REDACTED_SMOKE_PASSWORD>"}' http://127.0.0.1:3999/api/auth/login
curl -sS http://127.0.0.1:3999/api/auth/is-initial
curl -sS -b cookies.txt -c cookies.txt -X POST http://127.0.0.1:3999/api/auth/logout
curl -sS http://127.0.0.1:3999/api/subscriptions
```

响应摘录：

```text
GET  /api/auth/is-initial            -> HTTP 200 {"isInitial":true}
POST /api/auth/login  (admin/admin123) -> HTTP 200 {"user":{...,"isInitial":true}}
POST /api/auth/change-password       -> HTTP 200 {"success":true}
POST /api/auth/login  (新密码)        -> HTTP 200 {"user":{...,"isInitial":false}}
GET  /api/auth/is-initial            -> HTTP 200 {"isInitial":false}
POST /api/auth/logout                -> HTTP 200 {"success":true}
GET  /api/subscriptions (无 cookie)  -> HTTP 401 {"error":"未登录"}
```

重启二进制后使用新密码仍可登录（`HTTP 200`，`isInitial:false`），说明改密已持久化到 SQLite。

结论：**通过**。首登 `isInitial=true`、种子账号登录、强制改密、新密码重登、标志清除、登出与受保护路由 401 全部符合预期。

## 2. 订阅 CRUD + 标签重名合并

命令与响应摘录：

```text
GET    /api/subscriptions                         -> HTTP 200，20 条
POST   /api/subscriptions                         -> HTTP 201
       {"id":"beeb83da-...","status":"active",
        "resetSchedules":[{"id":"smoke-sched-1","type":"monthly","exhausted":false}]}
PUT    /api/subscriptions/beeb83da-...            -> HTTP 200
       {"status":"paused","notes":"smoke #42 update",
        "tagIds":["7d2807d3-f074-4d36-8394-f5424b6271cf"]}
PUT    /api/subscriptions/beeb83da-... (status)   -> HTTP 200 {"status":"active"}
DELETE /api/subscriptions/beeb83da-...            -> HTTP 200 {"success":true}
GET    /api/subscriptions/beeb83da-...            -> HTTP 404 {"error":"Subscription not found"}
GET    /api/subscriptions                         -> HTTP 200，20 条
```

标签重名合并：更新时提交 `tagNames:["👎太贵","👎太贵"]`。响应只有一个 `tagId`，且等于生产数据中已存在的
同名标签 `7d2807d3-...`；随后 `GET /api/tags` 仍为 2 条，没有产生重复标签行。

结论：**通过**。list / create / update（含 active↔paused 状态切换）/ delete 全链路正常；重复标签名合并到既有标签。

## 3. 优先级排序（拖拽对应的 PATCH reorder）

```bash
curl -sS -b cookies.txt http://127.0.0.1:3999/api/priorities
curl -sS -b cookies.txt -X PATCH -H 'Content-Type: application/json' \
  -d '{"action":"reorder","subscriptionOrder":[<逆序后的 14 个 id>]}' \
  http://127.0.0.1:3999/api/priorities/8b284d4e-9930-49b7-8424-f05b49255eaa
curl -sS -b cookies.txt http://127.0.0.1:3999/api/priorities
```

响应摘录：

```text
GET   /api/priorities -> HTTP 200，3 个场景；首个场景「常规编码」14 个订阅 id
PATCH /api/priorities/8b284d4e-... -> HTTP 200
      {"name":"常规编码","subscriptionOrder":["c67e9c7f-...","259a29ea-...","a08e2d58-...", ... 14 项],
       "updatedAt":"2026-11-05T00:01:03.153Z"}
GET   /api/priorities -> HTTP 200，读回顺序与 PATCH 请求完全一致
```

结论：**通过**。reorder 经 HTTP 落库，读回顺序与请求逐项相等。

## 4. 重置计划与校准触发

创建时携带一个 `monthly` 重置计划，随后通过 toggle 端点切换：

```text
POST /api/subscriptions/beeb83da-.../schedules/smoke-sched-1/toggle {"exhausted":true}
  -> HTTP 200 {"status":"paused","resetSchedules":[{...,"exhausted":true,
     "updatedAt":"2026-11-05T00:00:57.063Z"}]}
POST /api/subscriptions/beeb83da-.../schedules/smoke-sched-1/toggle {"exhausted":false}
  -> HTTP 200 {"status":"active","resetSchedules":[{...,"exhausted":false,
     "updatedAt":"2026-11-05T00:00:57.091Z"}]}
```

调度 tick 是 5 分钟 `time.Ticker`，无法在冒烟窗口内实时等待；按评审要求引用服务端 Go 测试作为佐证
（本次复跑 `PASS`，由测试覆盖，而非实时服务等待）：

| 行为 | 测试 |
| --- | --- |
| tick 周期执行 / 取消即停 / 不立即 tick | `internal/scheduler`: `TestRunTicksOnEveryIntervalAndStopsOnCancel`、`TestRunDoesNotTickImmediately`、`TestRunReportsErrorsAndKeepsTicking` |
| 校准改写 nextResetTime / 单次抓取对齐全部 schedule / weekly+monthly 推导 | `internal/calibration`: `TestAlignResetTimesOverwritesNextResetTime`、`TestAlignResetTimesAlignsAllEnabledSchedulesWithOneFetch`、`TestAlignResetTimesDerivesWeeklyConfig`、`TestAlignResetTimesDerivesMonthlyConfig` |
| 重置 tick 触发并清除 exhausted / 未用尽只推进 / 跳过 cancelled | `internal/store`: `TestResetTickTriggersAndClearsExhaustion`、`TestResetTickAdvancesWithoutTriggeringWhenNotExhausted`、`TestResetTickSkipsCancelledSubscriptions` |

```text
go test ./internal/scheduler ./internal/calibration ./internal/store -run '<上述测试名>' -v
--- PASS: TestAlignResetTimesAlignsAllEnabledSchedulesWithOneFetch (0.00s)
--- PASS: TestAlignResetTimesDerivesWeeklyConfig (0.00s)
--- PASS: TestAlignResetTimesDerivesMonthlyConfig (0.00s)
--- PASS: TestResetTickSkipsCancelledSubscriptions (0.01s)
--- PASS: TestResetTickAdvancesWithoutTriggeringWhenNotExhausted (0.01s)
--- PASS: TestResetTickTriggersAndClearsExhaustion (0.00s)
PASS
ok  	ai-subscriptions/internal/store	0.024s
```

结论：**通过**。计划创建与手动 toggle 已实时留痕；5 分钟 tick 与查询驱动校准由上述 Go 测试覆盖（如实标注，未实时等待）。

## 5. 火山 / 阿里 / DeepSeek 实时查询

从迁移数据中选取真实存在、带凭据的订阅，调用只读查询端点：

| 厂商 | 订阅 | 端点 | HTTP | 返回摘要 |
| --- | --- | --- | ---: | --- |
| 火山（`fangzhou` / 火山方舟） | 方舟 Agent Plan `259a29ea-65d4-43db-b74c-3a34c444f2f8`（Agent Plan，active，有凭据） | `GET /api/subscriptions/{id}/usage` | 200 | `fiveHour` limit 10000 / used 0 / remaining 10000；`weekly` limit 35000 / used 31674.8439 / remaining 3325.1561；`monthly` limit 100000 / used 69252.7792 / remaining 30747.2208 |
| 阿里（`alibaba`） | 阿里云 Token Plan `3017a6f6-38ce-412e-8b32-76088916036f`（token-plan，active，有凭据） | `GET /api/subscriptions/{id}/usage` | 200 | `monthly` limit 250000 / used 153124.5287 / remaining 96875.4713；`fiveHour`、`weekly` 为 null |
| DeepSeek（`deepseek`） | DeepSeek `18acdf8f-c161-4f2c-a680-0383c34e3232`（one-time，cancelled，有凭据） | `GET /api/subscriptions/{id}/balance` | 200 | `provider:"deepseek"`，`isAvailable:false`，1 条 `CNY` 余额：available `-1.21` |

命令示例：

```bash
curl -sS -b cookies.txt http://127.0.0.1:3999/api/subscriptions/259a29ea-.../usage
curl -sS -b cookies.txt http://127.0.0.1:3999/api/subscriptions/3017a6f6-.../usage
curl -sS -b cookies.txt http://127.0.0.1:3999/api/subscriptions/18acdf8f-.../balance
```

偏差说明：

- 注册表中「火山」的 provider id 是 `fangzhou`（名称「火山方舟」），不存在字面 id `volcengine`；因此用方舟
  Agent Plan 覆盖「火山」一项，未替换成其他厂商。
- 阿里 Coding Plan 无凭据、无 usage 端点，故使用有凭据的阿里 Token Plan。
- DeepSeek 订阅是 one-time/cancelled，usage 端点只支持 recurring，改用 balance 端点（余额属日常只读查询）。
- usage 端点按 ADR-0016 会用查询结果校准重置计划（应用日常行为），未做任何额外管理端写入。

结论：**通过**。三家均返回 HTTP 200 且额度摘要合理（DeepSeek 为真实负余额，`isAvailable:false`）。

## 6. 飞书通知：配置、WS 启停；测试发送留待人工

配置读取（凭据已脱敏）：

```text
GET /api/notifications -> HTTP 200
{"channels":[{"type":"feishu-app","name":"飞书测试1","enabled":true,
  "hasAppSecret":true,"hasSecret":true,"lastSendResult":{"success":true,...}}],
 "defaultLowBalanceThreshold":10}
```

WS 监听启动（用已保存渠道的 `channelId` 解析凭据）→ 轮询 → 停止，全程被动连接、未发送任何消息：

```text
POST   /api/notifications/feishu-app/listen {"channelId":"d35656e7-..."}
  -> HTTP 200 {"appId":"cli_****","listenId":"4f36b72f-...","startedAt":"2026-11-05T00:01:21Z",
     "messageCount":0,"stopped":false,"ttlSeconds":120}
GET    /api/notifications/feishu-app/listen?listenId=4f36b72f-...
  -> HTTP 200 {"messages":[],"status":{...,"stopped":false,"messageCount":0}}
DELETE /api/notifications/feishu-app/listen?listenId=4f36b72f-...
  -> HTTP 200 {"success":true}
```

测试发送：**未执行**。该操作会向真实飞书会话外发消息：

> 留待用户 main 合并前人工冒烟（外发真实消息，需用户执行）。

结论：**部分通过（按约定）**。配置读取与 WS 监听启停已实时留痕；测试发送按评审要求不代执行，交由用户人工确认。

## 7. 备份快照可恢复

二进制启动时在 `DATA_DIR/backups` 生成快照（保留最近 10 份）。首次启动快照生成于认证种子之前，
因此重启一次再取快照，使 `auth_user` 等懒种子数据也进入对比：

```text
/tmp/smoke-42/backups/ai-subscriptions.2026-11-05T00-00-00-410Z.db   (首次启动)
/tmp/smoke-42/backups/ai-subscriptions.2026-11-05T00-00-32-624Z.db   (认证后重启)
```

用 Python 标准库 `sqlite3` 以只读方式打开当前库与最新快照，执行 `PRAGMA integrity_check` 与逐表行数对比
（本机无 `sqlite3` CLI）：

```text
live      integrity=ok  user_version=1
snapshot  integrity=ok  user_version=1
all table counts match: True

subscriptions 20/20   categories 2/2   tags 2/2   subscription_tags 2/2
priority_scenes 3/3   priority_scene_items 23/23
tools 13/13           tool_priority_scenes 1/1   tool_priority_scene_items 5/5
proxy_subscriptions 6/6   proxy_tags 2/2   proxy_subscription_tags 3/3
notification_channels 1/1   balance_transition_states 2/2
auth_user 1/1   app_state 3/3
```

恢复验证：把最新快照复制到独立路径后重新打开，`integrity_check=ok`、`user_version=1`，逐表行数与快照一致。

结论：**通过**。快照可由 SQLite 正常打开、通过完整性检查，关键表行数与当前库一致，复制后可独立恢复。

## 汇总

| 冒烟项 | 结论 |
| --- | --- |
| 登录 / 改密 / 首登强制改密 | 通过 |
| 订阅 CRUD + 标签重名合并 | 通过 |
| 优先级 PATCH reorder 与读回 | 通过 |
| 重置计划 toggle；tick/校准由 Go 测试覆盖 | 通过（tick/校准为测试佐证） |
| 火山 / 阿里 / DeepSeek 实时查询 | 通过（3×HTTP 200） |
| 飞书通知 + WS 启停 | 通过；测试发送留待用户人工执行 |
| 备份快照可恢复 | 通过 |

## 偏差与备注

1. 副本未复制 `auth.json`：生产账号 `isInitial=false` 且密码未知，直接复制无法验证「首登强制改密」链路。
   smoke 运行目录因此走首登种子（`admin/admin123`），改密只写临时 SQLite；生产 `auth.json` 与运行中服务均未被修改。
2. 首次启动快照早于认证接口的懒种子，故 `auth_user` 为 0；重启后生成的第二份快照与本表对比，`auth_user` 为 1。
3. 「火山」在应用注册表中是 `fangzhou`（火山方舟），无字面 `volcengine` provider；已按实际数据记录。
4. 迁移演练与资源指标沿用既有记录，未改动 [cutover-migration-drill.md](cutover-migration-drill.md)。
5. 冒烟结束后关闭临时二进制并删除 `/tmp/smoke-42`（含数据副本、快照、cookie jar 与会话材料）。
