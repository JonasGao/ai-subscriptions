package notify

// Production FeishuSocket: the oapi-sdk-go v3 Channel module over a WebSocket
// long connection (ADR-0018). The Channel module wraps event listening
// (im.message.receive_v1 normalization), the WS transport and lifecycle hooks;
// this adapter maps its NormalizedMessage onto the listener's captured shape.
//
// Channel applies two safety defaults we consciously override: group messages
// require a mention, and mention-all is rejected. The listener exists to help a
// user discover their open_id from any message, which is what the old stack
// recorded, so the policy is fully permissive here.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strconv"
	"sync"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	"github.com/larksuite/oapi-sdk-go/v3/channel"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
)

// feishuConnectTimeout bounds how long Connect waits for the WS handshake.
const feishuConnectTimeout = 30 * time.Second

// newChannelSocketFactory returns the production factory used by the manager.
func newChannelSocketFactory() SocketFactory {
	return func(appID, appSecret string, onMessage func(ReceivedMessage)) (FeishuSocket, error) {
		client := lark.NewClient(appID, appSecret)
		wsClient := larkws.NewClient(appID, appSecret)
		larkChannel := channel.NewChannel(client, wsClient)

		permissive := false
		allowMentionAll := true
		larkChannel.UpdatePolicy(channeltypes.PolicyConfig{
			RequireMention:      &permissive,
			RespondToMentionAll: &allowMentionAll,
			DMMode:              "open",
		})
		larkChannel.OnMessage(func(_ context.Context, msg *channeltypes.NormalizedMessage) error {
			onMessage(receivedMessageFrom(msg))
			return nil
		})

		return &channelSocket{
			channel: larkChannel,
			ready:   make(chan struct{}),
			fail:    make(chan error, 1),
			done:    make(chan struct{}),
		}, nil
	}
}

// channelSocket adapts a Channel to the blocking-Connect/non-blocking-Close
// shape the manager drives.
type channelSocket struct {
	channel channeltypes.Channel
	ready   chan struct{}
	fail    chan error
	done    chan struct{}

	cancel    context.CancelFunc
	readyOnce sync.Once
}

func (s *channelSocket) Connect(ctx context.Context) error {
	// The connection outlives the HTTP request that started it, so the run
	// context is Background-derived and only Close (or a terminal error)
	// cancels it. ctx itself only bounds the handshake.
	runCtx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel

	s.channel.OnReady(func() {
		s.readyOnce.Do(func() { close(s.ready) })
	})
	s.channel.OnError(func(err error) {
		select {
		case s.fail <- err:
		default:
		}
	})

	go func() {
		defer close(s.done)
		if err := s.channel.Start(runCtx); err != nil && !errors.Is(err, context.Canceled) {
			select {
			case s.fail <- err:
			default:
			}
		}
	}()

	select {
	case <-s.ready:
		return nil
	case err := <-s.fail:
		cancel()
		return err
	case <-ctx.Done():
		cancel()
		return ctx.Err()
	case <-time.After(feishuConnectTimeout):
		cancel()
		return errors.New("feishu ws connect timeout")
	}
}

func (s *channelSocket) Close() error {
	if s.cancel != nil {
		s.cancel()
	}
	stopCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.channel.Stop(stopCtx); err != nil {
		return err
	}
	select {
	case <-s.done:
	case <-stopCtx.Done():
	}
	return nil
}

// receivedMessageFrom maps the Channel's normalized message onto the captured
// shape, preferring the raw event so union_id/user_id survive.
func receivedMessageFrom(msg *channeltypes.NormalizedMessage) ReceivedMessage {
	if msg == nil {
		return ReceivedMessage{}
	}

	out := ReceivedMessage{
		Sender: ReceivedSender{OpenID: msg.UserID},
		Message: ReceivedMessageBody{
			MessageID:   msg.MessageID,
			ChatID:      msg.ChatID,
			ChatType:    msg.ChatType,
			MessageType: msg.RawContentType,
		},
	}
	if msg.CreateTimeMs != 0 {
		out.Message.CreateTime = strconv.FormatInt(msg.CreateTimeMs, 10)
	}

	if raw, ok := msg.RawEvent.(*larkim.P2MessageReceiveV1); ok && raw != nil && raw.Event != nil {
		if raw.Event.Sender != nil && raw.Event.Sender.SenderId != nil {
			sender := raw.Event.Sender.SenderId
			if sender.OpenId != nil {
				out.Sender.OpenID = *sender.OpenId
			}
			if sender.UserId != nil {
				out.Sender.UserID = *sender.UserId
			}
			if sender.UnionId != nil {
				out.Sender.UnionID = *sender.UnionId
			}
		}
		if raw.Event.Message != nil && raw.Event.Message.CreateTime != nil {
			out.Message.CreateTime = *raw.Event.Message.CreateTime
		}
	}
	return out
}

// newListenerID returns a random UUID v4, the same id shape the old
// crypto.randomUUID() produced.
func newListenerID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("notify: cannot read random bytes: " + err.Error())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(b[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
