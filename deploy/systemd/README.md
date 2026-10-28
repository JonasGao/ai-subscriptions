# systemd 用户服务部署（备用方案）

**当前本机不使用此方案**：部署已迁移到 Docker（见 `deploy/docker/`），systemd 用户服务（unit 文件 `~/.config/systemd/user/ai-subscriptions.service`）已从本机撤销。

保留此目录仅为备用/回退参考：不依赖 Docker 时，可直接用 systemd 用户服务跑 `next start`。

## 恢复方式

```bash
make -C deploy/systemd install   # 写入 unit 并 enable（登录自启）
make -C deploy/systemd start
```

卸载：

```bash
make -C deploy/systemd uninstall # stop + disable + 删除 unit
```

## 其它目标

```bash
make -C deploy/systemd status    # systemctl --user status
make -C deploy/systemd logs      # journalctl --user -u ai-subscriptions -f
make -C deploy/systemd restart
make -C deploy/systemd enable / disable
make -C deploy/systemd build     # npm run build
```

## 与 Docker 方案的差异

- 该方案依赖仓库内的 `node_modules/` 与 `npm run build` 产物（`.next`），不做镜像隔离。
- 读取仓库根的 `.env` 作为 `EnvironmentFile`（因此需要仓库根的 `.env`，而 Docker 方案读 `~/docker/ai-subscriptions/.env`）。
- `Makefile` 中的 `PROJECT_DIR` 由 `$(abspath $(CURDIR)/../..)` 推导，即无论从哪里调用都指向仓库根。
- 与 Docker 部署**不可同时启用**（都占用 3000 端口），启用前先 `make down`。
