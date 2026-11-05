package providers

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

// TestDefaultProvidersJSONMatchesOldStack pins the registry's JSON bytes to the
// old stack's `JSON.stringify(defaultProviders)` output (captured under
// testdata/), covering the "API JSON shape byte-aligned with the old stack"
// acceptance criterion for the static registry data.
//
// The encoding must disable HTML escaping: the old stack emits raw `&` in the
// fangzhou model-list URLs, which Go would otherwise turn into &.
func TestDefaultProvidersJSONMatchesOldStack(t *testing.T) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(DefaultProviders()); err != nil {
		t.Fatalf("encode: %v", err)
	}
	got := bytes.TrimRight(buf.Bytes(), "\n")

	want, err := os.ReadFile("testdata/old_stack_providers.json")
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("registry JSON differs from old stack\n got: %s\nwant: %s", got, want)
	}
}
