// Package model holds the domain shapes ported 1:1 from lib/types.ts.
//
// The JSON tags are the wire contract of the old stack and are also what the
// one-way JSON→SQLite importer decodes, so they must stay exactly as written.
// ADR-0017: migration is data movement, not a redesign — no field is added or
// dropped here.
package model

// ResetSchedule is a tracked quota reset recurrence.
type ResetSchedule struct {
	ID            string `json:"id"`
	Enabled       bool   `json:"enabled"`
	Type          string `json:"type"`
	TimeOfDay     string `json:"timeOfDay,omitempty"`
	Timezone      string `json:"timezone,omitempty"`
	DayOfWeek     *int   `json:"dayOfWeek,omitempty"`
	DayOfMonth    *int   `json:"dayOfMonth,omitempty"`
	NextResetTime string `json:"nextResetTime"`
	Exhausted     bool   `json:"exhausted"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// Subscription is one AI service subscription.
type Subscription struct {
	ID                  string          `json:"id"`
	Name                string          `json:"name"`
	Category            string          `json:"category"`
	Provider            string          `json:"provider"`
	ProviderCustom      string          `json:"providerCustom,omitempty"`
	SubscriptionType    string          `json:"subscriptionType"`
	BillingCycle        string          `json:"billingCycle,omitempty"`
	Price               float64         `json:"price"`
	StartDate           string          `json:"startDate,omitempty"`
	RenewalDate         string          `json:"renewalDate,omitempty"`
	Status              string          `json:"status"`
	Notes               string          `json:"notes,omitempty"`
	Credentials         string          `json:"credentials,omitempty"`
	Balance             *float64        `json:"balance,omitempty"`
	BalanceCurrency     string          `json:"balanceCurrency,omitempty"`
	LowBalanceThreshold *float64        `json:"lowBalanceThreshold,omitempty"`
	ResetSchedules      []ResetSchedule `json:"resetSchedules,omitempty"`
	PlanID              string          `json:"planId,omitempty"`
	TagIDs              []string        `json:"tagIds,omitempty"`
	CreatedAt           string          `json:"createdAt"`
	UpdatedAt           string          `json:"updatedAt"`
}

// Tag is a reusable subscription descriptor (ADR-0008 stable identity).
type Tag struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// SubscriptionData is the subscriptions.json document shape.
type SubscriptionData struct {
	Subscriptions []Subscription `json:"subscriptions"`
	Categories    []string       `json:"categories"`
	Tags          []Tag          `json:"tags,omitempty"`
}

// PriorityScene is one drag-ordered subscription priority scene.
type PriorityScene struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	SubscriptionOrder []string `json:"subscriptionOrder"`
	CreatedAt         string   `json:"createdAt"`
	UpdatedAt         string   `json:"updatedAt"`
}

// PriorityData is the priorities.json document shape.
type PriorityData struct {
	Scenes []PriorityScene `json:"scenes"`
}

// ToolPriorityScene is one drag-ordered tool priority scene.
type ToolPriorityScene struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	ToolOrder []string `json:"toolOrder"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

// ToolPriorityData is the tool-priorities.json document shape.
type ToolPriorityData struct {
	Scenes []ToolPriorityScene `json:"scenes"`
}

// Tool is a managed AI coding tool.
type Tool struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Category       string   `json:"category"`
	Provider       string   `json:"provider"`
	ProviderCustom string   `json:"providerCustom,omitempty"`
	Forms          []string `json:"forms"`
	Order          int      `json:"order"`
	IsOpenSource   bool     `json:"isOpenSource"`
	RepoURL        string   `json:"repoUrl,omitempty"`
	Status         string   `json:"status"`
	Notes          string   `json:"notes,omitempty"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

// ToolData is the tools.json document shape.
type ToolData struct {
	Tools []Tool `json:"tools"`
}

// ProxySubscription is a manually-tracked proxy purchase (ADR-0009).
type ProxySubscription struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	MonthlyPrice   float64 `json:"monthlyPrice"`
	ExpirationDate string  `json:"expirationDate,omitempty"`
	Website        string  `json:"website,omitempty"`
	Notes          string  `json:"notes,omitempty"`
	Status         string  `json:"status"`
	// tagIds is always an array on the wire (the old stack normalises missing
	// tagIds to []), so this field deliberately has no omitempty.
	TagIDs    []string `json:"tagIds"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

// ProxySubscriptionTag is a tag scoped to proxy subscriptions.
type ProxySubscriptionTag struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// ProxySubscriptionData is the proxy-subscriptions.json document shape.
type ProxySubscriptionData struct {
	Subscriptions []ProxySubscription    `json:"subscriptions"`
	Tags          []ProxySubscriptionTag `json:"tags"`
}

// SendResult is the outcome of the last notification send.
type SendResult struct {
	Success   bool   `json:"success"`
	Timestamp string `json:"timestamp"`
	Error     string `json:"error,omitempty"`
}

// NotificationChannel is one delivery target.
type NotificationChannel struct {
	ID             string      `json:"id"`
	Type           string      `json:"type"`
	Name           string      `json:"name"`
	URL            string      `json:"url,omitempty"`
	Secret         string      `json:"secret,omitempty"`
	AppID          string      `json:"appId,omitempty"`
	AppSecret      string      `json:"appSecret,omitempty"`
	ReceiveID      string      `json:"receiveId,omitempty"`
	ReceiveIDType  string      `json:"receiveIdType,omitempty"`
	Enabled        bool        `json:"enabled"`
	LastSendResult *SendResult `json:"lastSendResult,omitempty"`
	CreatedAt      string      `json:"createdAt"`
	UpdatedAt      string      `json:"updatedAt"`
}

// BalanceTransitionState tracks the last above/below threshold observation.
type BalanceTransitionState struct {
	Status    string `json:"status"`
	UpdatedAt string `json:"updatedAt"`
}

// NotificationData is the notifications.json document shape.
type NotificationData struct {
	Channels                   []NotificationChannel             `json:"channels"`
	DefaultLowBalanceThreshold float64                           `json:"defaultLowBalanceThreshold"`
	BalanceTransitionStates    map[string]BalanceTransitionState `json:"balanceTransitionStates"`
}

// AuthData is the auth.json document shape.
type AuthData struct {
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	IsInitial    bool   `json:"isInitial"`
}

// LastMonthlyReset is the last-monthly-reset.json document shape.
type LastMonthlyReset struct {
	LastReset string `json:"lastReset"`
}

// DefaultLowBalanceThreshold matches DEFAULT_LOW_BALANCE_THRESHOLD in
// lib/types.ts.
const DefaultLowBalanceThreshold = 10

// ResetTickTrigger is one (subscription, schedule) pair that fired during a
// reset tick. NextResetTime is the recomputed next occurrence AFTER firing.
type ResetTickTrigger struct {
	SubscriptionID string `json:"subscriptionId"`
	ScheduleType   string `json:"scheduleType"`
	NextResetTime  string `json:"nextResetTime"`
}
