package httpapi

// Proxy-subscription HTTP surface, ported from app/api/proxy-subscriptions/**
// and app/api/proxy-tags/**. Status codes and error messages match the old
// stack verbatim because the SPA shows them to the user.

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

// ProxyService is the proxy-subscription seam the router depends on.
// *store.Store is the production implementation; tests can substitute one.
type ProxyService interface {
	ProxySubscriptions() ([]model.ProxySubscription, error)
	ProxySubscriptionByID(id string) (*model.ProxySubscription, error)
	CreateProxySubscription(input store.ProxySubscriptionInput) (*model.ProxySubscription, error)
	UpdateProxySubscription(id string, input store.ProxySubscriptionInput) (*model.ProxySubscription, error)
	DeleteProxySubscription(id string) (bool, error)
	ProxyTags() ([]model.ProxySubscriptionTag, error)
	RenameProxyTag(id, name string) (*model.ProxySubscriptionTag, error)
	DeleteProxyTag(id string) (*store.DeleteProxyTagResult, error)
}

func mountProxyRoutes(api chi.Router, service ProxyService) {
	api.Get("/proxy-subscriptions", handleProxySubscriptionList(service))
	api.Post("/proxy-subscriptions", handleProxySubscriptionCreate(service))
	api.Get("/proxy-subscriptions/{id}", handleProxySubscriptionGet(service))
	api.Put("/proxy-subscriptions/{id}", handleProxySubscriptionUpdate(service))
	api.Delete("/proxy-subscriptions/{id}", handleProxySubscriptionDelete(service))

	api.Get("/proxy-tags", handleProxyTagList(service))
	api.Patch("/proxy-tags/{id}", handleProxyTagRename(service))
	api.Delete("/proxy-tags/{id}", handleProxyTagDelete(service))
}

// proxySubscriptionPayload decodes the create/update body. Pointer fields
// distinguish "not supplied" (leave unchanged on PUT) from an explicit empty
// value (clear the field), matching the old route's undefined filtering.
type proxySubscriptionPayload struct {
	Name           *string   `json:"name"`
	MonthlyPrice   *float64  `json:"monthlyPrice"`
	ExpirationDate *string   `json:"expirationDate"`
	Website        *string   `json:"website"`
	Notes          *string   `json:"notes"`
	Status         *string   `json:"status"`
	TagNames       *[]string `json:"tagNames"`
}

func (p proxySubscriptionPayload) input() store.ProxySubscriptionInput {
	return store.ProxySubscriptionInput{
		Name:           p.Name,
		MonthlyPrice:   p.MonthlyPrice,
		ExpirationDate: p.ExpirationDate,
		Website:        p.Website,
		Notes:          p.Notes,
		Status:         p.Status,
		TagNames:       p.TagNames,
	}
}

func decodeProxyPayload(w http.ResponseWriter, r *http.Request) (proxySubscriptionPayload, bool) {
	var payload proxySubscriptionPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON in request body"})
		return proxySubscriptionPayload{}, false
	}
	return payload, true
}

func handleProxySubscriptionList(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subscriptions, err := service.ProxySubscriptions()
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{
				"error": "Failed to fetch proxy subscriptions",
			})
			return
		}
		if subscriptions == nil {
			subscriptions = []model.ProxySubscription{}
		}
		writeJSONAligned(w, http.StatusOK, subscriptions)
	}
}

func handleProxySubscriptionCreate(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, ok := decodeProxyPayload(w, r)
		if !ok {
			return
		}
		created, err := service.CreateProxySubscription(payload.input())
		if err != nil {
			writeProxyError(w, err, "Failed to create proxy subscription")
			return
		}
		writeJSONAligned(w, http.StatusCreated, created)
	}
}

func handleProxySubscriptionGet(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subscription, err := service.ProxySubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{
				"error": "Failed to fetch proxy subscriptions",
			})
			return
		}
		if subscription == nil {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{
				"error": "Proxy subscription not found",
			})
			return
		}
		writeJSONAligned(w, http.StatusOK, subscription)
	}
}

func handleProxySubscriptionUpdate(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, ok := decodeProxyPayload(w, r)
		if !ok {
			return
		}
		updated, err := service.UpdateProxySubscription(chi.URLParam(r, "id"), payload.input())
		if err != nil {
			writeProxyError(w, err, "Failed to update proxy subscription")
			return
		}
		if updated == nil {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{
				"error": "Proxy subscription not found",
			})
			return
		}
		writeJSONAligned(w, http.StatusOK, updated)
	}
}

func handleProxySubscriptionDelete(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deleted, err := service.DeleteProxySubscription(chi.URLParam(r, "id"))
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{
				"error": "Failed to delete proxy subscription",
			})
			return
		}
		if !deleted {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{
				"error": "Proxy subscription not found",
			})
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func handleProxyTagList(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tags, err := service.ProxyTags()
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{
				"error": "Failed to fetch proxy tags",
			})
			return
		}
		if tags == nil {
			tags = []model.ProxySubscriptionTag{}
		}
		writeJSONAligned(w, http.StatusOK, tags)
	}
}

func handleProxyTagRename(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name *string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON in request body"})
			return
		}
		name := ""
		if body.Name != nil {
			name = *body.Name
		}
		tag, err := service.RenameProxyTag(chi.URLParam(r, "id"), name)
		if err != nil {
			writeProxyError(w, err, "重命名标签失败")
			return
		}
		if tag == nil {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{"error": "标签不存在"})
			return
		}
		writeJSONAligned(w, http.StatusOK, tag)
	}
}

func handleProxyTagDelete(service ProxyService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := service.DeleteProxyTag(chi.URLParam(r, "id"))
		if err != nil {
			writeJSONAligned(w, http.StatusInternalServerError, map[string]string{"error": "删除标签失败"})
			return
		}
		if result == nil {
			writeJSONAligned(w, http.StatusNotFound, map[string]string{"error": "标签不存在"})
			return
		}
		writeJSONAligned(w, http.StatusOK, result)
	}
}

// writeProxyError surfaces validation errors as 400s with the message intact.
// The old stack wrapped every handler in try/catch and answered
// error.message — the user-facing Chinese text — so the SPA can show it.
func writeProxyError(w http.ResponseWriter, err error, fallback string) {
	message := fallback
	if err != nil && err.Error() != "" {
		message = err.Error()
	}
	writeJSONAligned(w, http.StatusBadRequest, map[string]string{"error": message})
}
