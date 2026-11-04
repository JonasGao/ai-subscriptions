package httpapi

// Notification HTTP surface, ported from app/api/notifications/** (route.ts and
// [id]/route.ts). Status codes, error strings and response shapes match the
// old handlers because the SPA renders them verbatim.

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/notify"
	"ai-subscriptions/internal/store"
)

// errFeishuAppSenderPending is returned for feishu-app test sends until the
// app-bot sender lands with #38. The endpoint shape stays identical: the
// failure is recorded in lastSendResult and reported as a 502.
var errFeishuAppSenderPending = errors.New("feishu-app channel test send is not supported yet")

// NotificationService is the storage seam the router depends on. *store.Store
// is the production implementation.
type NotificationService interface {
	NotificationChannels() ([]model.NotificationChannel, error)
	NotificationChannelByID(id string) (*model.NotificationChannel, error)
	CreateNotificationChannel(input store.NotificationChannelInput) (*model.NotificationChannel, error)
	UpdateNotificationChannel(id string, patch store.NotificationChannelPatch) (*model.NotificationChannel, error)
	DeleteNotificationChannel(id string) (bool, error)
	ToggleNotificationChannel(id string) (*model.NotificationChannel, error)
	SetNotificationChannelSendResult(id string, result model.SendResult) error
	DefaultLowBalanceThreshold() (float64, error)
	SetDefaultLowBalanceThreshold(value float64) error
}

func mountNotificationRoutes(api chi.Router, service NotificationService) {
	api.Get("/notifications", handleNotificationList(service))
	api.Post("/notifications", handleNotificationCreate(service))
	api.Put("/notifications", handleNotificationThreshold(service))
	api.Put("/notifications/{id}", handleNotificationUpdate(service))
	api.Delete("/notifications/{id}", handleNotificationDelete(service))
	api.Post("/notifications/{id}", handleNotificationAction(service))
}

// decodeJSONObject mirrors parseJsonBody: malformed JSON and non-object bodies
// get the old stack's exact messages. Presence of a key is meaningful on PUT
// (omitted = leave unchanged), so decoding into a map is deliberate.
func decodeJSONObject(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var body any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON in request body"})
		return nil, false
	}
	object, ok := body.(map[string]any)
	if !ok {
		writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "Request body must be a JSON object"})
		return nil, false
	}
	return object, true
}

// jsTruthy mirrors JavaScript's Boolean() for values produced by encoding/json.
func jsTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case string:
		return typed != ""
	default:
		return true
	}
}

// stringValue mirrors `typeof value === "string"` plus trim().
func stringValue(value any) (string, bool) {
	text, ok := value.(string)
	if !ok {
		return "", false
	}
	return strings.TrimSpace(text), true
}

func handleNotificationList(service NotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		channels, err := service.NotificationChannels()
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{
				"error": "Failed to fetch notifications config",
			})
			return
		}
		threshold, err := service.DefaultLowBalanceThreshold()
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{
				"error": "Failed to fetch notifications config",
			})
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]any{
			"channels":                   notify.SanitizeChannels(channels),
			"defaultLowBalanceThreshold": threshold,
		})
	}
}

func handleNotificationCreate(service NotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}

		name, _ := stringValue(body["name"])
		if name == "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "Channel name is required"})
			return
		}

		channelType, _ := body["type"].(string)
		if !notify.IsValidChannelType(channelType) {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{
				"error": "Invalid type. Must be one of: " + strings.Join(notify.ValidChannelTypes, ", "),
			})
			return
		}

		enabled := true
		if value, supplied := body["enabled"]; supplied {
			enabled = jsTruthy(value)
		}

		input := store.NotificationChannelInput{
			Type:    channelType,
			Name:    name,
			Enabled: &enabled,
		}

		switch {
		case notify.IsWebhookChannelType(channelType):
			rawURL, _ := body["url"].(string)
			webhookURL, valid := notify.SafeWebhookURL(rawURL)
			if !valid {
				writeJSONAligned(w, http.StatusBadRequest, map[string]string{
					"error": "A valid http(s) webhook URL is required",
				})
				return
			}
			input.URL = webhookURL

			if rawSecret, supplied := body["secret"]; supplied && rawSecret != nil && rawSecret != "" {
				secret, isString := rawSecret.(string)
				if !isString {
					writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "secret must be a string"})
					return
				}
				input.Secret = secret
			}

		case notify.IsFeishuAppChannelType(channelType):
			appID, ok := safeNonEmptyStringField(body, "appId")
			if !ok {
				writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "appId is required for feishu-app channel"})
				return
			}
			appSecret, ok := safeNonEmptyStringField(body, "appSecret")
			if !ok {
				writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "appSecret is required for feishu-app channel"})
				return
			}
			receiveID, ok := safeNonEmptyStringField(body, "receiveId")
			if !ok {
				writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "receiveId is required for feishu-app channel"})
				return
			}
			receiveIDType, ok := safeReceiveIDTypeField(body)
			if !ok {
				writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "receiveIdType must be 'open_id' or 'chat_id'"})
				return
			}
			input.AppID = appID
			input.AppSecret = appSecret
			input.ReceiveID = receiveID
			input.ReceiveIDType = receiveIDType
		}

		created, err := service.CreateNotificationChannel(input)
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create channel"})
			return
		}
		writeJSONAligned(w, http.StatusCreated, notify.SanitizeChannel(*created))
	}
}

