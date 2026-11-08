package api_test

import (
	"encoding/hex"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/cosmos/cosmos-sdk/types/bech32"

	"github.com/plsgiveup/fibre/fibre-sentinel/observer/api"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// vantageFixture is a store with this observer's own vantage "ut-1" and room
// for another vantage's rows beside it.
type vantageFixture struct {
	t   *testing.T
	st  *store.Store
	now time.Time
}

func newVantageFixture(t *testing.T) *vantageFixture {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "observer.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if err := st.SetMeta("chain_id", "mocha-test", time.Now()); err != nil {
		t.Fatal(err)
	}
	return &vantageFixture{t: t, st: st, now: time.Now().UTC()}
}

// beat stores one heartbeat from vantage, ago before now. tls is the
// handshake's result; identity follows it.
func (f *vantageFixture) beat(vantage, addr, host string, ago time.Duration, tls bool) {
	f.t.Helper()
	at := store.TS(f.now.Add(-ago))
	ok, outcome := 0, "TLS_HANDSHAKE_FAIL"
	if tls {
		ok, outcome = 1, "REACHABLE"
	}
	if _, err := f.st.DB().Exec(`INSERT INTO reachability (dedupe_key, vantage, validator_address, validator_host, height, scheduled_at, started_at,
		dns_ok, tcp_ok, tcp_ms, tls_ok, tls_ms, identity_ok, identity_reason, outcome, raw_error, total_duration_ms, raw_json)
		VALUES (?, ?, ?, ?, 1, ?, ?, 1, 1, 10, ?, 20, ?, '', ?, '', 30, '{}')`,
		vantage+"|"+addr+"|"+at+"|"+host, vantage, addr, host, at, at, ok, ok, outcome); err != nil {
		f.t.Fatal(err)
	}
}

// endpoint registers addr's Fibre host, so the census counts it.
func (f *vantageFixture) endpoint(addr, host string) {
	f.t.Helper()
	if _, err := f.st.DB().Exec(`INSERT INTO endpoints
		(validator_cons_address, host, first_seen_at, first_seen_height, last_seen_at, last_seen_height)
		VALUES (?, ?, ?, ?, ?, ?)`, addr, host, store.TS(f.now.Add(-3*time.Hour)), 99, store.TS(f.now), 99); err != nil {
		f.t.Fatal(err)
	}
}

func (f *vantageFixture) server() *httptest.Server {
	// A data dir of its own: snapshots persisted by an earlier server must
	// not be served in place of this one's.
	srv := api.NewWithVantage(f.st, api.VantageInfo{Name: "ut-1"}, nil, api.WithDataDir(f.t.TempDir()))
	ts := httptest.NewServer(srv)
	f.t.Cleanup(func() { ts.Close(); srv.Close() })
	return ts
}

type vantageValidator struct {
	V struct {
		Reachable       *bool   `json:"reachable"`
		EndpointState   string  `json:"endpoint_state"`
		Identity        string  `json:"identity_status"`
		ConfirmedFrom   string  `json:"confirmed_from"`
		AlsoFailedFrom  string  `json:"also_failed_from"`
		Reachability    rateOf  `json:"reachability_window"`
		LastUnreachable *string `json:"last_unreachable_at"`
		LastReachable   *string `json:"last_reachable_at"`
	} `json:"validator"`
	Check *struct {
		At      string `json:"at"`
		TLSOK   bool   `json:"tls_ok"`
		Outcome string `json:"outcome"`
		Vantage string `json:"vantage"`
	} `json:"last_endpoint_check"`
}

type rateOf struct {
	Num int64 `json:"num"`
	Den int64 `json:"den"`
}

