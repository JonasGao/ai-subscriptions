# AI Subscriptions Project

AI 订阅管理应用：Go 单二进制（`server/`）+ SolidJS SPA（`web/`），数据存 SQLite。重写依据见
`docs/adr/0017-storage-engine-sqlite-migration.md`（存储）与 `docs/adr/0018-go-solidjs-single-binary-rewrite.md`
（架构、范围与验收指标）。

## Commands

```bash
make build          # web/ 构建 SPA → 暂存 server/internal/webui/dist → go build，产物 server/bin/ai-subscriptions
make test           # 全量：go test ./... + web/ vitest
make run            # make build 后直接运行单二进制（默认 :3000）
make web-install    # 安装 web/ 依赖（npm ci）
make web-build      # 只构建 SPA 并暂存给 go:embed
make server-build   # 只编译 Go 二进制（需先 web-build）
make clean          # 清理构建产物（保留 go:embed 占位）
```

分栈测试/开发：

```bash
cd server && go test ./...             # Go 全量测试（表驱动，parity 与领域行为）
cd server && go run ./cmd/server       # 开发用后端（:3000）
npm --prefix web test                  # vitest run
npm --prefix web run dev               # Vite 开发服务器，/api 代理到 127.0.0.1:3000
```

## Architecture

- **后端**：Go 1.27 + chi（`server/`）。除 auth 外所有 API 路径/方法/JSON 形状与旧栈字节对齐。
- **前端**：Vite + SolidJS SPA（`web/`），构建产物经 `go:embed` 打进单二进制。
- **数据存储**：SQLite（`modernc.org/sqlite`，WAL）——库文件 `ai-subscriptions.db` 与 `backups/` 快照位于
  `DATA_DIR`。`DATA_DIR` 未设时依次回退 `XDG_DATA_HOME/ai-subscriptions`、`~/.local/share/ai-subscriptions`；
  容器内固定为 `/data`。首次启动发现旧 `*.json` 会先做 JSON 快照再单向导入，之后不再读 JSON（ADR-0017）。
- **认证**：自研无状态 HMAC 签名 cookie（7 天），登录/登出/会话为 `POST /api/auth/login`、
  `POST /api/auth/logout`、`GET /api/auth/session`；默认种子账号 `admin/admin123`，首登强制改密。
- **加密**：凭据 AES-256-CBC，密钥 `sha256(NEXTAUTH_SECRET + "-api-key-encryption")` 派生，与旧栈密文字节级兼容。
- **调度与通知**：`time.Ticker` 5 分钟 tick；飞书 oapi-sdk-go（Channel 模块 WS 长连接）。
- **前端实现约定**（ADR-0018 修订记录）：对话框/`select`/`radio` 用原生元素（对话框为 `div role="dialog"`），
  图标为手写内联 SVG，错误提示为页面/对话框内联错误条。不引入 solid-ui/Kobalte、unplugin-icons、solid-sonner。

## Key Files

| Path                                        | Purpose                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `server/cmd/server/main.go`                 | 进程入口：配置、存储、调度、HTTP 服务、嵌入 SPA 静态资源           |
| `server/cmd/migration-drill/main.go`        | JSON→SQLite 迁移演练/校验（只读源目录，逐项核对行数与密文）        |
| `server/internal/httpapi/`                  | chi 路由与各 API handler（auth 除外与旧栈对齐）                    |
| `server/internal/store/`                    | SQLite 存储层、旧 JSON 导入、快照备份；`migrations/` 为内嵌 schema |
| `server/internal/auth/`                     | 登录限流、会话 HMAC、改密                                          |
| `server/internal/crypto/`                   | AES-256-CBC 凭据加解密（字节级兼容旧栈）                           |
| `server/internal/providers/`                | provider 注册表、用量/余额/模型查询与签名                          |
| `server/internal/scheduler/`                | 重置/对齐/校准的 5 分钟调度 tick                                   |
| `server/internal/notify/`                   | 飞书通知、payload、WS 监听                                         |
| `server/internal/webui/`                    | `go:embed` 的 SPA 暂存目录（`dist/` 由 make web-build 生成）       |
| `web/src/routes.tsx`                        | 前端路由表                                                         |
| `web/src/pages/`                            | 订阅、工具、代理订阅、登录、改密页面                               |
| `web/src/components/`                       | 订阅卡片/表单、统计卡、重置计划、主题切换等                        |
| `web/src/{auth,subscriptions,tools,proxy}/` | 各领域 API 与业务模块                                              |
| `Dockerfile` / `deploy/docker/`             | 多阶段镜像与 Docker 部署（默认）                                   |
| `deploy/systemd/`                           | systemd 用户服务部署（备选）                                       |
| `docs/parity-matrix.md`                     | 582 例旧测试逐条去向对账（cutover gate）                           |

