package api

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// withTipKeepAlive sets the tip streams' ping pace, for tests.
func withTipKeepAlive(d time.Duration) Option { return func(s *Server) { s.streams.keepAlive = d } }

// streamServer is an API whose tip the collector's meta row names, served
// over HTTP as observer-api serves it (a stream needs a real connection: its
// flushes, its deadlines, a reader that goes away), with the server's read
// timeout shortened, which a stream must outlive, and a ping every 300 ms.
func streamServer(t *testing.T, opts ...Option) (*Server, *store.Store, *httptest.Server) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "observer.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetMeta("chain_height", "1000", time.Now()); err != nil {
		t.Fatal(err)
	}
	srv := NewWithVantage(st, VantageInfo{Name: "test"}, nil, append([]Option{withTipKeepAlive(300 * time.Millisecond)}, opts...)...)
	ts := httptest.NewUnstartedServer(srv)
	ts.Config.ReadTimeout = 500 * time.Millisecond
	ts.Start()
	t.Cleanup(func() {
		srv.EndTipStreams()
		ts.Close()
		srv.Close()
		st.Close()
	})
	return srv, st, ts
}

type sseEvent struct{ name, data string }

// openStream opens /v1/tip/stream and reads its events onto the channel it
// returns, closed when the stream ends.
func openStream(t *testing.T, ts *httptest.Server) (*http.Response, <-chan sseEvent) {
	t.Helper()
	res, err := ts.Client().Get(ts.URL + "/v1/tip/stream")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	evs := make(chan sseEvent, 256)
	go func() {
		defer close(evs)
		sc := bufio.NewScanner(res.Body)
		var ev sseEvent
		for sc.Scan() {
			switch line := sc.Text(); {
			case line == "":
				if ev != (sseEvent{}) {
					select {
					case evs <- ev:
					default:
					}
				}
				ev = sseEvent{}
			case strings.HasPrefix(line, "event: "):
				ev.name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				ev.data = strings.TrimPrefix(line, "data: ")
			}
		}
	}()
	return res, evs
}

// nextEvent is the stream's next event called name, the others skipped.
func nextEvent(t *testing.T, evs <-chan sseEvent, name string, within time.Duration) sseEvent {
	t.Helper()
	timeout := time.After(within)
	for {
		select {
		case ev, ok := <-evs:
			if !ok {
				t.Fatalf("the stream ended before a %q event", name)
			}
			if ev.name == name {
				return ev
			}
		case <-timeout:
			t.Fatalf("no %q event within %s", name, within)
		}
	}
}

// tipAt is the next tip event at height h, the ones before it skipped.
func tipAt(t *testing.T, evs <-chan sseEvent, h int64, within time.Duration) map[string]any {
	t.Helper()
	end := time.Now().Add(within)
	for {
		ev := nextEvent(t, evs, "tip", time.Until(end))
		var v map[string]any
		if err := json.Unmarshal([]byte(ev.data), &v); err != nil {
			t.Fatalf("tip event %q: %v", ev.data, err)
		}
		if v["height"] == float64(h) {
			return v
		}
	}
}

func streamState(s *Server) (open int, running bool) {
	s.streams.mu.Lock()
	defer s.streams.mu.Unlock()
	return len(s.streams.subs), s.streams.running
}

// streamGoroutines counts the goroutines in a tip stream's handler or its
// producer, in the whole process: the other tests of the package open no
// stream, and these run one at a time.
func streamGoroutines() int {
	buf := make([]byte, 8<<20)
	all := string(buf[:runtime.Stack(buf, true)])
	return strings.Count(all, ").handleTipStream(") + strings.Count(all, ").tipProducer(")
}

func waitFor(t *testing.T, within time.Duration, what string, ok func() bool) {
	t.Helper()
	for end := time.Now().Add(within); !ok(); time.Sleep(20 * time.Millisecond) {
		if time.Now().After(end) {
			t.Fatalf("%s: not within %s", what, within)
		}
	}
}

// A stream sends the tip at once, the answer /v1/tip gives, then each
// change of it and nothing while it does not change, with a ping between;
// and it outlives the server's read timeout.
func TestTipStreamSendsTheTipAndEachChange(t *testing.T) {
	srv, st, ts := streamServer(t)
	res, evs := openStream(t, ts)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	for k, want := range map[string]string{"Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"} {
		if got := res.Header.Get(k); got != want {
			t.Errorf("%s %q, want %q", k, got, want)
		}
	}
	got := tipAt(t, evs, 1000, 3*time.Second)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/tip", nil))
	var want map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &want); err != nil {
		t.Fatal(err)
	}
	if got["server_time"] == nil {
		t.Errorf("the event has no server_time: %v", got)
	}
	delete(got, "server_time")
	delete(want, "server_time")
	if !reflect.DeepEqual(got, want) {
		t.Errorf("the event %v is not /v1/tip's answer %v", got, want)
	}

	// past the read timeout, the pings go on
	time.Sleep(700 * time.Millisecond)
	ping := nextEvent(t, evs, "ping", 2*time.Second)
	var p struct {
		ServerTime time.Time `json:"server_time"`
	}
	if err := json.Unmarshal([]byte(ping.data), &p); err != nil || p.ServerTime.IsZero() {
		t.Errorf("ping %q: %v", ping.data, err)
	}

	// a new block reaches the stream as the cache reads it
	if err := st.SetMeta("chain_height", "1001", time.Now()); err != nil {
		t.Fatal(err)
	}
	tipAt(t, evs, 1001, 5*time.Second)

	// and while nothing changes, only pings
	quiet := time.After(time.Second)
	pings := 0
	for done := false; !done; {
		select {
		case ev, ok := <-evs:
			if !ok {
				t.Fatal("the stream ended")
			}
			if ev.name == "tip" {
				t.Errorf("a tip event while the tip did not change: %s", ev.data)
			}
			pings++
		case <-quiet:
			done = true
		}
	}
	if pings == 0 {
		t.Error("no ping in a second, at a ping every 300 ms")
	}
}

