package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/providers"
	"ai-subscriptions/internal/store"
)

// DataService is the subscription/category/tag surface the JSON API depends
// on. *store.Store is the production implementation; tests run it against a
// temporary database.
type DataService interface {
	Subscriptions() ([]model.Subscription, error)
	SubscriptionByID(id string) (*model.Subscription, error)
	CreateSubscription(input store.SubscriptionInput, tagNames []string) (*model.Subscription, error)
	UpdateSubscription(id string, updates store.SubscriptionUpdates, tagNames *[]string) (*model.Subscription, error)
	DeleteSubscription(id string) (bool, error)
	Categories() ([]string, error)
	AddCategory(name string) ([]string, error)
	DeleteCategory(name string) ([]string, error)
	Tags() ([]model.Tag, error)
	RenameTag(id, name string) (*model.Tag, error)
	DeleteTag(id string) (*store.DeleteTagResult, error)
	// Reset-schedule surface (#27). AddResetSchedule/UpdateResetSchedule/
	// DeleteResetSchedule back the schedule CRUD; ToggleScheduleExhausted is
	// the manual "已用尽" switch (ADR-0007).
	ToggleScheduleExhausted(subscriptionID, scheduleID string, exhausted bool) (*model.Subscription, error)
}

// subscriptionPayload is the wire shape of a subscription
// (lib/api-utils.ts stripCredentials: credentials removed, hasCredentials
// appended). Field order follows model.Subscription.
type subscriptionPayload struct {
	ID                  string                `json:"id"`
	Name                string                `json:"name"`
	Category            string                `json:"category"`
	Provider            string                `json:"provider"`
	ProviderCustom      string                `json:"providerCustom,omitempty"`
	SubscriptionType    string                `json:"subscriptionType"`
	BillingCycle        string                `json:"billingCycle,omitempty"`
	Price               float64               `json:"price"`
	StartDate           string                `json:"startDate,omitempty"`
	RenewalDate         string                `json:"renewalDate,omitempty"`
	Status              string                `json:"status"`
	Notes               string                `json:"notes,omitempty"`
	Balance             *float64              `json:"balance,omitempty"`
	BalanceCurrency     string                `json:"balanceCurrency,omitempty"`
	LowBalanceThreshold *float64              `json:"lowBalanceThreshold,omitempty"`
	ResetSchedules      []model.ResetSchedule `json:"resetSchedules,omitempty"`
	PlanID              string                `json:"planId,omitempty"`
	TagIDs              []string              `json:"tagIds"`
	CreatedAt           string                `json:"createdAt"`
	UpdatedAt           string                `json:"updatedAt"`
	HasCredentials      bool                  `json:"hasCredentials"`
}

func newSubscriptionPayload(sub model.Subscription) subscriptionPayload {
	tagIDs := sub.TagIDs
	if tagIDs == nil {
		tagIDs = []string{}
	}
	return subscriptionPayload{
		ID:                  sub.ID,
		Name:                sub.Name,
		Category:            sub.Category,
		Provider:            sub.Provider,
		ProviderCustom:      sub.ProviderCustom,
		SubscriptionType:    sub.SubscriptionType,
		BillingCycle:        sub.BillingCycle,
		Price:               sub.Price,
		StartDate:           sub.StartDate,
		RenewalDate:         sub.RenewalDate,
		Status:              sub.Status,
		Notes:               sub.Notes,
		Balance:             sub.Balance,
		BalanceCurrency:     sub.BalanceCurrency,
		LowBalanceThreshold: sub.LowBalanceThreshold,
		ResetSchedules:      sub.ResetSchedules,
		PlanID:              sub.PlanID,
		TagIDs:              tagIDs,
		CreatedAt:           sub.CreatedAt,
		UpdatedAt:           sub.UpdatedAt,
		HasCredentials:      sub.Credentials != "",
	}
}

func newSubscriptionPayloads(subs []model.Subscription) []subscriptionPayload {
	payloads := make([]subscriptionPayload, len(subs))
	for i, sub := range subs {
		payloads[i] = newSubscriptionPayload(sub)
	}
	return payloads
}

// writeError is the old stack's {error: message} body.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSONAligned(w, status, map[string]string{"error": message})
}

