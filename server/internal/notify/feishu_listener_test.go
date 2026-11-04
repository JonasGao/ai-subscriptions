package notify

// Parity port of __tests__/feishu-listener.test.ts (13 cases). The old module
// kept one long-connection listener per appId in process memory, auto-stopped
// it after a TTL, and kept the stopped state around as a tombstone so the
// settings page can poll once more and see why polling ended.

import (
	"context"
	"strconv"
	"sync"
	"testing"
	"time"
)

// fakeScheduler replaces timers so a TTL can elapse without waiting.
type fakeScheduler struct {
	mu      sync.Mutex
	pending []*fakeTimer
}

type fakeTimer struct {
	after   time.Duration
	fn      func()
	fired   bool
	stopped bool
	sched   *fakeScheduler
}

func (s *fakeScheduler) AfterFunc(d time.Duration, fn func()) Timer {
	s.mu.Lock()
	defer s.mu.Unlock()
	timer := &fakeTimer{after: d, fn: fn, sched: s}
	s.pending = append(s.pending, timer)
	return timer
}

// Advance fires every timer whose delay is at most d.
func (s *fakeScheduler) Advance(d time.Duration) {
	s.mu.Lock()
	toFire := make([]*fakeTimer, 0, len(s.pending))
	for _, timer := range s.pending {
		if timer.fired || timer.stopped || timer.after > d {
			continue
		}
		timer.fired = true
		toFire = append(toFire, timer)
	}
	s.mu.Unlock()

	for _, timer := range toFire {
		timer.fn()
	}
}

func (t *fakeTimer) Stop() bool {
	t.sched.mu.Lock()
	defer t.sched.mu.Unlock()
	wasActive := !t.stopped && !t.fired
	t.stopped = true
	return wasActive
}

// fakeSocket stands in for the Channel-based long connection.
type fakeSocket struct {
	mu       sync.Mutex
	started  int
	closed   int
	onMsg    func(ReceivedMessage)
	release  chan struct{}
	stopOnce sync.Once
	startErr error
}

func newFakeSocket(onMsg func(ReceivedMessage)) *fakeSocket {
	return &fakeSocket{onMsg: onMsg, release: make(chan struct{})}
}

// Connect is called once per listener; it records the call and returns.
func (s *fakeSocket) Connect(ctx context.Context) error {
	s.mu.Lock()
	s.started++
	err := s.startErr
	s.mu.Unlock()
	return err
}

// Close stops the connection and releases the run loop.
func (s *fakeSocket) Close() error {
	s.mu.Lock()
	s.closed++
	s.mu.Unlock()
	s.stopOnce.Do(func() { close(s.release) })
	return nil
}

func (s *fakeSocket) startCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.started
}

func (s *fakeSocket) closeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func (s *fakeSocket) deliver(msg ReceivedMessage) {
	s.onMsg(msg)
}

type listenerFixture struct {
	manager   *ListenerManager
	scheduler *fakeScheduler
	sockets   map[string]*fakeSocket
	mu        sync.Mutex
	uuidSeq   int
	clock     time.Time
}

func newListenerFixture(t *testing.T) *listenerFixture {
	t.Helper()

	fixture := &listenerFixture{
		scheduler: &fakeScheduler{},
		sockets:   make(map[string]*fakeSocket),
		clock:     time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC),
	}
	fixture.manager = NewListenerManager(ListenerOptions{
		Scheduler: fixture.scheduler,
		Now: func() time.Time {
			fixture.mu.Lock()
			defer fixture.mu.Unlock()
			return fixture.clock
		},
		NewID: func() string {
			fixture.mu.Lock()
			defer fixture.mu.Unlock()
			fixture.uuidSeq++
			return "listen-id-" + strconv.Itoa(fixture.uuidSeq)
		},
		SocketFactory: func(appID, appSecret string, onMessage func(ReceivedMessage)) (FeishuSocket, error) {
			fixture.mu.Lock()
			defer fixture.mu.Unlock()
			socket := newFakeSocket(onMessage)
			fixture.sockets[appID] = socket
			return socket, nil
		},
	})
	t.Cleanup(fixture.manager.Reset)
	return fixture
}

func (f *listenerFixture) socketFor(t *testing.T, appID string) *fakeSocket {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	socket, found := f.sockets[appID]
	if !found {
		t.Fatalf("no socket was created for app %q", appID)
	}
	return socket
}

