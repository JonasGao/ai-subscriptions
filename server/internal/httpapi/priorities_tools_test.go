package httpapi

// Route parity for the priority-scene, tool-priority-scene and tool surfaces
// (#35). The old stack's app/api/{priorities,tool-priorities,tools}/** handlers
// had no route tests of their own, so these cases lock the contract the SPA
// consumes: response shapes, status codes and the Chinese/English error bodies
// that lib/priority-scene.ts and lib/tools.ts produced.

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

func TestPrioritySceneRoutesRoundTrip(t *testing.T) {
	srv, session, _ := newSubscriptionRouter(t)

	list := request(t, srv, http.MethodGet, "/api/priorities", "", session)
	if list.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", list.Code, list.Body.String())
	}
	if got, want := list.Body.String(), `{"scenes":[]}`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	created := request(t, srv, http.MethodPost, "/api/priorities", `{"name":" 工作 "}`, session)
	if created.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%q)", created.Code, created.Body.String())
	}
	scene := decodeObject(t, created.Body.Bytes())
	if scene["name"] != "工作" {
		t.Fatalf("name = %v, want trimmed", scene["name"])
	}
	order, ok := scene["subscriptionOrder"].([]any)
	if !ok || len(order) != 0 {
		t.Fatalf("subscriptionOrder = %v, want empty array", scene["subscriptionOrder"])
	}

	blank := request(t, srv, http.MethodPost, "/api/priorities", `{"name":"   "}`, session)
	if blank.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", blank.Code)
	}
	if got := decodeObject(t, blank.Body.Bytes())["error"]; got != "Scene name is required" {
		t.Fatalf("error = %v", got)
	}

	duplicate := request(t, srv, http.MethodPost, "/api/priorities", `{"name":"工作"}`, session)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%q)", duplicate.Code, duplicate.Body.String())
	}
	if got := decodeObject(t, duplicate.Body.Bytes())["error"]; got != "Scene name already exists" {
		t.Fatalf("error = %v", got)
	}

	broken := request(t, srv, http.MethodPost, "/api/priorities", `{"name":`, session)
	if broken.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", broken.Code)
	}
	if got := decodeObject(t, broken.Body.Bytes())["error"]; got != "Invalid JSON in request body" {
		t.Fatalf("error = %v", got)
	}

	id, _ := scene["id"].(string)
	got := request(t, srv, http.MethodGet, "/api/priorities/"+id, "", session)
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", got.Code)
	}
	if decodeObject(t, got.Body.Bytes())["id"] != id {
		t.Fatalf("body = %s, want the created scene", got.Body.String())
	}

	missing := request(t, srv, http.MethodGet, "/api/priorities/missing", "", session)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", missing.Code)
	}
	if got := decodeObject(t, missing.Body.Bytes())["error"]; got != "Priority scene not found" {
		t.Fatalf("error = %v", got)
	}

	renamed := request(t, srv, http.MethodPut, "/api/priorities/"+id, `{"name":"工作二"}`, session)
	if renamed.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", renamed.Code, renamed.Body.String())
	}
	if decodeObject(t, renamed.Body.Bytes())["name"] != "工作二" {
		t.Fatalf("body = %s, want the new name", renamed.Body.String())
	}

	blankRename := request(t, srv, http.MethodPut, "/api/priorities/"+id, `{"name":""}`, session)
	if blankRename.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", blankRename.Code)
	}
	if got := decodeObject(t, blankRename.Body.Bytes())["error"]; got != "Scene name must be a non-empty string" {
		t.Fatalf("error = %v", got)
	}

	putMissing := request(t, srv, http.MethodPut, "/api/priorities/missing", `{"name":"x"}`, session)
	if putMissing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", putMissing.Code)
	}

	patch := request(t, srv, http.MethodPatch, "/api/priorities/"+id,
		`{"action":"reorder","subscriptionOrder":["a","b"]}`, session)
	if patch.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", patch.Code, patch.Body.String())
	}
	patched := decodeObject(t, patch.Body.Bytes())
	patchedOrder, _ := patched["subscriptionOrder"].([]any)
	if len(patchedOrder) != 2 || patchedOrder[0] != "a" || patchedOrder[1] != "b" {
		t.Fatalf("subscriptionOrder = %v, want [a b]", patched["subscriptionOrder"])
	}

	notArray := request(t, srv, http.MethodPatch, "/api/priorities/"+id,
		`{"action":"reorder","subscriptionOrder":"a"}`, session)
	if notArray.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", notArray.Code)
	}
	if got := decodeObject(t, notArray.Body.Bytes())["error"]; got != "subscriptionOrder must be an array" {
		t.Fatalf("error = %v", got)
	}

	badAction := request(t, srv, http.MethodPatch, "/api/priorities/"+id, `{"action":"move"}`, session)
	if badAction.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", badAction.Code)
	}
	if got := decodeObject(t, badAction.Body.Bytes())["error"]; got != "Invalid action. Only reorder is supported" {
		t.Fatalf("error = %v", got)
	}

	patchMissing := request(t, srv, http.MethodPatch, "/api/priorities/missing",
		`{"action":"reorder","subscriptionOrder":[]}`, session)
	if patchMissing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", patchMissing.Code)
	}

	deleted := request(t, srv, http.MethodDelete, "/api/priorities/"+id, "", session)
	if deleted.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", deleted.Code)
	}
	if got, want := deleted.Body.String(), `{"success":true}`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	deleteMissing := request(t, srv, http.MethodDelete, "/api/priorities/"+id, "", session)
	if deleteMissing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", deleteMissing.Code)
	}
}

