package httpapi

import (
	"testing"

	"ai-subscriptions/internal/model"
)

// TestSubscriptionPayloadMatchesOldStackBytes pins the wire shape:
// lib/api-utils.ts stripCredentials returns the subscription with
// `credentials` removed and `hasCredentials` appended. Field order follows the
// old model declaration so a byte diff against the Node stack is empty.
func TestSubscriptionPayloadMatchesOldStackBytes(t *testing.T) {
	balance := 10.5
	threshold := 5.0
	dayOfWeek := 1
	dayOfMonth := 15

	sub := model.Subscription{
		ID:                  "sub-1",
		Name:                "测试订阅",
		Category:            "官方订阅",
		Provider:            "openai",
		ProviderCustom:      "FooAPI",
		SubscriptionType:    "recurring",
		BillingCycle:        "monthly",
		Price:               20,
		StartDate:           "2024-01-01",
		RenewalDate:         "2024-02-01",
		Status:              "active",
		Notes:               "备注",
		Credentials:         "v1:encrypted",
		Balance:             &balance,
		BalanceCurrency:     "CNY",
		LowBalanceThreshold: &threshold,
		ResetSchedules: []model.ResetSchedule{{
			ID:            "sched-1",
			Enabled:       true,
			Type:          "monthly",
			TimeOfDay:     "09:30",
			Timezone:      "Asia/Shanghai",
			DayOfWeek:     &dayOfWeek,
			DayOfMonth:    &dayOfMonth,
			NextResetTime: "2026-09-01T00:00:00.000Z",
			Exhausted:     false,
			CreatedAt:     "2026-08-01T00:00:00.000Z",
			UpdatedAt:     "2026-08-01T00:00:00.000Z",
		}},
		PlanID:    "kimi-code",
		TagIDs:    []string{"tag-1", "tag-2"},
		CreatedAt: "2026-01-01T00:00:00.000Z",
		UpdatedAt: "2026-01-02T00:00:00.000Z",
	}

	got, err := marshalAligned(newSubscriptionPayload(sub))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	want := `{"id":"sub-1","name":"测试订阅","category":"官方订阅","provider":"openai",` +
		`"providerCustom":"FooAPI","subscriptionType":"recurring","billingCycle":"monthly",` +
		`"price":20,"startDate":"2024-01-01","renewalDate":"2024-02-01","status":"active",` +
		`"notes":"备注","balance":10.5,"balanceCurrency":"CNY","lowBalanceThreshold":5,` +
		`"resetSchedules":[{"id":"sched-1","enabled":true,"type":"monthly","timeOfDay":"09:30",` +
		`"timezone":"Asia/Shanghai","dayOfWeek":1,"dayOfMonth":15,` +
		`"nextResetTime":"2026-09-01T00:00:00.000Z","exhausted":false,` +
		`"createdAt":"2026-08-01T00:00:00.000Z","updatedAt":"2026-08-01T00:00:00.000Z"}],` +
		`"planId":"kimi-code","tagIds":["tag-1","tag-2"],` +
		`"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-02T00:00:00.000Z",` +
		`"hasCredentials":true}`

	if string(got) != want {
		t.Fatalf("payload differs from old stack\n got: %s\nwant: %s", got, want)
	}
}

func TestSubscriptionPayloadAlwaysEmitsTagIDs(t *testing.T) {
	got, err := marshalAligned(newSubscriptionPayload(model.Subscription{
		ID: "sub-1", Name: "A", Category: "官方订阅", Provider: "openai",
		SubscriptionType: "one-time", Price: 1, Status: "active",
		CreatedAt: "2026-01-01T00:00:00.000Z", UpdatedAt: "2026-01-01T00:00:00.000Z",
	}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	want := `{"id":"sub-1","name":"A","category":"官方订阅","provider":"openai",` +
		`"subscriptionType":"one-time","price":1,"status":"active","tagIds":[],` +
		`"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",` +
		`"hasCredentials":false}`
	if string(got) != want {
		t.Fatalf("payload differs from old stack\n got: %s\nwant: %s", got, want)
	}
}
