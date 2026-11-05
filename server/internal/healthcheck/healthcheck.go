// Package healthcheck implements the container health probe.
//
// The runtime image is distroless: it carries no shell, curl or wget. Docker
// therefore asks the binary itself whether the HTTP server is up, which keeps
// the compose healthcheck contract (probe local HTTP on the app port) intact.
package healthcheck

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"ai-subscriptions/internal/config"
)

// ProbeTimeout bounds a single probe so it always finishes well inside the
// compose healthcheck timeout (10s).
const ProbeTimeout = 5 * time.Second

// TargetURL resolves the local health URL from the environment: the same PORT
// the server listens on, defaulting to 3000.
func TargetURL(getenv config.Getenv) (string, error) {
	port, err := config.ResolvePort(getenv)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("http://127.0.0.1:%d/api/health", port), nil
}

// Probe performs GET on url and returns nil only for a 2xx response.
func Probe(ctx context.Context, client *http.Client, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build health request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("health request failed: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("health endpoint returned %d", resp.StatusCode)
	}
	return nil
}

// Run executes the `ai-subscriptions healthcheck` subcommand and returns the
// process exit code: 0 when healthy, non-zero otherwise.
func Run(getenv config.Getenv, stdout, stderr io.Writer) int {
	url, err := TargetURL(getenv)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}

	ctx, cancel := context.WithTimeout(context.Background(), ProbeTimeout)
	defer cancel()

	if err := Probe(ctx, http.DefaultClient, url); err != nil {
		fmt.Fprintf(stderr, "unhealthy: %v\n", err)
		return 1
	}

	fmt.Fprintf(stdout, "healthy: %s\n", url)
	return 0
}
