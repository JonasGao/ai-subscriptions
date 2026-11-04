package httpapi

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func testAssets() fs.FS {
	return fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(`<!doctype html><html lang="zh-CN"><body><div id="root"></div><script type="module" src="/assets/app-abc123.js"></script></body></html>`),
		},
		"assets/app-abc123.js": &fstest.MapFile{
			Data: []byte(`console.log("welcome")`),
		},
	}
}

func get(t *testing.T, srv http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

func TestServesIndexAtRoot(t *testing.T) {
	srv := New(Options{Assets: testAssets()})

	rec := get(t, srv, "/")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	if !strings.Contains(rec.Body.String(), `id="root"`) {
		t.Errorf("body does not look like the SPA shell: %q", rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, want no-cache", cc)
	}
}

func TestServesHashedAssets(t *testing.T) {
	srv := New(Options{Assets: testAssets()})

	rec := get(t, srv, "/assets/app-abc123.js")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); !strings.Contains(body, "welcome") {
		t.Errorf("asset body = %q, want embedded asset content", body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("Content-Type = %q, want a javascript content type", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("Cache-Control = %q, want immutable caching for hashed assets", cc)
	}
}

func TestSPAFallbackServesIndexForClientRoutes(t *testing.T) {
	srv := New(Options{Assets: testAssets()})

	rec := get(t, srv, "/subscriptions/42")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), `id="root"`) {
		t.Errorf("body does not fall back to the SPA shell: %q", rec.Body.String())
	}
}

func TestMissingAssetsDoNotFallBackToIndex(t *testing.T) {
	srv := New(Options{Assets: testAssets()})

	rec := get(t, srv, "/assets/missing.js")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if strings.Contains(rec.Body.String(), `id="root"`) {
		t.Errorf("missing asset must not fall back to index.html")
	}
}

func TestUnknownAPIRouteDoesNotFallBackToIndex(t *testing.T) {
	srv := New(Options{Assets: testAssets()})

	for _, target := range []string{"/api", "/api/does-not-exist"} {
		t.Run(target, func(t *testing.T) {
			rec := get(t, srv, target)

			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
			}
			if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			if strings.Contains(rec.Body.String(), `id="root"`) {
				t.Errorf("unknown API route must not fall back to the SPA shell")
			}
		})
	}
}

func TestUnbuiltAssetsReturnServiceUnavailable(t *testing.T) {
	srv := New(Options{Assets: fstest.MapFS{"placeholder.gitkeep": &fstest.MapFile{}}})

	rec := get(t, srv, "/")

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if !strings.Contains(rec.Body.String(), "make build") {
		t.Errorf("body = %q, want a hint to run make build", rec.Body.String())
	}
}

func TestDirectoriesAreNeverListed(t *testing.T) {
	srv := New(Options{Assets: testAssets()})

	tests := []struct {
		target string
		want   int
	}{
		{target: "/assets/", want: http.StatusNotFound},
		{target: "/assets", want: http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.target, func(t *testing.T) {
			rec := get(t, srv, tt.target)

			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d", rec.Code, tt.want)
			}
			if strings.Contains(rec.Body.String(), "app-abc123") {
				t.Errorf("response leaks a directory listing: %q", rec.Body.String())
			}
		})
	}
}