func safeNonEmptyStringField(body map[string]any, key string) (string, bool) {
	raw, _ := body[key].(string)
	return notify.SafeNonEmptyString(raw)
}

func safeReceiveIDTypeField(body map[string]any) (string, bool) {
	raw, _ := body["receiveIdType"].(string)
	return notify.SafeReceiveIDType(raw)
}

func handleNotificationThreshold(service NotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}
		value, isNumber := body["defaultLowBalanceThreshold"].(float64)
		if !isNumber || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{
				"error": "defaultLowBalanceThreshold must be a non-negative number",
			})
			return
		}
		if err := service.SetDefaultLowBalanceThreshold(value); err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update threshold"})
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]any{"defaultLowBalanceThreshold": value})
	}
}

func handleNotificationUpdate(service NotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		existing, err := service.NotificationChannelByID(id)
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update channel"})
			return
		}
		if existing == nil {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{"error": "Channel not found"})
			return
		}

		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}

		patch, message := channelPatchFromBody(body)
		if message != "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": message})
			return
		}

		// feishu-app channels must never end up without an appSecret.
		// Mirrors the old handler's guard: an omitted appSecret, and even an
		// explicit clear, fall back to the stored value when one exists; the
		// request is rejected only when the effective value is empty.
		effectiveType := existing.Type
		if patch.Type != nil {
			effectiveType = *patch.Type
		}
		if notify.IsFeishuAppChannelType(effectiveType) {
			effectiveAppSecret := existing.AppSecret
			if patch.AppSecret != nil && *patch.AppSecret != "" {
				effectiveAppSecret = *patch.AppSecret
			}
			if effectiveAppSecret == "" {
				writeJSONAligned(w, http.StatusBadRequest, map[string]string{
					"error": "feishu-app channel requires a non-empty appSecret",
				})
				return
			}
		}

		updated, err := service.UpdateNotificationChannel(id, patch)
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to update channel"})
			return
		}
		if updated == nil {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{"error": "Channel not found"})
			return
		}
		writeJSONAligned(w, http.StatusOK, notify.SanitizeChannel(*updated))
	}
}

// channelPatchFromBody applies the old PUT field rules. A non-empty message is
// the 400 error text.
func channelPatchFromBody(body map[string]any) (store.NotificationChannelPatch, string) {
	var patch store.NotificationChannelPatch

	if raw, supplied := body["name"]; supplied {
		name, _ := stringValue(raw)
		if name == "" {
			return patch, "Channel name cannot be empty"
		}
		patch.Name = &name
	}

	if raw, supplied := body["type"]; supplied {
		channelType, isString := raw.(string)
		if !isString || !notify.IsValidChannelType(channelType) {
			return patch, "Invalid type. Must be one of: " + strings.Join(notify.ValidChannelTypes, ", ")
		}
		patch.Type = &channelType
	}

	if raw, supplied := body["url"]; supplied {
		rawURL, _ := raw.(string)
		webhookURL, valid := notify.SafeWebhookURL(rawURL)
		if !valid {
			return patch, "A valid http(s) webhook URL is required"
		}
		patch.URL = &webhookURL
	}

	if raw, supplied := body["secret"]; supplied {
		if raw == nil || raw == "" {
			cleared := ""
			patch.Secret = &cleared
		} else if secret, isString := raw.(string); isString {
			patch.Secret = &secret
		} else {
			return patch, "secret must be a string"
		}
	}

	if _, supplied := body["appId"]; supplied {
		appID, ok := safeNonEmptyStringField(body, "appId")
		if !ok {
			return patch, "appId cannot be empty"
		}
		patch.AppID = &appID
	}

	if raw, supplied := body["appSecret"]; supplied {
		if raw == nil || raw == "" {
			cleared := ""
			patch.AppSecret = &cleared
		} else if appSecret, isString := raw.(string); isString {
			patch.AppSecret = &appSecret
		} else {
			return patch, "appSecret must be a string"
		}
	}

	if _, supplied := body["receiveId"]; supplied {
		receiveID, ok := safeNonEmptyStringField(body, "receiveId")
		if !ok {
			return patch, "receiveId cannot be empty"
		}
		patch.ReceiveID = &receiveID
	}

	if _, supplied := body["receiveIdType"]; supplied {
		receiveIDType, ok := safeReceiveIDTypeField(body)
		if !ok {
			return patch, "receiveIdType must be 'open_id' or 'chat_id'"
		}
		patch.ReceiveIDType = &receiveIDType
	}

	if raw, supplied := body["enabled"]; supplied {
		enabled := jsTruthy(raw)
		patch.Enabled = &enabled
	}

	return patch, ""
}

