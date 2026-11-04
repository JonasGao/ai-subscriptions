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

	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/notify"
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
	// Auth verifies session cookies and owns credentials. Nil disables the
	// session gate's ability to authenticate anyone, which only tests use.
	Auth AuthService
	// Data is the subscription/category/tag storage surface (#26). Nil keeps
	// those routes unregistered, which only tests that do not touch them use.
	Data DataService
	// Cipher encrypts credential blobs on write. Nil derives one from
	// NEXTAUTH_SECRET like the old stack.
	Cipher *crypto.Cipher
	// Proxy serves the proxy-subscription CRUD and tag catalog (ADR-0009).
	// Nil leaves those routes unregistered.
	Proxy ProxyService
	// Notify serves notification-channel CRUD, the low-balance threshold and
	// channel test sends. Nil leaves those routes unregistered.
	Notify NotificationService
	// Feishu serves the app-bot helpers (chat list, user lookup, test send).
	// Nil falls back to the process-wide client.
	Feishu FeishuService
	// Listeners serves the Feishu WS listener lifecycle. Nil falls back to the
	// process-wide manager.
	Listeners ListenerService
	// Priorities serves the subscription/tool priority scenes. Nil leaves those
	// routes unregistered.
	Priorities PriorityService
	// Tools serves the managed-tool catalog. Nil leaves those routes
	// unregistered.
	Tools ToolService
}

// New builds the application router.
func New(opts Options) http.Handler {
	r := chi.NewRouter()

	r.Route("/api", func(api chi.Router) {
		// Every API route runs through the session gate; the auth endpoints
		// are white-listed inside the gate itself. Unknown /api paths are
		// gated too (the gate wraps this subrouter's NotFound handler).
		api.Use(opts.sessionGate)

		api.Get("/health", handleHealth)
		if opts.Auth != nil {
			api.Post("/auth/login", handleLogin(opts.Auth))
			api.Post("/auth/logout", handleLogout)
			api.Get("/auth/session", handleSession(opts))
			api.Get("/auth/is-initial", handleIsInitial(opts.Auth))
			api.Post("/auth/change-password", handleChangePassword(opts.Auth))
		}
		api.Get("/providers", handleProviders(opts))
		api.Get("/providers/unregistered", handleUnregisteredProviders(opts))
		if opts.Data != nil {
			api.Get("/subscriptions", handleListSubscriptions(opts))
			api.Post("/subscriptions", handleCreateSubscription(opts))
			api.Get("/subscriptions/{id}", handleGetSubscription(opts))
			api.Put("/subscriptions/{id}", handleUpdateSubscription(opts))
			api.Delete("/subscriptions/{id}", handleDeleteSubscription(opts))
			api.Get("/subscriptions/{id}/usage", handleSubscriptionUsage(opts))
			api.Get("/subscriptions/{id}/models", handleSubscriptionModels(opts))
			api.Get("/tags", handleListTags(opts))
			api.Patch("/tags/{id}", handleRenameTag(opts))
			api.Delete("/tags/{id}", handleDeleteTag(opts))
			api.Get("/categories", handleListCategories(opts))
			api.Post("/categories", handleAddCategory(opts))
			api.Delete("/categories", handleDeleteCategory(opts))
		}
		if opts.Proxy != nil {
			mountProxyRoutes(api, opts.Proxy)
		}
		if opts.Priorities != nil {
			mountPriorityRoutes(api, opts.Priorities)
		}
		if opts.Tools != nil {
			mountToolRoutes(api, opts.Tools)
		}
		if opts.Notify != nil {
			feishu := opts.Feishu
			if feishu == nil {
				feishu = notify.DefaultFeishuClient()
			}
			listeners := opts.Listeners
			if listeners == nil {
				listeners = notify.DefaultListenerManager()
			}
			mountNotificationRoutes(api, opts.Notify, feishu)
			mountFeishuRoutes(api, feishu, listeners, opts.Notify)
		}
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
