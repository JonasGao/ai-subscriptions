package deploycontract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func readRepoFile(t *testing.T, rel ...string) string {
	t.Helper()
	root, err := RepoRoot()
	if err != nil {
		t.Fatalf("RepoRoot() error = %v", err)
	}
	path := filepath.Join(append([]string{root}, rel...)...)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(data)
}

// --- Dockerfile -----------------------------------------------------------

type dockerStage struct {
	base  string
	name  string
	lines []string
}

func (s dockerStage) has(fragment string) bool {
	return strings.Contains(strings.Join(s.lines, "\n"), fragment)
}

func parseDockerfile(t *testing.T, src string) []dockerStage {
	t.Helper()
	var stages []dockerStage
	for _, line := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToUpper(trimmed), "FROM ") {
			fields := strings.Fields(trimmed)
			stage := dockerStage{base: fields[1]}
			if len(fields) >= 4 && strings.EqualFold(fields[2], "AS") {
				stage.name = fields[3]
			}
			stages = append(stages, stage)
			continue
		}
		if len(stages) > 0 {
			stages[len(stages)-1].lines = append(stages[len(stages)-1].lines, trimmed)
		}
	}
	return stages
}

func findStage(t *testing.T, stages []dockerStage, fragment string) dockerStage {
	t.Helper()
	for _, stage := range stages {
		if strings.Contains(stage.base, fragment) {
			return stage
		}
	}
	t.Fatalf("no Dockerfile stage built on %q (stages: %+v)", fragment, stageBases(stages))
	return dockerStage{}
}

func stageBases(stages []dockerStage) []string {
	bases := make([]string, 0, len(stages))
	for _, stage := range stages {
		bases = append(bases, stage.base)
	}
	return bases
}

func TestDockerfileBuildsWebThenGoThenDistroless(t *testing.T) {
	src := readRepoFile(t, "Dockerfile")
	stages := parseDockerfile(t, src)

	if len(stages) < 3 {
		t.Fatalf("Dockerfile has %d stages, want at least 3 (web -> go -> runtime)", len(stages))
	}
	if !strings.Contains(src, "ARG NODE_IMAGE=node:24-alpine") {
		t.Error("Dockerfile must keep the NODE_IMAGE build arg (machine mirrors rely on it)")
	}
	if !strings.Contains(src, "ARG GO_IMAGE=") {
		t.Error("Dockerfile must expose a GO_IMAGE build arg for machine mirrors")
	}
	if !strings.Contains(src, "ARG RUNTIME_IMAGE=") {
		t.Error("Dockerfile must expose a RUNTIME_IMAGE build arg for machine mirrors")
	}

	web := findStage(t, stages, "NODE_IMAGE")
	if !web.has("npm ci") || !web.has("npm run build") {
		t.Errorf("web stage must run npm ci + npm run build, got:\n%s", strings.Join(web.lines, "\n"))
	}

	build := findStage(t, stages, "GO_IMAGE")
	if !build.has("CGO_ENABLED=0") {
		t.Error("go stage must compile with CGO_ENABLED=0 (static binary for distroless)")
	}
	if !build.has("go build") || !build.has("./cmd/server") {
		t.Errorf("go stage must build ./cmd/server, got:\n%s", strings.Join(build.lines, "\n"))
	}
	if !build.has("internal/webui/dist") {
		t.Error("go stage must stage web/dist into server/internal/webui/dist for go:embed")
	}

	runtime := findStage(t, stages, "RUNTIME_IMAGE")
	if !strings.Contains(src, "ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot") {
		t.Error("runtime image must default to a distroless static base")
	}
	for _, want := range []string{"EXPOSE 3000", "PORT=3000", "DATA_DIR=/data", "ENTRYPOINT"} {
		if !runtime.has(want) {
			t.Errorf("runtime stage missing %q", want)
		}
	}
	if runtime.has("npm") || runtime.has("go build") {
		t.Error("runtime stage must not carry build tooling (node/npm/go)")
	}
}

func TestDockerfileKeepsDataVolumeWritableForContractUser(t *testing.T) {
	src := readRepoFile(t, "Dockerfile")

	if !strings.Contains(src, "--chown=1000:1000") || !strings.Contains(src, "/data") {
		t.Error("Dockerfile must create /data owned by 1000:1000 (non-root volume contract)")
	}
	if !strings.Contains(src, "USER 1000:1000") && !strings.Contains(src, "USER nonroot") {
		t.Error("runtime image must declare a non-root USER")
	}
}

// --- docker-compose -------------------------------------------------------

