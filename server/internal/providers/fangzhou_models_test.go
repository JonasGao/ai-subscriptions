package providers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// Port of __tests__/fangzhou-models.test.ts (15 cases):
// fetchFangzhouModels (8) + fetchAgentPlanModels (4) + fetchCodingPlanModels (3).

// recordingDoer captures the outgoing request and returns a canned response.
type recordingDoer struct {
	response *http.Response
	err      error
	captured *http.Request
	body     string
}

func (r *recordingDoer) Do(req *http.Request) (*http.Response, error) {
	r.captured = req
	if r.body == "" {
		defer req.Body.Close()
		data, _ := io.ReadAll(req.Body)
		r.body = string(data)
	}
	if r.err != nil {
		return nil, r.err
	}
	if r.response != nil {
		return r.response, nil
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader("{}")),
		Header:     make(http.Header),
	}, nil
}

// sequenceDoer returns a different canned response per call.
type sequenceDoer struct {
	responses []*http.Response
	callCount int
}

func (s *sequenceDoer) Do(*http.Request) (*http.Response, error) {
	if s.callCount >= len(s.responses) {
		return &http.Response{
			StatusCode: 500,
			Status:     "500 Internal Server Error",
			Body:       io.NopCloser(strings.NewReader("{}")),
			Header:     make(http.Header),
		}, nil
	}
	resp := s.responses[s.callCount]
	s.callCount++
	return resp, nil
}

func modelResponse(body string, status int) *http.Response {
	statusText := http.StatusText(status)
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, statusText),
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
}

// ── fetchFangzhouModels (8 examples) ─────────────────────────────────────────

func TestFangzhouModels_ThrowsWhenAKSKIsMissing(t *testing.T) {
	_, err := FetchFangzhouModels(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{})
	if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
		t.Errorf("err = %v, want containing \"AK/SK not configured\"", err)
	}
	_, err = FetchFangzhouModels(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{"ak": "", "sk": "x"})
	if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
		t.Errorf("err = %v, want containing \"AK/SK not configured\"", err)
	}
}

func TestFangzhouModels_FetchesSinglePageAndExtractsItemNames(t *testing.T) {
	body := `{"ResponseMetadata":{"RequestId":"abc-123","Action":"ListFoundationModels"},"Result":{"Items":[{"Name":"doubao-pro-32k","DisplayName":"Doubao Pro 32K"},{"Name":"doubao-lite-32k","DisplayName":"Doubao Lite 32K"}],"TotalCount":2,"PageNumber":1,"PageSize":20}}`
	rec := &recordingDoer{response: modelResponse(body, 200)}
	models, err := FetchFangzhouModels(context.Background(), rec, map[string]string{"ak": "test-ak", "sk": "test-sk"})
	if err != nil {
		t.Fatalf("FetchFangzhouModels: %v", err)
	}
	want := []string{"doubao-pro-32k", "doubao-lite-32k"}
	if len(models) != len(want) {
		t.Fatalf("models = %v, want %v", models, want)
	}
	for i := range want {
		if models[i] != want[i] {
			t.Errorf("models[%d] = %q, want %q", i, models[i], want[i])
		}
	}

	if rec.captured == nil {
		t.Fatal("no request captured")
	}
	if !strings.Contains(rec.captured.URL.String(), "Action=ListFoundationModels") {
		t.Errorf("url = %q, want Action=ListFoundationModels", rec.captured.URL.String())
	}
	if !strings.Contains(rec.captured.URL.String(), "Version=2024-01-01") {
		t.Errorf("url = %q, want Version=2024-01-01", rec.captured.URL.String())
	}
	if auth := rec.captured.Header.Get("Authorization"); !strings.Contains(auth, "HMAC-SHA256") {
		t.Errorf("Authorization = %q, want HMAC-SHA256", auth)
	}
}

