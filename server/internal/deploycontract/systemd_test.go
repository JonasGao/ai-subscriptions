package deploycontract

import (
	"strings"
	"testing"
)

func TestRootMakefileKeepsCommandFamily(t *testing.T) {
	src := readRepoFile(t, "Makefile")

	for _, target := range []string{"deploy", "image", "smoke", "up", "down", "restart", "status", "logs", "uninstall"} {
		if !strings.Contains(src, target+":") {
			t.Errorf("root Makefile lost the %q target", target)
		}
	}
	if !strings.Contains(src, "$(MAKE) -C deploy/docker") {
		t.Error("root Makefile must keep proxying deploy/image/... to deploy/docker")
	}
}

func TestDockerMakefileBuildsNewStackImage(t *testing.T) {
	src := readRepoFile(t, "deploy", "docker", "Makefile")

	if !strings.Contains(src, "IMAGE := ${PROJECT_NAME}:latest") {
		t.Error("docker Makefile must keep the image tag contract ai-subscriptions:latest")
	}
	if !strings.Contains(src, "--project-directory ${DEPLOY_DIR}") {
		t.Error("compose must keep running with --project-directory ${DEPLOY_DIR}")
	}
	if !strings.Contains(src, "-include $(DEPLOY_DIR)/build.env") {
		t.Error("docker Makefile must keep honouring the machine-level build.env")
	}

	for _, arg := range []string{"NODE_IMAGE", "GO_IMAGE", "RUNTIME_IMAGE", "GOPROXY"} {
		if !strings.Contains(src, "--build-arg "+arg+"=") {
			t.Errorf("image target must pass --build-arg %s (machine mirrors/offline builds)", arg)
		}
	}
	if !strings.Contains(src, "docker build") || !strings.Contains(src, "${REPO_ROOT}") {
		t.Error("image target must docker build with the repository root as context")
	}
}

func TestSystemdServiceRunsSingleBinary(t *testing.T) {
	makefile := readRepoFile(t, "deploy", "systemd", "Makefile")
	unit := readRepoFile(t, "deploy", "systemd", "ai-subscriptions.service.in")

	if !strings.Contains(makefile, "PREFIX ?= $(HOME)/.local") {
		t.Error("systemd Makefile must document PREFIX defaulting to ~/.local")
	}
	if !strings.Contains(makefile, "$(PREFIX)/bin/$(PROJECT_NAME)") {
		t.Error("systemd Makefile must install the binary under $(PREFIX)/bin/$(PROJECT_NAME)")
	}
	if !strings.Contains(makefile, "install -m 755") {
		t.Error("install target must install the built binary with install -m 755")
	}
	// install-binary/unit are split out so the install path can be verified
	// without touching the real systemd user session.
	for _, target := range []string{"install-binary:", "unit:", "install: build"} {
		if !strings.Contains(makefile, target) {
			t.Errorf("systemd Makefile missing %q", target)
		}
	}
	if !strings.Contains(makefile, "$(MAKE) -C $(PROJECT_DIR) build") {
		t.Error("build target must reuse the repository's single-binary build")
	}

	for _, want := range []string{"ExecStart=@BIN@", `Environment="PORT=@PORT@"`, "EnvironmentFile=-@ENV_FILE@", "WantedBy=default.target"} {
		if !strings.Contains(unit, want) {
			t.Errorf("systemd unit template missing %q", want)
		}
	}
	for _, forbidden := range []string{"next", "node_modules", "npm ", "node "} {
		if strings.Contains(unit, forbidden) {
			t.Errorf("systemd unit template still references %q; it must exec the single binary", forbidden)
		}
	}
}

func TestSystemdReadmeDocumentsInstallPath(t *testing.T) {
	readme := readRepoFile(t, "deploy", "systemd", "README.md")

	for _, want := range []string{"~/.local/bin/ai-subscriptions", "make -C deploy/systemd install", "ai-subscriptions.service"} {
		if !strings.Contains(readme, want) {
			t.Errorf("systemd README does not document %q", want)
		}
	}
}
