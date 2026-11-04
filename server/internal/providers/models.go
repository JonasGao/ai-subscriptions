package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// ModelsHandler is the model-query contract (lib/providers/index.ts
// ModelsHandler). There is deliberately no TestConnection: credential testing is
// unrelated to model queries.
type ModelsHandler interface {
	FetchModels(ctx context.Context, credentials map[string]string) ([]string, error)
}

// ModelsHandlers returns the exception handlers for providers whose model list
// is not OpenAI-shaped: github (`data[].id` behind a token exchange) and
// fangzhou (Volcengine `Result.Items[].Name`). Their bodies land with #30/#32;
// the registry keys are already absent here, so those providers resolve to the
// generic fallback until then — visible to users as the OpenAI-shaped attempt the
// old stack would also make against a bespoke endpoint.
//
// Everything else resolves through the generic fallback in ResolveModelsHandler.
func ModelsHandlers(clients ...HTTPDoer) map[string]ModelsHandler {
	return map[string]ModelsHandler{}
}

// ResolveModelsHandlerKey ports resolveModelsHandlerKey: "<provider>:<planId>"
// when a plan is set, bare provider id otherwise.
func ResolveModelsHandlerKey(provider, planID string) string {
	if planID != "" {
		return provider + ":" + planID
	}
	return provider
}

// ResolveModelsHandler mirrors lib/providers/index.ts resolveModelsHandler:
// resolve the endpoint, then prefer a plan-specific exception handler, then a
// provider-wide one, then the generic OpenAI-compatible fallback bound to the
// resolved URL.
func ResolveModelsHandler(provider Provider, planID string, clients ...HTTPDoer) (ModelsHandler, string, bool) {
	return ResolveModelsHandlerWith(provider, planID, ModelsHandlers(clients...), clients...)
}

// ResolveModelsHandlerWith is ResolveModelsHandler against an explicit exception
// registry. It exists so the resolution rule (plan key → bare key → generic
// fallback) can be pinned independently of which provider bodies have landed;
// the production registry is ModelsHandlers().
func ResolveModelsHandlerWith(provider Provider, planID string, handlers map[string]ModelsHandler, clients ...HTTPDoer) (ModelsHandler, string, bool) {
	modelsAPIURL := ResolveModelsAPIURL(provider, planID)
	if modelsAPIURL == "" {
		return nil, "", false
	}

	handler := handlers[ResolveModelsHandlerKey(provider.ID, planID)]
	if handler == nil {
		handler = handlers[provider.ID]
	}
	if handler == nil {
		client := resolveClient(clients)
		handler = genericModelsHandler{client: client, modelsAPIURL: modelsAPIURL}
	}
	return handler, modelsAPIURL, true
}

// genericModelsHandler is the OpenAI-compatible fallback: GET the resolved
// models endpoint, extract data[].id.
type genericModelsHandler struct {
	client       HTTPDoer
	modelsAPIURL string
}

func (h genericModelsHandler) FetchModels(ctx context.Context, credentials map[string]string) ([]string, error) {
	return FetchGenericModels(ctx, h.client, h.modelsAPIURL, credentials)
}

// FetchGenericModels ports lib/providers/index.ts fetchGenericModels. Public
// endpoints (openrouter, alibaba coding-plan) simply get no Authorization
// header when the credential is empty.
func FetchGenericModels(ctx context.Context, client HTTPDoer, modelsAPIURL string, credentials map[string]string) ([]string, error) {
	headers := map[string]string{}
	if apiKey := credentials["apiKey"]; apiKey != "" {
		headers["Authorization"] = "Bearer " + apiKey
	}

	response, err := doGET(ctx, client, modelsAPIURL, headers)
	if err != nil {
		return nil, err
	}
	if !isSuccess(response) {
		status := response.Status
		response.Body.Close()
		return nil, fmt.Errorf("Models query failed: %s", status)
	}

	var data map[string]any
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return nil, err
	}

	items, ok := data["data"].([]any)
	if !ok {
		return nil, fmt.Errorf("Invalid models response: missing data array")
	}

	models := make([]string, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, ok := record["id"].(string)
		if !ok || id == "" {
			continue
		}
		models = append(models, id)
	}
	return models, nil
}

// NormalizeModels ports normalizeModels: deduplicate, then sort the way
// localeCompare does (ICU collation), falling back to byte order for equal
// collation keys so the result stays deterministic.
func NormalizeModels(models []string) []string {
	seen := make(map[string]struct{}, len(models))
	unique := make([]string, 0, len(models))
	for _, model := range models {
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		unique = append(unique, model)
	}

	collator := collate.New(language.AmericanEnglish)
	sort.SliceStable(unique, func(i, j int) bool {
		if cmp := collator.CompareString(unique[i], unique[j]); cmp != 0 {
			return cmp < 0
		}
		return unique[i] < unique[j]
	})
	return unique
}

// resolveClient picks the first injected HTTP client, defaulting to
// DefaultHTTPClient.
func resolveClient(clients []HTTPDoer) HTTPDoer {
	for _, client := range clients {
		if client != nil {
			return client
		}
	}
	return DefaultHTTPClient
}

// compile-time guards for the handler contracts.
var (
	_ ModelsHandler  = genericModelsHandler{}
	_ BalanceHandler = (*moonshotBalanceHandler)(nil)
	_ BalanceHandler = (*deepseekBalanceHandler)(nil)
	_ BalanceHandler = (*siliconFlowBalanceHandler)(nil)
	_ BalanceHandler = (*openRouterBalanceHandler)(nil)
)
