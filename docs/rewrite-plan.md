# Go + SolidJS 重写实施计划

依据 ADR-0017（存储引擎）与 ADR-0018（架构、范围修订、验收指标）执行。每阶段一个 commit、测试绿才进下一阶段；parity 对账见 [parity-matrix.md](parity-matrix.md)。

## 过渡期纪律

- 旧栈（`app/` + `lib/` + `__tests__/`）冻结：仅收紧急 bugfix；新需求排队到 cutover 后在新栈实现。
- 两栈不共享写：旧栈继续用 JSON，新栈只在 cutover 部署后接管 `DATA_DIR`。
- `server/` 与 `web/` 并行开发，cutover 前 `make deploy` 仍部署旧栈。

## 阶段

### P1 存储层 + 认证

`server/` 脚手架（Go module `ai-subscriptions`、chi、目录布局）；加密模块（AES-256-CBC 字节级兼容 + sha256 派生）；SQLite 存储层（modernc 驱动、WAL、嵌入迁移 + `user_version`、文件快照备份留 10 份）；JSON→SQLite 启动自迁移器（迁移前快照、单向、密文原样搬）；auth（种子账号/isInitial/改密/登录限流、HMAC 无状态 cookie、login/logout/session 端点）。
**Gate**：`db`、`tags`、加密、迁移器用例移植绿（含生产 JSON 副本迁移演练脚本）。

### P2 订阅核心 + 领域数学

订阅 CRUD、分类、状态策略、重置计划（创建两种途径、唯一性、fiveHour/weekly/monthly 计算）、对齐与校准、用尽标记、调度器 tick（time.Ticker 5min）。
**Gate**：`utils`、`reset-*`、`subscription-status-edit`、`status-policy` 等对应行闭合。

### P3 provider 集成（分批）

火山 V4 签名器 → fangzhou 三模块 → 阿里 ACS3 → GitHub token 交换 → moonshot/zhipu/opencode/deepseek/siliconflow/openrouter → 注册表与能力标记、通用模型获取回退。
**Gate**：providers 相关 ~20 个测试文件对应行闭合（签名/窗口解码/token 交换边例逐条过）。

### P4 其余 API

priorities / tool-priorities / tools / tags（含 API 缓存）/ proxy-subscriptions / proxy-tags / notifications CRUD + 测试发送 / 飞书（应用机器人、WS 监听启停、chats、lookup-user）/ providers 只读注册表端点。
**Gate**：路由级用例（`*-route`）与通知/飞书行闭合；29 条 API 契约对齐复核。

### P5 SolidJS 前端

`web/` 脚手架（Vite + TS + vitest + jsdom）；solid-ui/Kobalte 原语与主题 tokens 平移；unplugin-icons（lucide 34 图标）；订阅页（无饼图区块）、表单、卡片、优先级拖拽、工具/标签/代理订阅/通知页、登录与改密；`go:embed` 集成。
**Gate**：solid 侧 9 文件 74 例闭合；全站手动走查。

### P6 部署 + cutover

多阶段 Dockerfile（node 构建 web → go 编译 → distroless）；`deploy/docker` 与 `deploy/systemd`（单二进制安装）适配，make 命令族与对外契约不变。
**cutover gate**（ADR-0018）：parity 矩阵全闭合 + 冒烟清单（登录/改密/首登强制改密、订阅 CRUD + 优先级拖拽、火山/阿里/DeepSeek 实时查询、重置计划与校准触发、飞书通知测试发送 + WS 启停、生产副本迁移演练、备份快照可恢复、镜像 <50MB 且 RSS <150MB）。
**通过后**：单提交删除旧栈（`app/`、`lib/`、`__tests__/`、旧 Dockerfile/config），AGENTS.md 与 CONTEXT.md 同步改写。
