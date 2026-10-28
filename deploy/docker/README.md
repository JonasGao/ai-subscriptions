# Docker 部署

本目录是 Docker 部署（默认方式）的配置目录：`Makefile`（docker 目标实现）、`docker-compose.yml`（编排定义）、本说明。

根目录 `Makefile` 只是瘦代理，`make deploy` 会转发到本目录执行，命令用法不变。

## 布局

```
deploy/docker/
├── Makefile            # image/deploy/up/down/restart/status/logs/uninstall
├── docker-compose.yml  # 编排定义（真源）
└── README.md
```

运行时目录 `~/docker/ai-subscriptions/` 只保留三样东西，**不放 compose 文件**（避免与仓库双份漂移）：

- `data/` —— 应用数据卷（`subscriptions.json` 等，含用户数据，勿入 git）
- `.env` —— 运行时环境变量（`NEXTAUTH_SECRET`）
- `build.env` —— 可选，机器级构建配置（如 `NODE_IMAGE=z.my/node:24-alpine`）

镜像仍由仓库根 `Dockerfile` 构建，构建上下文为仓库根。

## 基础镜像（NODE_IMAGE）

`Dockerfile` 的基础镜像不写死，由构建参数 `NODE_IMAGE` 决定，默认 `node:24-alpine`：

- `deploy/docker/Makefile` 会读取 `~/docker/ai-subscriptions/build.env`（存在则覆盖默认值）——机器无 docker.io 直连时，在这里配置本地镜像源（如 `NODE_IMAGE=z.my/node:24-alpine`），配置留在机器上、不入 git；
- 也可临时覆盖：`make image NODE_IMAGE=<registry>/node:24-alpine`（注意：build.env 存在时优先于 shell 环境变量）。

## 常用命令

```bash
make deploy    # 构建镜像 + compose up（日常更新用这个）
make image     # 只构建镜像
make up        # 启动容器
make down      # 停止并删除容器
make restart   # 重启容器
make status    # 查看容器状态
make logs      # 跟随日志
make uninstall # 删除容器（镜像与 ~/docker 数据保留）
```

以上也可直接在本目录执行：`make -C deploy/docker <target>`。

## compose 关键字段

- `user: "1000:1000"` —— 容器以非 root 运行，uid/gid 对齐宿主机用户，保证数据卷文件可写且宿主侧归属正确。
- `deploy.resources.limits.cpus: "1.0"` / `memory: 512M` —— 资源上限，避免单容器吃满本机。
- `volumes: ./data:/data` —— 宿主数据卷挂载。配合 `environment.DATA_DIR: /data`，应用把 JSON 数据写在 `/data`。
- `env_file: .env` —— 注入 `NEXTAUTH_SECRET`（未写进 compose，避免密钥入库）。
- `healthcheck` —— 探测 `http://127.0.0.1:3000/api/auth/session`，`start_period: 15s`，因此 up 后约 15–45 秒才会转为 `healthy`。
- `restart: unless-stopped` + `logging` 上限（10m × 3）—— 自愈与日志瘦身。

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
