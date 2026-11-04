package httpapi

// Route-level coverage for the reset-schedule surface (#27): the
// exhausted-toggle endpoint (old app/api/subscriptions/[id]/schedules/
// [scheduleId]/toggle/route.ts) and the schedule write paths reachable through
// the subscription payload.

import (
	"net/http"
	"testing"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

func decodeError(t *testing.T, raw []byte) string {
	t.Helper()
	value := decodeSubscription(t, raw)["error"]
	message, _ := value.(string)
	return message
}

func scheduleForRoute(id, scheduleType string) model.ResetSchedule {
	dayOfMonth := 15
	return model.ResetSchedule{
		ID:            id,
		Enabled:       true,
		Type:          scheduleType,
		TimeOfDay:     "10:00",
		DayOfMonth:    &dayOfMonth,
		NextResetTime: "2024-07-15T02:00:00.000Z",
		Exhausted:     false,
		CreatedAt:     "2024-01-01T00:00:00.000Z",
		UpdatedAt:     "2024-01-01T00:00:00.000Z",
	}
}

func seedScheduledSubscription(t *testing.T, s *store.Store) *model.Subscription {
	t.Helper()
	input := store.SubscriptionInput{
		Name:             "Scheduled",
		Category:         "官方订阅",
		Provider:         "openai",
		SubscriptionType: "recurring",
		BillingCycle:     "monthly",
		Price:            20,
		Status:           "active",
		ResetSchedules:   []model.ResetSchedule{scheduleForRoute("sched-1", "monthly")},
	}
	sub, err := s.CreateSubscription(input, nil)
	if err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	return sub
}

// Old route: POST returns the updated subscription (credentials stripped) and
// derives the status from the exhausted flag.
func TestPostScheduleToggleMarksExhaustedAndPauses(t *testing.T) {
	srv, cookie, s := newSubscriptionRouter(t)
	sub := seedScheduledSubscription(t, s)

	rec := request(t, srv, http.MethodPost,
		"/api/subscriptions/"+sub.ID+"/schedules/sched-1/toggle",
		`{"exhausted":true}`, cookie)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := decodeSubscription(t, rec.Body.Bytes())
	if body["status"] != "paused" {
		t.Fatalf("status = %v, want paused", body["status"])
	}
	schedules := body["resetSchedules"].([]any)
	first := schedules[0].(map[string]any)
	if first["exhausted"] != true {
		t.Fatalf("exhausted = %v, want true", first["exhausted"])
	}
	if _, leaked := body["credentials"]; leaked {
		t.Fatal("payload must strip credentials")
	}
	if body["hasCredentials"] != false {
		t.Fatalf("hasCredentials = %v, want false", body["hasCredentials"])
	}
}

func TestPostScheduleToggleClearsExhaustedAndRestoresActive(t *testing.T) {
	srv, cookie, s := newSubscriptionRouter(t)
	sub := seedScheduledSubscription(t, s)
	if _, err := s.ToggleScheduleExhausted(sub.ID, "sched-1", true); err != nil {
		t.Fatalf("seed exhaustion: %v", err)
	}

	rec := request(t, srv, http.MethodPost,
		"/api/subscriptions/"+sub.ID+"/schedules/sched-1/toggle",
		`{"exhausted":false}`, cookie)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := decodeSubscription(t, rec.Body.Bytes())
	if body["status"] != "active" {
		t.Fatalf("status = %v, want active", body["status"])
	}
	first := body["resetSchedules"].([]any)[0].(map[string]any)
	if first["exhausted"] != false {
		t.Fatalf("exhausted = %v, want false", first["exhausted"])
	}
}

// Old route: a non-boolean "exhausted" is a 400 with the verbatim message.
func TestPostScheduleToggleRejectsNonBoolean(t *testing.T) {
	srv, cookie, s := newSubscriptionRouter(t)
	sub := seedScheduledSubscription(t, s)

	rec := request(t, srv, http.MethodPost,
		"/api/subscriptions/"+sub.ID+"/schedules/sched-1/toggle",
		`{"exhausted":"yes"}`, cookie)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := decodeError(t, rec.Body.Bytes()); got != `Invalid request body. "exhausted" must be a boolean` {
		t.Fatalf("error = %q", got)
	}
}

// Old route: unknown subscription or schedule is a 404 with one message.
func TestPostScheduleToggleReturnsNotFound(t *testing.T) {
	srv, cookie, s := newSubscriptionRouter(t)
	sub := seedScheduledSubscription(t, s)

	for _, path := range []string{
		"/api/subscriptions/missing/schedules/sched-1/toggle",
		"/api/subscriptions/" + sub.ID + "/schedules/missing/toggle",
	} {
		rec := request(t, srv, http.MethodPost, path, `{"exhausted":true}`, cookie)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, body = %s", path, rec.Code, rec.Body.String())
		}
		if got := decodeError(t, rec.Body.Bytes()); got != "Subscription or schedule not found" {
			t.Fatalf("%s: error = %q", path, got)
		}
	}
}

