# 设计文档：智谱 Coding Plan 用量查询

**日期**: 2026-09-18
**状态**: 已批准（grilling Q1–Q17 全部确认，见文末决策记录）
**关联 ADR**: [ADR-0011](../../adr/0011-zhipu-credit-limit-window-decoding.md)

## 概述

为智谱 AI（`zhipu`）注册 Coding Plan（单 plan），并实现额度查询：调用智谱用量监控接口，解析 `CREDIT_LIMIT` 配额行，映射为系统现有的 `fiveHour` / `weekly` UsageWindow。所有映射 handler-local，不改任何共享代码。

## 背景

- **端点**: `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`（仅 CN 站，Q8）
- **认证**: 裸 API Key —— `Authorization: <apiKey>`，无 `Bearer ` 前缀
- **端点性质**: 无官方文档的内部监控接口。字段语义经两路交叉验证：用户实测样本（`test-zhipu-usage.sh`）+ 社区实现 [opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota)（与官方破坏性变更同步维护）

### 实测响应样本（权威）

```json
{
  "code": 200,
  "msg": "Operation successful",
  "data": {
    "limits": [
      {
        "type": "CREDIT_LIMIT",
        "unit": 3,
        "number": 5,
        "usage": 12000,
        "currentValue": 0,
        "remaining": 12000,
        "percentage": 0
      },
      {
        "type": "CREDIT_LIMIT",
        "unit": 6,
        "number": 1,
        "usage": 60000,
        "currentValue": 0,
        "remaining": 60000,
        "percentage": 0,
        "nextResetTime": 1790302548999
      }
    ],
    "level": "pro"
  },
  "success": true
}
```

### 字段语义（已证实）

| 字段                | 语义                                           | 证据                                                             |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `usage`             | 窗口总额度（上限）                             | `percentage:0` + `currentValue:0` + `usage===remaining` 交叉验证 |
| `currentValue`      | 已用                                           | 同上                                                             |
| `remaining`         | 剩余                                           | 同上                                                             |
| `unit=3 & number=5` | **5 小时窗口**                                 | opencode-glm-quota `token-limits.ts` 与样本吻合                  |
| `unit=6 & number=1` | **每周窗口**                                   | 同上                                                             |
| `nextResetTime`     | epoch 毫秒；**5h 行可能缺失**，weekly 行存在   | 样本实测                                                         |
| `data.level`        | 账户等级（`"pro"`）                            | 样本                                                             |
| `percentage`        | 派生值（`currentValue/usage*100`），**不使用** | Q4                                                               |

## 设计方案

### 1. Provider 注册（`lib/types.ts:207-212`，zhipu 占位改写）

```typescript
{
  id: "zhipu",
  name: "智谱 AI",
  description: "GLM 系列",
  website: "https://bigmodel.cn",
  credentialFields: [{ key: "apiKey", label: "API Key", type: "password" }],
  plans: [
    {
      id: "coding-plan",
      name: "Coding Plan",
      usageApiUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    },
  ],
},
```

- 单 plan：`resolvePlanId`（`lib/db.ts:601-603`）对新 recurring 订阅隐式选中，无需 UI 改动（Q1）
- plan 显示名 `"Coding Plan"` 与方舟/百炼同名，靠 provider 上下文消歧（Q11=B）
- tier（Lite/Pro/Max）是运行时账户属性，经 `membership.level` 返回，不拆 plan（Q1）

### 2. Handler（`lib/providers/zhipu.ts` 新增）

**`fetchZhipuUsage(credentials): Promise<UsageResult>`**