// decodeObjectBody decodes a JSON object request body. A non-object or broken
// document is reported as invalid JSON, like the old stack's request.json()
// SyntaxError path.
func decodeObjectBody(r *http.Request) (map[string]any, error) {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	if body == nil {
		return nil, errors.New("empty body")
	}
	return body, nil
}

// truthyString mirrors `!!body[key]` for string fields.
func truthyString(body map[string]any, key string) (string, bool) {
	value, ok := body[key].(string)
	if !ok || value == "" {
		return "", false
	}
	return value, true
}

func stringOr(body map[string]any, key, fallback string) string {
	if value, ok := body[key].(string); ok {
		return value
	}
	return fallback
}

func nullableNumber(body map[string]any, key string) (present bool, value *float64, ok bool) {
	raw, present := body[key]
	if !present {
		return false, nil, true
	}
	if raw == nil {
		return true, nil, true
	}
	number, isNumber := raw.(float64)
	if !isNumber {
		return true, nil, false
	}
	return true, &number, true
}

func stringList(body map[string]any, key string) ([]string, bool) {
	raw, ok := body[key]
	if !ok {
		return nil, false
	}
	items, isList := raw.([]any)
	if !isList {
		return nil, false
	}
	values := make([]string, 0, len(items))
	for _, item := range items {
		text, isString := item.(string)
		if !isString {
			return nil, false
		}
		values = append(values, text)
	}
	return values, true
}

func (opts Options) dataCipher() *crypto.Cipher {
	if opts.Cipher != nil {
		return opts.Cipher
	}
	return crypto.NewFromEnv(os.Getenv)
}

// handleListSubscriptions serves GET /api/subscriptions.
func handleListSubscriptions(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subs, err := opts.Data.Subscriptions()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch subscriptions")
			return
		}
		writeJSONAligned(w, http.StatusOK, newSubscriptionPayloads(subs))
	}
}