func TestFangzhouModels_PaginatesToFetchAllModels(t *testing.T) {
	page1 := `{"ResponseMetadata":{"RequestId":"1"},"Result":{"Items":[{"Name":"model-a"},{"Name":"model-b"}],"TotalCount":5,"PageNumber":1,"PageSize":2}}`
	page2 := `{"ResponseMetadata":{"RequestId":"2"},"Result":{"Items":[{"Name":"model-c"},{"Name":"model-d"}],"TotalCount":5,"PageNumber":2,"PageSize":2}}`
	page3 := `{"ResponseMetadata":{"RequestId":"3"},"Result":{"Items":[{"Name":"model-e"}],"TotalCount":5,"PageNumber":3,"PageSize":2}}`

	seq := &sequenceDoer{responses: []*http.Response{
		modelResponse(page1, 200),
		modelResponse(page2, 200),
		modelResponse(page3, 200),
	}}
	models, err := FetchFangzhouModels(context.Background(), seq, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchFangzhouModels: %v", err)
	}
	want := []string{"model-a", "model-b", "model-c", "model-d", "model-e"}
	if len(models) != len(want) {
		t.Fatalf("models = %v, want %v", models, want)
	}
	for i := range want {
		if models[i] != want[i] {
			t.Errorf("models[%d] = %q, want %q", i, models[i], want[i])
		}
	}
	if seq.callCount != 3 {
		t.Errorf("callCount = %d, want 3", seq.callCount)
	}
}

func TestFangzhouModels_StopsAtDefensiveLimitOf1000Items(t *testing.T) {
	// Each page returns 100 items and TotalCount=2000; pagination should stop
	// at 1000 items after 10 pages.
	makePage := func(pageNumber int) string {
		var items []string
		for i := 0; i < 100; i++ {
			items = append(items, fmt.Sprintf(`{"Name":"model-%d-%d"}`, pageNumber, i))
		}
		return fmt.Sprintf(`{"ResponseMetadata":{"RequestId":"%d"},"Result":{"Items":[%s],"TotalCount":2000,"PageNumber":%d,"PageSize":100}}`,
			pageNumber, strings.Join(items, ","), pageNumber)
	}

	seq := &sequenceDoer{}
	for i := 1; i <= 10; i++ {
		seq.responses = append(seq.responses, modelResponse(makePage(i), 200))
	}
	models, err := FetchFangzhouModels(context.Background(), seq, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchFangzhouModels: %v", err)
	}
	if len(models) != 1000 {
		t.Errorf("len(models) = %d, want 1000", len(models))
	}
	if seq.callCount != 10 {
		t.Errorf("callCount = %d, want 10", seq.callCount)
	}
}

func TestFangzhouModels_ReturnsEmptyArrayWhenItemsIsMissing(t *testing.T) {
	body := `{"ResponseMetadata":{"RequestId":"1"},"Result":{}}`
	models, err := FetchFangzhouModels(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchFangzhouModels: %v", err)
	}
	if len(models) != 0 {
		t.Errorf("models = %v, want empty", models)
	}
}

