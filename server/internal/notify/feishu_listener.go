package notify

// Feishu WS long-connection listeners, ported from
// lib/notifications/feishu-listener.ts.
//
// One listener per appId lives in process memory: starting an already-running
// appId returns the existing status, a TTL timer auto-stops it, and the stopped
// entry survives as a tombstone for a grace period so the settings page's last
// poll can report why polling ended. All of this is process-resident by design
// (ADR-0018): a restart drops every listener, exactly like the old module state.
//
// The socket itself is behind the FeishuSocket seam; production uses the
// oapi-sdk-go v3 Channel module (see feishu_socket.go).

import (
	"context"
	"sync"
	"time"
)

// DefaultListenerTTLSeconds is how long a listener stays up before auto-stop.
const DefaultListenerTTLSeconds = 120

// ListenerTombstoneTTL is how long stopped state is kept for status polling.
const ListenerTombstoneTTL = 30 * time.Second

// StopReason records why a listener stopped.
type StopReason string

const (
	StopReasonManual  StopReason = "manual"
	StopReasonTimeout StopReason = "timeout"
	StopReasonError   StopReason = "error"
)

// ReceivedSender is who sent a captured message.
type ReceivedSender struct {
	OpenID  string `json:"open_id"`
	UserID  string `json:"user_id,omitempty"`
	UnionID string `json:"union_id,omitempty"`
	Name    string `json:"name,omitempty"`
}

// ReceivedMessageBody is the message metadata captured for the picker.
type ReceivedMessageBody struct {
	MessageID   string `json:"message_id"`
	ChatID      string `json:"chat_id"`
	ChatType    string `json:"chat_type"`
	MessageType string `json:"message_type"`
	CreateTime  string `json:"create_time"`
}

// ReceivedMessage is one message the listener captured.
type ReceivedMessage struct {
	Sender     ReceivedSender      `json:"sender"`
	Message    ReceivedMessageBody `json:"message"`
	ReceivedAt string              `json:"receivedAt"`
}

// ListenerStatus is what POST/GET /listen return to the page.
type ListenerStatus struct {
	AppID        string     `json:"appId"`
	ListenID     string     `json:"listenId"`
	StartedAt    string     `json:"startedAt"`
	MessageCount int        `json:"messageCount"`
	Stopped      bool       `json:"stopped"`
	StopReason   StopReason `json:"stopReason,omitempty"`
	TTLSeconds   int        `json:"ttlSeconds"`
}

// Timer is the one-shot timer seam, satisfied by *time.Timer.
type Timer interface {
	Stop() bool
}

// Scheduler creates one-shot timers. Injected so tests can advance time.
type Scheduler interface {
	AfterFunc(d time.Duration, fn func()) Timer
}

// FeishuSocket is one long connection. Connect must not block past the moment
// the connection is ready; Close tears it down and releases Connect's loop.
type FeishuSocket interface {
	Connect(ctx context.Context) error
	Close() error
}

// SocketFactory builds a socket for an app. onMessage is called for every
// received message while the socket is open.
type SocketFactory func(appID, appSecret string, onMessage func(ReceivedMessage)) (FeishuSocket, error)

// ListenerOptions are the injection points; nil fields fall back to production
// defaults so only tests pay attention to them.
type ListenerOptions struct {
	Scheduler     Scheduler
	Now           func() time.Time
	NewID         func() string
	SocketFactory SocketFactory
}

type listenerState struct {
	appID      string
	listenID   string
	socket     FeishuSocket
	startedAt  string
	messages   []ReceivedMessage
	ttlSeconds int
	ttlTimer   Timer
	tombstone  Timer
	stopped    bool
	stopReason StopReason
}

// ListenerManager owns the per-app listener table.
type ListenerManager struct {
	mu       sync.Mutex
	byAppID  map[string]*listenerState
	byListen map[string]string
	inFlight map[string]*startCall

	scheduler     Scheduler
	now           func() time.Time
	newID         func() string
	socketFactory SocketFactory
}

