package httpapi

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// handleListTags serves GET /api/tags. The catalogue is mutable data, so the
// response is explicitly uncacheable (the old route's force-dynamic).
func handleListTags(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tags, err := opts.Data.Tags()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch tags")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSONAligned(w, http.StatusOK, tags)
	}
}

// handleRenameTag serves PATCH /api/tags/{id} — rename by stable id (ADR-0008).
func handleRenameTag(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		// validateTagName in the old stack rejects non-strings explicitly.
		name, isString := body["name"].(string)
		if !isString {
			writeError(w, http.StatusBadRequest, "Tag name must be a string")
			return
		}
		tag, err := opts.Data.RenameTag(chi.URLParam(r, "id"), name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if tag == nil {
			writeError(w, http.StatusNotFound, "Tag not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, tag)
	}
}

// handleDeleteTag serves DELETE /api/tags/{id}.
func handleDeleteTag(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := opts.Data.DeleteTag(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to delete tag")
			return
		}
		if result == nil {
			writeError(w, http.StatusNotFound, "Tag not found")
			return
		}
		writeJSONAligned(w, http.StatusOK, result)
	}
}

// handleListCategories serves GET /api/categories.
func handleListCategories(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		categories, err := opts.Data.Categories()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to fetch categories")
			return
		}
		writeJSONAligned(w, http.StatusOK, categories)
	}
}

// handleAddCategory serves POST /api/categories.
func handleAddCategory(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := decodeObjectBody(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON in request body")
			return
		}
		// The old route only trims string values; anything else is empty.
		raw, _ := body["category"].(string)
		name := strings.TrimSpace(raw)
		if name == "" {
			writeError(w, http.StatusBadRequest, "Category must be a non-empty string")
			return
		}
		categories, err := opts.Data.AddCategory(name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to add category")
			return
		}
		writeJSONAligned(w, http.StatusCreated, categories)
	}
}

// handleDeleteCategory serves DELETE /api/categories?name=...
func handleDeleteCategory(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		if name == "" {
			writeError(w, http.StatusBadRequest, "Category name is required")
			return
		}
		categories, err := opts.Data.DeleteCategory(name)
		if err != nil {
			// In-use (and, defensively, an empty name) is a request error; the
			// old route surfaced the message verbatim with status 400.
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSONAligned(w, http.StatusOK, categories)
	}
}