func TestFangzhouModels_ReturnsEmptyArrayWhenResultIsMissing(t *testing.T) {
	body := `{"ResponseMetadata":{"RequestId":"1"}}`
	models, err := FetchFangzhouModels(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"})
	if err != nil {
		t.Fatalf("FetchFangzhouModels: %v", err)
	}
	if len(models) != 0 {
		t.Errorf("models = %v, want empty", models)
	}
}

func TestFangzhouModels_ThrowsOnNon2xxResponse(t *testing.T) {
	_, err := FetchFangzhouModels(context.Background(), cannedHTTPDoer{statusCode: 403, body: `{"message":"forbidden"}`}, map[string]string{"ak": "a", "sk": "s"})
	if err == nil || !strings.Contains(err.Error(), "ListFoundationModels API returned 403") {
		t.Errorf("err = %v, want containing \"ListFoundationModels API returned 403\"", err)
	}
}

func TestFangzhouModels_SendsProperV4SignedHeaders(t *testing.T) {
	body := `{"ResponseMetadata":{"RequestId":"1"},"Result":{"Items":[{"Name":"model-a"}],"TotalCount":1,"PageNumber":1,"PageSize":20}}`
	rec := &recordingDoer{response: modelResponse(body, 200)}
	_, err := FetchFangzhouModels(context.Background(), rec, map[string]string{"ak": "test-ak", "sk": "test-sk"})
	if err != nil {
		t.Fatalf("FetchFangzhouModels: %v", err)
	}
	if rec.captured == nil {
		t.Fatal("no request captured")
	}
	if ct := rec.captured.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if sha := rec.captured.Header.Get("X-Content-Sha256"); sha == "" {
		t.Error("X-Content-Sha256 is empty")
	}
	if date := rec.captured.Header.Get("X-Date"); date == "" {
		t.Error("X-Date is empty")
	}
	if auth := rec.captured.Header.Get("Authorization"); !strings.Contains(auth, "HMAC-SHA256 Credential=test-ak") {
		t.Errorf("Authorization = %q, want HMAC-SHA256 Credential=test-ak", auth)
	}
}

// ── fetchAgentPlanModels (4 examples) ───────────────────────────────────────

func TestAgentPlanModels_ThrowsWhenAKSKIsMissing(t *testing.T) {
	_, err := fetchPlanModels(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{}, fangzhouAgentPlanModelsURL, "ListAgentPlanLatestModel")
	if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
		t.Errorf("err = %v, want containing \"AK/SK not configured\"", err)
	}
}

func TestAgentPlanModels_CallsListAgentPlanLatestModelAndExtractsModelNames(t *testing.T) {
	body := `{"ResponseMetadata":{"RequestId":"test-req"},"Result":{"Data":[{"ModelId":"doubao-seed-2-1-pro-260915","ModelName":"doubao-seed-2-1-pro","Enabled":true},{"ModelId":"auto-id","ModelName":"","Enabled":false},{"ModelId":"auto","ModelName":"auto","Enabled":false}]}}`
	rec := &recordingDoer{response: modelResponse(body, 200)}
	models, err := fetchPlanModels(context.Background(), rec, map[string]string{"ak": "a", "sk": "s"}, fangzhouAgentPlanModelsURL, "ListAgentPlanLatestModel")
	if err != nil {
		t.Fatalf("fetchPlanModels: %v", err)
	}
	want := []string{"doubao-seed-2-1-pro", "auto-id", "auto"}
	if len(models) != len(want) {
		t.Fatalf("models = %v, want %v", models, want)
	}
	for i := range want {
		if models[i] != want[i] {
			t.Errorf("models[%d] = %q, want %q", i, models[i], want[i])
		}
	}

	if rec.captured == nil {
		t.Fatal("no request captured")
	}
	if !strings.Contains(rec.captured.URL.String(), "Action=ListAgentPlanLatestModel") {
		t.Errorf("url = %q, want Action=ListAgentPlanLatestModel", rec.captured.URL.String())
	}
	if !strings.Contains(rec.captured.URL.String(), "Version=2024-01-01") {
		t.Errorf("url = %q, want Version=2024-01-01", rec.captured.URL.String())
	}
	if !strings.Contains(rec.captured.URL.String(), "open.volcengineapi.com") {
		t.Errorf("url = %q, want open.volcengineapi.com", rec.captured.URL.String())
	}
	if rec.captured.Method != http.MethodPost {
		t.Errorf("method = %q, want POST", rec.captured.Method)
	}
}

func TestAgentPlanModels_ReturnsEmptyArrayWhenDataIsMissing(t *testing.T) {
	body := `{"ResponseMetadata":{"RequestId":"1"},"Result":{}}`
	models, err := fetchPlanModels(context.Background(), cannedHTTPDoer{body: body}, map[string]string{"ak": "a", "sk": "s"}, fangzhouAgentPlanModelsURL, "ListAgentPlanLatestModel")
	if err != nil {
		t.Fatalf("fetchPlanModels: %v", err)
	}
	if len(models) != 0 {
		t.Errorf("models = %v, want empty", models)
	}
}

