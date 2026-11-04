package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

// request runs one request against the router with the session cookie and
// returns the recorder, so tests can assert status, headers and raw body.
func request(t *testing.T, handler http.Handler, method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// decodeSubscription decodes one subscription payload, keeping the reset
// schedules untyped so "absent" and "empty" stay distinguishable.
func decodeSubscription(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("unmarshal subscription: %v (body=%q)", err, raw)
	}
	return body
}

func seedSubscription(t *testing.T, s *store.Store, input store.SubscriptionInput, tagNames ...string) *model.Subscription {
	t.Helper()
	sub, err := s.CreateSubscription(input, tagNames)
	if err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	return sub
}

func exhaustedSchedule(id string, exhausted bool) model.ResetSchedule {
	return model.ResetSchedule{
		ID:            id,
		Enabled:       true,
		Type:          "monthly",
		NextResetTime: "2026-09-01T00:00:00.000Z",
		Exhausted:     exhausted,
		CreatedAt:     "2026-08-01T00:00:00.000Z",
		UpdatedAt:     "2026-08-01T00:00:00.000Z",
	}
}

// subscription-status-edit.test.ts case 1: "keeps an explicitly chosen active
// status even with exhausted schedules".
func TestPutSubscriptionKeepsExplicitActiveStatusWithExhaustedSchedules(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name:             "测试订阅",
		Category:         "官方订阅",
		Provider:         "openai",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "paused",
		ResetSchedules:   []model.ResetSchedule{exhaustedSchedule("sched-1", true)},
	})

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID, `{"status":"active"}`, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["status"]; got != "active" {
		t.Fatalf("response status = %v, want active", got)
	}

	saved, err := db.SubscriptionByID(sub.ID)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.Status != "active" {
		t.Fatalf("stored status = %q, want active", saved.Status)
	}
}

// subscription-status-edit.test.ts case 2: "keeps the manually chosen status
// after saving the edit form" (whole form payload, no schedules).
func TestPutSubscriptionKeepsChosenStatusFromFormPayload(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name:             "测试订阅",
		Category:         "官方订阅",
		Provider:         "openai",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "cancelled",
	})

	body := `{"id":"` + sub.ID + `","name":"测试订阅","category":"官方订阅","provider":"openai",` +
		`"subscriptionType":"recurring","billingCycle":"monthly","price":20,"status":"paused",` +
		`"resetSchedules":[],"tagNames":[]}`

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID, body, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["status"]; got != "paused" {
		t.Fatalf("response status = %v, want paused", got)
	}
	saved, err := db.SubscriptionByID(sub.ID)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.Status != "paused" {
		t.Fatalf("stored status = %q, want paused", saved.Status)
	}
}

// subscription-status-edit.test.ts case 3: "keeps the chosen status even when
// the subscription has healthy schedules".
func TestPutSubscriptionKeepsChosenStatusWithHealthySchedules(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name:             "测试订阅",
		Category:         "官方订阅",
		Provider:         "openai",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "cancelled",
		ResetSchedules:   []model.ResetSchedule{exhaustedSchedule("sched-1", false)},
	})

	body := `{"status":"paused","resetSchedules":[{"id":"sched-1","enabled":true,"type":"monthly",` +
		`"nextResetTime":"2026-09-01T00:00:00.000Z","exhausted":false,` +
		`"createdAt":"2026-08-01T00:00:00.000Z","updatedAt":"2026-08-01T00:00:00.000Z"}]}`

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID, body, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["status"]; got != "paused" {
		t.Fatalf("response status = %v, want paused", got)
	}
	saved, err := db.SubscriptionByID(sub.ID)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.Status != "paused" {
		t.Fatalf("stored status = %q, want paused", saved.Status)
	}
}

// subscription-status-edit.test.ts case 4: "still recomputes status when only
// schedules change".
func TestPutSubscriptionRecomputesStatusWhenOnlySchedulesChange(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name:             "测试订阅",
		Category:         "官方订阅",
		Provider:         "openai",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "paused",
		ResetSchedules:   []model.ResetSchedule{exhaustedSchedule("sched-1", true)},
	})

	body := `{"name":"测试订阅","category":"官方订阅","provider":"openai",` +
		`"subscriptionType":"recurring","billingCycle":"monthly","price":20,` +
		`"resetSchedules":[{"id":"sched-1","enabled":true,"type":"monthly",` +
		`"nextResetTime":"2026-09-01T00:00:00.000Z","exhausted":false,` +
		`"createdAt":"2026-08-01T00:00:00.000Z","updatedAt":"2026-08-01T00:00:00.000Z"}]}`

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID, body, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["status"]; got != "active" {
		t.Fatalf("response status = %v, want active", got)
	}
	saved, err := db.SubscriptionByID(sub.ID)
	if err != nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.Status != "active" {
		t.Fatalf("stored status = %q, want active", saved.Status)
	}
}