func TestToolPrioritySceneRoutesRoundTrip(t *testing.T) {
	srv, session, _ := newSubscriptionRouter(t)

	list := request(t, srv, http.MethodGet, "/api/tool-priorities", "", session)
	if got, want := list.Body.String(), `{"scenes":[]}`; got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	created := request(t, srv, http.MethodPost, "/api/tool-priorities", `{"name":"日常"}`, session)
	if created.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%q)", created.Code, created.Body.String())
	}
	scene := decodeObject(t, created.Body.Bytes())
	if _, ok := scene["toolOrder"].([]any); !ok {
		t.Fatalf("toolOrder = %v, want an array", scene["toolOrder"])
	}
	id, _ := scene["id"].(string)

	if got := request(t, srv, http.MethodPost, "/api/tool-priorities", `{"name":"日常"}`, session); got.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", got.Code)
	}
	if got := request(t, srv, http.MethodPost, "/api/tool-priorities", `{"name":" "}`, session); got.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", got.Code)
	}

	missing := request(t, srv, http.MethodGet, "/api/tool-priorities/missing", "", session)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", missing.Code)
	}
	if got := decodeObject(t, missing.Body.Bytes())["error"]; got != "Tool priority scene not found" {
		t.Fatalf("error = %v", got)
	}

	patch := request(t, srv, http.MethodPatch, "/api/tool-priorities/"+id,
		`{"action":"reorder","toolOrder":["t1","t2"]}`, session)
	if patch.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", patch.Code, patch.Body.String())
	}
	patched := decodeObject(t, patch.Body.Bytes())
	order, _ := patched["toolOrder"].([]any)
	if len(order) != 2 || order[0] != "t1" {
		t.Fatalf("toolOrder = %v, want [t1 t2]", patched["toolOrder"])
	}

	notArray := request(t, srv, http.MethodPatch, "/api/tool-priorities/"+id,
		`{"action":"reorder","toolOrder":"t1"}`, session)
	if notArray.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", notArray.Code)
	}
	if got := decodeObject(t, notArray.Body.Bytes())["error"]; got != "toolOrder must be an array" {
		t.Fatalf("error = %v", got)
	}

	badAction := request(t, srv, http.MethodPatch, "/api/tool-priorities/"+id, `{"action":"x"}`, session)
	if badAction.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", badAction.Code)
	}
	if got := decodeObject(t, badAction.Body.Bytes())["error"]; got != "Invalid action. Only reorder is supported" {
		t.Fatalf("error = %v", got)
	}

	deleted := request(t, srv, http.MethodDelete, "/api/tool-priorities/"+id, "", session)
	if deleted.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", deleted.Code)
	}
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
