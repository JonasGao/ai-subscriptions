// Package config resolves runtime configuration from the environment.
//
// Parity note: the data directory resolution mirrors the old stack's
// lib/file-ops.ts — DATA_DIR wins, then XDG_DATA_HOME, then ~/.local/share.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// DefaultPort matches the deployment contract (port 3000).
const DefaultPort = 3000

// Config holds the resolved runtime configuration.
type Config struct {
	// Addr is the listen address, e.g. ":3000".
	Addr string
	// Port is the numeric listen port.
	Port int
	// DataDir is the directory holding persisted application data.
	DataDir string
}

// Getenv is the signature of os.Getenv, injected so tests can supply a fake.
type Getenv func(string) string

// FromEnv resolves the full configuration from getenv.
func FromEnv(getenv Getenv) (Config, error) {
	port, err := ResolvePort(getenv)
	if err != nil {
		return Config{}, err
	}
	dataDir, err := ResolveDataDir(getenv)
	if err != nil {
		return Config{}, err
	}
	return Config{
		Addr:    fmt.Sprintf(":%d", port),
		Port:    port,
		DataDir: dataDir,
	}, nil
}

// ResolvePort returns the listen port, defaulting to DefaultPort.
func ResolvePort(getenv Getenv) (int, error) {
	raw := getenv("PORT")
	if raw == "" {
		return DefaultPort, nil
	}
	port, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid PORT %q: %w", raw, err)
	}
	if port < 1 || port > 65535 {
		return 0, fmt.Errorf("invalid PORT %d: must be between 1 and 65535", port)
	}
	return port, nil
}

// ResolveDataDir returns the data directory: DATA_DIR, then XDG_DATA_HOME,
// then ~/.local/share, each with "ai-subscriptions" appended where applicable.
func ResolveDataDir(getenv Getenv) (string, error) {
	if dir := getenv("DATA_DIR"); dir != "" {
		return dir, nil
	}

	xdg := getenv("XDG_DATA_HOME")
	if xdg == "" {
		home := getenv("HOME")
		if home == "" {
			resolved, err := os.UserHomeDir()
			if err != nil {
				return "", fmt.Errorf("cannot resolve home directory: %w", err)
			}
			home = resolved
		}
		xdg = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(xdg, "ai-subscriptions"), nil
}

// EnsureDataDir creates dir (and parents) if it does not exist.
func EnsureDataDir(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create data dir %q: %w", dir, err)
	}
	return nil
}