// This observer calls an endpoint unreachable after two failed checks in a
// row. Another vantage's newest check of the same host, in the last fifteen
// minutes, then decides: a completed handshake there makes it reachable,
// confirmed from that vantage, with that check's identity verdict; a failure
// there too keeps it unreachable and says so. A stale check, or one of a
// different host, changes nothing, and neither does another vantage's word
// on an endpoint this observer already reaches.
func TestAnotherVantageConfirmsOrContradictsAFailure(t *testing.T) {
	f := newVantageFixture(t)
	const host = "h:7980"
	addrs := map[string]string{
		"bothUp":    "0000000000000000000000000000000000000001",
		"confirmed": "0000000000000000000000000000000000000002",
		"bothDown":  "0000000000000000000000000000000000000003",
		"stale":     "0000000000000000000000000000000000000004",
		"otherHost": "0000000000000000000000000000000000000005",
		"noOther":   "0000000000000000000000000000000000000006",
	}
	for name, a := range addrs {
		up := name == "bothUp"
		f.beat("ut-1", a, host, 10*time.Minute, up)
		f.beat("ut-1", a, host, 5*time.Minute, up)
	}
	f.beat("de-1", addrs["bothUp"], host, 3*time.Minute, false)
	f.beat("de-1", addrs["confirmed"], host, 8*time.Minute, false)
	f.beat("de-1", addrs["confirmed"], host, 3*time.Minute, true) // newest wins
	f.beat("de-1", addrs["bothDown"], host, 12*time.Minute, true)
	f.beat("de-1", addrs["bothDown"], host, 2*time.Minute, false) // newest wins
	f.beat("de-1", addrs["stale"], host, 30*time.Minute, true)
	f.beat("de-1", addrs["otherHost"], "elsewhere:7980", 3*time.Minute, true)
	ts := f.server()

	want := map[string]struct {
		state, confirmed, alsoFailed, identity string
		up                                     bool
	}{
		"bothUp":    {"reachable", "", "", "verified", true},
		"confirmed": {"reachable", "de-1", "", "verified", true},
		"bothDown":  {"unreachable", "", "de-1", "no_tls", false},
		"stale":     {"unreachable", "", "", "no_tls", false},
		"otherHost": {"unreachable", "", "", "no_tls", false},
		"noOther":   {"unreachable", "", "", "no_tls", false},
	}
	for name, w := range want {
		var body vantageValidator
		if code := getAny(t, ts, "/v1/validators/"+addrs[name], &body); code != 200 {
			t.Fatalf("%s: %d", name, code)
		}
		v := body.V
		if v.EndpointState != w.state || v.Reachable == nil || *v.Reachable != w.up ||
			v.ConfirmedFrom != w.confirmed || v.AlsoFailedFrom != w.alsoFailed || v.Identity != w.identity {
			t.Errorf("%s: state %q reachable %v confirmed %q also_failed %q identity %q; want %+v",
				name, v.EndpointState, v.Reachable, v.ConfirmedFrom, v.AlsoFailedFrom, v.Identity, w)
		}
		// What this observer saw stays on the page, whatever the other
		// vantage said, and its own window counts only its own checks.
		if body.Check == nil || body.Check.Vantage != "ut-1" || body.Check.TLSOK != (name == "bothUp") {
			t.Errorf("%s: last_endpoint_check = %+v, want this observer's own newest check", name, body.Check)
		}
		if v.Reachability.Den != 2 {
			t.Errorf("%s: reachability_window den = %d, want this observer's 2 checks", name, v.Reachability.Den)
		}
	}
}

