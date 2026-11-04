package deploycontract

import (
	"strings"
	"testing"
)

// TestVolumeDestinationMatchesDataDir pins the persistence contract: whatever
// the server writes under DATA_DIR (subscriptions.db, backups/ snapshots,
// imports) must land on the host-mounted volume. Compose and the image have to
// agree on that path, otherwise snapshots silently end up in the container
// filesystem and vanish on recreate.
func TestVolumeDestinationMatchesDataDir(t *testing.T) {
	spec := loadCompose(t)
	svc := spec.Services["ai-subscriptions"]

	composeDataDir := svc.Environment["DATA_DIR"]
	if composeDataDir == "" {
		t.Fatal("compose has no DATA_DIR environment entry")
	}

	volumeDest := ""
	for _, volume := range svc.Volumes {
		parts := strings.Split(volume, ":")
		if len(parts) >= 2 && parts[1] == composeDataDir {
			volumeDest = parts[1]
		}
	}
	if volumeDest == "" {
		t.Errorf("volumes = %v, want a bind mount onto DATA_DIR %q", svc.Volumes, composeDataDir)
	}

	dockerfile := readRepoFile(t, "Dockerfile")
	if !strings.Contains(dockerfile, "DATA_DIR="+composeDataDir) {
		t.Errorf("Dockerfile ENV DATA_DIR must match compose DATA_DIR %q", composeDataDir)
	}
}