// startCall funnels concurrent starts for one appId onto a single connect.
type startCall struct {
	done   chan struct{}
	status ListenerStatus
	err    error
}

type realScheduler struct{}

func (realScheduler) AfterFunc(d time.Duration, fn func()) Timer {
	return time.AfterFunc(d, fn)
}

// NewListenerManager builds a manager with the given seams.
func NewListenerManager(opts ListenerOptions) *ListenerManager {
	manager := &ListenerManager{
		byAppID:       make(map[string]*listenerState),
		byListen:      make(map[string]string),
		inFlight:      make(map[string]*startCall),
		scheduler:     opts.Scheduler,
		now:           opts.Now,
		newID:         opts.NewID,
		socketFactory: opts.SocketFactory,
	}
	if manager.scheduler == nil {
		manager.scheduler = realScheduler{}
	}
	if manager.now == nil {
		manager.now = time.Now
	}
	if manager.newID == nil {
		manager.newID = newListenerID
	}
	if manager.socketFactory == nil {
		manager.socketFactory = newChannelSocketFactory()
	}
	return manager
}

// Start opens (or returns) the listener for appID. ttlSeconds <= 0 uses the
// default TTL. Concurrent calls for one appId share a single connect.
func (m *ListenerManager) Start(ctx context.Context, appID, appSecret string, ttlSeconds int) (ListenerStatus, error) {
	m.mu.Lock()
	if state, found := m.byAppID[appID]; found && !state.stopped {
		status := statusOf(state)
		m.mu.Unlock()
		return status, nil
	}
	if call, found := m.inFlight[appID]; found {
		m.mu.Unlock()
		<-call.done
		return call.status, call.err
	}
	call := &startCall{done: make(chan struct{})}
	m.inFlight[appID] = call
	m.mu.Unlock()

	status, err := m.connect(ctx, appID, appSecret, ttlSeconds)

	m.mu.Lock()
	call.status, call.err = status, err
	delete(m.inFlight, appID)
	m.mu.Unlock()
	close(call.done)
	return status, err
}

// connect builds the socket, registers it and arms the TTL timer. The socket's
// own goroutine does the message capture, so this never blocks on the network
// loop.
func (m *ListenerManager) connect(ctx context.Context, appID, appSecret string, ttlSeconds int) (ListenerStatus, error) {
	if ttlSeconds <= 0 {
		ttlSeconds = DefaultListenerTTLSeconds
	}

	state := &listenerState{
		appID:      appID,
		listenID:   m.newID(),
		startedAt:  m.now().UTC().Format(time.RFC3339),
		ttlSeconds: ttlSeconds,
	}

	socket, err := m.socketFactory(appID, appSecret, func(message ReceivedMessage) {
		m.recordMessage(state, message)
	})
	if err != nil {
		return ListenerStatus{}, err
	}
	state.socket = socket

	if err := socket.Connect(ctx); err != nil {
		_ = socket.Close()
		return ListenerStatus{}, err
	}

	m.mu.Lock()
	state.ttlTimer = m.scheduler.AfterFunc(time.Duration(ttlSeconds)*time.Second, func() {
		m.stopInternal(appID, StopReasonTimeout)
	})
	m.byAppID[appID] = state
	m.byListen[state.listenID] = appID
	status := statusOf(state)
	m.mu.Unlock()
	return status, nil
}

// recordMessage appends a captured message and stamps it with the read clock.
func (m *ListenerManager) recordMessage(state *listenerState, message ReceivedMessage) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if state.stopped {
		return
	}
	message.ReceivedAt = m.now().UTC().Format(time.RFC3339)
	state.messages = append(state.messages, message)
}

