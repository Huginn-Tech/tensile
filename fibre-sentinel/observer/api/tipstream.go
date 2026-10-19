package api

// GET /v1/tip/stream: /v1/tip as server-sent events. Every open page reads
// the tip every second, for the header's block and to know when a blob
// arrived, so a new block reached a page half a second after the API had it
// on average, and up to a second. A stream hands it over when the API has
// it. It is in front of that polling, never instead of it: a page whose
// stream cannot be opened, is refused, ends or goes quiet asks /v1/tip
// every second as before (web/src/lib/tipfeed-core.ts), so the worst a
// stream can do is leave a page as it was.
//
// One producer reads the tip's cache (cachedTip) while any stream is open,
// the way /v1/tip reads it and at its pace, and hands each change to every
// stream: a stream costs the node and the store nothing of its own, and
// however many are open the tip is read at most four times a second.
//
// On connecting, and whenever a field of the answer other than server_time
// changes:
//
//	event: tip
//	data: <the answer /v1/tip gives, on one line>
//
// and every tipStreamKeepAlive:
//
//	event: ping
//	data: {"server_time":"..."}
//
// which keeps the proxies on the way from closing a quiet connection and
// tells the page the stream is alive while the chain is (a halted chain
// sends no tip). An SSE comment would do the first, but a browser's
// EventSource does not hand a comment to the page.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const (
	// DefaultTipStreams is how many tip streams may be open at once
	// (observer-api -tip-streams). Past it a stream is refused with a 503,
	// its page asks /v1/tip every second as before, and /v1/health's
	// tip_streams check fails for a while (tipStreamsCheck).
	DefaultTipStreams = 2000
	// tipStreamKeepAlive is the ping's pace. A page that hears nothing for
	// 20 s takes its stream for dead and polls.
	tipStreamKeepAlive = 15 * time.Second
	// tipStreamWriteTimeout bounds one event's write: a reader that has
	// stopped reading is let go after it, not held.
	tipStreamWriteTimeout = 10 * time.Second
	// tipStreamTick is how often the producer looks at the cache. The cache
	// is read afresh at most every tipTTL, so a change reaches the streams
	// within this of the read that found it.
	tipStreamTick = 50 * time.Millisecond
)

// WithTipStreams caps the tip streams open at once (observer-api
// -tip-streams); 0 opens none, and every page asks /v1/tip as before.
func WithTipStreams(n int) Option { return func(s *Server) { s.streams.max = n } }

// tipStreams is the open streams and their producer.
type tipStreams struct {
	mu sync.Mutex
	// max is the cap (WithTipStreams); -1 until an option sets it, then
	// DefaultTipStreams.
	max  int
	subs map[chan tipEvent]struct{}
	// running is whether the producer runs: from the first stream opened
	// until it finds none open.
	running bool
	// ended is set, and end closed, once the server stops (EndTipStreams):
	// every stream returns, and none is opened after.
	ended bool
	end   chan struct{}
	// keepAlive is tipStreamKeepAlive, shorter in tests.
	keepAlive time.Duration
	// For /v1/health and the log: the most open at once since the API
	// started, the streams refused at the cap since then and the last one's
	// time, and those refused since the log last said so.
	peak      int
	refused   int64
	refusedAt time.Time
	loggedAt  time.Time
	unlogged  int64
}

// tipEvent is one change of the tip, as the producer hands it to a stream.
type tipEvent struct {
	// gen is the cache's read the answer came from (tipCache.gen): a stream
	// drops one no newer than the answer it sent on connecting.
	gen uint64
	// key is the answer without its server_time: two answers with one key
	// say the same.
	key []byte
	// frame is the event as written.
	frame []byte
}

// EndTipStreams ends every tip stream and refuses new ones. observer-api
// calls it as its HTTP server begins to shut down
// (http.Server.RegisterOnShutdown): a stream never falls idle, and the
// shutdown would otherwise wait out its whole drain for them. Close calls
// it too.
func (s *Server) EndTipStreams() {
	t := &s.streams
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.ended {
		t.ended = true
		if t.end != nil {
			close(t.end)
		}
	}
}

func (s *Server) handleTipStream(w http.ResponseWriter, r *http.Request) {
	ch, ok := s.joinTipStream()
	if !ok {
		// The page asks /v1/tip every second instead. A 503 is not one of
		// the API's failures (countsAsError); the cap's own check is
		// tip_streams.
		w.Header().Set("Retry-After", "60")
		writeErr(w, http.StatusServiceUnavailable, "too many tip streams open: ask /v1/tip")
		return
	}
	defer s.leaveTipStream(ch)
	rc := http.NewResponseController(w)
	// The server's ReadTimeout runs from the request's first byte, and once
	// it has passed, the connection's read in the background fails and
	// cancels the request: every stream would end ten seconds in. Writes
	// get a deadline each instead of ServeHTTP's one for the route, and the
	// end of the answer one of its own, past the last event's.
	_ = rc.SetReadDeadline(time.Time{})
	defer func() { _ = rc.SetWriteDeadline(time.Now().Add(tipStreamWriteTimeout)) }()
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-store, no-transform")
	h.Set("X-Accel-Buffering", "no") // nginx: pass each event on as it comes
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		// net/http swallows a HEAD answer's body without an error, so the
		// stream would run on for a reader that has had its answer.
		return
	}
	send := func(frame []byte) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(tipStreamWriteTimeout))
		if _, err := w.Write(frame); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	// The tip now, read after joining: a change the producer finds from here
	// on reaches this stream, and one it found before is in this answer.
	v, gen := s.cachedTip()
	key, frame := tipFrame(v)
	if !send(frame) {
		return
	}
	keep := time.NewTicker(s.streams.keepAlive)
	defer keep.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.streams.end:
			return
		case ev := <-ch:
			if ev.gen <= gen || bytes.Equal(ev.key, key) {
				continue
			}
			gen, key = ev.gen, ev.key
			if !send(ev.frame) {
				return
			}
		case <-keep.C:
			if !send(pingFrame(s.now())) {
				return
			}
		}
	}
}

