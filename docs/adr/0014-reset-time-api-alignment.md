# 重置时间 API 对齐（Reset-Time Alignment）

订阅的 `nextResetTime` 原本完全由调度属性（`dayOfWeek`/`dayOfMonth`/`timeOfDay`/`timezone`）计算得出，与供应商真实的重置时间可能错位。我们决定：当一个耗尽（exhausted）的 schedule 到达重置时间恢复时，由调度器在通知 tick 之后异步调用该订阅的用量查询接口，把返回的合法未来重置时间覆写到该订阅**所有 enabled schedule** 的 `nextResetTime` 上——查询失败、桶缺失或时间戳非未来时不更新、仅打 info 日志。`nextResetTime` 的语义由此从"纯计算值"变为"API 校正值优先、计算值兜底"。

## Considered Options

- **仅覆写 `nextResetTime`（选定）**：不加字段、不改调度属性。weekly/monthly 的覆写会在下次触发时被属性重算覆盖，但下次耗尽恢复会再次校正——"查询成功链不断则对齐持续成立"。
- **反推调度属性**：把 API 时间反推成 `dayOfWeek`/`dayOfMonth`/`timeOfDay` 持久化。需处理时区换算与 monthly 31→28 clamp 再漂移，且等于悄悄改写用户配置的表单值。否决。
- **新增锚点字段**（如 `anchoredResetTime` 优先于计算值）：字段、迁移、优先级规则与表单展示都要动。否决。
- 触发范围上选择了**仅 `wasExhausted` 的触发**（而非每次触发都查询）以控制供应商 API 调用量；fiveHour 无属性可反推，覆写直接进入 +5h 锚链。

## Consequences

- **weekly/monthly 对齐是瞬态的**：设配置触发 00:00、供应商真实 08:00——00:00 恢复时对齐到 08:00（卡片显示正确的恢复倒计时），但 08:00 的未耗尽触发不查询、按属性重算跳回"下月 1 号 00:00"，错位复现直到下次耗尽恢复。fiveHour 因锚链（08:00+5h）不受此影响。这是"最小 API 调用量"选择的固有代价，接受。
- `processResetTick` 保持同步纯函数、通知链路零改动：通知使用计算值，可能与对齐后的卡片短暂不一致（对齐是尽力而为的后校正）。
- 手动用量查询不回写（本机制仅由重置触发）；如需扩展为独立需求另议。
- 用量 handler 解析统一走 `lib/providers` 的 `resolveUsageHandler`（usage route 与对齐模块共用）。