## Deployment

两种方式二选一，均占 3000 端口，**不可同时启用**。Docker 为默认方式。

### Docker（默认）

镜像由根 `Dockerfile` 多阶段构建：`node` 构建 SPA → `go` 以 `CGO_ENABLED=0` 编译单二进制 → `distroless/static`
运行（约 25MB，常驻 RSS 约 6MiB）。部署配置在 `deploy/docker/`（`Makefile`、`docker-compose.yml`、`smoke.sh`），
根 `Makefile` 只做转发。运行时目录 `~/docker/ai-subscriptions/` 放 `.env`、`data/` 与可选的 `build.env`。

```bash
make deploy    # Build image + compose up
make image     # Build image only
make smoke     # Verify image contract on a throw-away container
make up/down/restart/status/logs
make uninstall # Remove container (image and ~/docker data kept)
```

容器非 root（1000:1000），限制 1.0 CPU / 512M，数据卷 `~/docker/ai-subscriptions/data` → `/data`（`DATA_DIR`，
含 SQLite 库与 `backups/` 快照）。Compose 固定以 `--project-directory ~/docker/ai-subscriptions` 运行，
因此 `./data`、`.env` 相对运行时目录解析——不要在 `deploy/docker/` 裸跑 `docker compose`。基础镜像与
Go 代理由 `NODE_IMAGE` / `GO_IMAGE` / `RUNTIME_IMAGE` / `GOPROXY` 决定，可在 `build.env` 覆盖。
运行镜像无 shell，healthcheck 走二进制自带的 `healthcheck` 子命令。详见 `deploy/docker/README.md`。

### systemd

构建并安装单二进制为用户服务：`make -C deploy/systemd install`（安装到 `~/.local/bin/ai-subscriptions`，
unit 写到 `~/.config/systemd/user/ai-subscriptions.service`），其余目标见 `deploy/systemd/README.md`。

## Conventions

- **Go 测试**：表驱动，逐条映射旧 vitest 用例；`docs/parity-matrix.md` 是行为规范来源。
- **前端测试**：vitest + `@solidjs/testing-library`（jsdom），文件与被测模块同目录 `*.test.ts(x)`。
- **导入**：`web/` 使用相对路径（无 `@/` 别名）；Go 包按 `server/internal/<domain>` 组织。
- **不改 API 形状**：auth 端点除外，其余契约以旧栈为准；领域术语见 `GLOSSARY.md` / `CONTEXT.md`。
- **数据目录不入库**：SQLite 库、备份与 `.env` 均属运行时状态。

## Data Model

- **Subscription**：recurring/one-time，billingCycle（monthly/yearly），status（active/paused/cancelled），
  balance（可选，一次性订阅），凭据密文。
- **Tool**：forms（CLI/TUI、GUI、Web）、isOpenSource、order（排序）。
- **ProxySubscription**：独立于 AI 订阅，手动状态与专属标签。
- 领域定义与关系以 `CONTEXT.md`、`GLOSSARY.md` 与 `docs/adr/` 为准。

## RTK Token Optimization

Prefix shell commands with `rtk` to compress output (saves 60-90% tokens):

```bash
rtk git status
rtk git log -10
```

## Commit Per Phase

Commit after each completed development phase. Do not batch multiple phases into a single commit.

```bash
git status && git add <relevant-files> && git commit -m "<message>"
```
