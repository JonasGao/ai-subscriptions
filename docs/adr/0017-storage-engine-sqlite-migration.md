# 存储引擎换 SQLite：启动自迁移，单向不回滚（Storage Engine Migration to SQLite）

Go 重写（ADR-0018）给了替换存储引擎的窗口。现状是 `data/*.json` 平面文件：写前时间戳备份留 10 份、`.tmp` + rename 原子写、**完全无锁**——读-改-写依赖单用户低流量才不出事。我们决定 Go 版采用 SQLite：`modernc.org/sqlite` 纯 Go 驱动（WAL 模式），首次启动在 `DATA_DIR` 发现旧 `data/*.json` 时**先做 JSON 快照、再单向导入**；加密凭据密文**原样搬运、不解密重加密**（AES-256-CBC + `sha256(NEXTAUTH_SECRET + "-api-key-encryption")` 派生密钥，Go 标准库字节级兼容）。schema 版本用内嵌迁移 + `PRAGMA user_version` 管理。备份语义从「每次写前时间戳备份留 10 份」改为 SQLite 文件快照，保留策略沿用。过渡期两栈不共享写：旧栈继续用 JSON，新栈只在 cutover 部署后接管数据。

## Considered Options

- **SQLite + 启动自迁移（选定）**：挂同一个卷即自动完成迁移，drop-in 语义从「格式兼容」修订为「自动迁移」。事务与并发写安全由 SQLite 兜底，测试可用内存库。
- **沿用 JSON 原格式**：严格 drop-in、回滚零成本，但读-改-写无锁的丢更新风险原样带入新栈，且查询/事务能力持续缺失；除省事外无收益。否决。
- **SQLite + 双写同步回 JSON**：保住回滚路径，但双写一致性维护成本高、备份语义混乱，为一次性过渡支付永久复杂度。否决。

## Consequences

- cutover 提交后不再支持回滚到 JSON；迁移前的 JSON 快照长期保留作最后救济。
- 迁移是「数据搬运」不是「数据重设计」：表结构按 `lib/types.ts` 现有形状 1:1 映射，领域模型零变更。
- 写路径不再逐次备份，快照按保留策略滚动（数量沿用 10 份）。
- 驱动选定 `modernc.org/sqlite`（纯 Go）：`CGO_ENABLED=0` 静态构建是 ADR-0018 单二进制目标的硬约束，cgo 方案（mattn）会破坏它；性能差异在此体量无感。
- 迁移器本身必须有测试，且「用生产 JSON 副本做迁移演练」列入 cutover 冒烟清单。
