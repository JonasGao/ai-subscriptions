package httpapi

// Tool-catalog routes (#35), ported from app/api/tools/**. Status codes and
// error bodies match the old handlers verbatim because the SPA surfaces them
// directly.

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

// ToolService is the tool-catalog surface from lib/tools.ts.
type ToolService interface {
	Tools() ([]model.Tool, error)
	ToolByID(id string) (*model.Tool, error)
	CreateTool(input store.ToolInput) (*model.Tool, error)
	UpdateTool(id string, updates store.ToolUpdates) (*model.Tool, error)
	DeleteTool(id string) (bool, error)
	ReorderTools(ids []string) ([]model.Tool, error)
}

func mountToolRoutes(api chi.Router, svc ToolService) {
	api.Get("/tools", handleListTools(svc))
	api.Post("/tools", handleCreateTool(svc))
	api.Patch("/tools", handleReorderTools(svc))
	api.Get("/tools/{id}", handleGetTool(svc))
	api.Put("/tools/{id}", handleUpdateTool(svc))
	api.Delete("/tools/{id}", handleDeleteTool(svc))
}

func handleListTools(svc ToolService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tools, err := svc.Tools()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch tools")
			return
		}
		writeJSONAligned(w, http.StatusOK, tools)
	}
}

func handleCreateTool(svc ToolService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		rawName, _ := body["name"].(string)
		name := strings.TrimSpace(rawName)
		if name == "" {
			writeError(w, http.StatusBadRequest, "Tool name is required")
			return
		}
		rawCategory, _ := body["category"].(string)
		category := strings.TrimSpace(rawCategory)
		if category == "" {
			writeError(w, http.StatusBadRequest, "Tool category is required")
			return
		}
		rawProvider, _ := body["provider"].(string)
		provider := strings.TrimSpace(rawProvider)
		if provider == "" {
			writeError(w, http.StatusBadRequest, "Tool provider is required")
			return
		}
		if repoURL, ok := body["repoUrl"].(string); ok && repoURL != "" && !isValidHTTPURL(repoURL) {
			writeError(w, http.StatusBadRequest, "Repository URL must be a valid HTTP or HTTPS URL")
			return
		}

		input := store.ToolInput{
			Name:     name,
			Category: category,
			Provider: provider,
			Forms:    stringSliceFrom(body["forms"]),
			Status:   "active",
		}
		if value, ok := body["providerCustom"].(string); ok {
			input.ProviderCustom = strings.TrimSpace(value)
		}
		if value, ok := body["isOpenSource"].(bool); ok {
			input.IsOpenSource = value
		}
		if value, ok := body["repoUrl"].(string); ok {
			input.RepoURL = strings.TrimSpace(value)
		}
		if value, ok := body["status"].(string); ok && value != "" {
			input.Status = value
		}
		if value, ok := body["notes"].(string); ok {
			input.Notes = strings.TrimSpace(value)
		}

		tool, err := svc.CreateTool(input)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to create tool")
			return
		}
		writeJSONAligned(w, http.StatusCreated, tool)
	}
}

func handleGetTool(svc ToolService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tool, err := svc.ToolByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch tool")
			return
		}
		if tool == nil {
			writeError(w, http.StatusNotFound, "Tool not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, tool)
	}
}

func handleUpdateTool(svc ToolService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		var updates store.ToolUpdates
		if raw, present := body["name"]; present {
			name, ok := raw.(string)
			if !ok || strings.TrimSpace(name) == "" {
				writeError(w, http.StatusBadRequest, "Tool name must be a non-empty string")
				return
			}
			updates.Name = &name
		}
		if raw, present := body["category"]; present {
			category, ok := raw.(string)
			if !ok || strings.TrimSpace(category) == "" {
				writeError(w, http.StatusBadRequest, "Tool category must be a non-empty string")
				return
			}
			updates.Category = &category
		}
		if raw, present := body["repoUrl"]; present {
			repoURL, ok := raw.(string)
			if !ok || (repoURL != "" && !isValidHTTPURL(repoURL)) {
				writeError(w, http.StatusBadRequest, "Repository URL must be a valid HTTP or HTTPS URL")
				return
			}
			updates.RepoURL = &repoURL
		}
		if value, ok := body["provider"].(string); ok {
			updates.Provider = &value
		}
		if value, ok := body["providerCustom"].(string); ok {
			updates.ProviderCustom = &value
		}
		if value, ok := body["forms"]; ok {
			forms := stringSliceFrom(value)
			updates.Forms = &forms
		}
		if value, ok := body["isOpenSource"].(bool); ok {
			updates.IsOpenSource = &value
		}
		if value, ok := body["status"].(string); ok {
			updates.Status = &value
		}
		if value, ok := body["notes"].(string); ok {
			updates.Notes = &value
		}

		tool, err := svc.UpdateTool(chi.URLParam(r, "id"), updates)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to update tool")
			return
		}
		if tool == nil {
			writeError(w, http.StatusNotFound, "Tool not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, tool)
	}
}

func handleDeleteTool(svc ToolService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deleted, err := svc.DeleteTool(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to delete tool")
			return
		}
		if !deleted {
			writeError(w, http.StatusNotFound, "Tool not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func handleReorderTools(svc ToolService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		raw, present := body["toolIds"]
		arr, ok := raw.([]any)
		if !present || !ok {
			writeError(w, http.StatusBadRequest, "toolIds array is required")
			return
		}
		tools, err := svc.ReorderTools(stringSlice(arr))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to reorder tools")
			return
		}
		writeJSONAligned(w, http.StatusOK, tools)
	}
}

// stringSlice converts decoded JSON array items to strings, dropping anything
// that is not a string (the old routes passed the array straight through).
func stringSlice(values []any) []string {
	items := make([]string, 0, len(values))
	for _, value := range values {
		if item, ok := value.(string); ok {
			items = append(items, item)
		}
	}
	return items
}

func stringSliceFrom(value any) []string {
	values, ok := value.([]any)
	if !ok {
		return []string{}
	}
	return stringSlice(values)
}

// isValidHTTPURL mirrors the old routes' isValidUrl: only absolute HTTP(S)
// URLs with a host are accepted.
func isValidHTTPURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}
