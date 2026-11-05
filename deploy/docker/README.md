# Docker 部署

本目录是 Docker 部署（默认方式）的配置目录：`Makefile`（docker 目标实现）、`docker-compose.yml`（编排定义）、`smoke.sh`（镜像契约自检）、本说明。

根目录 `Makefile` 只是瘦代理，`make deploy` 会转发到本目录执行，命令用法不变。

镜像是**多阶段构建**的 Go 单二进制（ADR-0018）：`node` 阶段构建 SolidJS SPA → `go` 阶段把 `web/dist` 放进 `server/internal/webui/dist` 后以 `CGO_ENABLED=0` 编译 → `distroless/static` 运行。运行镜像内无 shell、无 node、无 wget/curl。

## 布局

```
deploy/docker/
├── Makefile            # image/deploy/smoke/up/down/restart/status/logs/uninstall
├── docker-compose.yml  # 编排定义（真源）
├── smoke.sh            # 镜像契约自检（非 root、健康检查、数据卷读写、SPA）
└── README.md
```

运行时目录 `~/docker/ai-subscriptions/` 只保留三样东西，**不放 compose 文件**（避免与仓库双份漂移）：

- `data/` —— 应用数据卷（`ai-subscriptions.db` 与 `backups/` 快照，含用户数据，勿入 git）
- `.env` —— 运行时环境变量（`NEXTAUTH_SECRET`）
- `build.env` —— 可选，机器级构建配置（`NODE_IMAGE` / `GO_IMAGE` / `RUNTIME_IMAGE` / `GOPROXY`）

镜像由仓库根 `Dockerfile` 构建，构建上下文为仓库根（`.dockerignore` 只放行 `server/` 与 `web/`）。

## 基础镜像（构建参数）

`Dockerfile` 的基础镜像不写死，由构建参数决定，默认值对公有源可用：

| 参数            | 默认值                                       | 用途           |
| --------------- | -------------------------------------------- | -------------- |
| `NODE_IMAGE`    | `node:24-alpine`                             | 构建 SPA       |
| `GO_IMAGE`      | `golang:1.27-alpine`                         | 编译单二进制   |
| `RUNTIME_IMAGE` | `gcr.io/distroless/static-debian12:nonroot`  | 运行（非 root）|
| `GOPROXY`       | `https://proxy.golang.org,direct`            | Go 模块代理    |

`deploy/docker/Makefile` 会读取 `~/docker/ai-subscriptions/build.env`（存在则覆盖默认值）——机器无外网直连时，在这里配置镜像源与代理，配置留在机器上、不入 git。本机当前值为：

```bash
NODE_IMAGE=harbor.supermod.cn/dockerhub/library/node:24-alpine
GO_IMAGE=harbor.supermod.cn/dockerhub/library/golang:1.27-alpine
RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot
GOPROXY=https://goproxy.cn,direct
```

也可临时覆盖：`make image NODE_IMAGE=<registry>/node:24-alpine`（注意：build.env 存在时优先于 shell 环境变量）。

## 常用命令

```bash
make deploy    # 构建镜像 + compose up（日常更新用这个）
make image     # 只构建镜像
make smoke     # 镜像契约自检（另起临时容器，不碰 :3000）
make up        # 启动容器
make down      # 停止并删除容器
make restart   # 重启容器
make status    # 查看容器状态
make logs      # 跟随日志
make uninstall # 删除容器（镜像与 ~/docker 数据保留）
```

以上也可直接在本目录执行：`make -C deploy/docker <target>`。

## compose 关键字段（对外契约，与旧栈逐项一致）

- `ports: "3000:3000"` —— 端口不变。
- `user: "1000:1000"` —— 容器以非 root 运行，uid/gid 对齐宿主机用户，保证数据卷文件可写且宿主侧归属正确（镜像 `USER` 同为 `1000:1000`）。
- `deploy.resources.limits.cpus: "1.0"` / `memory: 512M` —— 资源上限不变（ADR-0018 指标：镜像 <50MB、RSS <150MB；实测镜像 25MB、常驻 RSS 约 6MiB）。
- `volumes: ./data:/data` —— 宿主数据卷挂载。配合 `environment.DATA_DIR: /data`，应用把 SQLite 库与 `backups/` 快照写在 `/data`。
- `env_file: .env` —— 注入 `NEXTAUTH_SECRET`（未写进 compose，避免密钥入库）。
- `healthcheck` —— 探测 `http://127.0.0.1:$PORT/api/health`，`start_period: 15s`，因此 up 后约 15–45 秒才会转为 `healthy`。运行镜像无 shell/wget，探测由二进制自带的子命令执行：`["CMD", "/app/ai-subscriptions", "healthcheck"]`（读 `PORT`，默认 3000；健康返回 0，否则非 0）。
- `restart: unless-stopped` + `logging` 上限（10m × 3）—— 自愈与日志瘦身，不变。

`server/internal/deploycontract` 下的 Go 测试把这些字段逐条钉住（含 Compose 解析与 Dockerfile 阶段检查），改坏会在 `make test` 里红。

## 路径解析：为什么 compose 里用 `./data`、`.env` 这种相对写法

`Makefile` 中的 `COMPOSE` 固定带 `--project-directory ~/docker/ai-subscriptions`。Compose 会把**相对路径（`env_file`、`volumes` 的绑定源）相对 project directory 解析**，而不是相对 compose 文件所在目录。所以：

- `docker-compose.yml` 放在仓库 `deploy/docker/` 下，`./data` 仍解析为 `/home/god/docker/ai-subscriptions/data`；
- `env_file: .env` 解析为 `/home/god/docker/ai-subscriptions/.env`。

这样 compose 文件可以入 git 而部署期数据留在 `~/docker`，且无需写死绝对路径（可移植）。可用下面命令核对解析结果：

```bash
docker compose --project-directory ~/docker/ai-subscriptions \
  -f deploy/docker/docker-compose.yml config
```

注意：正因为依赖 `--project-directory`，**在 `deploy/docker/` 里裸跑 `docker compose up` 会解析到错误路径**，请用 Makefile 目标（或显式带 `--project-directory`）。

## 冒烟自检（make smoke）

`smoke.sh` 在临时端口（默认 13900）起一个一次性容器，逐项验证契约：

1. 镜像 `USER` 为 `1000:1000`；
2. 容器健康检查转 `healthy`（证明 distroless 里二进制自带探测可用）；
3. `GET /api/health` 返回 `{"status":"ok"}`；`GET /` 返回含 `id="root"` 的 SPA 外壳（证明 `go:embed` 生效）；未知 `/api/*` 返回 404 JSON；
4. 容器进程实际 uid 为 1000；
5. `DATA_DIR` 指向卷内子目录时容器能自建（无 shell 也要能写卷），宿主侧可读写同一路径；
6. 卷映射为 `<宿主目录>:/data`。

失败时打印容器日志并以非 0 退出，可直接接进 CI。
