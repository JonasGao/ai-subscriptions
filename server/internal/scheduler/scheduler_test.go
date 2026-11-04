package scheduler

// Behaviour of the reset tick loop (#27): it runs on the configured cadence,
// keeps running after a failed tick, and stops on cancellation. The old stack
// used node-cron ("*/5 * * * *"); the single binary uses time.Ticker, which must
// stay observable-equivalent — not running at boot, then every 5 minutes.

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunTicksOnEveryIntervalAndStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var ticks atomic.Int32
	done := make(chan struct{})
	go func() {
		Run(ctx, 10*time.Millisecond, func() error {
			ticks.Add(1)
			return nil
		}, nil)
		close(done)
	}()

	// Give the loop time for a few intervals.
	deadline := time.Now().Add(2 * time.Second)
	for ticks.Load() < 3 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if got := ticks.Load(); got < 3 {
		t.Fatalf("ticks = %d, want at least 3", got)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not return after cancellation")
	}
}

func TestRunDoesNotTickImmediately(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var ticks atomic.Int32
	go Run(ctx, time.Hour, func() error {
		ticks.Add(1)
		return nil
	}, nil)

	time.Sleep(20 * time.Millisecond)
	if got := ticks.Load(); got != 0 {
		t.Fatalf("ticks = %d before the first interval, want 0 (node-cron did not run on boot)", got)
	}
}

func TestRunReportsErrorsAndKeepsTicking(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var mu sync.Mutex
	var reported []error
	ticks := make(chan struct{}, 8)

	go Run(ctx, 5*time.Millisecond, func() error {
		select {
		case ticks <- struct{}{}:
		default:
		}
		return errors.New("tick failed")
	}, func(err error) {
		mu.Lock()
		reported = append(reported, err)
		mu.Unlock()
	})

	// Two ticks prove the loop survived the first failure.
	for i := 0; i < 2; i++ {
		select {
		case <-ticks:
		case <-time.After(2 * time.Second):
			t.Fatalf("tick %d never ran", i+1)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if len(reported) == 0 {
		t.Fatal("no error was reported")
	}
}