// joinTipStream opens a stream: its channel, or false at the cap and once
// the server is stopping. The first stream starts the producer.
func (s *Server) joinTipStream() (chan tipEvent, bool) {
	t := &s.streams
	now := s.now()
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.ended || t.max == 0 {
		return nil, false
	}
	if len(t.subs) >= t.max {
		t.refused++
		t.unlogged++
		t.refusedAt = now
		s.logTipRefusals(now)
		return nil, false
	}
	if t.subs == nil {
		t.subs = map[chan tipEvent]struct{}{}
	}
	ch := make(chan tipEvent, 1)
	t.subs[ch] = struct{}{}
	t.peak = max(t.peak, len(t.subs))
	if !t.running {
		// Before Close waits for the background work: Close ends the
		// streams first, under this lock, and none is opened after.
		t.running = true
		s.bg.Add(1)
		go s.tipProducer()
	}
	return ch, true
}

func (s *Server) leaveTipStream(ch chan tipEvent) {
	s.streams.mu.Lock()
	delete(s.streams.subs, ch)
	s.streams.mu.Unlock()
}

// tipProducer reads the tip's cache while any stream is open and hands each
// change to every stream: the newest only, in place of one a stream has not
// taken yet, so a slow reader holds no other up. It ends when it finds no
// stream open, or the server stopping.
func (s *Server) tipProducer() {
	defer s.bg.Done()
	t := &s.streams
	tick := time.NewTicker(tipStreamTick)
	defer tick.Stop()
	var last tipEvent
	for {
		select {
		case <-t.end:
		case <-tick.C:
		}
		t.mu.Lock()
		if len(t.subs) == 0 || t.ended {
			t.running = false
			t.mu.Unlock()
			return
		}
		s.logTipRefusals(s.now())
		t.mu.Unlock()
		v, gen := s.cachedTip()
		if gen == last.gen {
			continue
		}
		key, frame := tipFrame(v)
		if bytes.Equal(key, last.key) {
			last.gen = gen
			continue
		}
		last = tipEvent{gen: gen, key: key, frame: frame}
		t.mu.Lock()
		for ch := range t.subs {
			offer(ch, last)
		}
		t.mu.Unlock()
	}
}

// offer puts ev on ch, in place of an event the stream has not taken yet.
// Only the producer sends, so the second try finds room.
func offer(ch chan tipEvent, ev tipEvent) {
	for {
		select {
		case ch <- ev:
			return
		default:
		}
		select {
		case <-ch:
		default:
		}
	}
}

// tipFrame is v as a tip event, and its key: the answer without its
// server_time. The data is the body /v1/tip answers with (writeJSON's
// compact encoding), on one line.
func tipFrame(v tipResponse) (key, frame []byte) {
	b, _ := json.Marshal(v)
	frame = make([]byte, 0, len(b)+20)
	frame = append(frame, "event: tip\ndata: "...)
	frame = append(frame, b...)
	frame = append(frame, "\n\n"...)
	v.ServerTime = time.Time{}
	key, _ = json.Marshal(v)
	return key, frame
}

func pingFrame(now time.Time) []byte {
	return []byte("event: ping\ndata: {\"server_time\":\"" + now.UTC().Format(time.RFC3339Nano) + "\"}\n\n")
}

// logTipRefusals says how many streams were refused at the cap, at most
// once a minute: the first refusal at once, those after it once a minute
// has passed, at the next refusal or the producer's next look. Called with
// s.streams.mu held.
func (s *Server) logTipRefusals(now time.Time) {
	t := &s.streams
	if t.unlogged == 0 || now.Sub(t.loggedAt) < time.Minute || s.log == nil {
		return
	}
	s.log.Printf("tip streams: %d refused at the cap of %d (%d since the API started, %d open); their pages ask /v1/tip every second instead: raise observer-api -tip-streams",
		t.unlogged, t.max, t.refused, len(t.subs))
	t.loggedAt, t.unlogged = now, 0
}

// tipStreamsCheck is /v1/health's tip_streams row: the streams open, the
// most at once since the API started, and the cap. It fails for
// routeErrorsFailFor after a stream was refused at the cap. No page shows
// less for it (a refused page asks /v1/tip every second, as every page did
// before the streams), but the cap is then lower than the readers, and the
// health watch says so.
func (s *Server) tipStreamsCheck(now time.Time) healthCheck {
	t := &s.streams
	t.mu.Lock()
	open, limit, peak, refused, at := len(t.subs), t.max, t.peak, t.refused, t.refusedAt
	t.mu.Unlock()
	if limit == 0 {
		return healthCheck{"tip_streams", true, "off (observer-api -tip-streams 0): every page asks /v1/tip"}
	}
	state := fmt.Sprintf("%d open, at most %d at once since the API started, of %d allowed", open, peak, limit)
	if refused > 0 && now.Sub(at) <= routeErrorsFailFor {
		return healthCheck{"tip_streams", false, fmt.Sprintf("%s; %d refused at that cap since the API started, the last %s ago: their pages ask /v1/tip every second instead (raise observer-api -tip-streams)",
			state, refused, now.Sub(at).Round(time.Second))}
	}
	return healthCheck{"tip_streams", true, state}
}
