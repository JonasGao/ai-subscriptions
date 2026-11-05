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
	"ai-subscriptions/internal/calibration"
	"ai-subscriptions/internal/config"
	"ai-subscriptions/internal/crypto"
	"ai-subscriptions/internal/healthcheck"
	"ai-subscriptions/internal/httpapi"
	"ai-subscriptions/internal/notify"
	"ai-subscriptions/internal/scheduler"
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
			Assets:       assets,
			Auth:         authService,
			Data:         db,
			ProviderRefs: db,
			Proxy:        db,
			Notify:       db,
			Priorities:   db,
			Tools:        db,
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// ADR-0018: the reset tick runs on a 5-minute time.Ticker (replaces
	// node-cron). It restores exhausted schedules due for a reset, advances
	// their nextResetTime and then dispatches the reset/low-balance events to
	// the configured notification channels (#39). Query-driven calibration
	// (ADR-0016) runs for the triggered subscriptions between the two phases;
	// alignment is best-effort and never blocks the notification path.
	calibrator := calibration.New(db, crypto.NewFromEnv(os.Getenv), nil)
	dispatcher := notify.NewDispatcher(db, notify.NewHTTPSender(nil), notify.DefaultFeishuClient())
	go scheduler.Run(ctx, 5*time.Minute, func() error {
		triggers, resetErr := db.ProcessResetTick()
		if resetErr == nil && len(triggers) > 0 {
			log.Printf("reset tick: %d trigger(s)", len(triggers))
		}

		// Alignment is best-effort: a failure is logged and never blocks the
		// next tick or the notification path.
		if err := calibrator.AlignResetTimes(ctx, triggers); err != nil {
			log.Printf("reset-time alignment failed: %v", err)
		}

		// A reset failure must not block notifications (the old scheduler ran
		// the two phases in separate try/catch blocks).
		subscriptions, subsErr := db.Subscriptions()
		if subsErr != nil {
			return errors.Join(resetErr, subsErr)
		}
		notifyErr := dispatcher.RunNotificationTick(ctx, subscriptions, triggers)
		return errors.Join(resetErr, notifyErr)
	}, func(err error) {
		log.Printf("scheduler tick failed: %v", err)
	})

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
