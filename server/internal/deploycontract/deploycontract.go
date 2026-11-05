// Package deploycontract pins the deployment pipeline's external contract.
//
// The contract is inherited from the old stack and restated in ADR-0018
// (port 3000, /data volume, DATA_DIR, non-root 1000:1000, 1 CPU / 512M, the
// make command family). These tests are the executable form of that contract:
// they read the checked-in deployment artifacts so drift fails the build
// instead of being discovered at deploy time.
package deploycontract

import (
	"fmt"
	"os"
	"path/filepath"
)

// RepoRoot walks up from the current working directory until it finds the
// repository root (identified by server/go.mod) and returns that path.
func RepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "server", "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("repository root (server/go.mod) not found above %q", dir)
		}
		dir = parent
	}
}
