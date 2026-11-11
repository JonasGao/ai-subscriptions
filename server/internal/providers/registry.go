// Package providers ports the old stack's static provider registry
// (lib/types.ts defaultProviders), the read-only capability enrichment
// (lib/providers/enrichment.ts), the plan-selection rules
// (lib/db.ts resolvePlanId) and the provider usage handlers needed by the
// parity rows owned by ticket #25.
//
// The registry is deliberately immutable: ADR-0006 keeps provider management
// read-only, so the data lives in code exactly as it did in the old stack.
package providers

// CredentialField describes one credential input for a provider. Values live
// on subscriptions; the registry only declares the shape.
type CredentialField struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

// PlanDefinition subdivides a provider's recurring subscriptions (ADR-0005).
// A plan may override the provider-level usage/models endpoint.
type PlanDefinition struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// UsageAPIURL is the plan-level usage endpoint. Absent means the plan has
	// no usage query.
	UsageAPIURL string `json:"usageApiUrl,omitempty"`
	// ModelsAPIURL overrides the provider-level model list endpoint.
	ModelsAPIURL string `json:"modelsApiUrl,omitempty"`
	// ModelsRequireCredentials is a tri-state: nil means "inherit the
	// provider flag (default true)", non-nil overrides it. Public endpoints
	// (e.g. alibaba coding-plan) opt out with false.
	ModelsRequireCredentials *bool `json:"modelsRequireCredentials,omitempty"`
}

// Provider is one entry of the read-only registry (ADR-0006).
type Provider struct {
	ID                       string            `json:"id"`
	Name                     string            `json:"name"`
	Description              string            `json:"description,omitempty"`
	Website                  string            `json:"website,omitempty"`
	BalanceAPIURL            string            `json:"balanceApiUrl,omitempty"`
	UsageAPIURL              string            `json:"usageApiUrl,omitempty"`
	ModelsAPIURL             string            `json:"modelsApiUrl,omitempty"`
	ModelsRequireCredentials *bool             `json:"modelsRequireCredentials,omitempty"`
	CredentialFields         []CredentialField `json:"credentialFields,omitempty"`
	Plans                    []PlanDefinition  `json:"plans,omitempty"`
}

func boolPtr(v bool) *bool { return &v }

