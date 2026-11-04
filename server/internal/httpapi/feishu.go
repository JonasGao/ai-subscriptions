package httpapi

// Feishu app-bot routes, ported from
// app/api/notifications/feishu-app/{chats,lookup-user,listen}/route.ts.
//
// Three helpers share one credential resolver: the settings page can post
// appId+appSecret directly, or a stored channelId whose appSecret is reused.
// Every handler answers {error: "..."} with status 500 on failure, exactly like
// the old handlers, because the SPA renders that string verbatim.

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/notify"
)

// FeishuService is the app-bot surface the router depends on.
// *notify.FeishuClient is the production implementation.
type FeishuService interface {
	ListChats(ctx context.Context, appID, appSecret string, opts notify.ChatListOptions) (notify.FeishuChatList, error)
	LookupUsers(ctx context.Context, appID, appSecret string, mobiles, emails []string) (notify.FeishuUserLookup, error)
	SendToChannel(ctx context.Context, event notify.Event, channel model.NotificationChannel) error
}

// ListenerService is the WS listener surface. *notify.ListenerManager is the
// production implementation.
type ListenerService interface {
	Start(ctx context.Context, appID, appSecret string, ttlSeconds int) (notify.ListenerStatus, error)
	Stop(ctx context.Context, appIDOrListenID string) (bool, error)
	Status(appIDOrListenID string) (notify.ListenerStatus, bool)
	Messages(appIDOrListenID string) []notify.ReceivedMessage
}

func mountFeishuRoutes(api chi.Router, feishu FeishuService, listeners ListenerService, service NotificationService) {
	api.Post("/notifications/feishu-app/chats", handleFeishuChats(service, feishu))
	api.Post("/notifications/feishu-app/lookup-user", handleFeishuLookupUser(service, feishu))
	api.Post("/notifications/feishu-app/listen", handleFeishuListenStart(service, listeners))
	api.Get("/notifications/feishu-app/listen", handleFeishuListenPoll(listeners))
	api.Delete("/notifications/feishu-app/listen", handleFeishuListenStop(listeners))
}

// channelLookup adapts the notification service to the resolver's seam.
func channelLookup(service NotificationService) notify.ChannelLookup {
	if service == nil {
		return nil
	}
	return func(id string) (*model.NotificationChannel, error) {
		return service.NotificationChannelByID(id)
	}
}

// resolveFeishu answers the request's credentials or writes the old handler's
// 500 body and reports false.
func resolveFeishu(w http.ResponseWriter, body map[string]any, service NotificationService) (notify.FeishuResolvedCredentials, bool) {
	creds, err := notify.ResolveFeishuCredentials(body, channelLookup(service))
	if err != nil {
		writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return notify.FeishuResolvedCredentials{}, false
	}
	return creds, true
}

func handleFeishuChats(service NotificationService, feishu FeishuService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}
		creds, ok := resolveFeishu(w, body, service)
		if !ok {
			return
		}

		opts := notify.ChatListOptions{}
		if pageSize, isNumber := body["page_size"].(float64); isNumber {
			opts.PageSize = int(pageSize)
		}
		if pageToken, isString := body["page_token"].(string); isString {
			opts.PageToken = pageToken
		}

		result, err := feishu.ListChats(r.Context(), creds.AppID, creds.AppSecret, opts)
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSONAligned(w, http.StatusOK, result)
	}
}

func handleFeishuLookupUser(service NotificationService, feishu FeishuService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}
		creds, ok := resolveFeishu(w, body, service)
		if !ok {
			return
		}

		mobiles, ok := trimmedStringList(w, body["mobiles"], "mobiles")
		if !ok {
			return
		}
		emails, ok := optionalStringList(w, body["emails"], "emails")
		if !ok {
			return
		}

		result, err := feishu.LookupUsers(r.Context(), creds.AppID, creds.AppSecret, mobiles, emails)
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSONAligned(w, http.StatusOK, result)
	}
}

// trimmedStringList validates a required string array (the mobiles contract).
func trimmedStringList(w http.ResponseWriter, raw any, key string) ([]string, bool) {
	values, isArray := raw.([]any)
	if !isArray || len(values) == 0 {
		writeJSONAligned(w, http.StatusBadRequest, map[string]string{
			"error": key + " 必须是包含至少一个手机号的数组",
		})
		return nil, false
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		text, isString := value.(string)
		if !isString || strings.TrimSpace(text) == "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{
				"error": key + " 数组中的每个元素必须是非空字符串",
			})
			return nil, false
		}
		out = append(out, strings.TrimSpace(text))
	}
	return out, true
}

// optionalStringList validates an optional string array (the emails addition).
func optionalStringList(w http.ResponseWriter, raw any, key string) ([]string, bool) {
	if raw == nil {
		return nil, true
	}
	values, isArray := raw.([]any)
	if !isArray {
		writeJSONAligned(w, http.StatusBadRequest, map[string]string{
			"error": key + " 必须是字符串数组",
		})
		return nil, false
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		text, isString := value.(string)
		if !isString || strings.TrimSpace(text) == "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{
				"error": key + " 数组中的每个元素必须是非空字符串",
			})
			return nil, false
		}
		out = append(out, strings.TrimSpace(text))
	}
	return out, true
}

func handleFeishuListenStart(service NotificationService, listeners ListenerService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}
		creds, ok := resolveFeishu(w, body, service)
		if !ok {
			return
		}

		ttlSeconds := 0
		if ttl, isNumber := body["ttl_seconds"].(float64); isNumber {
			ttlSeconds = int(ttl)
		}

		status, err := listeners.Start(r.Context(), creds.AppID, creds.AppSecret, ttlSeconds)
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSONAligned(w, http.StatusOK, status)
	}
}

func handleFeishuListenPoll(listeners ListenerService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		id := query.Get("listenId")
		if id == "" {
			id = query.Get("appId")
		}
		if id == "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "缺少 listenId 或 appId 参数"})
			return
		}

		status, found := listeners.Status(id)
		if !found {
			// 404 tells the page to stop polling: the listener never existed or
			// its tombstone expired.
			writeJSONAligned(w, http.StatusNotFound, map[string]string{
				"error": "没有找到监听器(id=" + id + "),可能已停止或已过期",
			})
			return
		}

		messages := listeners.Messages(id)
		writeJSONAligned(w, http.StatusOK, map[string]any{
			"status":   status,
			"messages": messages,
		})
	}
}

func handleFeishuListenStop(listeners ListenerService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		id := query.Get("listenId")
		if id == "" {
			id = query.Get("appId")
		}
		if id == "" {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "缺少 listenId 或 appId 参数"})
			return
		}

		stopped, err := listeners.Stop(r.Context(), id)
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": stopped})
	}
}
