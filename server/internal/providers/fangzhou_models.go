package providers

import (
	"context"
	"encoding/json"
	"fmt"
)

// Fangzhou model handlers ported from lib/providers/fangzhou.ts:
// ListFoundationModels (paginated), ListAgentPlanLatestModel, ListArkCodeLatestModel.
// All three use V4-signed POST requests to open.volcengineapi.com.

const (
	fangzhouListModelsURL    = "https://open.volcengineapi.com/?Action=ListFoundationModels&Version=2024-01-01"
	fangzhouAgentPlanModelsURL = "https://open.volcengineapi.com/?Action=ListAgentPlanLatestModel&Version=2024-01-01"
	fangzhouCodingPlanModelsURL = "https://open.volcengineapi.com/?Action=ListArkCodeLatestModel&Version=2024-01-01"
)

// Defensive limit to prevent infinite pagination loops (matches old stack).
const fangzhouMaxItems = 1000
const fangzhouDefaultPageSize = 100

// fangzhouModelsHandler fetches the full ListFoundationModels catalog with
// V4-signed pagination. Registered under the bare "fangzhou" provider key.
type fangzhouModelsHandler struct{ client HTTPDoer }

func (h fangzhouModelsHandler) FetchModels(ctx context.Context, credentials map[string]string) ([]string, error) {
	return FetchFangzhouModels(ctx, h.client, credentials)
}

// FetchFangzhouModels paginates through all ListFoundationModels pages.
func FetchFangzhouModels(ctx context.Context, client HTTPDoer, credentials map[string]string) ([]string, error) {
	ak, sk := credentials["ak"], credentials["sk"]
	if ak == "" || sk == "" {
		return nil, fmt.Errorf("AK/SK not configured")
	}

	allModels := []string{}
	pageNumber := 1

	for len(allModels) < fangzhouMaxItems {
		body := fmt.Sprintf(`{"PageNumber":%d,"PageSize":%d}`, pageNumber, fangzhouDefaultPageSize)
		headers := signVolcengineRequest(fangzhouListModelsURL, body, ak, sk)

		response, err := postVolcengine(ctx, client, fangzhouListModelsURL, body, headers)
		if err != nil {
			return nil, err
		}

		if response.StatusCode < 200 || response.StatusCode >= 300 {
			response.Body.Close()
			return nil, fmt.Errorf("ListFoundationModels API returned %d", response.StatusCode)
		}

		var payload struct {
			Result *struct {
				Items      []struct{ Name string } `json:"Items"`
				TotalCount int                     `json:"TotalCount"`
			} `json:"Result"`
		}
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			response.Body.Close()
			return nil, err
		}
		response.Body.Close()

		if payload.Result == nil || len(payload.Result.Items) == 0 {
			break
		}

		for _, item := range payload.Result.Items {
			if len(allModels) >= fangzhouMaxItems {
				break
			}
			if item.Name != "" {
				allModels = append(allModels, item.Name)
			}
		}

		// Continue if we haven't reached totalCount AND we got items.
		totalCount := 0
		if payload.Result != nil {
			totalCount = payload.Result.TotalCount
		}
		if len(allModels) >= totalCount || len(payload.Result.Items) == 0 {
			break
		}
		pageNumber++
	}

	return allModels, nil
}

// planModelsHandler fetches plan-specific model lists (AgentPlan/CodingPlan).
type planModelsHandler struct {
	client HTTPDoer
	url    string
	action string
}

func (h planModelsHandler) FetchModels(ctx context.Context, credentials map[string]string) ([]string, error) {
	return fetchPlanModels(ctx, h.client, credentials, h.url, h.action)
}

func fetchPlanModels(ctx context.Context, client HTTPDoer, credentials map[string]string, url, action string) ([]string, error) {
	ak, sk := credentials["ak"], credentials["sk"]
	if ak == "" || sk == "" {
		return nil, fmt.Errorf("AK/SK not configured")
	}

	body := "{}"
	headers := signVolcengineRequest(url, body, ak, sk)

	response, err := postVolcengine(ctx, client, url, body, headers)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("%s API returned %d", action, response.StatusCode)
	}

	var payload struct {
		Result *struct {
			Data []struct {
				ModelId   string `json:"ModelId"`
				ModelName string `json:"ModelName"`
			} `json:"Data"`
		} `json:"Result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}

	if payload.Result == nil || len(payload.Result.Data) == 0 {
		return []string{}, nil
	}

	models := []string{}
	for _, item := range payload.Result.Data {
		name := item.ModelName
		if name == "" {
			name = item.ModelId
		}
		if name != "" {
			models = append(models, name)
		}
	}
	return models, nil
}

// agentPlanModelsHandler uses ListAgentPlanLatestModel.
type agentPlanModelsHandler struct{ client HTTPDoer }

func (h agentPlanModelsHandler) FetchModels(ctx context.Context, credentials map[string]string) ([]string, error) {
	return fetchPlanModels(ctx, h.client, credentials, fangzhouAgentPlanModelsURL, "ListAgentPlanLatestModel")
}

// codingPlanModelsHandler uses ListArkCodeLatestModel.
type codingPlanModelsHandler struct{ client HTTPDoer }

func (h codingPlanModelsHandler) FetchModels(ctx context.Context, credentials map[string]string) ([]string, error) {
	return fetchPlanModels(ctx, h.client, credentials, fangzhouCodingPlanModelsURL, "ListArkCodeLatestModel")
}

// compile-time guards.
var (
	_ ModelsHandler = fangzhouModelsHandler{}
	_ ModelsHandler = agentPlanModelsHandler{}
	_ ModelsHandler = codingPlanModelsHandler{}
	_ ModelsHandler = planModelsHandler{}
)

// fangzhouModelsHandlers returns the fangzhou model handlers for registration.
// Called by ModelsHandlers() to populate the exception registry.
func fangzhouModelsHandlers(client HTTPDoer) map[string]ModelsHandler {
	return map[string]ModelsHandler{
		"fangzhou":            fangzhouModelsHandler{client: client},
		"fangzhou:agentplan":  agentPlanModelsHandler{client: client},
		"fangzhou:codingplan": codingPlanModelsHandler{client: client},
	}
}
