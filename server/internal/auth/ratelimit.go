package auth

import (
	"sync"
	"time"
)

// Login rate limit, ported from lib/auth.ts.
const (
	// MaxAttempts is the number of login attempts allowed per window.
	MaxAttempts = 5
	// AttemptWindow is the lockout window measured from the first attempt.
	AttemptWindow = 15 * time.Minute
)

type attemptEntry struct {
	count      int
	first      time.Time
	lastActive time.Time
}

// RateLimiter is an in-process, per-IP attempt counter. Like the old stack's
// Map, it resets on restart (ADR-0018: process state is not persisted).
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]attemptEntry
}

// NewRateLimiter returns an empty limiter.
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{entries: make(map[string]attemptEntry)}
}

// Allow records an attempt from key and reports whether it may proceed. The
// first attempt opens a 15-minute window; attempts after MaxAttempts are
// refused until the window expires.
func (l *RateLimiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry, ok := l.entries[key]
	if !ok || now.Sub(entry.first) > AttemptWindow {
		l.entries[key] = attemptEntry{count: 1, first: now, lastActive: now}
		return true
	}
	if entry.count >= MaxAttempts {
		entry.lastActive = now
		l.entries[key] = entry
		return false
	}
	entry.count++
	entry.lastActive = now
	l.entries[key] = entry
	return true
}

// Reset forgets key after a successful login.
func (l *RateLimiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}
