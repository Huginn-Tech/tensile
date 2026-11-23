package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/plsgiveup/fibre/fibre-sentinel/internal/scan"
)

// price_formula as /v1/params has served it since it was first published,
// byte for byte, and as it is served from app version 12.
const (
	formulaThrough11 = `{"base_gas":650000,"gas_per_chunk":45000,"chunk_bytes":262144,"utia_per_gas":1,"note":"fee = (base_gas + gas_per_chunk × ⌈blob_size / chunk_bytes⌉) × utia_per_gas; the same charge whether the promise is settled or timed out"}`
	formulaFrom12    = `{"base_gas":650000,"gas_per_chunk":45000,"chunk_bytes":262144,"utia_per_gas":1,"note":"gas = base_gas + gas_per_chunk × ⌈blob_size / chunk_bytes⌉; fee = ⌈gas × utia_per_gas_numerator / utia_per_gas_denominator⌉ utia in blocks from app version 12, gas × utia_per_gas utia in blocks through app version 11; the same charge whether the promise is settled or timed out","from_app_version":12,"utia_per_gas_numerator":4,"utia_per_gas_denominator":1000,"rounding":"ceil"}`
)

// paramsRaw is the /v1/params body as served, and the bytes of its
// price_formula.
func paramsRaw(t *testing.T, ts *httptest.Server) (body, formula string) {
	t.Helper()
	resp, err := http.Get(ts.URL + "/v1/params")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("params: status %d, err %v", resp.StatusCode, err)
	}
	var p struct {
		Formula json.RawMessage `json:"price_formula"`
	}
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatalf("params: decode: %v", err)
	}
	return string(b), string(p.Formula)
}

// Through app version 11, and while the chain's version is not on record
// or does not parse, price_formula is what it always was, byte for byte,
// and so is the whole body: an installer compares /v1/params before and
// after.
func TestPriceFormulaThroughAppVersion11IsUnchanged(t *testing.T) {
	ts, st := paramsServer(t)
	before, f := paramsRaw(t, ts)
	if f != formulaThrough11 {
		t.Fatalf("no app version on record:\n got %s\nwant %s", f, formulaThrough11)
	}
	for _, v := range []string{"10", "11", "", "v12", "12.0", "-12", "twelve"} {
		if err := st.SetMeta("app_version", v, time.Now()); err != nil {
			t.Fatal(err)
		}
		body, f := paramsRaw(t, ts)
		if f != formulaThrough11 {
			t.Fatalf("app_version %q:\n got %s\nwant %s", v, f, formulaThrough11)
		}
		if body != before {
			t.Fatalf("app_version %q changed /v1/params:\n got %s\nwant %s", v, body, before)
		}
	}
}

// From app version 12 the formula carries the rate that version charges at,
// 0.004 utia per gas as a fraction, rounded up to the whole utia, after the
// fields it always had, which stay as they were. A later version keeps it.
func TestPriceFormulaFromAppVersion12(t *testing.T) {
	ts, st := paramsServer(t)
	for _, v := range []string{"12", "13"} {
		if err := st.SetMeta("app_version", v, time.Now()); err != nil {
			t.Fatal(err)
		}
		if _, f := paramsRaw(t, ts); f != formulaFrom12 {
			t.Fatalf("app_version %s:\n got %s\nwant %s", v, f, formulaFrom12)
		}
	}
	var p struct {
		Formula struct {
			BaseGas     uint64 `json:"base_gas"`
			GasPerChunk uint64 `json:"gas_per_chunk"`
			ChunkBytes  uint64 `json:"chunk_bytes"`
			UtiaPerGas  uint64 `json:"utia_per_gas"`
			From        uint64 `json:"from_app_version"`
			Numerator   uint64 `json:"utia_per_gas_numerator"`
			Denominator uint64 `json:"utia_per_gas_denominator"`
			Rounding    string `json:"rounding"`
		} `json:"price_formula"`
	}
	if code := get(t, ts, "/v1/params", &p); code != 200 {
		t.Fatalf("params: %d", code)
	}
	f := p.Formula
	// the gate is the scanner's: the version whose blocks it charges at
	// this rate
	if f.From != scan.MinGasPriceAppVersion || f.Rounding != "ceil" || f.Denominator == 0 {
		t.Fatalf("formula: %+v", f)
	}
	// A reader's arithmetic on the published fields gives what the module
	// charges at each rate: 256 KiB, 1 MiB, 16 MiB and the largest blob.
	for _, c := range []struct{ size, through11, from12 uint64 }{
		{262144, 695_000, 2_780},
		{1 << 20, 830_000, 3_320},
		{16 << 20, 3_530_000, 14_120},
		{128 << 20, 23_690_000, 94_760},
	} {
		chunks := (c.size + f.ChunkBytes - 1) / f.ChunkBytes
		gas := f.BaseGas + f.GasPerChunk*chunks
		if got := gas * f.UtiaPerGas; got != c.through11 {
			t.Errorf("%d bytes through app version 11: %d utia, want %d", c.size, got, c.through11)
		}
		if got := (gas*f.Numerator + f.Denominator - 1) / f.Denominator; got != c.from12 {
			t.Errorf("%d bytes from app version 12: %d utia, want %d", c.size, got, c.from12)
		}
	}
	// and a chain that is back below it (another network's store) gets the
	// earlier formula again
	if err := st.SetMeta("app_version", "11", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, f := paramsRaw(t, ts); f != formulaThrough11 {
		t.Fatalf("app_version 11 after 12:\n got %s\nwant %s", f, formulaThrough11)
	}
}