1. `apiKey` 缺失 → `throw new Error("API Key not configured")`
2. `GET` usage URL，头 `{ Authorization: apiKey }`（裸 key），走 `fetchWithTimeout` + `DEFAULT_TIMEOUT`
3. `!response.ok` → `console.error` + `throw new Error(\`Zhipu usage API returned ${status}\`)`（fangzhou 风格）
4. 信封校验：`code !== 200 || success === false` → `throw new Error(msg ?? "Zhipu usage API returned failure")`（Q7）
5. `data.limits` 缺失或空数组 → `throw new Error("未检测到 Coding Plan 订阅")`（Q7，对齐 fangzhou-codingplan 先例）
6. 逐行分类（**仅认 `type === "CREDIT_LIMIT"`**，Q14）：
   - `unit===3 && number===5` → fiveHour 候选
   - `unit===6 && number===1` → weekly 候选
   - 其余一切行（TOKENS_LIMIT / TIME_LIMIT / 未知 unit 组合）→ `console.warn` 跳过（Q2/Q12/Q14）
7. 同桶多行冲突 → 保留 `usage`（上限）更高者（Q15，复刻 alibaba `pickHigher` 语义，handler-local）
8. **零窗口可映射**（两桶皆空）→ `throw new Error("未识别到可用的配额窗口（CREDIT_LIMIT）")`（Q16 —— 这是智谱再次改名时唯一的显式告警信号）
9. 窗口映射（绝对值直映射，Q4）：

```typescript
{
  used: String(currentValue ?? 0),
  limit: String(usage),
  remaining: String(remaining ?? 0),
  resetTime: nextResetTime ? new Date(nextResetTime).toISOString() : null, // ms → ISO
}
```

10. 返回：`{ provider: "zhipu", fiveHour, weekly, monthly: null, boosterWallet: null, parallel: null, membership: level ? { level: level.toUpperCase() } : null }`
    - `monthly` **恒为 null**（TIME_LIMIT 月度 MCP 行不处理，Q12）
    - `level` 缺失 → `membership: null`（Q5 附属约定）
    - ADR-0007 自动耗尽零改动：绝对值映射下 `used >= limit` 在真实耗尽时自然成立

**`testZhipuConnection(credentials)`**（Q6，复用 usage 端点，opencode 模式）

| 情况          | 返回                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| `apiKey` 缺失 | `{ ok: false, message: "API Key 未配置" }`                                            |
| HTTP 401/403  | `{ ok: false, message: "API Key 无效" }`                                              |
| 其他 `!ok`    | `{ ok: false, message: \`API 返回 ${status}\` }`                                      |
| 信封失败      | `{ ok: false, message: msg }`                                                         |
| limits 空     | `{ ok: false, message: "未检测到 Coding Plan 订阅" }`                                 |
| 成功          | `{ ok: true, message: \`已连接 (${level.toUpperCase()})\` }`（level 缺失则 `已连接`） |
| 异常          | `{ ok: false, message: e.message }`                                                   |

### 3. Handler 注册（`lib/providers/index.ts`）

```typescript
"zhipu:coding-plan": {
  fetchUsage: (creds) => fetchZhipuUsage(creds),
  testConnection: (creds) => testZhipuConnection(creds),
},
```

`enrichment.supportsUsageQuery` 经注册表自动点亮，providers 页面与订阅卡片无需改动。

### 4. 明确不做（scope 之外）

- ❌ **不处理 `TOKENS_LIMIT`**（旧行名）：无实测证据表明仍会出现，兼容分支不可测试（Q14）
- ❌ **不处理 `TIME_LIMIT`**（月度 MCP 行）：monthly 恒 null（Q12/Q14）
- ❌ **不加存量迁移**：`migrations.ts` 不动；存量 zhipu 订阅经编辑保存后由 `resolvePlanId` 自动补上 planId（Q13）
- ❌ **不用 ADR-0010 percent 合成**：CREDIT_LIMIT 自带绝对值，percentage 字段弃用（Q4/Q14）
- ❌ **不改 CONTEXT.md**：无新领域术语，Plan/Usage Query 词条已覆盖（Q9 收窄）
- ❌ **不支持 Global 端点**（api.z.ai）：仅 CN（Q8）
- ❌ **不改共享代码**：`UsageWindow`/`UsageResult`/卡片/auto-exhaust 全部原样

## 测试计划（TDD：先写 `__tests__/zhipu.test.ts`，再写 handler）