type composeSpec struct {
	Services map[string]struct {
		Image         string            `yaml:"image"`
		ContainerName string            `yaml:"container_name"`
		Restart       string            `yaml:"restart"`
		User          string            `yaml:"user"`
		Ports         []string          `yaml:"ports"`
		Environment   map[string]string `yaml:"environment"`
		EnvFile       []string          `yaml:"env_file"`
		Volumes       []string          `yaml:"volumes"`
		Deploy        struct {
			Resources struct {
				Limits struct {
					Cpus   string `yaml:"cpus"`
					Memory string `yaml:"memory"`
				} `yaml:"limits"`
			} `yaml:"resources"`
		} `yaml:"deploy"`
		Healthcheck struct {
			Test        []string `yaml:"test"`
			Interval    string   `yaml:"interval"`
			Timeout     string   `yaml:"timeout"`
			Retries     int      `yaml:"retries"`
			StartPeriod string   `yaml:"start_period"`
		} `yaml:"healthcheck"`
		Logging struct {
			Driver  string            `yaml:"driver"`
			Options map[string]string `yaml:"options"`
		} `yaml:"logging"`
	} `yaml:"services"`
	Networks map[string]struct {
		Name string `yaml:"name"`
	} `yaml:"networks"`
}

func loadCompose(t *testing.T) composeSpec {
	t.Helper()
	var spec composeSpec
	if err := yaml.Unmarshal([]byte(readRepoFile(t, "deploy", "docker", "docker-compose.yml")), &spec); err != nil {
		t.Fatalf("parse docker-compose.yml: %v", err)
	}
	return spec
}

func TestComposePreservesExternalContract(t *testing.T) {
	spec := loadCompose(t)
	svc, ok := spec.Services["ai-subscriptions"]
	if !ok {
		t.Fatalf("compose has no ai-subscriptions service (have %v)", keys(spec.Services))
	}

	checks := []struct {
		name string
		got  string
		want string
	}{
		{"image", svc.Image, "ai-subscriptions:latest"},
		{"container_name", svc.ContainerName, "ai-subscriptions"},
		{"restart", svc.Restart, "unless-stopped"},
		{"user", svc.User, "1000:1000"},
		{"environment.DATA_DIR", svc.Environment["DATA_DIR"], "/data"},
		{"limits.cpus", svc.Deploy.Resources.Limits.Cpus, "1.0"},
		{"limits.memory", svc.Deploy.Resources.Limits.Memory, "512M"},
		{"logging.driver", svc.Logging.Driver, "json-file"},
		{"logging.options.max-size", svc.Logging.Options["max-size"], "10m"},
		{"logging.options.max-file", svc.Logging.Options["max-file"], "3"},
		// healthcheck cadence is part of the old contract
		{"healthcheck.interval", svc.Healthcheck.Interval, "30s"},
		{"healthcheck.timeout", svc.Healthcheck.Timeout, "10s"},
		{"healthcheck.start_period", svc.Healthcheck.StartPeriod, "15s"},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %q, want %q", c.name, c.got, c.want)
		}
	}
	if svc.Healthcheck.Retries != 3 {
		t.Errorf("healthcheck.retries = %d, want 3", svc.Healthcheck.Retries)
	}

	if want := []string{"3000:3000"}; !equal(svc.Ports, want) {
		t.Errorf("ports = %v, want %v", svc.Ports, want)
	}
	if want := []string{"./data:/data"}; !equal(svc.Volumes, want) {
		t.Errorf("volumes = %v, want %v", svc.Volumes, want)
	}
	if want := []string{".env"}; !equal(svc.EnvFile, want) {
		t.Errorf("env_file = %v, want %v", svc.EnvFile, want)
	}
	if net, ok := spec.Networks["default"]; !ok || net.Name != "ai-subscriptions_default" {
		t.Errorf("default network = %+v, want name ai-subscriptions_default", net)
	}
}

func TestComposeHealthcheckWorksInDistroless(t *testing.T) {
	spec := loadCompose(t)
	svc := spec.Services["ai-subscriptions"]
	joined := strings.Join(svc.Healthcheck.Test, " ")

	if joined == "" {
		t.Fatal("compose service has no healthcheck")
	}
	for _, forbidden := range []string{"wget", "curl", "sh -c", "/bin/"} {
		if strings.Contains(joined, forbidden) {
			t.Errorf("healthcheck test = %q, must not depend on %q (distroless has no shell/tools)", joined, forbidden)
		}
	}
	if !strings.Contains(joined, "/ai-subscriptions") || !strings.Contains(joined, "healthcheck") {
		t.Errorf("healthcheck test = %q, want the binary's healthcheck subcommand", joined)
	}
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func equal(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
