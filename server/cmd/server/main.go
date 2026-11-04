// Command server is the single binary: it serves the JSON API and the
// embedded SolidJS SPA on one port.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"ai-subscriptions/internal/auth"
	"ai-subscriptions/internal/config"
	"ai-subscriptions/internal/healthcheck"
	"ai-subscriptions/internal/httpapi"
	"ai-subscriptions/internal/store"
	"ai-subscriptions/internal/webui"
)

func main() {
	// The distroless runtime has no shell or wget, so container healthchecks
	// invoke this subcommand instead.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck.Run(os.Getenv, os.Stdout, os.Stderr))
	}

	if err := run(); err != nil {
		log.Fatalf("ai-subscriptions: %v", err)
	}
}

func run() error {
	cfg, err := config.FromEnv(os.Getenv)
	if err != nil {
		return err
	}
	if err := config.EnsureDataDir(cfg.DataDir); err != nil {
		return err
	}

	assets, err := webui.Assets()
	if err != nil {
		return err
	}

	// Storage engine (ADR-0017): open SQLite, import any legacy JSON on first
	// start, then take a rolling file snapshot.
	db, err := store.Open(filepath.Join(cfg.DataDir, store.DefaultFilename))
	if err != nil {
		return err
	}
	defer db.Close()
	if snapshot, err := db.Snapshot(); err != nil {
		log.Printf("warning: backup snapshot failed: %v", err)
	} else {
		log.Printf("backup snapshot: %s", snapshot)
	}

	// Authentication: seed account, password change and stateless HMAC
	// session cookies (ADR-0018). An unset NEXTAUTH_SECRET falls back to a
	// random secret like lib/auth.ts, so sessions do not survive a restart
	// until the operator configures it.
	sessionSecret, generated := auth.SecretFromEnv(os.Getenv)
	if generated {
		log.Print("WARNING: NEXTAUTH_SECRET is not set. Using a random secret. Sessions will be invalidated on restart.")
	}
	authService := auth.New(db, sessionSecret)

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.New(httpapi.Options{
			Assets: assets,
			Auth:   authService,
			Proxy:  db,
			Notify: db,
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("listening on %s (data dir: %s)", cfg.Addr, cfg.DataDir)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Print("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