全部 fixture 基于真实样本回放（TOKENS_LIMIT/TIME_LIMIT 不在 fixture 中，因已排除）：

1. **正常路径**：真实样本 → fiveHour `{used:"0",limit:"12000",remaining:"12000",resetTime:null}`、weekly `{...,limit:"60000",resetTime:"2026-05-21T..."（1790302548999 的 ISO）}`、`membership:{level:"PRO"}`、monthly null
2. **未知 unit 行**（如 `unit:9`）：与有效行并存时被忽略（warn），查询成功
3. **零窗口可映射**：limits 仅含 TOKENS_LIMIT 行 → 抛 "未识别到可用的配额窗口（CREDIT_LIMIT）"
4. **同桶冲突**：两行 `unit=3/number=5`，`usage` 高者胜
5. **空 limits** → "未检测到 Coding Plan 订阅"
6. **信封失败**（`success:false` / `code:401`）→ 抛 `msg`
7. **level 缺失** → `membership: null`
8. **耗尽态映射**：`currentValue === usage` → `used === limit`（字符串级断言，衔接 ADR-0007）
9. **testConnection**：401 → "API Key 无效"；成功 → "已连接 (PRO)"
10. **apiKey 缺失** → 抛错

## 实施步骤

1. 写 `__tests__/zhipu.test.ts`（上述 fixture，先红）
2. 写 `lib/providers/zhipu.ts`（转绿）
3. 改 `lib/types.ts` zhipu 注册 + `lib/providers/index.ts` 注册表
4. 验收门：`vitest` 全绿 + `tsc` + `lint`

## 风险评估

- **端点形状漂移**（无官方文档，历史上已有 TOKENS→CREDIT 改名先例）：由零映射报错（显式失败）+ 未知行忽略+warn（不炸查询）双层兜底
- **5h 行缺 `nextResetTime`**：`resetTime: null` → 卡片显示 "—"，可接受
- **存量订阅无 planId**：编辑一次即恢复，用户已接受（Q13）

## 决策记录（grilling 摘要，2026-09-18）

| #      | 决策                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| Q1     | 单 plan `coding-plan` + provider 级 apiKey 密码字段；handler key `zhipu:coding-plan`；tier 走 membership   |
| Q2     | 只认 `unit=3/5`→fiveHour、`unit=6/1`→weekly；未知组合忽略+warn                                             |
| Q3/Q14 | 仅解析 `CREDIT_LIMIT`；TOKENS_LIMIT、TIME_LIMIT 忽略                                                       |
| Q4     | 绝对值直映射（currentValue→used / usage→limit / remaining→remaining / nextResetTime→ISO）；percentage 弃用 |
| Q5     | `level` → `membership.level`，toUpperCase；缺失 → null                                                     |
| Q6     | testConnection 复用 usage 端点                                                                             |
| Q7     | 信封失败抛 msg；空 limits 抛"未检测到 Coding Plan 订阅"                                                    |
| Q8     | 仅 CN `open.bigmodel.cn`                                                                                   |
| Q9     | spec + ADR-0011；CONTEXT.md 不改                                                                           |
| Q10    | TDD，fixture 基于真实样本                                                                                  |
| Q11    | plan 显示名 "Coding Plan"（B：与方舟/百炼同名）                                                            |
| Q12    | monthly 恒 null，TIME_LIMIT 不处理                                                                         |
| Q13    | 不加存量迁移                                                                                               |
| Q14    | 不构造 TOKENS_LIMIT/TIME_LIMIT fixture                                                                     |
| Q15    | 同桶冲突取 limit 更高者                                                                                    |
| Q16    | 零窗口可映射 → 显式抛错                                                                                    |
| Q17    | 产出 spec + ADR + dev loop 交接 prompt，委托实现                                                           |

## 审批记录

- **用户**: 已批准（Q1–Q10 "全部按推荐"，Q11–Q15 逐条确认，Q16/Q17 "OK"）
- **日期**: 2026-09-18