// DefaultProviders mirrors lib/types.ts defaultProviders byte for byte
// (order included) and must stay in sync with the old stack until cutover.
func DefaultProviders() []Provider {
	return []Provider{
		{
			ID:          "anthropic",
			Name:        "Anthropic",
			Description: "Claude 系列",
			Website:     "https://anthropic.com",
		},
		{
			ID:          "openai",
			Name:        "OpenAI",
			Description: "GPT 系列",
			Website:     "https://openai.com",
		},
		{
			ID:          "google",
			Name:        "Google",
			Description: "Gemini 系列",
			Website:     "https://ai.google.dev",
		},
		{
			ID:           "github",
			Name:         "GitHub",
			Description:  "GitHub Copilot",
			Website:      "https://github.com",
			UsageAPIURL:  "https://api.github.com/copilot_internal/user",
			ModelsAPIURL: "https://api.githubcopilot.com/models",
			CredentialFields: []CredentialField{
				{Key: "token", Label: "Token", Type: "password"},
			},
		},
		{
			ID:          "alibaba",
			Name:        "阿里云百炼",
			Description: "Qwen 系列",
			Website:     "https://bailian.console.aliyun.com",
			CredentialFields: []CredentialField{
				{Key: "ak", Label: "Access Key ID", Type: "text"},
				{Key: "sk", Label: "Access Key Secret", Type: "password"},
				{Key: "workspaceId", Label: "Workspace ID", Type: "text"},
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
			Plans: []PlanDefinition{
				{
					ID:   "coding-plan",
					Name: "Coding Plan",
					// Public OpenAI-compatible endpoint: no auth required
					// (verified — returns the plan's entitled model list even
					// with a bogus Bearer).
					ModelsAPIURL:             "https://coding.dashscope.aliyuncs.com/v1/models",
					ModelsRequireCredentials: boolPtr(false),
				},
				{
					ID:           "token-plan",
					Name:         "Token Plan",
					UsageAPIURL:  "https://modelstudio.cn-beijing.aliyuncs.com/tokenplan/subscription/seat-detail",
					ModelsAPIURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models",
				},
			},
		},
		{
			ID:            "moonshot",
			Name:          "月之暗面",
			Description:   "Kimi 系列",
			Website:       "https://kimi.moonshot.cn",
			BalanceAPIURL: "https://api.moonshot.cn/v1/users/me/balance",
			ModelsAPIURL:  "https://api.moonshot.cn/v1/models",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
			Plans: []PlanDefinition{
				{
					ID:           "kimi-code",
					Name:         "Kimi Code",
					UsageAPIURL:  "https://api.kimi.com/coding/v1/usages",
					ModelsAPIURL: "https://api.kimi.com/coding/v1/models",
				},
			},
		},
		{
			ID:            "deepseek",
			Name:          "DeepSeek",
			Description:   "DeepSeek 系列",
			Website:       "https://deepseek.com",
			BalanceAPIURL: "https://api.deepseek.com/user/balance",
			ModelsAPIURL:  "https://api.deepseek.com/models",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
		},
		{
			ID:          "zhipu",
			Name:        "智谱 AI",
			Description: "GLM 系列",
			Website:     "https://bigmodel.cn",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
			Plans: []PlanDefinition{
				{
					ID:           "coding-plan",
					Name:         "Coding Plan",
					UsageAPIURL:  "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
					ModelsAPIURL: "https://open.bigmodel.cn/api/coding/paas/v4/models",
				},
			},
		},
		{
			ID:            "siliconflow",
			Name:          "SiliconFlow",
			Description:   "模型托管平台",
			Website:       "https://siliconflow.cn",
			BalanceAPIURL: "https://api.siliconflow.cn/v1/user/info",
			ModelsAPIURL:  "https://api.siliconflow.cn/v1/models",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
		},
		{
			ID:            "openrouter",
			Name:          "OpenRouter",
			Description:   "多模型统一 API",
			Website:       "https://openrouter.ai",
			BalanceAPIURL: "https://openrouter.ai/api/v1/credits",
			ModelsAPIURL:  "https://openrouter.ai/api/v1/models",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
		},
		{
			ID:          "minimax",
			Name:        "MiniMax",
			Description: "MiniMax 系列",
			Website:     "https://minimaxi.com",
		},
		{
			ID:          "byteDance",
			Name:        "字节跳动",
			Description: "豆包系列",
			Website:     "https://doubao.com",
		},
		{
			ID:           "fangzhou",
			Name:         "火山方舟",
			Description:  "火山方舟模型服务",
			Website:      "https://www.volcengine.com/product/ark",
			ModelsAPIURL: "https://open.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01",
			CredentialFields: []CredentialField{
				{Key: "ak", Label: "Access Key", Type: "text"},
				{Key: "sk", Label: "Secret Key", Type: "password"},
			},
			Plans: []PlanDefinition{
				{
					ID:           "codingplan",
					Name:         "Coding Plan",
					UsageAPIURL:  "https://open.volcengineapi.com/open/GetCodingPlanUsage",
					ModelsAPIURL: "https://open.volcengineapi.com/?Action=ListArkCodeLatestModel&Version=2024-01-01",
				},
				{
					ID:           "agentplan",
					Name:         "Agent Plan",
					UsageAPIURL:  "https://open.volcengineapi.com/open/GetAFPUsage",
					ModelsAPIURL: "https://open.volcengineapi.com/?Action=ListAgentPlanLatestModel&Version=2024-01-01",
				},
			},
		},
		{
			ID:          "opencode",
			Name:        "OpenCode",
			Description: "OpenCode 编码助手",
			Website:     "https://opencode.ai",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
			Plans: []PlanDefinition{
				{
					ID:           "go",
					Name:         "Go",
					UsageAPIURL:  "https://opencode.ai/zen/go/v1/usage",
					ModelsAPIURL: "https://opencode.ai/zen/go/v1/models",
				},
				{
					ID:   "zen",
					Name: "Zen",
				},
			},
		},
		{
			ID:          "baidu",
			Name:        "百度",
			Description: "文心一言",
			Website:     "https://yiyan.baidu.com",
		},
		{
			ID:          "xiaomi",
			Name:        "小米",
			Description: "MiMo 系列",
			Website:     "https://mimo.mi.com",
		},
		{
			ID:          "xunfei",
			Name:        "讯飞",
			Description: "星火大模型",
			Website:     "https://xinghuo.xfyun.cn",
		},
		{
			ID:          "ollama",
			Name:        "Ollama",
			Description: "本地模型运行",
			Website:     "https://ollama.ai",
		},
		{
			ID:          "lmstudio",
			Name:        "LM Studio",
			Description: "本地模型运行",
			Website:     "https://lmstudio.ai",
		},
		{
			ID:          "local",
			Name:        "本地部署",
			Description: "自托管模型",
		},
		{
			ID:            "dddai",
			Name:          "滴滴滴AI",
			Description:   "AI API 中转服务",
			Website:       "https://api.dddai.dev",
			UsageAPIURL:   "https://api.dddai.dev/user/balance",
			BalanceAPIURL: "https://api.dddai.dev/user/balance",
			ModelsAPIURL:  "https://api.dddai.dev/v1/models",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
		},
		{
			ID:            "fastai",
			Name:          "FastAI",
			Description:   "AI API 中转服务",
			Website:       "https://www.fastaitoken.com",
			BalanceAPIURL: "https://www.fastaitoken.com/v1/usage",
			ModelsAPIURL:  "https://www.fastaitoken.com/v1/models",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
		},
		{
			ID:            "morphapi",
			Name:          "MorphAPI",
			Description:   "AI API 中转服务",
			Website:       "https://www.aidjapi.top",
			BalanceAPIURL: "https://www.aidjapi.top/v1/usage",
			ModelsAPIURL:  "https://www.aidjapi.top/v1/models",
			CredentialFields: []CredentialField{
				{Key: "apiKey", Label: "API Key", Type: "password"},
			},
		},
		{
			ID:          "other",
			Name:        "其他",
			Description: "自定义提供商",
		},
	}
}
