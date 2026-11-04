// Package httpapi wires the HTTP surface: JSON API routes plus the embedded
// SolidJS SPA. API routes live under /api; every other path serves the SPA
// shell (client-side routing) or an embedded asset.
package httpapi

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"
)

const assetsNotBuiltHint = "web assets not built: run `make build`\n"

// Options configures the router.
type Options struct {
	// Assets is the built SPA file tree (index.html at the root). A nil or
	// index-less tree makes non-API routes answer 503 with a build hint.
	Assets fs.FS
	// ProviderRefs supplies subscription/tool references for provider
	// enrichment. Nil means a fresh install with no references.
	ProviderRefs ProviderRefSource
}

// New builds the application router.
func New(opts Options) http.Handler {
	r := chi.NewRouter()

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", handleHealth)
		api.Get("/providers", handleProviders(opts))
		api.Get("/providers/unregistered", handleUnregisteredProviders(opts))
		api.NotFound(writeJSONNotFound)
	})

	r.NotFound(spaHandler(opts.Assets).ServeHTTP)
	return r
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSONNotFound(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// spaHandler serves embedded assets and falls back to index.html for client
// routes. Missing files under assets/ and unknown /api routes never receive
// the HTML shell.
func spaHandler(assets fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if assets == nil {
			http.Error(w, assetsNotBuiltHint, http.StatusServiceUnavailable)
			return
		}
		index, err := fs.ReadFile(assets, "index.html")
		if err != nil {
			http.Error(w, assetsNotBuiltHint, http.StatusServiceUnavailable)
			return
		}

		rel := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if rel == "" || rel == "." {
			serveIndex(w, r, index)
			return
		}

		// Exact /api (no trailing segment) is not routed to the JSON
		// subrouter, so guard it here to keep API paths HTML-free.
		if rel == "api" {
			writeJSONNotFound(w, r)
			return
		}

		if info, err := fs.Stat(assets, rel); err != nil || info.IsDir() {
			if rel == "assets" || strings.HasPrefix(rel, "assets/") {
				http.NotFound(w, r)
				return
			}
			serveIndex(w, r, index)
			return
		}

		if strings.HasPrefix(rel, "assets/") {
			// Vite fingerprints filenames under assets/, so they are immutable.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, index []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(index)
}
