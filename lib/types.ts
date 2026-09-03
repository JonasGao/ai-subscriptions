export type ResetScheduleType = "fiveHour" | "weekly" | "monthly";

/** All possible reset schedule types, in display order. */
export const RESET_SCHEDULE_TYPES: ResetScheduleType[] = [
  "fiveHour",
  "weekly",
  "monthly",
];

export interface ResetSchedule {
  id: string;
  enabled: boolean;
  type: ResetScheduleType;
  timeOfDay?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  nextResetTime: string;
  exhausted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  subscriptionType: "recurring" | "one-time";
  billingCycle?: BillingCycle;
  price: number;
  startDate?: string;
  renewalDate?: string;
  status: "active" | "paused" | "cancelled";
  notes?: string;
  credentials?: string;
  hasCredentials?: boolean;
  balance?: number;
  balanceCurrency?: string;
  lowBalanceThreshold?: number;
  resetSchedules?: ResetSchedule[];
  planId?: string;
  tagIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type ProxySubscriptionStatus = "unused" | "in-use" | "expired";

export interface ProxySubscription {
  id: string;
  name: string;
  monthlyPrice: number;
  expirationDate?: string;
  website?: string;
  notes?: string;
  status: ProxySubscriptionStatus;
  tagIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProxySubscriptionTag {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProxySubscriptionData {
  subscriptions: ProxySubscription[];
  tags: ProxySubscriptionTag[];
}

export interface ProxySubscriptionFormData {
  name: string;
  monthlyPrice: number;
  expirationDate?: string;
  website?: string;
  notes?: string;
  status: ProxySubscriptionStatus;
  tagNames?: string[];
}

export type SubscriptionStatus = "active" | "paused" | "cancelled";
export type SubscriptionType = "recurring" | "one-time";
export type BillingCycle = "monthly" | "yearly";

export type EffectiveStatusReason =
  | { kind: "manual-cancelled" }
  | { kind: "schedule-exhausted"; scheduleIds: string[] }
  | { kind: "available" }
  | { kind: "manual-paused" };

export interface SubscriptionData {
  subscriptions: Subscription[];
  categories: string[];
  tags?: Tag[];
}

export const defaultCategories: string[] = ["官方订阅", "中转站"];

export interface CredentialField {
  key: string;
  label: string;
  type: "text" | "password";
}

export interface PlanDefinition {
  id: string;
  name: string;
  usageApiUrl?: string;
}

export interface Provider {
  id: string;
  name: string;
  description?: string;
  website?: string;
  balanceApiUrl?: string;
  usageApiUrl?: string;
  credentialFields?: CredentialField[];
  plans?: PlanDefinition[];
}

export const defaultProviders: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 系列",
    website: "https://anthropic.com",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT 系列",
    website: "https://openai.com",
  },
  {
    id: "google",
    name: "Google",
    description: "Gemini 系列",
    website: "https://ai.google.dev",
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub Copilot",
    website: "https://github.com",
    usageApiUrl: "https://api.github.com/copilot_internal/user",
    credentialFields: [{ key: "token", label: "Token", type: "password" }],
  },
  {
    id: "alibaba",
    name: "阿里云百炼",
    description: "Qwen 系列",
    website: "https://bailian.console.aliyun.com",
    credentialFields: [
      { key: "ak", label: "Access Key ID", type: "text" },
      { key: "sk", label: "Access Key Secret", type: "password" },
      { key: "workspaceId", label: "Workspace ID", type: "text" },
    ],
    plans: [
      {
        id: "coding-plan",
        name: "Coding Plan",
      },
      {
        id: "token-plan",
        name: "Token Plan",
        usageApiUrl:
          "https://modelstudio.cn-beijing.aliyuncs.com/tokenplan/subscription/seat-detail",
      },
    ],
  },
  {
    id: "moonshot",
    name: "月之暗面",
    description: "Kimi 系列",
    website: "https://kimi.moonshot.cn",
    balanceApiUrl: "https://api.moonshot.cn/v1/users/me/balance",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password" }],
    plans: [
      {
        id: "kimi-code",
        name: "Kimi Code",
        usageApiUrl: "https://api.kimi.com/coding/v1/usages",
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek 系列",
    website: "https://deepseek.com",
    balanceApiUrl: "https://api.deepseek.com/user/balance",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password" }],
  },
  {
    id: "zhipu",
    name: "智谱 AI",
    description: "GLM 系列",
    website: "https://bigmodel.cn",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    description: "模型托管平台",
    website: "https://siliconflow.cn",
    balanceApiUrl: "https://api.siliconflow.cn/v1/user/info",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password" }],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "多模型统一 API",
    website: "https://openrouter.ai",
    balanceApiUrl: "https://openrouter.ai/api/v1/credits",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password" }],
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax 系列",
    website: "https://minimaxi.com",
  },
  {
    id: "byteDance",
    name: "字节跳动",
    description: "豆包系列",
    website: "https://doubao.com",
  },
  {
    id: "fangzhou",
    name: "火山方舟",
    description: "火山方舟模型服务",
    website: "https://www.volcengine.com/product/ark",
    credentialFields: [
      { key: "ak", label: "Access Key", type: "text" },
      { key: "sk", label: "Secret Key", type: "password" },
    ],
    plans: [
      {
        id: "codingplan",
        name: "Coding Plan",
        usageApiUrl: "https://open.volcengineapi.com/open/GetCodingPlanUsage",
      },
      {
        id: "agentplan",
        name: "Agent Plan",
        usageApiUrl: "https://open.volcengineapi.com/open/GetAFPUsage",
      },
    ],
  },
  {
    id: "baidu",
    name: "百度",
    description: "文心一言",
    website: "https://yiyan.baidu.com",
  },
  {
    id: "xiaomi",
    name: "小米",
    description: "MiMo 系列",
    website: "https://mimo.mi.com",
  },
  {
    id: "xunfei",
    name: "讯飞",
    description: "星火大模型",
    website: "https://xinghuo.xfyun.cn",
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "本地模型运行",
    website: "https://ollama.ai",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    description: "本地模型运行",
    website: "https://lmstudio.ai",
  },
  { id: "local", name: "本地部署", description: "自托管模型" },
  { id: "other", name: "其他", description: "自定义提供商" },
];

export interface SubscriptionFormData {
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  subscriptionType: SubscriptionType;
  billingCycle?: BillingCycle;
  price: number;
  startDate?: string;
  renewalDate?: string;
  status: SubscriptionStatus;
  notes?: string;
  credentials?: Record<string, string>;
  balance?: number;
  lowBalanceThreshold?: number | null;
  resetSchedules?: ResetSchedule[];
  planId?: string;
  tagNames?: string[];
}

export interface ResetScheduleFormData {
  type: ResetScheduleType;
  enabled: boolean;
  timeOfDay?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface PriorityScene {
  id: string;
  name: string;
  subscriptionOrder: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PriorityData {
  scenes: PriorityScene[];
}

export interface PrioritySceneFormData {
  name: string;
}

export interface ToolPriorityScene {
  id: string;
  name: string;
  toolOrder: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ToolPriorityData {
  scenes: ToolPriorityScene[];
}

export interface ToolPrioritySceneFormData {
  name: string;
}

export type ToolFormType = "CLI / TUI" | "GUI" | "Web";

export const allowedToolForms: ToolFormType[] = ["CLI / TUI", "GUI", "Web"];

export interface Tool {
  id: string;
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  forms: string[];
  order: number;
  isOpenSource: boolean;
  repoUrl?: string;
  status: "active" | "paused" | "cancelled";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolData {
  tools: Tool[];
}

export type ToolStatus = "active" | "paused" | "cancelled";

export interface ToolFormData {
  name: string;
  category: string;
  provider: string;
  providerCustom?: string;
  forms: string[];
  isOpenSource: boolean;
  repoUrl?: string;
  status: ToolStatus;
  notes?: string;
}

export interface BalanceInfo {
  currency: string;
  available: string;
  total: string | null;
  toppedUp: string | null;
  granted: string | null;
  used: string | null;
  frozen: string | null;
  extras?: { label: string; value: string }[];
}

export interface BalanceResult {
  provider: string;
  isAvailable: boolean;
  balanceInfos: BalanceInfo[];
}

export interface UsageWindow {
  limit: string;
  used: string;
  remaining: string;
  resetTime: string | null;
}

export interface UsageBoosterWallet {
  balance: {
    amount: string;
    amountLeft: string;
    unit: string;
    type: string;
  } | null;
  monthlyUsed: { currency: string; priceInCents: string } | null;
  status: string;
}

export interface UsageResult {
  provider: string;
  /** 5-hour rolling window (e.g. AgentPlan AFPFiveHour, Kimi limits[0] 300min) */
  fiveHour: UsageWindow | null;
  /** Weekly quota (e.g. AgentPlan AFPWeekly, Kimi usage) */
  weekly: UsageWindow | null;
  /** Monthly quota (e.g. AgentPlan AFPMonthly) */
  monthly: UsageWindow | null;
  boosterWallet: UsageBoosterWallet | null;
  parallel: { limit: string } | null;
  membership: { level: string } | null;
}

// ============ Notification ============

export type NotificationChannelType =
  "dingtalk" | "feishu" | "webhook" | "feishu-app";

/**
 * Receive ID type for feishu-app channel:
 * - "open_id": single chat (user)
 * - "chat_id": group chat
 */
export type FeishuReceiveIdType = "open_id" | "chat_id";

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string;
  /** Webhook URL — used by dingtalk / feishu / webhook. Unused by feishu-app. */
  url?: string;
  /** HMAC signing secret — used by dingtalk / feishu. Unused by feishu-app. */
  secret?: string;
  /** Feishu app ID — used by feishu-app only. */
  appId?: string;
  /**
   * Feishu app secret — used by feishu-app only. Treated like `secret`:
   * never returned verbatim to the client (hasSecret flag instead).
   */
  appSecret?: string;
  /** Feishu receive ID (open_id or chat_id) — used by feishu-app only. */
  receiveId?: string;
  /** Feishu receive ID type — used by feishu-app only. */
  receiveIdType?: FeishuReceiveIdType;
  enabled: boolean;
  lastSendResult?: SendResult;
  createdAt: string;
  updatedAt: string;
}

export interface SendResult {
  success: boolean;
  timestamp: string;
  error?: string;
}

export interface NotificationData {
  channels: NotificationChannel[];
  defaultLowBalanceThreshold: number;
  balanceTransitionStates: Record<string, BalanceTransitionState>;
}

export interface BalanceTransitionState {
  /** "above" = last check balance >= threshold; "below" = last check balance < threshold */
  status: "above" | "below";
  updatedAt: string;
}

export const DEFAULT_LOW_BALANCE_THRESHOLD = 10;

// ============ Reset tick ============

/**
 * A single (subscription, schedule) pair that fired during a reset tick.
 * `nextResetTime` is the recomputed next reset time AFTER firing — i.e. the
 * schedule has already been advanced, so this is when it will fire again.
 */
export interface ResetTickTrigger {
  subscriptionId: string;
  scheduleType: ResetScheduleType;
  nextResetTime: string;
}