func TestCreateSubscriptionReturns201AndStripsCredentials(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)

	body := `{"name":"测试订阅","category":"官方订阅","provider":"openai",` +
		`"subscriptionType":"recurring","billingCycle":"monthly","price":20,` +
		`"startDate":"2024-01-01","renewalDate":"2024-02-01",` +
		`"credentials":{"apiKey":"sk-secret"},"tagNames":["稳定","稳定","Fast"]}`

	rec := request(t, srv, http.MethodPost, "/api/subscriptions", body, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%q)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}

	payload := decodeSubscription(t, rec.Body.Bytes())
	if _, leaked := payload["credentials"]; leaked {
		t.Fatalf("response leaked credentials: %s", rec.Body.String())
	}
	if payload["hasCredentials"] != true {
		t.Fatalf("hasCredentials = %v, want true", payload["hasCredentials"])
	}
	if payload["status"] != "active" {
		t.Fatalf("status = %v, want active", payload["status"])
	}
	if _, ok := payload["planId"]; ok {
		t.Fatalf("planId must be absent for a plan-less provider: %s", rec.Body.String())
	}

	tagIDs, _ := payload["tagIds"].([]any)
	if len(tagIDs) != 2 {
		t.Fatalf("tagIds = %#v, want 2 (duplicates merged)", payload["tagIds"])
	}

	saved, err := db.SubscriptionByID(payload["id"].(string))
	if err != nil || saved == nil {
		t.Fatalf("stored subscription missing: %v", err)
	}
	if saved.Credentials == "" || strings.Contains(saved.Credentials, "sk-secret") {
		t.Fatalf("credentials stored as %q, want ciphertext", saved.Credentials)
	}
}

// The old form always submitted `credentials: {}`; POST passed it through
// createSubscription, which encrypted even the empty object. That made
// hasCredentials true for form-created subscriptions — a legacy quirk the
// port keeps, because the card's auto-query gate keys off it.
func TestCreateSubscriptionEncryptsEmptyCredentialsObject(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)

	rec := request(t, srv, http.MethodPost, "/api/subscriptions",
		`{"name":"A","category":"官方订阅","price":1,"subscriptionType":"one-time","credentials":{}}`, session)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["hasCredentials"]; got != true {
		t.Fatalf("hasCredentials = %v, want true (old stack encrypts the empty object)", got)
	}
	saved, err := db.SubscriptionByID(decodeSubscription(t, rec.Body.Bytes())["id"].(string))
	if err != nil || saved == nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if !strings.HasPrefix(saved.Credentials, "v1:") {
		t.Fatalf("credentials = %q, want a v1 credential blob", saved.Credentials)
	}
}

// PUT with an empty credentials object keeps the stored blob instead
// (`delete body.credentials` in the old route).
func TestUpdateSubscriptionIgnoresEmptyCredentialsObject(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name: "A", Category: "官方订阅", Price: 1, Credentials: "v1:kept-blob",
	})

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID,
		`{"credentials":{}}`, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	saved, err := db.SubscriptionByID(sub.ID)
	if err != nil || saved == nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.Credentials != "v1:kept-blob" {
		t.Fatalf("credentials = %q, want the stored blob untouched", saved.Credentials)
	}
}

// tags.test.ts (ADR-0008) at the API seam: a re-used name keeps the original
// tag id instead of minting a twin.
func TestCreateSubscriptionMergesDuplicateTagNames(t *testing.T) {
	srv, session, _ := newSubscriptionRouter(t)

	first := request(t, srv, http.MethodPost, "/api/subscriptions",
		`{"name":"A","category":"官方订阅","price":1,"subscriptionType":"one-time","tagNames":["Stable"]}`, session)
	second := request(t, srv, http.MethodPost, "/api/subscriptions",
		`{"name":"B","category":"官方订阅","price":1,"subscriptionType":"one-time","tagNames":["Stable"]}`, session)
	if first.Code != http.StatusCreated || second.Code != http.StatusCreated {
		t.Fatalf("create status = %d/%d, want 201", first.Code, second.Code)
	}

	firstIDs := decodeSubscription(t, first.Body.Bytes())["tagIds"].([]any)
	secondIDs := decodeSubscription(t, second.Body.Bytes())["tagIds"].([]any)
	if len(firstIDs) != 1 || len(secondIDs) != 1 || firstIDs[0] != secondIDs[0] {
		t.Fatalf("tag ids differ: %v vs %v", firstIDs, secondIDs)
	}

	rec := request(t, srv, http.MethodGet, "/api/tags", "", session)
	if got := strings.Count(rec.Body.String(), "Stable"); got != 1 {
		t.Fatalf("tag catalog = %s, want exactly one Stable", rec.Body.String())
	}
}

