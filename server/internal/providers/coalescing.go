package providers

// ccswitch-style relay额度 extractors.
//
// Several OpenAI-compatible relay panels expose a flat GET /v1/usage payload.
// The ccswitch usageScript normalizes it with a nullish-coalescing chain:
//
//	remaining = remaining ?? quota.remaining ?? balance
//	unit      = unit      ?? quota.unit      ?? "USD"
//	isValid   = is_active ?? isValid         ?? true
//
// `??` is deliberately not `||`: a present-but-falsy value (0, false, "")
// stops the chain. That distinction matters for `is_active: false` (an
// explicitly invalid account) and `remaining: 0` (an exhausted wallet).
//
// This is the shared parse seam for relay providers that use this contract
// (FastAI, MorphAPI). Both expose the panel balance as a one-time subscription
//额度 query; neither has a windowed usage endpoint.

// firstPresent mirrors JS `a ?? b ?? c` over decoded JSON values: a missing key
// or JSON null falls through, any other value (including false / 0 / "") wins.
func firstPresent(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

// relayQuota is the normalized额度 of a ccswitch-style /v1/usage response.
// It intentionally carries only the fields the extractor contract defines;
// provider-specific extras belong in that provider's own handler.
type relayQuota struct {
	remaining float64
	unit      string
	planName  string
	isValid   bool
}

// parseRelayQuota implements the ccswitch extractor over a decoded response.
func parseRelayQuota(data map[string]any) relayQuota {
	quota, _ := data["quota"].(map[string]any)

	q := relayQuota{}
	q.remaining = numberOrZero(firstPresent(data["remaining"], quota["remaining"], data["balance"]))

	if unit := firstPresent(data["unit"], quota["unit"]); unit != nil {
		q.unit, _ = unit.(string)
	}
	if q.unit == "" {
		q.unit = "USD"
	}

	// `?? true`: absent defaults to valid, but an explicit false
	// (is_active / isValid) must survive — hence the nil check, not jsTruthy
	// over the whole chain.
	q.isValid = true
	if valid := firstPresent(data["is_active"], data["isValid"]); valid != nil {
		q.isValid = jsTruthy(valid)
	}

	q.planName, _ = data["planName"].(string)
	if q.planName == "" {
		q.planName = "余额"
	}
	return q
}
