package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveDataDir(t *testing.T) {
	tests := []struct {
		name    string
		dataDir string
		xdg     string
		home    string
		want    string
	}{
		{
			name:    "DATA_DIR wins over XDG and home",
			dataDir: "/srv/ai-subscriptions",
			xdg:     "/custom/xdg",
			home:    "/home/tester",
			want:    "/srv/ai-subscriptions",
		},
		{
			name: "XDG_DATA_HOME fallback",
			xdg:  "/custom/xdg",
			home: "/home/tester",
			want: "/custom/xdg/ai-subscriptions",
		},
		{
			name: "home fallback under ~/.local/share",
			home: "/home/tester",
			want: "/home/tester/.local/share/ai-subscriptions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("DATA_DIR", tt.dataDir)
			t.Setenv("XDG_DATA_HOME", tt.xdg)
			t.Setenv("HOME", tt.home)

			got, err := ResolveDataDir(os.Getenv)
			if err != nil {
				t.Fatalf("ResolveDataDir() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("ResolveDataDir() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolvePort(t *testing.T) {
	tests := []struct {
		name    string
		port    string
		want    int
		wantErr bool
	}{
		{name: "defaults to 3000", port: "", want: 3000},
		{name: "honours PORT", port: "8080", want: 8080},
		{name: "rejects non-numeric", port: "abc", wantErr: true},
		{name: "rejects zero", port: "0", wantErr: true},
		{name: "rejects out of range", port: "70000", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PORT", tt.port)

			got, err := ResolvePort(os.Getenv)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ResolvePort(%q) expected error, got %d", tt.port, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolvePort(%q) error = %v", tt.port, err)
			}
			if got != tt.want {
				t.Errorf("ResolvePort(%q) = %d, want %d", tt.port, got, tt.want)
			}
		})
	}
}

func TestEnsureDataDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "data")

	if err := EnsureDataDir(dir); err != nil {
		t.Fatalf("EnsureDataDir() error = %v", err)
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("data dir was not created: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("%q is not a directory", dir)
	}

	// Idempotent: a second call on an existing directory must succeed.
	if err := EnsureDataDir(dir); err != nil {
		t.Fatalf("EnsureDataDir() on existing dir error = %v", err)
	}
}

func TestFromEnv(t *testing.T) {
	t.Setenv("PORT", "4567")
	t.Setenv("DATA_DIR", "/tmp/ai-subscriptions-test-data")

	cfg, err := FromEnv(os.Getenv)
	if err != nil {
		t.Fatalf("FromEnv() error = %v", err)
	}
	if cfg.Addr != ":4567" {
		t.Errorf("Addr = %q, want %q", cfg.Addr, ":4567")
	}
	if cfg.DataDir != "/tmp/ai-subscriptions-test-data" {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, "/tmp/ai-subscriptions-test-data")
	}
}