func TestCreateSubscriptionValidationMessages(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "missing required fields",
			body: `{"category":"官方订阅","price":1}`,
			want: "Missing required fields: name, category, price",
		},
		{
			name: "negative price",
			body: `{"name":"A","category":"官方订阅","price":-1}`,
			want: "Price must be a non-negative number",
		},
		{
			name: "invalid threshold",
			body: `{"name":"A","category":"官方订阅","price":1,"lowBalanceThreshold":-2}`,
			want: "lowBalanceThreshold must be a non-negative finite number",
		},
		{
			name: "invalid subscription type",
			body: `{"name":"A","category":"官方订阅","price":1,"subscriptionType":"weekly"}`,
			want: "Invalid subscriptionType. Must be one of: recurring, one-time",
		},
		{
			name: "recurring without dates",
			body: `{"name":"A","category":"官方订阅","price":1,"subscriptionType":"recurring","billingCycle":"monthly"}`,
			want: "startDate and renewalDate are required for recurring subscriptions",
		},
		{
			name: "bad date format",
			body: `{"name":"A","category":"官方订阅","price":1,"subscriptionType":"recurring","billingCycle":"monthly","startDate":"2024/01/01","renewalDate":"2024-02-01"}`,
			want: "Dates must be in YYYY-MM-DD format",
		},
		{
			name: "recurring without billing cycle",
			body: `{"name":"A","category":"官方订阅","price":1,"subscriptionType":"recurring","startDate":"2024-01-01","renewalDate":"2024-02-01"}`,
			want: "billingCycle is required for recurring subscriptions",
		},
		{
			name: "invalid billing cycle",
			body: `{"name":"A","category":"官方订阅","price":1,"subscriptionType":"recurring","billingCycle":"weekly","startDate":"2024-01-01","renewalDate":"2024-02-01"}`,
			want: "Invalid billingCycle. Must be one of: monthly, yearly",
		},
		{
			name: "whitespace name reaches the store guard",
			body: `{"name":"   ","category":"官方订阅","price":1,"subscriptionType":"one-time"}`,
			want: "Subscription name is required",
		},
		{
			name: "invalid tag name",
			body: `{"name":"A","category":"官方订阅","price":1,"subscriptionType":"one-time","tagNames":["a,b"]}`,
			want: "标签不能包含中英文逗号或换行",
		},
		{
			name: "broken json",
			body: `{"name":`,
			want: "Invalid JSON in request body",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, session, db := newSubscriptionRouter(t)
			rec := request(t, srv, http.MethodPost, "/api/subscriptions", tc.body, session)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
			if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != tc.want {
				t.Fatalf("error = %v, want %q", got, tc.want)
			}
			subs, err := db.Subscriptions()
			if err != nil {
				t.Fatalf("Subscriptions: %v", err)
			}
			if len(subs) != 0 {
				t.Fatalf("subscriptions = %#v, want none", subs)
			}
		})
	}
}

func TestListSubscriptionsReturnsDocumentOrder(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	seedSubscription(t, db, store.SubscriptionInput{Name: "First", Category: "官方订阅", Price: 1})
	seedSubscription(t, db, store.SubscriptionInput{Name: "Second", Category: "官方订阅", Price: 2})

	rec := request(t, srv, http.MethodGet, "/api/subscriptions", "", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v (body=%q)", err, rec.Body.String())
	}
	if len(body) != 2 || body[0]["name"] != "First" || body[1]["name"] != "Second" {
		t.Fatalf("body = %s, want First,Second", rec.Body.String())
	}
	if _, leaked := body[0]["credentials"]; leaked {
		t.Fatalf("response leaked credentials: %s", rec.Body.String())
	}
}

func TestGetSubscriptionNotFound(t *testing.T) {
	srv, session, _ := newSubscriptionRouter(t)
	rec := request(t, srv, http.MethodGet, "/api/subscriptions/missing", "", session)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != "Subscription not found" {
		t.Fatalf("error = %v", got)
	}
}

// ADR-0005: switching a subscription to one-time clears planId, because plans
// are a recurring-only concept.
func TestPutSubscriptionClearsPlanIDWhenSwitchingToOneTime(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name:             "阿里 Token",
		Category:         "官方订阅",
		Provider:         "alibaba",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            100,
		Status:           "active",
		PlanID:           "token-plan",
	})

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID,
		`{"subscriptionType":"one-time"}`, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	payload := decodeSubscription(t, rec.Body.Bytes())
	if _, present := payload["planId"]; present {
		t.Fatalf("planId = %v, want cleared: %s", payload["planId"], rec.Body.String())
	}

	saved, err := db.SubscriptionByID(sub.ID)
	if err != nil || saved == nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.PlanID != "" {
		t.Fatalf("stored planId = %q, want empty", saved.PlanID)
	}
}