// Old route: a broken JSON body reports the SyntaxError path.
func TestPostScheduleToggleRejectsInvalidJSON(t *testing.T) {
	srv, cookie, s := newSubscriptionRouter(t)
	sub := seedScheduledSubscription(t, s)

	rec := request(t, srv, http.MethodPost,
		"/api/subscriptions/"+sub.ID+"/schedules/sched-1/toggle",
		`{`, cookie)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := decodeError(t, rec.Body.Bytes()); got != "Invalid JSON in request body" {
		t.Fatalf("error = %q", got)
	}
}

// Duplicate types are rejected through the create route with the old message.
func TestPostSubscriptionRejectsDuplicateScheduleTypes(t *testing.T) {
	srv, cookie, _ := newSubscriptionRouter(t)

	rec := request(t, srv, http.MethodPost, "/api/subscriptions", `{
		"name": "Dupes",
		"category": "官方订阅",
		"provider": "openai",
		"subscriptionType": "recurring",
		"billingCycle": "monthly",
		"price": 20,
		"status": "active",
		"startDate": "2024-01-01",
		"renewalDate": "2024-02-01",
		"resetSchedules": [
			{"id":"s1","enabled":true,"type":"weekly","dayOfWeek":1,"timeOfDay":"10:00",
			 "nextResetTime":"2024-01-01T00:00:00.000Z","exhausted":false,
			 "createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z"},
			{"id":"s2","enabled":true,"type":"weekly","dayOfWeek":2,"timeOfDay":"11:00",
			 "nextResetTime":"2024-01-01T00:00:00.000Z","exhausted":false,
			 "createdAt":"2024-01-01T00:00:00.000Z","updatedAt":"2024-01-01T00:00:00.000Z"}
		]
	}`, cookie)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := decodeError(t, rec.Body.Bytes()); got != `Duplicate schedule type "weekly" — each type is allowed at most once` {
		t.Fatalf("error = %q", got)
	}
}

// resetSchedules must be an array on both write paths.
func TestSchedulePayloadRejectsNonArray(t *testing.T) {
	srv, cookie, s := newSubscriptionRouter(t)
	sub := seedScheduledSubscription(t, s)

	create := request(t, srv, http.MethodPost, "/api/subscriptions", `{
		"name": "Broken", "category": "官方订阅", "provider": "openai",
		"subscriptionType": "recurring", "billingCycle": "monthly",
		"price": 20, "status": "active", "startDate": "2024-01-01",
		"renewalDate": "2024-02-01", "resetSchedules": "nope"
	}`, cookie)
	if create.Code != http.StatusBadRequest {
		t.Fatalf("create status = %d", create.Code)
	}
	if got := decodeError(t, create.Body.Bytes()); got != "resetSchedules must be an array" {
		t.Fatalf("create error = %q", got)
	}

	update := request(t, srv, http.MethodPut, "/api/subscriptions/"+sub.ID,
		`{"resetSchedules": "nope"}`, cookie)
	if update.Code != http.StatusBadRequest {
		t.Fatalf("update status = %d", update.Code)
	}
	if got := decodeError(t, update.Body.Bytes()); got != "resetSchedules must be an array" {
		t.Fatalf("update error = %q", got)
	}
}
