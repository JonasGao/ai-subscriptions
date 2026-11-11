package providers

import (
	"context"
	"fmt"
)

// --- FastAI (https://www.fastaitoken.com) 余额查询 ---
//
// GET {baseUrl}/v1/usage with a Bearer apiKey is the ccswitch usageScript
// contract. It returns a wallet balance (remaining / balance / unit /
// is_active), NOT a windowed usage quota, so it serves one-time subscriptions
// only: recurring subscriptions have no额度 query endpoint for this provider.
//
// A live probe of the endpoint returned (key redacted; this account is
// overdrawn, hence the negative remaining):
//
//	{"balance":-0.02009565,"daily_usage":[],"isValid":true,
//	 "mode":"unrestricted","planName":"钱包余额","remaining":-0.02009565,
//	 "unit":"USD","usage":{"total":{"actual_cost":10.02009565,"cost":40.08,...}}}
//
// The额度 extractor (?? chain) is shared with MorphAPI in coalescing.go.

const fastaiBalanceURL = "https://www.fastaitoken.com/v1/usage"

// fetchFastAIQuota issues the余额 request and normalizes it with the shared
// ccswitch extractor. It is the single fetch seam for the provider.
func fetchFastAIQuota(ctx context.Context, client HTTPDoer, apiKey string) (relayQuota, error) {
	response, err := doGET(ctx, client, fastaiBalanceURL, map[string]string{
		"Authorization": "Bearer " + apiKey,
	})
	if err != nil {
		return relayQuota{}, err
	}
	if !isSuccess(response) {
		response.Body.Close()
		return relayQuota{}, fmt.Errorf("FastAI API returned %d", response.StatusCode)
	}
	data, err := decodeObject(response)
	if err != nil {
		return relayQuota{}, err
	}
	return parseRelayQuota(data), nil
}

// --- one-time subscriptions (balance query) ---

type fastaiBalanceHandler struct{ client HTTPDoer }

func (h *fastaiBalanceHandler) FetchBalance(ctx context.Context, credentials map[string]string) (BalanceResult, error) {
	q, err := fetchFastAIQuota(ctx, h.client, credentials["apiKey"])
	if err != nil {
		return BalanceResult{}, err
	}
	planName := q.planName
	return BalanceResult{
		Provider:    "fastai",
		IsAvailable: q.isValid,
		BalanceInfos: []BalanceInfo{{
			Currency:  q.unit,
			Available: toFixed2(q.remaining),
			Total:     &planName,
		}},
	}, nil
}

func (h *fastaiBalanceHandler) TestConnection(ctx context.Context, credentials map[string]string) (ConnectionResult, error) {
	return testConnection(ctx, h.client, fastaiBalanceURL, credentials["apiKey"])
}

// FetchFastAIBalance is the exported entry point for the one-time path.
func FetchFastAIBalance(ctx context.Context, client HTTPDoer, apiKey string) (BalanceResult, error) {
	return (&fastaiBalanceHandler{client: client}).FetchBalance(ctx, map[string]string{"apiKey": apiKey})
}

var _ BalanceHandler = (*fastaiBalanceHandler)(nil)