// handleCreateSubscription serves POST /api/subscriptions.
func handleCreateSubscription(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}

		name, hasName := truthyString(body, "name")
		category, hasCategory := truthyString(body, "category")
		_, hasPrice := body["price"]
		if !hasName || !hasCategory || !hasPrice {
			writeError(w, http.StatusBadRequest, "Missing required fields: name, category, price")
			return
		}

		price, isNumber := body["price"].(float64)
		if !isNumber || price < 0 {
			writeError(w, http.StatusBadRequest, "Price must be a non-negative number")
			return
		}

		if _, _, ok := nullableNumber(body, "lowBalanceThreshold"); !ok {
			writeError(w, http.StatusBadRequest, "lowBalanceThreshold must be a non-negative finite number")
			return
		}
		if _, threshold, _ := nullableNumber(body, "lowBalanceThreshold"); threshold != nil && *threshold < 0 {
			writeError(w, http.StatusBadRequest, "lowBalanceThreshold must be a non-negative finite number")
			return
		}

		if raw, present := body["subscriptionType"]; present && raw != nil {
			if _, isString := raw.(string); !isString || (raw != "" && !validSubscriptionType(raw.(string))) {
				writeError(w, http.StatusBadRequest, "Invalid subscriptionType. Must be one of: recurring, one-time")
				return
			}
		}

		subscriptionType := stringOr(body, "subscriptionType", "recurring")
		startDate := stringOr(body, "startDate", "")
		renewalDate := stringOr(body, "renewalDate", "")
		billingCycle := stringOr(body, "billingCycle", "")

		// The route-level date/billing guards fire only when the request names
		// "recurring" explicitly; the default-and-validate path belongs to the
		// store, exactly like the old stack's `body.subscriptionType ===
		// "recurring"` test followed by createSubscription's own guards.
		if raw, present := body["subscriptionType"]; present && raw == "recurring" {
			if startDate == "" || renewalDate == "" {
				writeError(w, http.StatusBadRequest, "startDate and renewalDate are required for recurring subscriptions")
				return
			}
			if !validDate(startDate) || !validDate(renewalDate) {
				writeError(w, http.StatusBadRequest, "Dates must be in YYYY-MM-DD format")
				return
			}
			if billingCycle == "" {
				writeError(w, http.StatusBadRequest, "billingCycle is required for recurring subscriptions")
				return
			}
			if billingCycle != "monthly" && billingCycle != "yearly" {
				writeError(w, http.StatusBadRequest, "Invalid billingCycle. Must be one of: monthly, yearly")
				return
			}
		}

		credentials, err := encryptCredentialsBody(opts.dataCipher(), body, true)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid credentials in request body")
			return
		}

		tagNames, ok := stringList(body, "tagNames")
		if _, present := body["tagNames"]; present && !ok {
			writeError(w, http.StatusBadRequest, "tagNames must be an array")
			return
		}

		var schedules []model.ResetSchedule
		if raw, present := body["resetSchedules"]; present && raw != nil {
			if err := remarshal(raw, &schedules); err != nil {
				writeError(w, http.StatusBadRequest, "resetSchedules must be an array")
				return
			}
		}

		// createSubscription validates a provided balance: null or a non-number
		// is rejected with the old stack's message.
		if _, present := body["balance"]; present {
			balance, isNumber := body["balance"].(float64)
			if !isNumber || balance < 0 {
				writeError(w, http.StatusBadRequest, "Balance must be a non-negative number")
				return
			}
		}
		_, balance, _ := nullableNumber(body, "balance")
		_, threshold, _ := nullableNumber(body, "lowBalanceThreshold")

		input := store.SubscriptionInput{
			Name:                name,
			Category:            category,
			Provider:            stringOr(body, "provider", "other"),
			ProviderCustom:      stringOr(body, "providerCustom", ""),
			SubscriptionType:    subscriptionType,
			BillingCycle:        billingCycle,
			Price:               price,
			StartDate:           startDate,
			RenewalDate:         renewalDate,
			Status:              stringOr(body, "status", "active"),
			Notes:               stringOr(body, "notes", ""),
			Credentials:         credentials,
			Balance:             balance,
			BalanceCurrency:     stringOr(body, "balanceCurrency", ""),
			LowBalanceThreshold: threshold,
			ResetSchedules:      schedules,
			PlanID:              stringOr(body, "planId", ""),
		}
		if input.Provider == "" {
			input.Provider = "other"
		}
		if input.Status == "" {
			input.Status = "active"
		}

		created, err := opts.Data.CreateSubscription(input, tagNames)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSONAligned(w, http.StatusCreated, newSubscriptionPayload(*created))
	}
}

// handleGetSubscription serves GET /api/subscriptions/{id}.
func handleGetSubscription(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := opts.Data.SubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch subscription")
			return
		}
		if sub == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, newSubscriptionPayload(*sub))
	}
}

