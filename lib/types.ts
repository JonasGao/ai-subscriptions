export type ResetScheduleType = "hourly" | "daily" | "weekly" | "monthly";

export interface ResetSchedule {
  id: string;
  enabled: boolean;
  type: ResetScheduleType;
  intervalHours?: number;
  referenceTime?: string;
  timeOfDay?: string;
  timezone?: string;
  timezoneOffset?: number;
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
  apiKey?: string;
  balance?: number;
  resetSchedules?: ResetSchedule[];
  createdAt: string;
  updatedAt: string;
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
}

export const defaultCategories: string[] = [
  "AI助手",
  "图像生成",
  "代码工具",
  "写作工具",
  "数据分析",
  "其他",
];

export interface Provider {
  id: string;
  name: string;
  description?: string;
  website?: string;
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
  },
  {
    id: "alibaba",
    name: "阿里云百炼",
    description: "Qwen 系列",
    website: "https://bailian.console.aliyun.com",
  },
  {
    id: "moonshot",
    name: "月之暗面",
    description: "Kimi 系列",
    website: "https://kimi.moonshot.cn",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek 系列",
    website: "https://deepseek.com",
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
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "多模型统一 API",
    website: "https://openrouter.ai",
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
    id: "fangzhou-codingplan",
    name: "火山方舟 CodingPlan",
    description: "火山方舟 CodingPlan 模型服务",
    website: "https://www.volcengine.com/product/ark",
  },
  {
    id: "fangzhou-agentplan",
    name: "火山方舟 AgentPlan",
    description: "火山方舟 AgentPlan 模型服务",
    website: "https://www.volcengine.com/product/ark",
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
  apiKey?: string;
  balance?: number;
  resetSchedules?: ResetSchedule[];
}

export interface ResetScheduleFormData {
  type: ResetScheduleType;
  enabled: boolean;
  intervalHours?: number;
  referenceTime?: string;
  relativeHours?: number;
  relativeMinutes?: number;
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
  totalBalance: string;
  grantedBalance: string;
  toppedUpBalance: string;
}

export interface BalanceResult {
  provider?: string;
  isAvailable: boolean;
  balanceInfos: BalanceInfo[];
}
