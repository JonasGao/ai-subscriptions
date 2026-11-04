package webui

import (
	"io/fs"
	"strings"
	"testing"
)

// TestAssetsExposeSPAShell guards the go:embed wiring: the binary must carry a
// real index.html, not just the placeholder that keeps the embed pattern
// valid in an unbuilt checkout.
func TestAssetsExposeSPAShell(t *testing.T) {
	assets, err := Assets()
	if err != nil {
		t.Fatalf("Assets() error = %v", err)
	}

	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		t.Skip("web assets not built; run `make web-build` for the embed check")
	}

	if !strings.Contains(string(index), `id="root"`) {
		t.Errorf("embedded index.html is not the SolidJS shell: %q", index)
	}
	if !strings.Contains(string(index), "/assets/") {
		t.Errorf("embedded index.html has no hashed asset entry: %q", index)
	}
}