func TestListenerStartReturnsStatusWithListenIDAndTTL(t *testing.T) {
	f := newListenerFixture(t)

	status, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if status.AppID != "app-1" {
		t.Errorf("appId = %q, want app-1", status.AppID)
	}
	if status.ListenID != "listen-id-1" {
		t.Errorf("listenId = %q, want listen-id-1", status.ListenID)
	}
	if status.Stopped {
		t.Error("stopped = true, want false")
	}
	if status.MessageCount != 0 {
		t.Errorf("messageCount = %d, want 0", status.MessageCount)
	}
	if status.StartedAt != "2024-06-01T00:00:00Z" {
		t.Errorf("startedAt = %q, want the injected clock", status.StartedAt)
	}
	if status.TTLSeconds != DefaultListenerTTLSeconds {
		t.Errorf("ttlSeconds = %d, want %d", status.TTLSeconds, DefaultListenerTTLSeconds)
	}
	if got := f.socketFor(t, "app-1").startCount(); got != 1 {
		t.Errorf("connect calls = %d, want 1", got)
	}
}

func TestListenerStartIsIdempotentWhileActive(t *testing.T) {
	f := newListenerFixture(t)

	first, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0)
	if err != nil {
		t.Fatalf("first Start: %v", err)
	}
	second, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0)
	if err != nil {
		t.Fatalf("second Start: %v", err)
	}
	if first.ListenID != second.ListenID {
		t.Errorf("listenIds = %q/%q, want the same listener", first.ListenID, second.ListenID)
	}
	if got := f.socketFor(t, "app-1").startCount(); got != 1 {
		t.Errorf("connect calls = %d, want 1", got)
	}
}

func TestListenerStartSerialisesConcurrentStarts(t *testing.T) {
	f := newListenerFixture(t)

	type outcome struct {
		status ListenerStatus
		err    error
	}
	results := make(chan outcome, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0)
			results <- outcome{status: status, err: err}
		}()
	}
	wg.Wait()
	close(results)

	var listenIDs []string
	for result := range results {
		if result.err != nil {
			t.Fatalf("Start: %v", result.err)
		}
		listenIDs = append(listenIDs, result.status.ListenID)
	}
	if listenIDs[0] != listenIDs[1] {
		t.Errorf("listenIds = %v, want both callers to see one listener", listenIDs)
	}
	if got := f.socketFor(t, "app-1").startCount(); got != 1 {
		t.Errorf("connect calls = %d, want 1 despite the race", got)
	}
}

func TestListenerIsActiveTracksState(t *testing.T) {
	f := newListenerFixture(t)

	if f.manager.IsActive("app-1") {
		t.Fatal("IsActive = true, want false before any start")
	}
	if _, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !f.manager.IsActive("app-1") {
		t.Fatal("IsActive = false, want true while running")
	}
	if _, err := f.manager.Stop(context.Background(), "app-1"); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if f.manager.IsActive("app-1") {
		t.Fatal("IsActive = true, want false after stop")
	}
}

func TestListenerStopKeepsTombstone(t *testing.T) {
	f := newListenerFixture(t)

	status, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	stopped, err := f.manager.Stop(context.Background(), status.ListenID)
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if !stopped {
		t.Error("Stop = false, want true")
	}
	if got := f.socketFor(t, "app-1").closeCount(); got != 1 {
		t.Errorf("close calls = %d, want 1", got)
	}

	tombstone, found := f.manager.Status("app-1")
	if !found {
		t.Fatal("Status after stop = not found, want the tombstone")
	}
	if !tombstone.Stopped {
		t.Error("stopped = false, want true")
	}
	if tombstone.StopReason != StopReasonManual {
		t.Errorf("stopReason = %q, want %q", tombstone.StopReason, StopReasonManual)
	}
}

func TestListenerCanStopByListenID(t *testing.T) {
	f := newListenerFixture(t)

	status, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	// The page stops by the snapshot listenId, because the form's appId may have
	// been edited after starting.
	stopped, err := f.manager.Stop(context.Background(), status.ListenID)
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if !stopped {
		t.Error("Stop by listenId = false, want true")
	}
}