func TestPutSubscriptionAssignsImplicitSinglePlan(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name:             "Moonshot",
		Category:         "官方订阅",
		Provider:         "moonshot",
		SubscriptionType: "one-time",
		Price:            50,
		Status:           "active",
	})

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID,
		`{"subscriptionType":"recurring","billingCycle":"monthly"}`, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["planId"]; got != "kimi-code" {
		t.Fatalf("planId = %v, want kimi-code", got)
	}
}

func TestPutSubscriptionValidationMessages(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"negative price", `{"price":-1}`, "Price must be a non-negative number"},
		{"invalid threshold", `{"lowBalanceThreshold":-1}`, "lowBalanceThreshold must be a non-negative finite number"},
		{"invalid status", `{"status":"paused-forever"}`, "Invalid status. Must be one of: active, paused, cancelled"},
		{"null balance", `{"balance":null}`, "Balance must be a non-negative number"},
		{"broken json", `{"status":`, "Invalid JSON in request body"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, session, db := newSubscriptionRouter(t)
			sub := seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "官方订阅", Price: 1})
			rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID, tc.body, session)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
			if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != tc.want {
				t.Fatalf("error = %v, want %q", got, tc.want)
			}
		})
	}
}

func TestPutSubscriptionClearsNullableThreshold(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	threshold := 5.0
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name:                "A",
		Category:            "官方订阅",
		Price:               1,
		LowBalanceThreshold: &threshold,
	})

	rec := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID,
		`{"lowBalanceThreshold":null}`, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if _, present := decodeSubscription(t, rec.Body.Bytes())["lowBalanceThreshold"]; present {
		t.Fatalf("lowBalanceThreshold still present: %s", rec.Body.String())
	}
	saved, err := db.SubscriptionByID(sub.ID)
	if err != nil || saved == nil {
		t.Fatalf("SubscriptionByID: %v", err)
	}
	if saved.LowBalanceThreshold != nil {
		t.Fatalf("stored threshold = %v, want nil", *saved.LowBalanceThreshold)
	}
}

func TestPutSubscriptionRejectsUnknownID(t *testing.T) {
	srv, session, _ := newSubscriptionRouter(t)
	rec := request(t, srv, http.MethodPut, "/api/subscriptions/missing", `{"status":"paused"}`, session)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if got := decodeSubscription(t, rec.Body.Bytes())["error"]; got != "Subscription not found" {
		t.Fatalf("error = %v", got)
	}
}

func TestDeleteSubscription(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "官方订阅", Price: 1})

	rec := request(t, srv, http.MethodDelete, "/api/subscriptions/"+sub.ID, "", session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if got, want := rec.Body.String(), `{"success":true}`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	again := request(t, srv, http.MethodDelete, "/api/subscriptions/"+sub.ID, "", session)
	if again.Code != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404", again.Code)
	}
	if got := decodeSubscription(t, again.Body.Bytes())["error"]; got != "Subscription not found" {
		t.Fatalf("error = %v", got)
	}
}

// Subscription deletion must keep the subscription's reset schedules out of the
// database (ADR-0017 foreign-key cascade; user story 20).
func TestDeleteSubscriptionRemovesResetSchedules(t *testing.T) {
	srv, session, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{
		Name: "A", Category: "官方订阅", Price: 1,
		ResetSchedules: []model.ResetSchedule{exhaustedSchedule("sched-1", false)},
	})

	if rec := request(t, srv, http.MethodDelete, "/api/subscriptions/"+sub.ID, "", session); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var count int
	if err := db.DB().QueryRow("SELECT COUNT(*) FROM reset_schedules").Scan(&count); err != nil {
		t.Fatalf("count schedules: %v", err)
	}
	if count != 0 {
		t.Fatalf("reset_schedules rows = %d, want 0", count)
	}
}

func TestSubscriptionRoutesRequireSession(t *testing.T) {
	srv, _, db := newSubscriptionRouter(t)
	sub := seedSubscription(t, db, store.SubscriptionInput{Name: "A", Category: "官方订阅", Price: 1})

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/subscriptions"},
		{http.MethodPost, "/api/subscriptions"},
		{http.MethodGet, "/api/subscriptions/" + sub.ID},
		{http.MethodPut, "/api/subscriptions/" + sub.ID},
		{http.MethodDelete, "/api/subscriptions/" + sub.ID},
	} {
		rec := request(t, srv, tc.method, tc.path, `{}`)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a session = %d, want 401", tc.method, tc.path, rec.Code)
		}
	}
}