// handleUpdateSubscription serves PUT /api/subscriptions/{id}.
func handleUpdateSubscription(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}

		// Route-level guards, in the old stack's order.
		if priceRaw, present := body["price"]; present {
			price, isNumber := priceRaw.(float64)
			if !isNumber || price < 0 {
				writeError(w, http.StatusBadRequest, "Price must be a non-negative number")
				return
			}
		}
		if _, present := body["lowBalanceThreshold"]; present {
			_, threshold, ok := nullableNumber(body, "lowBalanceThreshold")
			if !ok || (threshold != nil && *threshold < 0) {
				writeError(w, http.StatusBadRequest, "lowBalanceThreshold must be a non-negative finite number")
				return
			}
		}
		if statusRaw, present := body["status"]; present {
			status, isString := statusRaw.(string)
			if !isString || !validStatus(status) {
				writeError(w, http.StatusBadRequest, "Invalid status. Must be one of: active, paused, cancelled")
				return
			}
		}

		updates := store.SubscriptionUpdates{}
		if raw, present := body["name"]; present {
			name, isString := raw.(string)
			if !isString || strings.TrimSpace(name) == "" {
				writeError(w, http.StatusBadRequest, "Subscription name must be a non-empty string")
				return
			}
			updates.Name = &name
		}
		if raw, present := body["category"]; present {
			updates.Category = stringPointer(valueOrEmpty(raw))
		}
		// null keeps the existing value (old stack's `?? existing` semantics).
		if raw, present := body["provider"]; present && raw != nil {
			updates.Provider = stringPointer(valueOrEmpty(raw))
		}
		if raw, present := body["providerCustom"]; present {
			updates.ProviderCustom = stringPointer(valueOrEmpty(raw))
		}
		if raw, present := body["subscriptionType"]; present {
			value, isString := raw.(string)
			if !isString || !validSubscriptionType(value) {
				writeError(w, http.StatusBadRequest, "Invalid subscriptionType value")
				return
			}
			updates.SubscriptionType = &value
		}
		if raw, present := body["billingCycle"]; present {
			value, isString := raw.(string)
			if !isString || !validBillingCycle(value) {
				writeError(w, http.StatusBadRequest, "Invalid billingCycle value")
				return
			}
			updates.BillingCycle = &value
		}
		if raw, present := body["price"]; present {
			price := raw.(float64)
			updates.Price = &price
		}
		if raw, present := body["startDate"]; present {
			updates.StartDate = stringPointer(valueOrEmpty(raw))
		}
		if raw, present := body["renewalDate"]; present {
			updates.RenewalDate = stringPointer(valueOrEmpty(raw))
		}
		if raw, present := body["status"]; present {
			status := raw.(string)
			updates.Status = &status
		}
		if raw, present := body["notes"]; present {
			updates.Notes = stringPointer(valueOrEmpty(raw))
		}
		if raw, present := body["balance"]; present {
			balance, isNumber := raw.(float64)
			if !isNumber || balance < 0 {
				writeError(w, http.StatusBadRequest, "Balance must be a non-negative number")
				return
			}
			updates.Balance = &balance
		}
		if raw, present := body["balanceCurrency"]; present {
			value, isString := raw.(string)
			if !isString || strings.TrimSpace(value) == "" {
				writeError(w, http.StatusBadRequest, "balanceCurrency must be a non-empty string")
				return
			}
			updates.BalanceCurrency = &value
		}
		if _, present := body["lowBalanceThreshold"]; present {
			_, threshold, _ := nullableNumber(body, "lowBalanceThreshold")
			if threshold == nil {
				updates.ClearLowBalanceThreshold = true
			} else {
				updates.LowBalanceThreshold = threshold
			}
		}
		if raw, present := body["resetSchedules"]; present {
			schedules := []model.ResetSchedule{}
			if raw != nil {
				if err := remarshal(raw, &schedules); err != nil {
					writeError(w, http.StatusBadRequest, "resetSchedules must be an array")
					return
				}
			}
			updates.ResetSchedules = &schedules
		}
		if raw, present := body["planId"]; present {
			if raw == nil {
				updates.ClearPlanID = true
			} else {
				value := valueOrEmpty(raw)
				updates.PlanID = &value
			}
		}

		credentials, err := encryptCredentialsBody(opts.dataCipher(), body, false)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid credentials in request body")
			return
		}
		if credentials != "" {
			updates.Credentials = &credentials
		}

		var tagsArg *[]string
		if _, present := body["tagNames"]; present {
			names, ok := stringList(body, "tagNames")
			if !ok {
				writeError(w, http.StatusBadRequest, "tagNames must be an array")
				return
			}
			tagsArg = &names
		}

		updated, err := opts.Data.UpdateSubscription(chi.URLParam(r, "id"), updates, tagsArg)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if updated == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, newSubscriptionPayload(*updated))
	}
}

// handleDeleteSubscription serves DELETE /api/subscriptions/{id}.
func handleDeleteSubscription(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deleted, err := opts.Data.DeleteSubscription(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to delete subscription")
			return
		}
		if !deleted {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
	}
}