// Stop tears a listener down by listenId or appId. It reports whether anything
// was actually stopped.
func (m *ListenerManager) Stop(ctx context.Context, appIDOrListenID string) (bool, error) {
	m.mu.Lock()
	appID := appIDOrListenID
	if resolved, found := m.byListen[appIDOrListenID]; found {
		appID = resolved
	}
	m.mu.Unlock()
	return m.stopInternal(appID, StopReasonManual), nil
}

// stopInternal performs the stop under the manager lock.
func (m *ListenerManager) stopInternal(appID string, reason StopReason) bool {
	m.mu.Lock()
	state, found := m.byAppID[appID]
	if !found || state.stopped {
		m.mu.Unlock()
		return false
	}
	if state.ttlTimer != nil {
		state.ttlTimer.Stop()
		state.ttlTimer = nil
	}
	state.stopped = true
	state.stopReason = reason
	socket := state.socket
	state.tombstone = m.scheduler.AfterFunc(ListenerTombstoneTTL, func() {
		m.clearTombstone(appID)
	})
	m.mu.Unlock()

	if socket != nil {
		_ = socket.Close()
	}
	return true
}

// clearTombstone drops a stopped entry once its grace period ends.
func (m *ListenerManager) clearTombstone(appID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, found := m.byAppID[appID]
	if !found || !state.stopped {
		return
	}
	if state.tombstone != nil {
		state.tombstone.Stop()
	}
	delete(m.byListen, state.listenID)
	delete(m.byAppID, appID)
}

// Status returns the listener status (including tombstones) by listenId or
// appId.
func (m *ListenerManager) Status(appIDOrListenID string) (ListenerStatus, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.lookup(appIDOrListenID)
	if state == nil {
		return ListenerStatus{}, false
	}
	return statusOf(state), true
}

// Messages returns a copy of the captured messages for a listener.
func (m *ListenerManager) Messages(appIDOrListenID string) []ReceivedMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.lookup(appIDOrListenID)
	if state == nil {
		return []ReceivedMessage{}
	}
	out := make([]ReceivedMessage, len(state.messages))
	copy(out, state.messages)
	return out
}

// IsActive reports whether a listener is running for appID.
func (m *ListenerManager) IsActive(appID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, found := m.byAppID[appID]
	return found && !state.stopped
}

// Reset stops every listener and clears all state.
func (m *ListenerManager) Reset() {
	m.mu.Lock()
	states := make([]*listenerState, 0, len(m.byAppID))
	for _, state := range m.byAppID {
		states = append(states, state)
	}
	m.byAppID = make(map[string]*listenerState)
	m.byListen = make(map[string]string)
	m.mu.Unlock()

	for _, state := range states {
		if state.ttlTimer != nil {
			state.ttlTimer.Stop()
		}
		if state.tombstone != nil {
			state.tombstone.Stop()
		}
		if !state.stopped && state.socket != nil {
			_ = state.socket.Close()
		}
	}
}

// lookup resolves listenId → appId and returns the state. Caller holds the lock.
func (m *ListenerManager) lookup(appIDOrListenID string) *listenerState {
	appID := appIDOrListenID
	if resolved, found := m.byListen[appIDOrListenID]; found {
		appID = resolved
	}
	state, found := m.byAppID[appID]
	if !found {
		return nil
	}
	return state
}

func statusOf(state *listenerState) ListenerStatus {
	return ListenerStatus{
		AppID:        state.appID,
		ListenID:     state.listenID,
		StartedAt:    state.startedAt,
		MessageCount: len(state.messages),
		Stopped:      state.stopped,
		StopReason:   state.stopReason,
		TTLSeconds:   state.ttlSeconds,
	}
}

// defaultListenerManager is the process-wide listener table. Its connections
// and cached IDs live until the process exits (ADR-0018).
var defaultListenerManager = NewListenerManager(ListenerOptions{})

// DefaultListenerManager returns the process-wide listener manager.
func DefaultListenerManager() *ListenerManager { return defaultListenerManager }