// Every figure over the reachability table is this observer's own. Another
// vantage's rows, each the opposite of this observer's check at the same
// moment, and none recent enough to confirm anything, leave the network's
// rates and census, every validator's row and last check, and the feed
// exactly as they were.
func TestAnotherVantagesRowsMoveNoFigure(t *testing.T) {
	f := newVantageFixture(t)
	const host = "h:7980"
	v1 := "00000000000000000000000000000000000000a1"
	v2 := "00000000000000000000000000000000000000a2"
	f.endpoint(v1, host)
	f.endpoint(v2, host)
	// v1 answers throughout; v2 stops answering for the last four checks.
	// Oldest first: rows are ingested in write order, and the newest check
	// is the highest rowid.
	for i := 20; i >= 1; i-- {
		ago := time.Duration(i) * 5 * time.Minute
		f.beat("ut-1", v1, host, ago, true)
		f.beat("ut-1", v2, host, ago, i > 4)
	}

	type netBody struct {
		Reach  rateOf `json:"reachability"`
		Window rateOf `json:"reachability_window"`
	}
	// what the summary and the rows keep and do not publish: the previous
	// day's reachability and each validator's certificate rate
	type wholeBody struct {
		Prev *struct {
			Reach rateOf `json:"reachability_window"`
		} `json:"previous"`
		Rows []struct {
			Address       string `json:"address"`
			IdentityValid rateOf `json:"identity_rate_window"`
		} `json:"validators"`
	}
	type snapshot struct {
		net   netBody
		whole wholeBody
		vals  map[string]vantageValidator
		feeds map[string][]string
	}
	take := func() snapshot {
		ts := f.server()
		var s snapshot
		if code := getAny(t, ts, "/v1/network?window=24h", &s.net); code != 200 {
			t.Fatalf("network: %d", code)
		}
		networkOf(t, f.st, "ut-1", "24h", time.Time{}, &s.whole)
		rowsOf(t, f.st, "ut-1", "24h", time.Time{}, &s.whole)
		s.vals = map[string]vantageValidator{}
		s.feeds = map[string][]string{}
		for _, a := range []string{v1, v2} {
			var b vantageValidator
			if code := getAny(t, ts, "/v1/validators/"+a+"?window=24h", &b); code != 200 {
				t.Fatalf("validator %s: %d", a, code)
			}
			s.vals[a] = b
			resp, d := fetchAtom(t, ts, "/v1/validators/"+a+"/feed.atom", nil)
			if resp.StatusCode != 200 {
				t.Fatalf("feed %s: %d", a, resp.StatusCode)
			}
			for _, e := range d.Entries {
				s.feeds[a] = append(s.feeds[a], e.ID+" "+e.Title)
			}
		}
		return s
	}
	before := take()
	if before.net.Window.Den != 40 || before.net.Reach.Num != 1 || before.net.Reach.Den != 2 {
		t.Fatalf("fixture: network %+v", before.net)
	}
	if len(before.feeds[v2]) == 0 {
		t.Fatalf("fixture: v2's feed has no unreachable entry")
	}

	// de-1 disagrees with every one of those checks, up to twenty minutes
	// ago: outside the window a failure is confirmed in.
	for i := 20; i >= 4; i-- {
		ago := time.Duration(i)*5*time.Minute + time.Minute
		f.beat("de-1", v1, host, ago, false)
		f.beat("de-1", v2, host, ago, true)
	}
	after := take()
	if !reflect.DeepEqual(before, after) {
		t.Errorf("another vantage's rows moved a figure:\nbefore %+v\nafter  %+v", before, after)
	}
}

// /v1/meta lists the vantages whose heartbeats reached the store in the last
// hour, with the newest row of each, and marks this observer's own.
func TestMetaListsRecentVantages(t *testing.T) {
	f := newVantageFixture(t)
	f.beat("ut-1", "aa", "h:7980", 5*time.Minute, true)
	f.beat("de-1", "aa", "h:7980", 20*time.Minute, true)
	f.beat("de-1", "aa", "h:7980", 2*time.Minute, true)
	f.beat("old-1", "aa", "h:7980", 2*time.Hour, true)
	ts := f.server()
	var body struct {
		Vantages []struct {
			Name     string `json:"name"`
			NewestAt string `json:"newest_at"`
			Primary  bool   `json:"primary"`
		} `json:"vantages"`
	}
	if code := getAny(t, ts, "/v1/meta", &body); code != 200 {
		t.Fatalf("meta: %d", code)
	}
	if len(body.Vantages) != 2 {
		t.Fatalf("vantages = %+v, want de-1 and ut-1 (old-1 is past the hour)", body.Vantages)
	}
	de, ut := body.Vantages[0], body.Vantages[1]
	if de.Name != "de-1" || de.Primary || de.NewestAt != store.TS(f.now.Add(-2*time.Minute)) {
		t.Errorf("de-1 entry = %+v", de)
	}
	if ut.Name != "ut-1" || !ut.Primary || ut.NewestAt != store.TS(f.now.Add(-5*time.Minute)) {
		t.Errorf("ut-1 entry = %+v", ut)
	}
}

// ownError stores one heartbeat of this observer's that failed on its own
// side (PROBE_ERROR), as an IPv6-only host dialled from a vantage without
// IPv6 does, ago before now.
func (f *vantageFixture) ownError(addr, host string, ago time.Duration) {
	f.t.Helper()
	at := store.TS(f.now.Add(-ago))
	if _, err := f.st.DB().Exec(`INSERT INTO reachability (dedupe_key, vantage, validator_address, validator_host, height, scheduled_at, started_at,
		dns_ok, tcp_ok, tcp_ms, tls_ok, tls_ms, identity_ok, identity_reason, outcome, raw_error, total_duration_ms, raw_json)
		VALUES (?, 'ut-1', ?, ?, 1, ?, ?, 1, 0, 0, 0, 0, 0, '', 'PROBE_ERROR', 'connect: network is unreachable', 0, '{}')`,
		"ut-1|"+addr+"|"+at+"|"+host, addr, host, at, at); err != nil {
		f.t.Fatal(err)
	}
}