// handleToggleScheduleExhausted serves
// POST /api/subscriptions/{id}/schedules/{scheduleId}/toggle
// (app/api/subscriptions/[id]/schedules/[scheduleId]/toggle/route.ts).
func handleToggleScheduleExhausted(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		exhausted, ok := body["exhausted"].(bool)
		if !ok {
			writeError(w, http.StatusBadRequest, `Invalid request body. "exhausted" must be a boolean`)
			return
		}

		updated, err := opts.Data.ToggleScheduleExhausted(
			chi.URLParam(r, "id"), chi.URLParam(r, "scheduleId"), exhausted,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to toggle schedule exhausted flag")
			return
		}
		if updated == nil {
			writeError(w, http.StatusNotFound, "Subscription or schedule not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, newSubscriptionPayload(*updated))
	}
}

// handleSubscriptionUsage serves GET /api/subscriptions/{id}/usage.
//
// The guard chain (404 / not-recurring / unsupported / credentials) is
// byte-aligned with the old stack. Dispatching to the provider handler lands
// with the query framework (#28); until then the terminal branch reports the
// same 502 family the old stack uses when a handler cannot complete.
func handleSubscriptionUsage(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := opts.Data.SubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to query usage")
			return
		}
		if sub == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		if sub.SubscriptionType != "recurring" {
			writeError(w, http.StatusBadRequest, "Usage query is only supported for recurring subscriptions")
			return
		}
		provider, ok := providers.ProviderByID(sub.Provider)
		if !ok || providers.ResolveUsageAPIURL(provider, sub.PlanID) == "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Usage query not supported for %s", sub.Provider))
			return
		}
		if !providers.HasUsageHandler(providers.ResolveUsageHandlerKey(sub.Provider, sub.PlanID)) {
			writeError(w, http.StatusBadRequest, "Unsupported provider")
			return
		}
		if sub.Credentials == "" {
			writeError(w, http.StatusBadRequest, "Credentials are not configured for this subscription")
			return
		}
		// #28 wires the provider fetch + #29 auto-exhaust + #34 calibration.
		writeError(w, http.StatusBadGateway, "Usage query failed")
	}
}

// handleSubscriptionModels serves GET /api/subscriptions/{id}/models. Guard
// chain aligned with the old stack; the fetch lands with #28.
func handleSubscriptionModels(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := opts.Data.SubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to query models")
			return
		}
		if sub == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		provider, ok := providers.ProviderByID(sub.Provider)
		if !ok || providers.ResolveModelsAPIURL(provider, sub.PlanID) == "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Model query not supported for %s", sub.Provider))
			return
		}
		if providers.ResolveModelsRequireCredentials(provider, sub.PlanID) && sub.Credentials == "" {
			writeError(w, http.StatusBadRequest, "Credentials are not configured for this subscription")
			return
		}
		// #28 wires the models fetchers.
		writeError(w, http.StatusBadGateway, "Model query failed")
	}
}

// encryptCredentialsBody turns a {credentials: {k: v}} object into the stored
// ciphertext. The created-route semantics differ slightly from update: POST
// encrypts any submitted object (the old form always sends `{}`, and
// createSubscription encrypted it), while PUT treats an empty object as "leave
// the stored credentials alone" (`delete body.credentials`). Callers pick the
// behaviour through includeEmpty.
func encryptCredentialsBody(cipher *crypto.Cipher, body map[string]any, includeEmpty bool) (string, error) {
	raw, present := body["credentials"]
	if !present || raw == nil {
		return "", nil
	}
	values, ok := raw.(map[string]any)
	if !ok {
		return "", errors.New("credentials must be an object")
	}
	if len(values) == 0 && !includeEmpty {
		return "", nil
	}
	credentials := make(map[string]string, len(values))
	for key, value := range values {
		if text, isString := value.(string); isString {
			credentials[key] = text
		}
	}
	if len(credentials) == 0 && !includeEmpty {
		return "", nil
	}
	return cipher.EncryptCredentials(credentials)
}

func remarshal(raw any, target any) error {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}

func stringPointer(value string) *string { return &value }

func valueOrEmpty(raw any) string {
	if raw == nil {
		return ""
	}
	if value, ok := raw.(string); ok {
		return value
	}
	return fmt.Sprint(raw)
}

func validStatus(value string) bool {
	switch value {
	case "active", "paused", "cancelled":
		return true
	}
	return false
}

func validSubscriptionType(value string) bool {
	switch value {
	case "recurring", "one-time":
		return true
	}
	return false
}

func validBillingCycle(value string) bool {
	switch value {
	case "monthly", "yearly":
		return true
	}
	return false
}

func validDate(value string) bool {
	if len(value) != 10 {
		return false
	}
	for i, runeValue := range value {
		switch i {
		case 4, 7:
			if runeValue != '-' {
				return false
			}
		default:
			if runeValue < '0' || runeValue > '9' {
				return false
			}
		}
	}
	return true
}