func TestAgentPlanModels_ThrowsOnNon2xxResponse(t *testing.T) {
	_, err := fetchPlanModels(context.Background(), cannedHTTPDoer{statusCode: 403, body: `{"message":"forbidden"}`}, map[string]string{"ak": "a", "sk": "s"}, fangzhouAgentPlanModelsURL, "ListAgentPlanLatestModel")
	if err == nil || !strings.Contains(err.Error(), "ListAgentPlanLatestModel API returned 403") {
		t.Errorf("err = %v, want containing \"ListAgentPlanLatestModel API returned 403\"", err)
	}
}

// ── fetchCodingPlanModels (3 examples) ──────────────────────────────────────

func TestCodingPlanModels_ThrowsWhenAKSKIsMissing(t *testing.T) {
	_, err := fetchPlanModels(context.Background(), cannedHTTPDoer{body: "{}"}, map[string]string{}, fangzhouCodingPlanModelsURL, "ListArkCodeLatestModel")
	if err == nil || !strings.Contains(err.Error(), "AK/SK not configured") {
		t.Errorf("err = %v, want containing \"AK/SK not configured\"", err)
	}
}

func TestCodingPlanModels_CallsListArkCodeLatestModelAndExtractsModelNames(t *testing.T) {
	body := `{"ResponseMetadata":{"RequestId":"test-req"},"Result":{"Data":[{"ModelId":"doubao-seed-2-1-pro-260915","ModelName":"doubao-seed-2-1-pro","Enabled":true},{"ModelId":"deepseek-v4-1-flash-260910","ModelName":"deepseek-v4-1-flash"}]}}`
	rec := &recordingDoer{response: modelResponse(body, 200)}
	models, err := fetchPlanModels(context.Background(), rec, map[string]string{"ak": "a", "sk": "s"}, fangzhouCodingPlanModelsURL, "ListArkCodeLatestModel")
	if err != nil {
		t.Fatalf("fetchPlanModels: %v", err)
	}
	want := []string{"doubao-seed-2-1-pro", "deepseek-v4-1-flash"}
	if len(models) != len(want) {
		t.Fatalf("models = %v, want %v", models, want)
	}
	for i := range want {
		if models[i] != want[i] {
			t.Errorf("models[%d] = %q, want %q", i, models[i], want[i])
		}
	}

	if rec.captured == nil {
		t.Fatal("no request captured")
	}
	if !strings.Contains(rec.captured.URL.String(), "Action=ListArkCodeLatestModel") {
		t.Errorf("url = %q, want Action=ListArkCodeLatestModel", rec.captured.URL.String())
	}
	if !strings.Contains(rec.captured.URL.String(), "Version=2024-01-01") {
		t.Errorf("url = %q, want Version=2024-01-01", rec.captured.URL.String())
	}
	if !strings.Contains(rec.captured.URL.String(), "open.volcengineapi.com") {
		t.Errorf("url = %q, want open.volcengineapi.com", rec.captured.URL.String())
	}
	if rec.captured.Method != http.MethodPost {
		t.Errorf("method = %q, want POST", rec.captured.Method)
	}
}

func TestCodingPlanModels_ThrowsOnNon2xxResponse(t *testing.T) {
	_, err := fetchPlanModels(context.Background(), cannedHTTPDoer{statusCode: 500, body: `{"message":"error"}`}, map[string]string{"ak": "a", "sk": "s"}, fangzhouCodingPlanModelsURL, "ListArkCodeLatestModel")
	if err == nil || !strings.Contains(err.Error(), "ListArkCodeLatestModel API returned 500") {
		t.Errorf("err = %v, want containing \"ListArkCodeLatestModel API returned 500\"", err)
	}
}

// compile-time guards for test doubles.
var (
	_ HTTPDoer = (*recordingDoer)(nil)
	_ HTTPDoer = (*sequenceDoer)(nil)
)
