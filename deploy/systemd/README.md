# systemd 用户服务部署（单二进制）

两种部署方式之一（另一种是 Docker，见 `deploy/docker/`）。不依赖 Docker，也不依赖 Node 运行时：用 systemd 用户服务直接跑 Go 单二进制（SolidJS SPA 已 `go:embed` 进二进制）。

## 安装路径

| 内容         | 路径                                        |
| ------------ | ------------------------------------------- |
| 可执行文件   | `~/.local/bin/ai-subscriptions`（`PREFIX`） |
| unit 文件    | `~/.config/systemd/user/ai-subscriptions.service` |
| 环境变量     | 仓库根 `.env`（`EnvironmentFile`）          |
| 数据目录     | `DATA_DIR`；未设置则 `~/.local/share/ai-subscriptions`（XDG） |

`PREFIX` 默认 `~/.local`，可覆盖：`make -C deploy/systemd install PREFIX=/usr/local`（后者需要 sudo）。unit 由 `deploy/systemd/ai-subscriptions.service.in` 模板生成，`@BIN@`/`@PROJECT_DIR@`/`@ENV_FILE@`/`@PORT@` 在 install 时替换。

## 安装方式

```bash
make -C deploy/systemd install   # 构建单二进制 → 装到 ~/.local/bin → 写 unit 并 enable
make -C deploy/systemd start
```

`install` 依赖仓库的 `make build`（`web/` 构建 SPA → 暂存 `server/internal/webui/dist` → `go build` 出 `server/bin/ai-subscriptions`），随后 `install -m 755` 到 `PREFIX/bin`。

卸载：

```bash
make -C deploy/systemd uninstall # stop + disable + 删除 unit 与已安装的二进制
```

## 其它目标

```bash
make -C deploy/systemd status    # systemctl --user status
make -C deploy/systemd logs      # journalctl --user -u ai-subscriptions -f
make -C deploy/systemd restart
make -C deploy/systemd enable / disable
make -C deploy/systemd build     # 只构建单二进制
```

## 与 Docker 方案的差异

- 该方案依赖仓库内构建产物（`server/bin/ai-subscriptions`），不做镜像隔离；升级需重新 `make install`（重新构建 + 覆盖安装）。
- 读取仓库根的 `.env` 作为 `EnvironmentFile`（因此需要仓库根的 `.env`，而 Docker 方案读 `~/docker/ai-subscriptions/.env`）。文件缺失时 systemd 只告警不阻止启动。
- `PROJECT_DIR` 由 `$(abspath $(CURDIR)/../..)` 推导，即无论从哪里调用都指向仓库根；`WorkingDirectory` 设为仓库根。
- 与 Docker 部署**不可同时启用**（都占用 3000 端口），启用前先 `make down`。
- 需要登录用户会话（`systemctl --user`）；`loginctl enable-linger $USER` 可让服务在未登录时也常驻。
