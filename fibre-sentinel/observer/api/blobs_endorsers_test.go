package api_test

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/plsgiveup/fibre/fibre-sentinel/observer/api"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// /v1/blobs?endorsers=1 gives each blob its endorsers: the validators with
// rows whose signature on the settlement verified, the ones
// attested_with_rows counts, by consensus address in lower case; a blob none
// endorsed has an empty list. Without it the list is byte for byte what it
// was, and a value other than 0 or 1 is refused.
func TestBlobsListEndorsers(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "observer.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	now := time.Now().UTC()
	hash := func(idx int) string { return fmt.Sprintf("%064x", 0x5a0000+idx) }
	insertPublication(t, st, 1, 900, now.Add(-time.Minute), "aa", "alice", 10)
	insertPublication(t, st, 2, 901, now, "aa", "alice", 10)
	assign := func(idx int, val string, rows int, attested any) {
		t.Helper()
		if _, err := st.DB().Exec(`INSERT INTO assignments (promise_hash, validator_address, voting_power, row_count, rows_json, attested, settlement_height)
			VALUES (?, ?, 10, ?, '[]', ?, 900)`, hash(idx), val, rows, attested); err != nil {
			t.Fatal(err)
		}
	}
	// blob 1: two endorsers with rows, one signer without rows, one that did not sign, one before signatures were verified
	assign(1, "BB00000000000000000000000000000000000002", 12, 1)
	assign(1, "aa00000000000000000000000000000000000001", 9, 1)
	assign(1, "cc00000000000000000000000000000000000003", 0, 1)
	assign(1, "dd00000000000000000000000000000000000004", 7, 0)
	assign(1, "ee00000000000000000000000000000000000005", 7, nil)
	// blob 2: none endorsed
	assign(2, "aa00000000000000000000000000000000000001", 9, 0)

	srv := api.NewWithVantage(st, api.VantageInfo{Name: "test"}, nil)
	defer srv.Close()
	get := func(path string) (int, string) {
		t.Helper()
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec.Code, rec.Body.String()
	}

	code, plain := get("/v1/blobs?limit=10")
	if code != 200 || strings.Contains(plain, "endorsers") {
		t.Fatalf("without the parameter: %d %s", code, plain)
	}
	if _, zero := get("/v1/blobs?limit=10&endorsers=0"); zero != plain {
		t.Errorf("endorsers=0 is not the list as it was:\n%s\n%s", zero, plain)
	}

	code, with := get("/v1/blobs?limit=10&endorsers=1")
	if code != 200 {
		t.Fatalf("%d %s", code, with)
	}
	var page struct {
		Blobs []map[string]any `json:"blobs"`
	}
	if err := json.Unmarshal([]byte(with), &page); err != nil {
		t.Fatal(err)
	}
	want := map[string][]any{
		hash(1): {"aa00000000000000000000000000000000000001", "bb00000000000000000000000000000000000002"},
		hash(2): {},
	}
	for _, b := range page.Blobs {
		h, _ := b["promise_hash"].(string)
		got, ok := b["endorsers"].([]any)
		if !ok || !reflect.DeepEqual(got, want[h]) {
			t.Errorf("blob %s endorsers %v, want %v", h, b["endorsers"], want[h])
		}
	}
	// and nothing else changes: the same list once the endorsers are taken out
	var a, b map[string]any
	if err := json.Unmarshal([]byte(plain), &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(with), &b); err != nil {
		t.Fatal(err)
	}
	for _, x := range b["blobs"].([]any) {
		delete(x.(map[string]any), "endorsers")
	}
	if !reflect.DeepEqual(a, b) {
		t.Errorf("the list with its endorsers taken out is not the list:\n%v\n%v", a, b)
	}

	if code, body := get("/v1/blobs?endorsers=yes"); code != 400 || !strings.Contains(body, "endorsers must be 0 or 1") {
		t.Errorf("a bad value: %d %s", code, body)
	}
}
