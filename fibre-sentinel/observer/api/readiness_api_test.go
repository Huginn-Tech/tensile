package api_test

import (
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/plsgiveup/fibre/fibre-sentinel/observer/api"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// A validator row publishes its endpoint's readiness from this observer's
// newest heartbeats, beside an endpoint state that does not move with it, and
// the last endpoint check carries that check's own answer.
func TestValidatorRowPublishesReadiness(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "observer.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ins := `INSERT INTO reachability (dedupe_key, vantage, validator_address, validator_host, height, scheduled_at, started_at,
		dns_ok, tcp_ok, tcp_ms, tls_ok, tls_ms, identity_ok, identity_reason, outcome, raw_error, total_duration_ms, raw_json)
		VALUES (?, 'test', ?, 'h:7980', 1, ?, ?, 1, 1, 10, ?, 20, ?, '', ?, '', 30, ?)`
	now := time.Now()
	n := 0
	// add writes one heartbeat ago minutes back: answered with status, "" for
	// none asked, or failed at the handshake
	add := func(addr string, ago int, status string, failed bool) string {
		n++
		at := store.TS(now.Add(-time.Duration(ago) * time.Minute))
		ok, outcome, raw := 1, "REACHABLE", `{}`
		if status != "" {
			raw = `{"outcome":"REACHABLE","readiness":{"status":"` + status + `","duration_ms":3}}`
		}
		if failed {
			ok, outcome = 0, "TLS_HANDSHAKE_FAIL"
		}
		if _, err := st.DB().Exec(ins, "k"+string(rune('a'+n)), addr, at, at, ok, ok, outcome, raw); err != nil {
			t.Fatal(err)
		}
		return at
	}
	const (
		ready     = "0000000000000000000000000000000000000001"
		once      = "0000000000000000000000000000000000000002"
		notReady  = "0000000000000000000000000000000000000003"
		unchecked = "0000000000000000000000000000000000000004"
		silent    = "0000000000000000000000000000000000000005"
		before    = "0000000000000000000000000000000000000006"
		flaky     = "0000000000000000000000000000000000000007"
		down      = "0000000000000000000000000000000000000008"
	)
	add(ready, 10, "not_serving", false)
	readyAt := add(ready, 5, "serving", false)
	add(once, 10, "serving", false)
	onceAt := add(once, 5, "not_serving", false)
	add(notReady, 15, "not_serving", false)
	add(notReady, 10, "unmeasured", false)
	notReadyAt := add(notReady, 5, "not_serving", false)
	lastAt := add(unchecked, 10, "serving", false)
	uncheckedAt := add(unchecked, 5, "unmeasured", false)
	silentAt := add(silent, 5, "not_reported", false)
	add(before, 5, "", false)
	flakyLastAt := add(flaky, 10, "serving", false)
	flakyAt := add(flaky, 5, "", true)
	add(down, 10, "serving", true)
	add(down, 5, "", true)

	srv := api.NewWithVantage(st, api.VantageInfo{Name: "test"}, nil, api.WithDataDir(dir))
	ts := httptest.NewServer(srv)
	defer func() { ts.Close(); srv.Close() }()
	type want struct {
		state, readiness string
		ready            *bool
		checkedAt        string
		last, lastAt     string
		check            string
	}
	yes, no := true, false
	for addr, w := range map[string]want{
		ready:     {"reachable", "ready", &yes, readyAt, "", "", "serving"},
		once:      {"reachable", "not_ready_once", nil, onceAt, "", "", "not_serving"},
		notReady:  {"reachable", "not_ready", &no, notReadyAt, "", "", "not_serving"},
		unchecked: {"reachable", "unchecked", nil, uncheckedAt, "ready", lastAt, "unmeasured"},
		silent:    {"reachable", "not_reported", nil, silentAt, "", "", "not_reported"},
		before:    {"reachable", "", nil, "", "", "", ""},
		flaky:     {"reachable", "unchecked", nil, flakyAt, "ready", flakyLastAt, ""},
		down:      {"unreachable", "", nil, "", "", "", ""},
	} {
		var body struct {
			V struct {
				EndpointState string  `json:"endpoint_state"`
				Readiness     string  `json:"readiness"`
				Ready         *bool   `json:"ready"`
				CheckedAt     *string `json:"readiness_checked_at"`
				Last          string  `json:"readiness_last_answer"`
				LastAt        *string `json:"readiness_last_answer_at"`
			} `json:"validator"`
			Check *struct {
				Readiness string `json:"readiness"`
			} `json:"last_endpoint_check"`
		}
		if code := getAny(t, ts, "/v1/validators/"+addr, &body); code != 200 {
			t.Fatalf("%s: %d", addr, code)
		}
		v := body.V
		if v.EndpointState != w.state || v.Readiness != w.readiness || v.Last != w.last {
			t.Errorf("%s: state %q readiness %q last %q, want %q %q %q", addr, v.EndpointState, v.Readiness, v.Last, w.state, w.readiness, w.last)
		}
		if (v.Ready == nil) != (w.ready == nil) || (v.Ready != nil && *v.Ready != *w.ready) {
			t.Errorf("%s: ready %v, want %v", addr, v.Ready, w.ready)
		}
		if str(v.CheckedAt) != w.checkedAt || str(v.LastAt) != w.lastAt {
			t.Errorf("%s: checked at %q last at %q, want %q %q", addr, str(v.CheckedAt), str(v.LastAt), w.checkedAt, w.lastAt)
		}
		if body.Check == nil || body.Check.Readiness != w.check {
			t.Errorf("%s: last check %+v, want readiness %q", addr, body.Check, w.check)
		}
	}
}

func str(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
