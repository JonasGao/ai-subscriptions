package httpapi

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"ai-subscriptions/internal/providers"
)

// decodeCredentialsBody ports the old routes' shared credential check: a JSON
// body that cannot be read is the catch-all 500, and an absent/empty/non-object
// credentials value is a 400. Values that are not strings are dropped (the
// provider handlers only read the documented keys).
func decodeCredentialsBody(r *http.Request) (map[string]string, int, string) {
	body, err := decodeObjectBody(r)
	if err != nil {
		return nil, http.StatusInternalServerError, "Failed to test connection"
	}

	credentials := map[string]string{}
	if raw, ok := body["credentials"].(map[string]any); ok {
		for key, value := range raw {
			if text, isString := value.(string); isString {
				credentials[key] = text
			}
		}
	}
	if len(credentials) == 0 {
		return nil, http.StatusBadRequest, "Credentials are required"
	}
	return credentials, 0, ""
}

// decodeProviderTestBody also reads the required provider and the optional
// planId (POST /api/test-connection).
func decodeProviderTestBody(r *http.Request) (provider, planID string, credentials map[string]string, status int, message string) {
	body, err := decodeObjectBody(r)
	if err != nil {
		return "", "", nil, http.StatusInternalServerError, "Failed to test connection"
	}

	provider, _ = body["provider"].(string)
	if provider == "" {
		return "", "", nil, http.StatusBadRequest, "Provider is required"
	}
	planID, _ = body["planId"].(string)

	credentials = map[string]string{}
	if raw, ok := body["credentials"].(map[string]any); ok {
		for key, value := range raw {
			if text, isString := value.(string); isString {
				credentials[key] = text
			}
		}
	}
	if len(credentials) == 0 {
		return "", "", nil, http.StatusBadRequest, "Credentials are required"
	}
	return provider, planID, credentials, 0, ""
}

// testProviderConnection ports the old route dispatch: the plan-aware usage
// handler wins over the provider-wide balance handler; neither means the
// provider cannot be tested. A handler error is the route's catch-all 500.
func (opts Options) testProviderConnection(ctx context.Context, provider, planID string, credentials map[string]string) (providers.ConnectionResult, int, string) {
	usageKey := providers.ResolveUsageHandlerKey(provider, planID)
	if handler := providers.UsageHandlers(opts.providerHTTP())[usageKey]; handler != nil {
		result, err := handler.TestConnection(ctx, credentials)
		if err != nil {
			return providers.ConnectionResult{}, http.StatusInternalServerError, "Failed to test connection"
		}
		return result, 0, ""
	}

	if handler := providers.BalanceHandlers(opts.providerHTTP())[provider]; handler != nil {
		result, err := handler.TestConnection(ctx, credentials)
		if err != nil {
			return providers.ConnectionResult{}, http.StatusInternalServerError, "Failed to test connection"
		}
		return result, 0, ""
	}

	return providers.ConnectionResult{}, http.StatusBadRequest,
		"Test connection not supported for " + provider
}

// handleTestConnection serves POST /api/test-connection, the create/edit
// form's "test connection" button (old app/api/test-connection/route.ts).
func handleTestConnection(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provider, planID, credentials, status, message := decodeProviderTestBody(r)
		if status != 0 {
			writeError(w, status, message)
			return
		}

		result, status, message := opts.testProviderConnection(
			r.Context(), provider, planID, credentials,
		)
		if status != 0 {
			writeError(w, status, message)
			return
		}
		writeJSONAligned(w, http.StatusOK, result)
	}
}

// handleSubscriptionTestConnection serves
// POST /api/subscriptions/{id}/test-connection (old
// app/api/subscriptions/[id]/test-connection/route.ts). The subscription is
// looked up before the body is read; its provider/planId select the handler and
// the body only carries credentials, like the old route.
func handleSubscriptionTestConnection(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := opts.Data.SubscriptionByID(chi.URLParam(r, "id"))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to test connection")
			return
		}
		if sub == nil {
			writeError(w, http.StatusNotFound, "Subscription not found")
			return
		}

		credentials, status, message := decodeCredentialsBody(r)
		if status != 0 {
			writeError(w, status, message)
			return
		}

		result, status, message := opts.testProviderConnection(
			r.Context(), sub.Provider, sub.PlanID, credentials,
		)
		if status != 0 {
			writeError(w, status, message)
			return
		}
		writeJSONAligned(w, http.StatusOK, result)
	}
}
