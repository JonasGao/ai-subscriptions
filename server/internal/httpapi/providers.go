package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"

	"ai-subscriptions/internal/providers"
)

// ProviderRefSource supplies the subscription/tool references that enrich the
// read-only provider registry (reference counts on /api/providers). The storage
// tickets (#23/#26) provide the real implementation; a nil source means "no
// references" (fresh install).
type ProviderRefSource interface {
	SubscriptionRefs() []providers.ProviderRef
	ToolRefs() []providers.ProviderRef
}

func (opts Options) providerRefs() (subscriptions, tools []providers.ProviderRef) {
	if opts.ProviderRefs == nil {
		return nil, nil
	}
	return opts.ProviderRefs.SubscriptionRefs(), opts.ProviderRefs.ToolRefs()
}

// handleProviders serves GET /api/providers: the static registry enriched with
// capability flags and reference counts (ADR-0006).
func handleProviders(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subscriptions, tools := opts.providerRefs()
		writeJSONAligned(w, http.StatusOK, providers.EnrichProviders(
			providers.DefaultProviders(), subscriptions, tools,
		))
	}
}

// handleUnregisteredProviders serves GET /api/providers/unregistered: distinct
// in-use providerCustom names with counts.
func handleUnregisteredProviders(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		subscriptions, tools := opts.providerRefs()
		names := providers.UnregisteredProviderNames(subscriptions, tools)
		if names == nil {
			names = []providers.UnregisteredProviderName{}
		}
		writeJSONAligned(w, http.StatusOK, names)
	}
}

// writeJSONAligned writes the payload the way the old stack's NextResponse.json
// does: HTML characters are NOT escaped (fangzhou's model URLs contain raw "&"),
// and the body has no trailing newline. Byte alignment is an acceptance
// criterion for the API surface.
func writeJSONAligned(w http.ResponseWriter, status int, payload any) {
	body, err := marshalAligned(payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "encode response"})
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// marshalAligned encodes payload the way JSON.stringify does for the old
// stack: raw HTML characters and no trailing newline.
func marshalAligned(payload any) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(payload); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