func TestListenerStopUnknownReturnsFalse(t *testing.T) {
	f := newListenerFixture(t)

	stopped, err := f.manager.Stop(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if stopped {
		t.Error("Stop = true, want false for an unknown id")
	}
}

func TestListenerAutoStopsAfterTTL(t *testing.T) {
	f := newListenerFixture(t)

	if _, err := f.manager.Start(context.Background(), "app-1", "secret-1", 5); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !f.manager.IsActive("app-1") {
		t.Fatal("IsActive = false, want true right after start")
	}

	f.scheduler.Advance(5 * time.Second)

	if f.manager.IsActive("app-1") {
		t.Fatal("IsActive = true, want false after the TTL elapsed")
	}
	if got := f.socketFor(t, "app-1").closeCount(); got != 1 {
		t.Errorf("close calls = %d, want 1", got)
	}
	status, found := f.manager.Status("app-1")
	if !found {
		t.Fatal("Status after timeout = not found, want the tombstone")
	}
	if status.StopReason != StopReasonTimeout {
		t.Errorf("stopReason = %q, want %q", status.StopReason, StopReasonTimeout)
	}
}

func TestListenerTombstoneExpiresAfterGrace(t *testing.T) {
	f := newListenerFixture(t)

	if _, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if _, err := f.manager.Stop(context.Background(), "app-1"); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if _, found := f.manager.Status("app-1"); !found {
		t.Fatal("Status = not found, want the tombstone right after stop")
	}

	f.scheduler.Advance(ListenerTombstoneTTL)

	if _, found := f.manager.Status("app-1"); found {
		t.Fatal("Status = found, want the tombstone gone after its grace period")
	}
}

func TestListenerRecordsReceivedMessages(t *testing.T) {
	f := newListenerFixture(t)

	if _, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0); err != nil {
		t.Fatalf("Start: %v", err)
	}
	f.socketFor(t, "app-1").deliver(ReceivedMessage{
		Sender: ReceivedSender{OpenID: "ou_user1", UserID: "user1"},
		Message: ReceivedMessageBody{
			MessageID:   "msg_1",
			ChatID:      "oc_chat1",
			ChatType:    "p2p",
			MessageType: "text",
			CreateTime:  "1717200000",
		},
		ReceivedAt: "2024-06-01T00:00:00Z",
	})

	messages := f.manager.Messages("app-1")
	if len(messages) != 1 {
		t.Fatalf("messages = %d, want 1", len(messages))
	}
	if messages[0].Sender.OpenID != "ou_user1" {
		t.Errorf("open_id = %q, want ou_user1", messages[0].Sender.OpenID)
	}
	if messages[0].Message.MessageID != "msg_1" {
		t.Errorf("message_id = %q, want msg_1", messages[0].Message.MessageID)
	}
	if messages[0].ReceivedAt != "2024-06-01T00:00:00Z" {
		t.Errorf("receivedAt = %q, want the injected clock", messages[0].ReceivedAt)
	}

	status, found := f.manager.Status("app-1")
	if !found {
		t.Fatal("Status = not found, want the running listener")
	}
	if status.MessageCount != 1 {
		t.Errorf("messageCount = %d, want 1", status.MessageCount)
	}
}

func TestListenerMessagesEmptyForUnknownListener(t *testing.T) {
	f := newListenerFixture(t)

	if messages := f.manager.Messages("nonexistent"); len(messages) != 0 {
		t.Errorf("messages = %v, want an empty slice", messages)
	}
}

func TestListenerKeepsAppIDsIsolated(t *testing.T) {
	f := newListenerFixture(t)

	if _, err := f.manager.Start(context.Background(), "app-1", "secret-1", 0); err != nil {
		t.Fatalf("start app-1: %v", err)
	}
	if _, err := f.manager.Start(context.Background(), "app-2", "secret-2", 0); err != nil {
		t.Fatalf("start app-2: %v", err)
	}
	if !f.manager.IsActive("app-1") || !f.manager.IsActive("app-2") {
		t.Fatal("both listeners must be active")
	}

	if _, err := f.manager.Stop(context.Background(), "app-1"); err != nil {
		t.Fatalf("Stop app-1: %v", err)
	}
	if f.manager.IsActive("app-1") {
		t.Error("app-1 still active after its stop")
	}
	if !f.manager.IsActive("app-2") {
		t.Error("app-2 deactivated by an unrelated stop")
	}
}

func TestListenerHonoursCustomTTL(t *testing.T) {
	f := newListenerFixture(t)

	status, err := f.manager.Start(context.Background(), "app-1", "secret-1", 60)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if status.TTLSeconds != 60 {
		t.Errorf("ttlSeconds = %d, want 60", status.TTLSeconds)
	}
}
