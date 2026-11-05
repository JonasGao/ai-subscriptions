# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**单人自托管的使用者**（用户明确确认：「单人自托管的工具类型」）。使用者本人部署、维护并独占一个实例：代码中只有默认 `admin` 账号与首登强制改密，没有多用户、角色、共享或权限体系。ADR-0018 称其为「登录后个人工具」。

主要任务：把自己名下不同类型的 AI 订阅连同金额与相关信息记下来、随时查得到——我有哪些订阅、各花多少钱、什么时候续费/到期、现在哪个可用。用户原话：「类似记账本，记录一些不同类型的订阅，以及相关的金额和信息之类的」。

## Product Purpose

一个个人 AI 订阅记账本：把周期性订阅、一次性订阅与代理订阅集中记录，保存金额、状态、到期日、凭据与备注，并提供月度/年度支出统计与续费提醒。使用者需要核对「订阅清单与花费」时，打开自己部署的实例即可，数据留在本机 SQLite。

成功 = 账目记得全、查得到、不依赖外部托管服务；不是把订阅做成自动化调度平台。

## Positioning

用户确认的定位：**个人订阅记账本**——记录不同类型的订阅以及相关的金额和信息。

init 中曾提出「厂商中立的额度控制台」「本地重置时间校准构成差异化主张」，用户明确把定位收敛为记账本，**该更强主张已被否定，不得替产品发明更锋利的对外定位或竞争声明**。额度重置计划、实时用量/余额/模型查询、重置时间对齐与校准、优先级场景等是产品具备的功能，属于记账信息的采集与展示方式，不是定位声明。

## Operating Context

- 自托管部署，二选一且同占 3000 端口、不可同时启用：Docker（默认，`deploy/docker/`，distroless 非 root 1000:1000，数据卷 `~/docker/ai-subscriptions/data` → `/data`）或 systemd 用户服务（`deploy/systemd/`）。
- 单个 Go 二进制内含 `go:embed` 的 SolidJS SPA；`DATA_DIR` 下为 `ai-subscriptions.db`（SQLite/WAL）与 `backups/` 快照（保留 10 份）。首次启动遇到旧 `*.json` 先做快照再单向导入，之后不再读 JSON。
- 认证：默认 `admin/admin123`，首次登录强制改密；7 天无状态 HMAC 签名 cookie。凭据以 AES-256-CBC 加密，密钥由 `NEXTAUTH_SECRET` 派生，密文与旧栈字节级兼容。
- 日常操作：订阅增删改查、按分类/状态筛选、支出统计、7 天内续费提醒、优先级场景拖拽排序、工具清单、代理订阅与其专属标签、用量/余额/模型查询、重置计划与校准、飞书应用机器人通知与 WS 监听。
- 界面与文档以中文为主；领域术语以 `CONTEXT.md`、`GLOSSARY.md`、`docs/UBIQUITOUS_LANGUAGE.md` 为准（如 Subscription 避免称 Account，Plan 避免称套餐）。
- 开发与验证：`make build` / `make test` / `make run`；分栈为 `cd server && go test ./...`、`npm --prefix web test`、`npm --prefix web run dev`（/api 代理到 127.0.0.1:3000）。

## Capabilities and Constraints

以下为当前代码与 ADR 的事实（仓库证据），除「用户已确认」条目外尚未逐条经用户确认为产品级承诺。

- 功能范围（README / AGENTS.md）：订阅（周期性/一次性）管理、支出统计、分类与标签、active/paused/cancelled 状态、续费提醒、优先级场景、工具清单、代理订阅、用量/余额/模型查询、重置计划与校准、飞书通知、SQLite 自动快照备份。
- 契约冻结：除 auth 端点外，全部 API 路径/方法/JSON 形状与旧栈字节对齐；auth 改为 `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/session`。领域模型与既有 ADR 全部沿用。
- 范围修订：图表功能按 ADR-0018 **不移植**，recharts 不引入；无对应测试用例，parity 矩阵零受影响行。
- 前端实现约定：对话框为 `div role="dialog"` 原生元素，`select`/`radio` 用原生；图标为手写内联 SVG；错误提示为页面/对话框内联错误条。不引入 solid-ui/Kobalte、unplugin-icons、solid-sonner。
- 资源上限：镜像 <50MB、常驻 RSS <150MB；容器限 1.0 CPU / 512M，非 root 1000:1000。
- 测试约定：Go 表驱动并逐条映射旧 vitest 用例；前端 vitest + `@solidjs/testing-library`（jsdom），`*.test.ts(x)` 与被测模块同目录；`web/` 使用相对路径、无 `@/` 别名。
- 运行时状态不入库：SQLite 库、`backups/`、`.env`、`.impeccable/` 下的会话产物。
- 进程内状态（登录限流计数、飞书 token 缓存、WS 连接）重启即失，与旧栈语义一致，非回归。
- cutover gate：`docs/parity-matrix.md` 闭合 582 条逐条去向 + `docs/smoke-checklist.md` 冒烟清单。

## Brand Commitments

- 名称：`AI订阅管理工具` / `AI Subscriptions`（README、package.json）。
- 中文界面与中文文档；MIT License。
- README 明确标注「截图为演示数据，非真实订阅信息」：`docs/screenshots/*.png` 是模拟数据，不得当作真实用户、真实订阅或用量证据，也不得据此虚构客户与案例。
- 用户本轮未确认额外的品牌语气、Logo、视觉资产或对外承诺。

## Evidence on Hand

- `CONTEXT.md`、`GLOSSARY.md`、`docs/UBIQUITOUS_LANGUAGE.md`：统一语言与关系。
- `docs/adr/0001–0018`：架构、领域与范围决策；`docs/rewrite-plan.md`、`docs/cutover-migration-drill.md`：重写与迁移记录。
- `docs/parity-matrix.md`（582 例）、`docs/smoke-checklist.md`、`docs/walkthrough.md`：行为规范与验收。
- `README.md`、`AGENTS.md`：功能清单、部署与开发约定。
- `docs/screenshots/*.png`：演示数据截图（浅色/深色订阅列表、订阅表单、工具、代理订阅、登录）。
- **不存在**：真实用户数据、客户证言、案例研究、媒体报道、定价或性能基准（资源上限是设计目标而非实测报告）。未来工作不得虚构上述内容。

## Product Principles

1. **它是记账本，不是控制台。** 新增能力服务于「把订阅、金额与相关信息记全、查得到」；不为了技术表现力改写成更强的产品主张。
2. **单人自托管优先。** 数据留在使用者自己的机器；不引入多用户、账号体系或外部托管依赖。
3. **保真移植优于重构。** API 形状、领域术语与既有行为是契约；改动先对照 ADR 与 parity 矩阵，不擅自改变术语或数据语义。
4. **轻量可部署是硬约束。** 单二进制、SQLite、镜像与内存上限不可被新依赖悄悄突破。
5. **演示数据不等于事实。** 截图与文档中的订阅均为模拟，不得据此推断真实使用情况或对外宣称。

## Open Decisions

以下项目在本轮访谈中未被用户逐条确认，保留为待确认项，不要当作已批准的产品承诺：

- 平台 `web` 由仓库证据判定（SolidJS SPA + Go HTTP 服务），用户本轮未单独确认；非 native / adaptive。
- 无障碍标准、品牌语气/Logo、真实用户或对外承诺：未确认，仓库中亦无相关资料。
- `Capabilities and Constraints` 中的技术/范围冻结项（API 形状、无图表、原生元素约定、资源上限、双部署互斥）为当前代码与 ADR 的现状事实；若要作为长期产品承诺或予以变更，需显式确认。