// An endpoint this observer never had an answer of, every own check its own
// fault, takes another vantage's newest recent check of it, under the rule the
// observer's own checks follow: reachable when it completed there; one failure
// after a completed check is flaky, still up; failures only are unreachable.
// An own answer older than the span counts as none. A stale check from elsewhere leaves it not checked yet, and the list and the
// validator's own page agree.
func TestAnotherVantageStandsInWhenThisObserverCannotDial(t *testing.T) {
	f := newVantageFixture(t)
	const host = "[2001:db8::5]:7980"
	addrs := map[string]string{
		"up":     "00000000000000000000000000000000000000b1",
		"flaky":  "00000000000000000000000000000000000000b2",
		"down":   "00000000000000000000000000000000000000b3",
		"stale":  "00000000000000000000000000000000000000b4",
		"none":   "00000000000000000000000000000000000000b5",
		"oldOwn": "00000000000000000000000000000000000000b6",
	}
	for _, a := range addrs {
		raw, err := hex.DecodeString(a)
		if err != nil {
			t.Fatal(err)
		}
		cons, err := bech32.ConvertAndEncode("celestiavalcons", raw)
		if err != nil {
			t.Fatal(err)
		}
		f.endpoint(cons, host)
		f.ownError(a, host, 10*time.Minute)
		f.ownError(a, host, 5*time.Minute)
	}
	f.beat("de-1", addrs["up"], host, 3*time.Minute, true)
	f.beat("de-1", addrs["flaky"], host, 8*time.Minute, true)
	f.beat("de-1", addrs["flaky"], host, 3*time.Minute, false)
	f.beat("de-1", addrs["down"], host, 8*time.Minute, false)
	f.beat("de-1", addrs["down"], host, 3*time.Minute, false)
	f.beat("de-1", addrs["stale"], host, 40*time.Minute, true)
	// an own answer of an hour ago is not the endpoint's state now
	f.beat("ut-1", addrs["oldOwn"], host, time.Hour, false)
	f.beat("de-1", addrs["oldOwn"], host, 3*time.Minute, true)
	ts := f.server()

	type want struct {
		state, confirmed, alsoFailed string
		reachable                    *bool
	}
	yes, no := true, false
	wants := map[string]want{
		"up":     {"reachable", "de-1", "", &yes},
		"flaky":  {"reachable", "", "", &yes},
		"oldOwn": {"reachable", "de-1", "", &yes},
		"down":   {"unreachable", "", "de-1", &no},
		"stale":  {"", "", "", nil},
		"none":   {"", "", "", nil},
	}
	var list struct {
		Rows []struct {
			Address   string `json:"address"`
			Reachable *bool  `json:"reachable"`
		} `json:"validators"`
	}
	if code := getAny(t, ts, "/v1/validators", &list); code != 200 {
		t.Fatalf("validators: %d", code)
	}
	inList := map[string]*bool{}
	for _, r := range list.Rows {
		inList[r.Address] = r.Reachable
	}
	same := func(a, b *bool) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }
	for name, w := range wants {
		var body vantageValidator
		if code := getAny(t, ts, "/v1/validators/"+addrs[name], &body); code != 200 {
			t.Fatalf("%s: %d", name, code)
		}
		v := body.V
		if v.EndpointState != w.state || !same(v.Reachable, w.reachable) ||
			v.ConfirmedFrom != w.confirmed || v.AlsoFailedFrom != w.alsoFailed {
			t.Errorf("%s: state %q reachable %v confirmed %q also_failed %q; want %+v",
				name, v.EndpointState, v.Reachable, v.ConfirmedFrom, v.AlsoFailedFrom, w)
		}
		if got, ok := inList[addrs[name]]; !ok || !same(got, w.reachable) {
			t.Errorf("%s: list reachable %v (listed %v), want %v", name, got, ok, w.reachable)
		}
		// What this observer saw stays its own.
		if body.Check == nil || body.Check.Vantage != "ut-1" || body.Check.Outcome != "PROBE_ERROR" {
			t.Errorf("%s: last_endpoint_check = %+v, want this observer's own PROBE_ERROR", name, body.Check)
		}
	}
}
