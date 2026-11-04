# 以 Go + SolidJS 重写为单二进制架构（Rewrite to Go + SolidJS Single Binary）

动机是资源/部署：容器限 512M 下 Node + Next 运行时偏重。勘察证实重写可行性：全部页面 `use client`、无 server actions / ISR / edge，Next 粘性为零；582 个 vitest 用例（44 文件）构成可移植的行为规范。我们决定在本仓库以 `server/`（Go）+ `web/`（SolidJS）并行重写，目标是**移植式重写**——领域模型、API 契约、UI 行为对齐，GLOSSARY 与既有 ADR 全部沿用——通过 cutover gate 后单提交删除旧栈。

## 架构决策明细

- **后端**：chi 路由。除 auth 端点外全部 API 字节对齐（路径/方法/JSON 形状）；`/api/auth/is-initial` 与 `/api/auth/change-password` 形状不变，NextAuth 流程替换为 `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/session` 三个简单端点。session 为自研**无状态 HMAC 签名 cookie**（7 天，对齐 NextAuth JWT 的重启存活语义；cutover 时重新登录一次）。
- **存储与加密**：SQLite（ADR-0017）；`NEXTAUTH_SECRET` 变量名与 dev 兜底行为原样沿用，密文格式字节级兼容。
- **前端**：Vite SPA 经 `go:embed` 打进单二进制；solid-js + `@solidjs/router` + `@thisbeyond/solid-dnd`；对话框与 `select`/`radio` 用原生元素（`role="dialog"`），图标为手写内联 SVG，toast 降级为页面/对话框内联错误条；主题切换手写 class toggle（`@solid-primitives/theme` 不存在）。初版曾计划 solid-ui + Kobalte、unplugin-icons + Iconify（lucide 集 34 图标）、solid-sonner，实施中均未引入（见下方修订记录）。
- **飞书与调度**：oapi-sdk-go v3（Channel 模块 WS 长连接）；node-cron → `time.Ticker`（5min tick）；登录限流、飞书 token 缓存、WS 连接保持进程内驻留语义。

## 范围修订（相对全量 parity 仅两处）

1. 存储引擎 JSON → SQLite（ADR-0017）。
2. **移除图表功能**：订阅页饼图区块不移植，recharts 依赖消失；图表无对应测试用例，parity 矩阵零受影响行。

## 修订记录

- **2026-11-04（终审）：前端技术栈与实现对齐。** 初版决定的 solid-ui + Kobalte、unplugin-icons + Iconify（lucide 集 34 图标）、solid-sonner 自始未进入 `web/`：`web/package.json` 的运行时依赖只有 `solid-js`、`@solidjs/router`、`@thisbeyond/solid-dnd`，分支历史也从未引入过这些包。实际实现为原生 `dialog`/`select`/`radio`（对话框以 `div role="dialog"` 手写）、5 个内联 SVG 图标、内联错误条替代 toast。该偏差由 parity 矩阵的组件用例与全站走查锁定；本 ADR 的范围修订、验收指标与 cutover gate 不变。`docs/rewrite-plan.md` 的 P5 阶段描述同步订正。

## 验收指标

镜像 **<50MB**（多阶段构建，distroless 基底）；常驻 RSS **<150MB**。

## cutover gate

`docs/parity-matrix.md` 闭合（582 条逐条登记去向：Go 表驱动测试 / vitest + @solidjs/testing-library / 不适用 + 理由）+ 冒烟清单：登录/改密/首登强制改密、订阅 CRUD + 优先级拖拽、火山/阿里/DeepSeek 三家实时查询、重置计划与校准触发、飞书通知测试发送 + WS 启停、生产 JSON 副本迁移演练、备份快照可恢复、资源指标达标。

## Considered Options

- **Go 单二进制 + SolidJS SPA（选定）**：兑现资源动机的最短路径；勘察证明无 SSR/框架粘性成本。
- **SolidStart**：登录后个人工具无 SEO/首屏需求，SSR 无价值且把 Node 运行时拖回部署面。否决。
- **不重写，继续 Next**：582 个测试零成本保留，但资源/部署痛点无解。已按动机优先级否决。
- **垂直切片推进（前后端同步迁移）**：更早可演示，但 API 形状未稳时前端反复跟改。否决，改后端优先六阶段。

## Consequences

- ~513 例领域/集成用例移植为 Go 表驱动测试、~69 例组件用例以 vitest + @solidjs/testing-library 重写，期间旧栈冻结：新需求排队到 cutover 后，旧栈仅收紧急 bugfix，parity 范围冻结。
- 实施顺序：P1 存储迁移 + auth → P2 订阅核心 + 领域数学 → P3 provider 集成分批 → P4 其余 API → P5 前端移植 → P6 部署 + cutover；每阶段一 commit、测试绿才进下一阶段。
- 部署契约全部不变：端口 3000、`/data` 卷、`DATA_DIR`、非 root 1000:1000、资源限制、make 命令族、systemd 备选路径（改为构建/安装单二进制）。
- 进程内状态重启即失（限流计数、飞书 token 缓存、WS 连接）——与现状语义一致，非回归。
- auth 端点形状变更意味着切换时所有会话失效，一次性成本，已接受。
