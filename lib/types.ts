export interface Subscription {
  id: string
  name: string
  category: string
  provider: string
  providerCustom?: string
  price: number
  startDate: string
  renewalDate: string
  status: 'active' | 'paused' | 'cancelled'
  notes?: string
  createdAt: string
  updatedAt: string
}

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled'

export interface SubscriptionData {
  subscriptions: Subscription[]
  categories: string[]
}

export const defaultCategories: string[] = [
  'AI助手',
  '图像生成',
  '代码工具',
  '写作工具',
  '数据分析',
  '其他'
]

export interface Provider {
  id: string
  name: string
  description?: string
  website?: string
}

export const defaultProviders: Provider[] = [
  { id: 'anthropic', name: 'Anthropic', description: 'Claude 系列', website: 'https://anthropic.com' },
  { id: 'openai', name: 'OpenAI', description: 'GPT 系列', website: 'https://openai.com' },
  { id: 'google', name: 'Google', description: 'Gemini 系列', website: 'https://ai.google.dev' },
  { id: 'alibaba', name: '阿里云百炼', description: 'Qwen 系列', website: 'https://bailian.console.aliyun.com' },
  { id: 'moonshot', name: '月之暗面', description: 'Kimi 系列', website: 'https://kimi.moonshot.cn' },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek 系列', website: 'https://deepseek.com' },
  { id: 'zhipu', name: '智谱 AI', description: 'GLM 系列', website: 'https://bigmodel.cn' },
  { id: 'siliconflow', name: 'SiliconFlow', description: '模型托管平台', website: 'https://siliconflow.cn' },
  { id: 'minimax', name: 'MiniMax', description: 'MiniMax 系列', website: 'https://minimaxi.com' },
  { id: 'byteDance', name: '字节跳动', description: '豆包系列', website: 'https://doubao.com' },
  { id: 'baidu', name: '百度', description: '文心一言', website: 'https://yiyan.baidu.com' },
  { id: 'xunfei', name: '讯飞', description: '星火大模型', website: 'https://xinghuo.xfyun.cn' },
  { id: 'ollama', name: 'Ollama', description: '本地模型运行', website: 'https://ollama.ai' },
  { id: 'lmstudio', name: 'LM Studio', description: '本地模型运行', website: 'https://lmstudio.ai' },
  { id: 'local', name: '本地部署', description: '自托管模型' },
  { id: 'other', name: '其他', description: '自定义提供商' },
]

export interface SubscriptionFormData {
  name: string
  category: string
  provider: string
  providerCustom?: string
  price: number
  startDate: string
  renewalDate: string
  status: SubscriptionStatus
  notes?: string
}