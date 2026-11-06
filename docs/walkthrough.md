# 全站走查清单（#40）

重写新栈（Go + SolidJS）页面收尾走查，对照旧栈 `app/`、`components/` 逐页核对。范围为五个路由
（`/login`、`/change-password`、`/subscriptions`、`/tools`、`/proxy-subscriptions`）与根路径跳转。
图表区块按 ADR-0018 范围修订不移植，不在走查范围。

## 走查方法与结论

- 静态走查：逐页阅读组件与 `web/src/styles.css`，对照旧栈页面壳、统计卡、筛选、主题 token。
- 自动化验证：`web/` 下 `npx vitest run`（188 例）与 `npx tsc --noEmit`；根路径重定向、主题持久化、
  统计卡与筛选、暗色按钮级联均有对应用例。
- 结论：下列问题已修复；其余页面结构与旧栈行为一致，无需改动。

## 问题与修复

| #   | 页面/区域   | 问题                                                                                    | 修复                                                                                                                                                            | 验证                                                                     |
| --- | ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | 三个主页面  | 各页自建导航：订阅页只有「代理订阅/工具」，工具页三项，代理页两项，入口不一致           | 新增 `components/MainPageShell.tsx`（标题、`aria-label="主要页面"` 导航、`aria-current`、主题按钮、改密入口），三页统一接入                                     | `MainPageShell.test.tsx`（parity 1 例）+ 列表页用例                      |
| 2   | 全站主题    | 仅 `prefers-color-scheme` 媒体查询，无法手动切换、不持久化                              | `theme.ts` 主题 store：`light`/`dark`/`system` 循环、`localStorage["theme"]`、`<html>` class + `color-scheme`；`ThemeToggle` 接入页面壳；`index.tsx` 首帧前应用 | `theme.test.tsx` 5 例                                                    |
| 3   | 暗色可读性  | 固定浅色/白色前景多处低对比：主按钮（白字浅靛）、状态徽标、代理状态、错误文案、开源标记 | `:root.dark` 覆盖：主按钮深色前景、状态徽标改亮色系、红/绿提示改高亮色；ghost/danger 按钮以更高特异度规则回退（订阅工具栏、表单操作、改密页等，见评审修复）     | `theme.test.tsx` 5 例 + `styles.test.ts` 3 例（ghost/danger 级联特异度） |
| 4   | 订阅列表页  | 统计卡缺失，旧栈四项汇总不可见                                                          | 新增 `components/StatsCards.tsx` + `format.ts` 汇总函数（月/年/一次性/计数），随筛选结果更新                                                                    | `StatsCards.test.tsx` 2 例                                               |
| 5   | 订阅列表页  | 分类筛选不持久化；状态筛选完全缺失                                                      | 恢复旧键 `selectedCategory`/`selectedStatuses`（含非法值清洗）；新增状态复选组；筛选联动统计卡与列表                                                            | `SubscriptionsPage.test.tsx` #40 段 2 例                                 |
| 6   | 订阅列表页  | 错误提示不可关闭（旧栈带关闭按钮）                                                      | 错误条 `role="alert"` + 「关闭错误提示」按钮                                                                                                                    | 类型检查与页面用例                                                       |
| 7   | 工具页      | 页面壳已加 h1 后原 `h1 工具管理` 造成双 h1                                              | 降为 `h2`                                                                                                                                                       | `ToolsPage.test.tsx` 保持绿                                              |
| 8   | 工具页      | 工具栏与工具卡片操作按钮无样式（浏览器默认外观）                                        | 新增共用按钮规则（含 `.ghost`/`.danger` 与暗色变体）                                                                                                            | 构建与快照式静态核对                                                     |
| 9   | 页面壳      | 旧壳含 `/providers`、`/notifications` 图标入口，新栈尚无这两个页面                      | 新壳只保留已实现路由（三主页面 + `/change-password`），避免死链；提供商/通知页面不在本票范围                                                                    | 路由表 `routes.tsx` 核对                                                 |
| 10  | 根路径      | `/` 重定向语义                                                                          | 已有 `Home` 组件 `navigate("/subscriptions", { replace: true })`，本票补测试锁定                                                                                | `routes.test.tsx` 1 例                                                   |
| 11  | 登录/改密页 | 无主题按钮                                                                              | 与旧栈一致（旧栈 MainPageShell 才有 ThemeToggle），不新增；主题按钮切换的 class 对全站生效                                                                      | `LoginPage`/`ChangePasswordPage` 用例保持绿                              |
| 12  | 主题按钮    | 图标在主题轮换后不更新（组件体内 `if` 在 Solid 中只执行一次，只有 title 是响应式的）    | `ThemeIcon` 改为接收 accessor，并用 `<Show>` 包裹三个图标分支，随每次轮换响应式切换                                                                             | `theme.test.tsx`「swaps the icon as the theme cycles」1 例               |

## 备注

- 主题键与取值与 next-themes 旧行为对齐：`localStorage["theme"] ∈ {light,dark,system}`，默认 `system`；
  `system` 跟随 OS 并在 OS 变化时重算。
- 旧栈 `attribute="class"` 写 `.dark`；新栈同时写 `.light`，以便显式浅色在深色 OS 下不被媒体查询覆盖。
- 统计卡使用「当前筛选后的订阅集合」，与旧栈 `StatsCards subscriptions={filteredSubscriptions}` 一致。
