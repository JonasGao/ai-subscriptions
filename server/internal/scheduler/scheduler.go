// Package scheduler drives the 5-minute reset tick (lib/scheduler.ts replaced
// node-cron with a time.Ticker, ADR-0018). Notification dispatch and provider
// calibration ride the same tick in their own tickets (#39, #34).
package scheduler

import (
	"context"
	"time"
)

// TickFunc is one unit of work run on every tick. Errors are reported and the
// loop continues: a failed tick must never stop the scheduler.
type TickFunc func() error

// Run ticks every interval until ctx is cancelled. The first tick happens one
// interval after start, matching node-cron's "*/5 * * * *" behaviour (no
// immediate run on boot).
func Run(ctx context.Context, interval time.Duration, tick TickFunc, report func(error)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := tick(); err != nil && report != nil {
				report(err)
			}
		}
	}
}
