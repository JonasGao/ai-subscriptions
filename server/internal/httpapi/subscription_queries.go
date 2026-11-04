package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/model"
	"ai-subscriptions/internal/providers"
	"ai-subscriptions/internal/store"
)

// providerHTTP returns the outbound client live queries use.
func (opts Options) providerHTTP() providers.HTTPDoer {
	if opts.ProviderHTTP != nil {
		return opts.ProviderHTTP
	}
	return providers.DefaultHTTPClient
}

// queryTimeoutMessage maps a timed-out provider call onto the old stack's
// AbortError branch (504 + "<kind> query timed out").
func queryTimeoutMessage(err error, kind string) (string, bool) {
	if err == nil {
		return "", false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return kind + " query timed out", true
	}
	return "", false
}

// decodeCredentials decrypts a subscription's stored credential blob. A
// malformed blob degrades to "no credentials", matching crypto.Cipher.
func (opts Options) decodeCredentials(ciphertext string) map[string]string {
	return opts.dataCipher().DecryptCredentials(ciphertext)
}

// subscriptionEcho is the credentials-stripped subscription the usage route
// echoes back so the frontend can stay consistent without a refetch
// (lib/api-utils.ts stripCredentials).
func subscriptionEcho(sub model.Subscription) subscriptionPayload {
	return newSubscriptionPayload(sub)
}

// handleSubscriptionUsage serves GET /api/subscriptions/{id}/usage.
//
// The guard chain (404 / not-recurring / unsupported / credentials) is the old
// stack's verbatim. The success branch dispatches to the provider usage handler
// and echoes the subscription back; the auto-exhaust linkage is a frontend rule
// (#29) and reset-time calibration is #34, so neither runs here yet.
func handleSubscriptionUsage(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := opts.Data.SubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to query usage")
			return
		}
		if sub == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		if sub.SubscriptionType != "recurring" {
			writeError(w, http.StatusBadRequest, "Usage query is only supported for recurring subscriptions")
			return
		}
		provider, ok := providers.ProviderByID(sub.Provider)
		if !ok || providers.ResolveUsageAPIURL(provider, sub.PlanID) == "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Usage query not supported for %s", sub.Provider))
			return
		}
		handlerKey := providers.ResolveUsageHandlerKey(sub.Provider, sub.PlanID)
		if !providers.HasUsageHandler(handlerKey) {
			writeError(w, http.StatusBadRequest, "Unsupported provider")
			return
		}
		handler := providers.UsageHandlers(opts.providerHTTP())[handlerKey]
		if handler == nil {
			// Defensive: every registered key has a handler body as of #33.
			// Report the handler-failure family rather than "unsupported".
			writeError(w, http.StatusBadGateway, "Usage query failed")
			return
		}
		if sub.Credentials == "" {
			writeError(w, http.StatusBadRequest, "Credentials are not configured for this subscription")
			return
		}

		credentials := opts.decodeCredentials(sub.Credentials)
		result, err := handler.FetchUsage(r.Context(), credentials)
		if err != nil {
			if message, timedOut := queryTimeoutMessage(err, "Usage"); timedOut {
				writeError(w, http.StatusGatewayTimeout, message)
				return
			}
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}

		writeNoStoreJSON(w, http.StatusOK, usageResponse{
			UsageResult:  result,
			Subscription: subscriptionEcho(*sub),
		})
	}
}

// usageResponse is the old stack's `{...usageResult, subscription}` body. The
// usage fields are inlined at the top level, so UsageResult is embedded.
type usageResponse struct {
	providers.UsageResult
	Subscription subscriptionPayload `json:"subscription"`
}

// handleSubscriptionBalance serves GET /api/subscriptions/{id}/balance.
//
// A successful query writes the first balance line back onto the subscription
// (available + currency) — the old stack did this server-side so no client PUT
// is needed.
func handleSubscriptionBalance(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := opts.Data.SubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to query balance")
			return
		}
		if sub == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		provider, ok := providers.ProviderByID(sub.Provider)
		if !ok || provider.BalanceAPIURL == "" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Balance query not supported for %s", sub.Provider))
			return
		}
		handler := providers.BalanceHandlers(opts.providerHTTP())[sub.Provider]
		if handler == nil {
			writeError(w, http.StatusBadRequest, "Unsupported provider")
			return
		}
		if sub.Credentials == "" {
			writeError(w, http.StatusBadRequest, "Credentials are not configured for this subscription")
			return
		}

		credentials := opts.decodeCredentials(sub.Credentials)
		result, err := handler.FetchBalance(r.Context(), credentials)
		if err != nil {
			if message, timedOut := queryTimeoutMessage(err, "Balance"); timedOut {
				writeError(w, http.StatusGatewayTimeout, message)
				return
			}
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}

		if len(result.BalanceInfos) > 0 {
			first := result.BalanceInfos[0]
			updates := store.SubscriptionUpdates{BalanceCurrency: &first.Currency}
			// parseFloat(available) >= 0 is the old stack's write-back guard: a
			// negative or unparsable amount keeps the stored balance untouched.
			if amount, parseErr := strconv.ParseFloat(first.Available, 64); parseErr == nil && amount >= 0 {
				updates.Balance = &amount
			}
			if _, err := opts.Data.UpdateSubscription(sub.ID, updates, nil); err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to query balance")
				return
			}
		}

		writeNoStoreJSON(w, http.StatusOK, result)
	}
}

// handleSubscriptionModels serves GET /api/subscriptions/{id}/models.
//
// Public endpoints (modelsRequireCredentials: false, e.g. alibaba coding-plan)
// answer without stored credentials; everything else requires them and routes
// the user to the edit dialog client-side.
func handleSubscriptionModels(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := opts.Data.SubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to query models")
			return
		}
		if sub == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}
		provider, ok := providers.ProviderByID(sub.Provider)
		if !ok {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Model query not supported for %s", sub.Provider))
			return
		}
		handler, _, resolved := providers.ResolveModelsHandler(provider, sub.PlanID, opts.providerHTTP())
		if !resolved {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("Model query not supported for %s", sub.Provider))
			return
		}
		if providers.ResolveModelsRequireCredentials(provider, sub.PlanID) && sub.Credentials == "" {
			writeError(w, http.StatusBadRequest, "Credentials are not configured for this subscription")
			return
		}

		credentials := map[string]string{}
		if sub.Credentials != "" {
			credentials = opts.decodeCredentials(sub.Credentials)
		}

		models, err := handler.FetchModels(r.Context(), credentials)
		if err != nil {
			if message, timedOut := queryTimeoutMessage(err, "Model"); timedOut {
				writeError(w, http.StatusGatewayTimeout, message)
				return
			}
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}

		writeNoStoreJSON(w, http.StatusOK, modelsResult{Models: providers.NormalizeModels(models)})
	}
}

// modelsResult is the models route's wire shape (lib/types.ts ModelsResult).
type modelsResult struct {
	Models []string `json:"models"`
}

// writeNoStoreJSON writes a query result that must never be cached
// (`Cache-Control: no-store`, as in the old route handlers).
func writeNoStoreJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSONAligned(w, status, payload)
}