func handleNotificationDelete(service NotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		removed, err := service.DeleteNotificationChannel(chi.URLParam(r, "id"))
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to delete channel"})
			return
		}
		if !removed {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{"error": "Channel not found"})
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func handleNotificationAction(service NotificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		channel, err := service.NotificationChannelByID(chi.URLParam(r, "id"))
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to perform action"})
			return
		}
		if channel == nil {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{"error": "Channel not found"})
			return
		}

		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}
		action, _ := body["action"].(string)

		switch action {
		case "test":
			handleNotificationTestSend(w, service, *channel)
		case "toggle":
			updated, err := service.ToggleNotificationChannel(channel.ID)
			if err != nil {
				writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to perform action"})
				return
			}
			if updated == nil {
				writeJSONAligned(w, http.StatusNotFound, map[string]string{"error": "Channel not found"})
				return
			}
			writeJSONAligned(w, http.StatusOK, notify.SanitizeChannel(*updated))
		default:
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{
				"error": `Unknown action. Use "test" or "toggle".`,
			})
		}
	}
}

func handleNotificationTestSend(w http.ResponseWriter, service NotificationService, channel model.NotificationChannel) {
	if !channel.Enabled {
		writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "Cannot test a disabled channel"})
		return
	}

	startedAt := model.FormatTimestamp(time.Now())
	err := sendChannelTest(channel)
	if err != nil {
		message := err.Error()
		_ = service.SetNotificationChannelSendResult(channel.ID, model.SendResult{
			Success:   false,
			Timestamp: startedAt,
			Error:     message,
		})
		refreshed, _ := service.NotificationChannelByID(channel.ID)
		writeJSONAligned(w, http.StatusBadGateway, map[string]any{
			"success": false,
			"error":   message,
			"channel": sanitizedOrNil(refreshed),
		})
		return
	}

	if err := service.SetNotificationChannelSendResult(channel.ID, model.SendResult{
		Success:   true,
		Timestamp: startedAt,
	}); err != nil {
		writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to perform action"})
		return
	}
	refreshed, err := service.NotificationChannelByID(channel.ID)
	if err != nil {
		writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "Failed to perform action"})
		return
	}
	writeJSONAligned(w, http.StatusOK, map[string]any{
		"success": true,
		"channel": sanitizedOrNil(refreshed),
	})
}

func sanitizedOrNil(channel *model.NotificationChannel) any {
	if channel == nil {
		return nil
	}
	return notify.SanitizeChannel(*channel)
}

// sendChannelTest mirrors the old route's sendTest: webhook channels go through
// the prepared-send pipeline; feishu-app has a dedicated sender that arrives
// with #38, so it reports a clear failure instead of silently doing nothing.
func sendChannelTest(channel model.NotificationChannel) error {
	event := testEvent()
	if channel.Type == notify.TypeFeishuApp {
		return errFeishuAppSenderPending
	}
	prepared, err := notify.PrepareSend(channel, event, time.Now())
	if err != nil {
		return err
	}
	return notify.NewHTTPSender(nil).Send(prepared)
}

// testEvent builds the synthetic low-balance event used by test sends. The
// placeholder subscription gives the payload builder something to render.
func testEvent() notify.Event {
	now := model.FormatTimestamp(time.Now())
	balance := 1.0
	return notify.Event{
		Kind: "low-balance",
		Subscription: model.Subscription{
			ID:               "test",
			Name:             "测试订阅",
			Category:         "其他",
			Provider:         "other",
			SubscriptionType: "one-time",
			Price:            0,
			Status:           "active",
			Balance:          &balance,
			CreatedAt:        now,
			UpdatedAt:        now,
		},
		Balance:     1,
		Threshold:   10,
		TriggeredAt: now,
	}
}
