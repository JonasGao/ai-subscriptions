# Cutover 迁移演练记录（#42）

日期：2026-11-05
演练对象：生产 JSON 数据副本（只读源目录）
源目录：`~/docker/ai-subscriptions/data`（仓库内 `data/` 不存在，按 #42 约定回退到 Docker 运行时目录）
副本目录：`/tmp/mig-drill-42/`
迁移入口：`server/cmd/migration-drill`（#23 交付）

## 执行

```bash
cp <源目录>/{subscriptions,tools,proxy-subscriptions,notifications,auth,last-monthly-reset}.json \
   /tmp/mig-drill-42/
cd server && go run ./cmd/migration-drill \
  --source /tmp/mig-drill-42 --work /tmp/mig-drill-42-scratch --keep
```

`migration-drill` 把源副本再拷入 scratch 后执行导入，源副本与真实目录均未被修改；导入前生成
JSON 快照（`subscriptions.json.backup-2026-11-04T23-47-54-987Z` 等 6 份），随后写入 SQLite。

## 结果

导入 6 个文档。各表行数与源 JSON 条目逐项一致：

| 源 JSON（条目数）                         | SQLite 表                   | 行数 | 一致              |
| ----------------------------------------- | --------------------------- | ---: | ----------------- |
| subscriptions.json（20）                  | `subscriptions`             |   20 | ☑                 |
| subscriptions.json（2 分类）              | `categories`                |    2 | ☑                 |
| subscriptions.json（2 标签）              | `tags`                      |    2 | ☑                 |
| subscriptions.json（tagIds 关联 2）       | `subscription_tags`         |    2 | ☑                 |
| tools.json（13）                          | `tools`                     |   13 | ☑                 |
| proxy-subscriptions.json（6）             | `proxy_subscriptions`       |    6 | ☑                 |
| proxy-subscriptions.json（2）             | `proxy_tags`                |    2 | ☑                 |
| proxy-subscriptions.json（tagIds 关联 3） | `proxy_subscription_tags`   |    3 | ☑                 |
| notifications.json（1 频道）              | `notification_channels`     |    1 | ☑                 |
| notifications.json（2 状态）              | `balance_transition_states` |    2 | ☑                 |
| auth.json（1）                            | `auth_user`                 |    1 | ☑                 |
| last-monthly-reset.json                   | `app_state`                 |    — | ☑（值 `2026-07`） |

加密凭据逐字节一致：源 19 条非空 `credentials` 与库中 19 条密文按 `(name, ciphertext)` 排序后完全相等，
无差异（明文密钥未参与、未重加密）。`auth.json` 的 `username` / `passwordHash` / `isInitial` 与库中
`auth_user` 完全一致。

迁移幂等：对同一 scratch 再执行一次 `ImportLegacyJSON` 返回 `Imported=false`，未重复导入；
`migration-drill` 整体退出码为 0，输出：

```
OK: every legacy document round-trips, ciphertext is byte-identical,
    and re-running the import is a no-op.
```

## 结论

生产 JSON 副本可无损迁移到 SQLite：各表行数一致、凭据密文逐字节一致、认证与最后重置状态一致、
重复导入为 no-op。cutover 后由新栈在首次启动时自动完成同一路径的迁移（ADR-0017）。

校验辅助脚本以 Python 标准库只读查询 SQLite 完成（本机无 `sqlite3` CLI）；`migration-drill` 自身的
Go 校验（`verify`）与上述独立核对结论一致。