// Past the cap a stream is refused with a 503 (its page polls /v1/tip), and
// /v1/health's tip_streams fails, while api_errors does not; a stream that
// closes lets the next in. At 0 none opens, and the check says it is off.
func TestTipStreamCap(t *testing.T) {
	srv, _, ts := streamServer(t, WithTipStreams(2))
	var first io.Closer
	for i := 0; i < 2; i++ {
		res, evs := openStream(t, ts)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("stream %d: status %d", i, res.StatusCode)
		}
		nextEvent(t, evs, "tip", 3*time.Second)
		if i == 0 {
			first = res.Body
		}
	}
	if c := srv.tipStreamsCheck(srv.now()); !c.OK || !strings.Contains(c.Detail, "2 open") {
		t.Errorf("at the cap, none refused yet: %+v", c)
	}
	res, err := ts.Client().Get(ts.URL + "/v1/tip/stream")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable || res.Header.Get("Retry-After") == "" || !strings.Contains(string(body), "/v1/tip") {
		t.Fatalf("past the cap: %d %q %s", res.StatusCode, res.Header.Get("Retry-After"), body)
	}
	if c := srv.tipStreamsCheck(srv.now()); c.OK || !strings.Contains(c.Detail, "1 refused") || !strings.Contains(c.Detail, "at most 2 at once") {
		t.Errorf("a stream refused at the cap: %+v", c)
	}
	if c := srv.apiErrorsCheck(srv.now()); !c.OK {
		t.Errorf("a refusal at the cap is not an error of the API's: %+v", c)
	}

	first.Close()
	waitFor(t, 3*time.Second, "the closed stream let go", func() bool { n, _ := streamState(srv); return n == 1 })
	if res, _ := openStream(t, ts); res.StatusCode != http.StatusOK {
		t.Errorf("a stream after one closed: status %d", res.StatusCode)
	}

	off, _, offTS := streamServer(t, WithTipStreams(0))
	res, err = offTS.Client().Get(offTS.URL + "/v1/tip/stream")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("-tip-streams 0: status %d", res.StatusCode)
	}
	if c := off.tipStreamsCheck(off.now()); !c.OK || !strings.Contains(c.Detail, "off") {
		t.Errorf("-tip-streams 0 is not a failure: %+v", c)
	}
}

// A reader that goes away ends its stream, and with the last one the
// producer stops: nothing is left running for streams no one reads.
func TestTipStreamEndsWithItsReader(t *testing.T) {
	srv, _, ts := streamServer(t)
	var bodies []io.Closer
	for i := 0; i < 3; i++ {
		res, evs := openStream(t, ts)
		nextEvent(t, evs, "tip", 3*time.Second)
		bodies = append(bodies, res.Body)
	}
	if n, running := streamState(srv); n != 3 || !running {
		t.Fatalf("%d open, producer running %v; want 3 and running", n, running)
	}
	if n := streamGoroutines(); n != 4 {
		t.Fatalf("%d goroutines of the streams, want 4: 3 streams and the producer", n)
	}
	for _, b := range bodies {
		b.Close()
	}
	waitFor(t, 3*time.Second, "every stream ended and the producer stopped", func() bool {
		n, running := streamState(srv)
		return n == 0 && !running && streamGoroutines() == 0
	})
	if c := srv.tipStreamsCheck(srv.now()); !c.OK || !strings.Contains(c.Detail, "0 open, at most 3 at once") {
		t.Errorf("after the readers left: %+v", c)
	}

	// a HEAD has its headers and nothing more, at once
	req, _ := http.NewRequest(http.MethodHead, ts.URL+"/v1/tip/stream", nil)
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	waitFor(t, 3*time.Second, "a HEAD's stream ended", func() bool { n, _ := streamState(srv); return n == 0 })
}

// The server's shutdown ends every stream at once (observer-api registers
// EndTipStreams with it), and refuses new ones.
func TestTipStreamsEndWithTheServer(t *testing.T) {
	srv, _, ts := streamServer(t)
	_, evs := openStream(t, ts)
	nextEvent(t, evs, "tip", 3*time.Second)
	srv.EndTipStreams()
	timeout := time.After(3 * time.Second)
	for open := true; open; {
		select {
		case _, open = <-evs:
		case <-timeout:
			t.Fatal("a stream outlived the server's shutdown")
		}
	}
	waitFor(t, 3*time.Second, "the stream and the producer stopped", func() bool {
		n, running := streamState(srv)
		return n == 0 && !running && streamGoroutines() == 0
	})
	res, err := ts.Client().Get(ts.URL + "/v1/tip/stream")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("a stream opened during the shutdown: status %d", res.StatusCode)
	}
}
