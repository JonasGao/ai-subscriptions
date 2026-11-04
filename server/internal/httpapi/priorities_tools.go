package httpapi

// Priority-scene, tool-priority-scene and tool routes (#35), ported from
// app/api/{priorities,tool-priorities,tools}/**. Status codes and error bodies
// match the old handlers verbatim because the SPA surfaces them directly.

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/store"
)

// PriorityService is the priority-scene surface: the subscription scenes from
// lib/priorities.ts and the tool scenes from lib/tool-priorities.ts (both are
// the shared createSceneManager from lib/priority-scene.ts).
type PriorityService interface {
	PriorityScenes() ([]model.PriorityScene, error)
	PrioritySceneByID(id string) (*model.PriorityScene, error)
	CreatePriorityScene(name string) (*model.PriorityScene, error)
	RenamePriorityScene(id, name string) (*model.PriorityScene, error)
	DeletePriorityScene(id string) (bool, error)
	SetPrioritySceneOrder(id string, order []string) (*model.PriorityScene, error)

	ToolPriorityScenes() ([]model.ToolPriorityScene, error)
	ToolPrioritySceneByID(id string) (*model.ToolPriorityScene, error)
	CreateToolPriorityScene(name string) (*model.ToolPriorityScene, error)
	RenameToolPriorityScene(id, name string) (*model.ToolPriorityScene, error)
	DeleteToolPriorityScene(id string) (bool, error)
	SetToolPrioritySceneOrder(id string, order []string) (*model.ToolPriorityScene, error)
}

// ToolService is the tool-catalog surface from lib/tools.ts.
type ToolService interface {
	Tools() ([]model.Tool, error)
	ToolByID(id string) (*model.Tool, error)
	CreateTool(input store.ToolInput) (*model.Tool, error)
	UpdateTool(id string, updates store.ToolUpdates) (*model.Tool, error)
	DeleteTool(id string) (bool, error)
	ReorderTools(ids []string) ([]model.Tool, error)
}

func mountPriorityRoutes(api chi.Router, svc PriorityService) {
	api.Get("/priorities", handleListPriorityScenes(svc))
	api.Post("/priorities", handleCreatePriorityScene(svc))
	api.Get("/priorities/{id}", handleGetPriorityScene(svc))
	api.Put("/priorities/{id}", handleRenamePriorityScene(svc))
	api.Delete("/priorities/{id}", handleDeletePriorityScene(svc))
	api.Patch("/priorities/{id}", handleReorderPriorityScene(svc))

	api.Get("/tool-priorities", handleListToolPriorityScenes(svc))
	api.Post("/tool-priorities", handleCreateToolPriorityScene(svc))
	api.Get("/tool-priorities/{id}", handleGetToolPriorityScene(svc))
	api.Put("/tool-priorities/{id}", handleRenameToolPriorityScene(svc))
	api.Delete("/tool-priorities/{id}", handleDeleteToolPriorityScene(svc))
	api.Patch("/tool-priorities/{id}", handleReorderToolPriorityScene(svc))
}

func mountToolRoutes(api chi.Router, svc ToolService) {
	api.Get("/tools", handleListTools(svc))
	api.Post("/tools", handleCreateTool(svc))
	api.Patch("/tools", handleReorderTools(svc))
	api.Get("/tools/{id}", handleGetTool(svc))
	api.Put("/tools/{id}", handleUpdateTool(svc))
	api.Delete("/tools/{id}", handleDeleteTool(svc))
}

// ---------- subscription priority scenes ----------

func handleListPriorityScenes(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scenes, err := svc.PriorityScenes()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch priority scenes")
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]any{"scenes": scenes})
	}
}

func handleCreatePriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		name, _ := body["name"].(string)
		if strings.TrimSpace(name) == "" {
			writeError(w, http.StatusBadRequest, "Scene name is required")
			return
		}
		scene, err := svc.CreatePriorityScene(name)
		if errors.Is(err, store.ErrSceneNameExists) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to create priority scene")
			return
		}
		writeJSONAligned(w, http.StatusCreated, scene)
	}
}

func handleGetPriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scene, err := svc.PrioritySceneByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch priority scene")
			return
		}
		if scene == nil {
			writeError(w, http.StatusNotFound, "Priority scene not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, scene)
	}
}

func handleRenamePriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		id := chi.URLParam(r, "id")
		rawName, hasName := body["name"]
		if hasName {
			name, ok := rawName.(string)
			if !ok || strings.TrimSpace(name) == "" {
				writeError(w, http.StatusBadRequest, "Scene name must be a non-empty string")
				return
			}
			scene, err := svc.RenamePriorityScene(id, name)
			if errors.Is(err, store.ErrSceneNameExists) {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to update priority scene")
				return
			}
			if scene == nil {
				writeError(w, http.StatusNotFound, "Priority scene not found")
				return
			}
			writeJSONAligned(w, http.StatusOK, scene)
			return
		}
		// A PUT without a name is a no-op read, like updateScene's spread.
		scene, err := svc.PrioritySceneByID(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to update priority scene")
			return
		}
		if scene == nil {
			writeError(w, http.StatusNotFound, "Priority scene not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, scene)
	}
}

func handleDeletePriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deleted, err := svc.DeletePriorityScene(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to delete priority scene")
			return
		}
		if !deleted {
			writeError(w, http.StatusNotFound, "Priority scene not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func handleReorderPriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		if action, _ := body["action"].(string); action == "reorder" {
			if raw, present := body["subscriptionOrder"]; present && raw != nil {
				arr, ok := raw.([]any)
				if !ok {
					writeError(w, http.StatusBadRequest, "subscriptionOrder must be an array")
					return
				}
				order := stringSlice(arr)
				scene, err := svc.SetPrioritySceneOrder(chi.URLParam(r, "id"), order)
				if err != nil {
					writeError(w, http.StatusInternalServerError, "Failed to reorder subscriptions")
					return
				}
				if scene == nil {
					writeError(w, http.StatusNotFound, "Priority scene not found")
					return
				}
				writeJSONAligned(w, http.StatusOK, scene)
				return
			}
		}
		writeError(w, http.StatusBadRequest, "Invalid action. Only reorder is supported")
	}
}

// ---------- tool priority scenes ----------

func handleListToolPriorityScenes(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scenes, err := svc.ToolPriorityScenes()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch tool priority scenes")
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]any{"scenes": scenes})
	}
}

func handleCreateToolPriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		name, _ := body["name"].(string)
		if strings.TrimSpace(name) == "" {
			writeError(w, http.StatusBadRequest, "Scene name is required")
			return
		}
		scene, err := svc.CreateToolPriorityScene(name)
		if errors.Is(err, store.ErrSceneNameExists) {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to create tool priority scene")
			return
		}
		writeJSONAligned(w, http.StatusCreated, scene)
	}
}

func handleGetToolPriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		scene, err := svc.ToolPrioritySceneByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch tool priority scene")
			return
		}
		if scene == nil {
			writeError(w, http.StatusNotFound, "Tool priority scene not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, scene)
	}
}

func handleRenameToolPriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		id := chi.URLParam(r, "id")
		rawName, hasName := body["name"]
		if hasName {
			name, ok := rawName.(string)
			if !ok || strings.TrimSpace(name) == "" {
				writeError(w, http.StatusBadRequest, "Scene name must be a non-empty string")
				return
			}
			scene, err := svc.RenameToolPriorityScene(id, name)
			if errors.Is(err, store.ErrSceneNameExists) {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to update tool priority scene")
				return
			}
			if scene == nil {
				writeError(w, http.StatusNotFound, "Tool priority scene not found")
				return
			}
			writeJSONAligned(w, http.StatusOK, scene)
			return
		}
		scene, err := svc.ToolPrioritySceneByID(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to update tool priority scene")
			return
		}
		if scene == nil {
			writeError(w, http.StatusNotFound, "Tool priority scene not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, scene)
	}
}

func handleDeleteToolPriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deleted, err := svc.DeleteToolPriorityScene(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to delete tool priority scene")
			return
		}
		if !deleted {
			writeError(w, http.StatusNotFound, "Tool priority scene not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, map[string]bool{"success": true})
	}
}

func handleReorderToolPriorityScene(svc PriorityService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		if action, _ := body["action"].(string); action == "reorder" {
			if raw, present := body["toolOrder"]; present && raw != nil {
				arr, ok := raw.([]any)
				if !ok {
					writeError(w, http.StatusBadRequest, "toolOrder must be an array")
					return
				}
				scene, err := svc.SetToolPrioritySceneOrder(chi.URLParam(r, "id"), stringSlice(arr))
				if err != nil {
					writeError(w, http.StatusInternalServerError, "Failed to reorder tools")
					return
				}
				if scene == nil {
					writeError(w, http.StatusNotFound, "Tool priority scene not found")
					return
				}
				writeJSONAligned(w, http.StatusOK, scene)
				return
			}
		}
		writeError(w, http.StatusBadRequest, "Invalid action. Only reorder is supported")
	}
}

// ---------- tools ----------

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
