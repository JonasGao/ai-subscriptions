package healthcheck

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func newServer(t *testing.T, status int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			t.Errorf("probe hit %q, want /api/health", r.URL.Path)
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func serverPort(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	return u.Port()
}

func TestProbeAcceptsHealthyServer(t *testing.T) {
	srv := newServer(t, http.StatusOK)

	if err := Probe(t.Context(), srv.Client(), srv.URL+"/api/health"); err != nil {
		t.Fatalf("Probe() error = %v, want nil", err)
	}
}

func TestProbeRejectsNon2xx(t *testing.T) {
	srv := newServer(t, http.StatusServiceUnavailable)

	err := Probe(t.Context(), srv.Client(), srv.URL+"/api/health")
	if err == nil {
		t.Fatal("Probe() = nil, want error for HTTP 503")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("error = %q, want it to mention status 503", err)
	}
}

func TestProbeReportsUnreachableServer(t *testing.T) {
	srv := newServer(t, http.StatusOK)
	probeURL := srv.URL + "/api/health"
	srv.Close()

	if err := Probe(t.Context(), srv.Client(), probeURL); err == nil {
		t.Fatal("Probe() = nil, want error for a closed server")
	}
}

func TestTargetURL(t *testing.T) {
	tests := []struct {
		name    string
		port    string
		want    string
		wantErr bool
	}{
		{name: "defaults to 3000", port: "", want: "http://127.0.0.1:3000/api/health"},
		{name: "honours PORT", port: "8080", want: "http://127.0.0.1:8080/api/health"},
		{name: "rejects invalid PORT", port: "nope", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PORT", tt.port)

			got, err := TargetURL(os.Getenv)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("TargetURL() = %q, want error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("TargetURL() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("TargetURL() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRunHealthyReturnsZero(t *testing.T) {
	srv := newServer(t, http.StatusOK)
	t.Setenv("PORT", serverPort(t, srv))

	var stdout, stderr bytes.Buffer
	if code := Run(os.Getenv, &stdout, &stderr); code != 0 {
		t.Fatalf("Run() = %d, want 0 (stderr=%q)", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "healthy") {
		t.Errorf("stdout = %q, want a healthy confirmation", stdout.String())
	}
}

func TestRunUnhealthyReturnsNonZero(t *testing.T) {
	srv := newServer(t, http.StatusInternalServerError)
	t.Setenv("PORT", serverPort(t, srv))

	var stdout, stderr bytes.Buffer
	if code := Run(os.Getenv, &stdout, &stderr); code == 0 {
		t.Fatal("Run() = 0, want non-zero for an unhealthy server")
	}
	if stderr.Len() == 0 {
		t.Error("stderr is empty, want a diagnostic for an unhealthy server")
	}
}

func TestRunRejectsInvalidPort(t *testing.T) {
	t.Setenv("PORT", "not-a-port")

	var stdout, stderr bytes.Buffer
	if code := Run(os.Getenv, &stdout, &stderr); code == 0 {
		t.Fatal("Run() = 0, want non-zero for an invalid PORT")
	}
}
