package httpapi

// Route parity for the tool-catalog surface (#35). The old stack's
// app/api/tools/** handlers had no route tests of their own, so these cases
// lock the contract the SPA consumes: response shapes, status codes and the
// Chinese/English error bodies that lib/tools.ts produced.

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func decodeObject(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decode %q: %v", raw, err)
	}
	return body
}

func TestToolRoutesRoundTrip(t *testing.T) {
	srv, session, _ := newSubscriptionRouter(t)

	list := request(t, srv, http.MethodGet, "/api/tools", "", session)
	if list.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", list.Code, list.Body.String())
	}
	if got, want := list.Body.String(), `[]`; got != want {
		t.Fatalf("body = %q, want %q (the old route returned the tool list directly)", got, want)
	}

	created := request(t, srv, http.MethodPost, "/api/tools", `{
		"name": " Claude Code ",
		"category": "AI助手",
		"provider": "anthropic",
		"forms": ["CLI / TUI", "Web"],
		"isOpenSource": true,
		"repoUrl": "https://github.com/anthropics/claude-code?a=1&b=2",
		"notes": " 主力工具 "
	}`, session)
	if created.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%q)", created.Code, created.Body.String())
	}
	tool := decodeObject(t, created.Body.Bytes())
	if tool["name"] != "Claude Code" || tool["notes"] != "主力工具" {
		t.Fatalf("body = %s, want trimmed name and notes", created.Body.String())
	}
	if tool["status"] != "active" || tool["order"] != float64(1) || tool["isOpenSource"] != true {
		t.Fatalf("body = %s, want active status, order 1, isOpenSource true", created.Body.String())
	}
	if !strings.Contains(created.Body.String(), "a=1&b=2") {
		t.Fatalf("body = %s, want the repo URL unescaped", created.Body.String())
	}
	id, _ := tool["id"].(string)

	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{"name", `{"name":"  ","category":"AI助手","provider":"anthropic"}`, "Tool name is required"},
		{"category", `{"name":"X","category":" ","provider":"anthropic"}`, "Tool category is required"},
		{"provider", `{"name":"X","category":"AI助手","provider":""}`, "Tool provider is required"},
		{"repo", `{"name":"X","category":"AI助手","provider":"anthropic","repoUrl":"ftp://x"}`, "Repository URL must be a valid HTTP or HTTPS URL"},
	} {
		rec := request(t, srv, http.MethodPost, "/api/tools", tc.body, session)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400 (body=%q)", tc.name, rec.Code, rec.Body.String())
		}
		if got := decodeObject(t, rec.Body.Bytes())["error"]; got != tc.want {
			t.Fatalf("%s: error = %v, want %q", tc.name, got, tc.want)
		}
	}

	got := request(t, srv, http.MethodGet, "/api/tools/"+id, "", session)
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", got.Code)
	}
	missing := request(t, srv, http.MethodGet, "/api/tools/missing", "", session)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", missing.Code)
	}
	if got := decodeObject(t, missing.Body.Bytes())["error"]; got != "Tool not found" {
		t.Fatalf("error = %v", got)
	}

	updated := request(t, srv, http.MethodPut, "/api/tools/"+id, `{"status":"paused"}`, session)
	if updated.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", updated.Code, updated.Body.String())
	}
	if decodeObject(t, updated.Body.Bytes())["status"] != "paused" {
		t.Fatalf("body = %s, want status paused", updated.Body.String())
	}

	blankName := request(t, srv, http.MethodPut, "/api/tools/"+id, `{"name":"  "}`, session)
	if blankName.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", blankName.Code)
	}
	if got := decodeObject(t, blankName.Body.Bytes())["error"]; got != "Tool name must be a non-empty string" {
		t.Fatalf("error = %v", got)
	}

	blankCategory := request(t, srv, http.MethodPut, "/api/tools/"+id, `{"category":""}`, session)
	if blankCategory.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", blankCategory.Code)
	}
	if got := decodeObject(t, blankCategory.Body.Bytes())["error"]; got != "Tool category must be a non-empty string" {
		t.Fatalf("error = %v", got)
	}

	badURL := request(t, srv, http.MethodPut, "/api/tools/"+id, `{"repoUrl":"javascript:alert(1)"}`, session)
	if badURL.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", badURL.Code)
	}
	if got := decodeObject(t, badURL.Body.Bytes())["error"]; got != "Repository URL must be a valid HTTP or HTTPS URL" {
		t.Fatalf("error = %v", got)
	}

	clearedURL := request(t, srv, http.MethodPut, "/api/tools/"+id, `{"repoUrl":""}`, session)
	if clearedURL.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (empty repoUrl clears the field)", clearedURL.Code)
	}
	if _, present := decodeObject(t, clearedURL.Body.Bytes())["repoUrl"]; present {
		t.Fatalf("body = %s, want repoUrl omitted when empty", clearedURL.Body.String())
	}

	second := request(t, srv, http.MethodPost, "/api/tools",
		`{"name":"Cursor","category":"AI助手","provider":"other"}`, session)
	if second.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", second.Code)
	}
	secondID, _ := decodeObject(t, second.Body.Bytes())["id"].(string)

	reordered := request(t, srv, http.MethodPatch, "/api/tools",
		`{"toolIds":["`+secondID+`","`+id+`"]}`, session)
	if reordered.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", reordered.Code, reordered.Body.String())
	}
	var tools []map[string]any
	if err := json.Unmarshal(reordered.Body.Bytes(), &tools); err != nil {
		t.Fatalf("decode %q: %v", reordered.Body.String(), err)
	}
	if len(tools) != 2 || tools[0]["id"] != secondID || tools[0]["order"] != float64(0) {
		t.Fatalf("body = %s, want the reordered list with the first tool at order 0", reordered.Body.String())
	}

	notList := request(t, srv, http.MethodPatch, "/api/tools", `{"toolIds":"x"}`, session)
	if notList.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", notList.Code)
	}
	if got := decodeObject(t, notList.Body.Bytes())["error"]; got != "toolIds array is required" {
		t.Fatalf("error = %v", got)
	}

	deleted := request(t, srv, http.MethodDelete, "/api/tools/"+id, "", session)
	if deleted.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", deleted.Code)
	}
	if got, want := deleted.Body.String(), `{"success":true}`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}
	deleteMissing := request(t, srv, http.MethodDelete, "/api/tools/"+id, "", session)
	if deleteMissing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", deleteMissing.Code)
	}
}
