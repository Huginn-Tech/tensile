package api

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// The tip names the newest endpoint registration or change of any validator,
// as endpoint_history words them: not a registration of the endpoint a
// validator already had, nor a change a scan gap hid. It is kept with the
// tip's answer and worked out again only when a registration is stored, or a
// minute on (a validator's new name), so the route every open page asks every
// second never walks the registrations per answer.
func TestTipNamesTheNewestEndpointEvent(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "observer.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	_ = st.SetMeta("chain_height", "1000", time.Now())
	var clk atomic.Int64
	clk.Store(time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC).UnixNano())
	srv := NewWithVantage(st, VantageInfo{Name: "test"}, nil, withClock(func() time.Time { return time.Unix(0, clk.Load()).UTC() }))
	defer srv.Close()

	// ask is one answer of the route, past the one kept before it
	ask := func() *tipEndpointEvent {
		t.Helper()
		clk.Add(int64(tipTTL))
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/tip", nil))
		var v tipResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		if v.LatestEndpointEvent == nil && strings.Contains(rec.Body.String(), "latest_endpoint_event") {
			t.Fatalf("an empty latest_endpoint_event is left out: %s", rec.Body.String())
		}
		return v.LatestEndpointEvent
	}
	at := func(h int64) string { return store.TS(time.Date(2026, 10, 17, 0, 0, int(h), 0, time.UTC)) }
	reg := func(h int64, fromTx int, addr, host, source string) {
		t.Helper()
		if _, err := st.DB().Exec(`INSERT INTO host_events (from_height, from_tx_index, cons_address, host, source, time) VALUES (?, ?, ?, ?, ?, ?)`,
			h, fromTx, addr, host, source, at(h)); err != nil {
			t.Fatal(err)
		}
	}
	name := func(addr, op, moniker string) {
		t.Helper()
		if _, err := st.DB().Exec(`INSERT INTO validator_identities (cons_address, operator_address, moniker, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			addr, op, moniker, at(1), at(1)); err != nil {
			t.Fatal(err)
		}
	}
	const valA, valB, valC = "aa00000000000000000000000000000000000001", "bb00000000000000000000000000000000000002", "cc00000000000000000000000000000000000003"

	if ev := ask(); ev != nil {
		t.Fatalf("no registration on record: %+v", ev)
	}
	// A's endpoint when the record began, and the same endpoint registered again
	reg(10, 0, valA, "10.0.0.1:7980", "seed")
	reg(20, 2, valA, "10.0.0.1:7980", "event")
	if ev := ask(); ev != nil {
		t.Fatalf("a registration of the endpoint A had is no event: %+v", ev)
	}

	// B registers its first endpoint, then A changes its own in a later block
	reg(30, 3, valB, "10.0.0.2:7980", "event")
	reg(40, 5, valA, "10.0.0.9:7980", "event")
	hash := strings.Repeat("AB", 32)
	if _, err := st.DB().Exec(`INSERT INTO tx_costs (height, tx_index, dedupe_key, tx_hash, time, raw_json) VALUES (40, 4, 'k40', ?, ?, '{}')`, hash, at(40)); err != nil {
		t.Fatal(err)
	}
	name(valA, "celestiavaloper1alpha", "DTEAM")
	want := tipEndpointEvent{Address: valA, OperatorAddress: "celestiavaloper1alpha", Moniker: "DTEAM", Outcome: endpointChanged,
		Host: "10.0.0.9:7980", PreviousHost: "10.0.0.1:7980", Height: 40, Time: at(40), TxHash: strings.ToLower(hash)}
	if ev := ask(); ev == nil || *ev != want {
		t.Fatalf("after A's change: %+v, want %+v", ev, want)
	}

	// a change a scan gap hid is not the newest event; C's first registration is
	reg(50, -1, valB, "10.0.0.3:7980", "reseed")
	if ev := ask(); ev == nil || *ev != want {
		t.Fatalf("after B's gap: %+v, want A's change", ev)
	}
	reg(60, 2, valC, "10.0.0.4:7980", "event")
	wantC := tipEndpointEvent{Address: valC, Outcome: endpointRegistered, Host: "10.0.0.4:7980", Height: 60, Time: at(60)}
	if ev := ask(); ev == nil || *ev != wantC {
		t.Fatalf("after C's registration: %+v, want %+v", ev, wantC)
	}

	// Kept: C's name, on record only now, is not looked up with every answer;
	// it is with the first a minute on.
	name(valC, "celestiavaloper1gamma", "Gamma")
	if ev := ask(); ev == nil || ev.Moniker != "" {
		t.Fatalf("the event was worked out again with no registration stored: %+v", ev)
	}
	clk.Add(int64(tipEndpointMaxAge))
	wantC.OperatorAddress, wantC.Moniker = "celestiavaloper1gamma", "Gamma"
	if ev := ask(); ev == nil || *ev != wantC {
		t.Fatalf("a minute on: %+v, want %+v", ev, wantC)
	}

	// C registers the same endpoint again: the mark moves, the event stays
	reg(70, 1, valC, "10.0.0.4:7980", "event")
	if ev := ask(); ev == nil || *ev != wantC {
		t.Fatalf("after C's same endpoint: %+v, want %+v", ev, wantC)
	}
}
