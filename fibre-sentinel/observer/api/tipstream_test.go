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

// withTipKeepAlive, withTipLifetime and withTipRead set the tip streams'
// ping pace, their lifetime and their producer's read, for tests.
func withTipKeepAlive(d time.Duration) Option { return func(s *Server) { s.streams.keepAlive = d } }

func withTipLifetime(d time.Duration) Option { return func(s *Server) { s.streams.lifetime = d } }

func withTipRead(f func() (tipResponse, uint64)) Option {
	return func(s *Server) { s.streams.read = f }
}

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

// Past the cap a stream is refused with a 503 (its page polls /v1/tip). One
// refusal fails no check, api_errors included, and /v1/health says nothing
// of the streams but "ok"; a stream that closes lets the next in. At 0 none
// opens, and that is no failure either.
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
	res, err := ts.Client().Get(ts.URL + "/v1/tip/stream")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable || res.Header.Get("Retry-After") == "" || !strings.Contains(string(body), "/v1/tip") {
		t.Fatalf("past the cap: %d %q %s", res.StatusCode, res.Header.Get("Retry-After"), body)
	}
	if c := srv.tipStreamsCheck(srv.now()); !c.OK || c.Detail != "ok" {
		t.Errorf("one stream refused at the cap: %+v", c)
	}
	if c := srv.apiErrorsCheck(srv.now()); !c.OK {
		t.Errorf("a refusal at the cap is not an error of the API's: %+v", c)
	}
	srv.streams.mu.Lock()
	refused := srv.streams.refused
	srv.streams.mu.Unlock()
	if refused != 1 {
		t.Errorf("%d refusals counted, want 1", refused)
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
	if c := off.tipStreamsCheck(off.now()); !c.OK || c.Detail != "ok" {
		t.Errorf("-tip-streams 0 is not a failure: %+v", c)
	}
}

// tip_streams fails only on refusals at the cap in 5 distinct minutes of the
// last 15, and its detail says that and no figure of the streams: one
// refusal, a burst in one minute, or refusals older than the window do not
// fail it.
func TestTipStreamsCheckWantsSustainedRefusals(t *testing.T) {
	s := &Server{}
	now := time.Date(2026, 10, 19, 12, 30, 30, 0, time.UTC)
	refuse := func(at time.Time) {
		s.streams.mu.Lock()
		s.streams.noteRefused(at)
		s.streams.mu.Unlock()
	}
	// in the order they come: some before the window, some in it, and a
	// burst in this minute
	for m := 29; m >= 15; m-- {
		refuse(now.Add(-time.Duration(m) * time.Minute))
	}
	for m := 3; m >= 1; m-- {
		refuse(now.Add(-time.Duration(m) * time.Minute))
	}
	for i := 0; i < 50; i++ {
		refuse(now)
	}
	if c := s.tipStreamsCheck(now); !c.OK || c.Detail != "ok" {
		t.Fatalf("refusals in 4 minutes of the last 15: %+v", c)
	}
	refuse(now.Add(-14 * time.Minute))
	c := s.tipStreamsCheck(now)
	if c.OK || !strings.Contains(c.Detail, "refusing streams at the cap in 5 of the last 15m") {
		t.Fatalf("refusals in 5 minutes of the last 15: %+v", c)
	}
	if strings.Contains(c.Detail, "open") || strings.Contains(c.Detail, "allowed") {
		t.Errorf("the public detail names the streams' figures: %q", c.Detail)
	}
	// a quarter of an hour later the window has moved past all of them
	if c := s.tipStreamsCheck(now.Add(15 * time.Minute)); !c.OK {
		t.Errorf("refusals out of the window still fail it: %+v", c)
	}
}

// A stream lives its time (an hour, here 600 ms less up to a twelfth), then
// says "end", for its page to open another at once, and closes.
func TestTipStreamEndsAfterItsLifetime(t *testing.T) {
	srv, _, ts := streamServer(t, withTipLifetime(600*time.Millisecond))
	_, evs := openStream(t, ts)
	nextEvent(t, evs, "tip", 3*time.Second)
	ev := nextEvent(t, evs, "end", 3*time.Second)
	var e struct {
		ServerTime time.Time `json:"server_time"`
	}
	if err := json.Unmarshal([]byte(ev.data), &e); err != nil || e.ServerTime.IsZero() {
		t.Errorf("end %q: %v", ev.data, err)
	}
	timeout := time.After(3 * time.Second)
	for open := true; open; {
		select {
		case _, open = <-evs:
		case <-timeout:
			t.Fatal("the stream stayed open after its end")
		}
	}
	waitFor(t, 3*time.Second, "the stream let go", func() bool { n, _ := streamState(srv); return n == 0 })
	if res, _ := openStream(t, ts); res.StatusCode != http.StatusOK {
		t.Errorf("a stream after one ended: status %d", res.StatusCode)
	}
}

// A producer that panics takes nothing else down: every stream is ended and
// refused from then on (the pages poll), /v1/tip still answers, and no
// goroutine of the streams is left.
func TestTipStreamProducerPanicEndsTheStreams(t *testing.T) {
	srv, _, ts := streamServer(t, withTipRead(func() (tipResponse, uint64) { panic("a bug in the producer") }))
	_, evs := openStream(t, ts)
	nextEvent(t, evs, "tip", 3*time.Second)
	timeout := time.After(3 * time.Second)
	for open := true; open; {
		select {
		case _, open = <-evs:
		case <-timeout:
			t.Fatal("a stream outlived its producer")
		}
	}
	waitFor(t, 3*time.Second, "the streams and the producer stopped", func() bool {
		n, running := streamState(srv)
		return n == 0 && !running && streamGoroutines() == 0
	})
	res, err := ts.Client().Get(ts.URL + "/v1/tip/stream")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("a stream after the producer failed: status %d", res.StatusCode)
	}
	res, err = ts.Client().Get(ts.URL + "/v1/tip")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("/v1/tip after the producer failed: status %d", res.StatusCode)
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
	srv.streams.mu.Lock()
	peak := srv.streams.peak
	srv.streams.mu.Unlock()
	if peak != 3 {
		t.Errorf("peak %d, want 3", peak)
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
