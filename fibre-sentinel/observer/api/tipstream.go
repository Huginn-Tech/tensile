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
// every tipStreamKeepAlive:
//
//	event: ping
//	data: {"server_time":"..."}
//
// which keeps the proxies on the way from closing a quiet connection and
// tells the page the stream is alive while the chain is (a halted chain
// sends no tip; an SSE comment would keep a proxy, but a browser's
// EventSource does not hand a comment to the page); and when the stream has
// lived its time (lifeOf, an hour at most), before the API closes it:
//
//	event: end
//	data: {"server_time":"..."}
//
// on which the page opens a new one at once, as from a failure but without
// its back-off: no connection is held for good through proxies that may not
// expect it.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"
)

const (
	// DefaultTipStreams is how many tip streams may be open at once
	// (observer-api -tip-streams). Past it a stream is refused with a 503,
	// and its page asks /v1/tip every second as before.
	DefaultTipStreams = 2000
	// tipStreamKeepAlive is the ping's pace. A page that hears nothing for
	// 20 s takes its stream for dead and polls.
	tipStreamKeepAlive = 15 * time.Second
	// tipStreamLifetime is the longest a stream lives (lifeOf).
	tipStreamLifetime = time.Hour
	// tipStreamWriteTimeout bounds one event's write: a reader that has
	// stopped reading is let go after it, not held.
	tipStreamWriteTimeout = 10 * time.Second
	// tipStreamTick is how often the producer looks at the cache. The cache
	// is read afresh at most every tipTTL, so a change reaches the streams
	// within this of the read that found it.
	tipStreamTick = 50 * time.Millisecond
	// /v1/health's tip_streams fails while streams were refused at the cap
	// in tipRefusedMinutes distinct minutes of the last tipRefusedWindow:
	// the cap is then lower than the readers, where a refusal or a burst of
	// them is not (tipStreamsCheck).
	tipRefusedWindow  = 15 * time.Minute
	tipRefusedMinutes = 5
	// tipStatsEvery is the pace of the journal's line on the streams
	// (logTipStats).
	tipStatsEvery = 10 * time.Minute
)

// tipRefusedSlots is how many one-minute counts cover tipRefusedWindow.
const tipRefusedSlots = int(tipRefusedWindow / time.Minute)

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
	// keepAlive, lifetime and read are tipStreamKeepAlive,
	// tipStreamLifetime and cachedTip (the producer's read), but in tests.
	keepAlive time.Duration
	lifetime  time.Duration
	read      func() (tipResponse, uint64)
	// For the journal alone (logTipStats, logTipRefusals): the most open at
	// once since the API started and since the last line on them, the
	// streams refused at the cap since the API started and since that line,
	// when it was written, and the refusals not said yet.
	peak       int
	recentPeak int
	refused    int64
	recent     int64
	statsAt    time.Time
	loggedAt   time.Time
	unlogged   int64
	// refusedIn is the refusals at the cap by minute over the last
	// tipRefusedWindow, for /v1/health (tipStreamsCheck).
	refusedIn [tipRefusedSlots]struct{ minute, n int64 }
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

// initTipStreams sets what the options left unset; newServer calls it
// after them.
func (s *Server) initTipStreams() {
	t := &s.streams
	if t.max < 0 {
		t.max = DefaultTipStreams
	}
	if t.keepAlive == 0 {
		t.keepAlive = tipStreamKeepAlive
	}
	if t.lifetime == 0 {
		t.lifetime = tipStreamLifetime
	}
	if t.read == nil {
		t.read = s.cachedTip
	}
	t.statsAt = s.now()
}

// EndTipStreams ends every tip stream and refuses new ones. observer-api
// calls it as its HTTP server begins to shut down
// (http.Server.RegisterOnShutdown): a stream never falls idle, and the
// shutdown would otherwise wait out its whole drain for them. Close calls
// it too, and so does a producer that fails.
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
	life := time.NewTimer(lifeOf(s.streams.lifetime))
	defer life.Stop()
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
			if !send(timeFrame("ping", s.now())) {
				return
			}
		case <-life.C:
			// the page opens a new one at once, as it would on connecting
			send(timeFrame("end", s.now()))
			return
		}
	}
}

// lifeOf is a stream's life: d, less up to a twelfth of it, so the pages
// one restart connected at once do not all come back at once.
func lifeOf(d time.Duration) time.Duration {
	if j := d / 12; j > 0 {
		d -= rand.N(j)
	}
	return d
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
		t.recent++
		t.unlogged++
		t.noteRefused(now)
		s.logTipRefusals(now)
		return nil, false
	}
	if t.subs == nil {
		t.subs = map[chan tipEvent]struct{}{}
	}
	ch := make(chan tipEvent, 1)
	t.subs[ch] = struct{}{}
	t.peak = max(t.peak, len(t.subs))
	t.recentPeak = max(t.recentPeak, len(t.subs))
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
//
// A panic of its own is not the API's: it is logged, every stream is ended
// and refused from then on, and the pages ask /v1/tip every second until
// the API restarts, as they did before the streams. Every lock it takes is
// let go on the way out (deferred), cachedTip's too.
func (s *Server) tipProducer() {
	defer s.bg.Done()
	defer func() {
		if p := recover(); p != nil {
			if s.log != nil {
				s.log.Printf("tip streams: the producer failed: %v; every stream is ended, and the pages ask /v1/tip every second until the API restarts", p)
			}
			s.EndTipStreams()
			s.streams.mu.Lock()
			s.streams.running = false
			s.streams.mu.Unlock()
		}
	}()
	tick := time.NewTicker(tipStreamTick)
	defer tick.Stop()
	var last tipEvent
	for {
		select {
		case <-s.streams.end:
		case <-tick.C:
		}
		if !s.tipStreamsWanted() {
			return
		}
		v, gen := s.streams.read()
		if gen == last.gen {
			continue
		}
		key, frame := tipFrame(v)
		if bytes.Equal(key, last.key) {
			last.gen = gen
			continue
		}
		last = tipEvent{gen: gen, key: key, frame: frame}
		s.handTipEvent(last)
	}
}

// tipStreamsWanted is whether the producer goes on: a stream is open and the
// server is not stopping. When not, the producer is marked stopped, under
// the lock a stream joins under, so the next stream starts another. The
// journal's lines that are due are written on the way.
func (s *Server) tipStreamsWanted() bool {
	t := &s.streams
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.subs) == 0 || t.ended {
		t.running = false
		return false
	}
	now := s.now()
	s.logTipRefusals(now)
	s.logTipStats(now)
	return true
}

// handTipEvent offers ev to every open stream.
func (s *Server) handTipEvent(ev tipEvent) {
	t := &s.streams
	t.mu.Lock()
	defer t.mu.Unlock()
	for ch := range t.subs {
		offer(ch, ev)
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

// timeFrame is an event whose data is the server's time alone: a ping, or
// the end of a stream's life.
func timeFrame(name string, now time.Time) []byte {
	return []byte("event: " + name + "\ndata: {\"server_time\":\"" + now.UTC().Format(time.RFC3339Nano) + "\"}\n\n")
}

// noteRefused counts a refusal at the cap in its minute. Called with t.mu
// held.
func (t *tipStreams) noteRefused(now time.Time) {
	m := now.Unix() / 60
	slot := m % int64(len(t.refusedIn))
	b := &t.refusedIn[slot]
	if b.minute != m {
		b.minute, b.n = m, 0
	}
	b.n++
}

// refusedMinutes is how many distinct minutes of the last tipRefusedWindow,
// this one among them, saw a stream refused at the cap. Called with t.mu
// held.
func (t *tipStreams) refusedMinutes(now time.Time) int {
	m := now.Unix() / 60
	n := 0
	for _, b := range t.refusedIn {
		age := m - b.minute
		if b.n > 0 && age >= 0 && age < int64(len(t.refusedIn)) {
			n++
		}
	}
	return n
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

// logTipStats writes the journal's line on the streams every tipStatsEvery
// while any is open: how many are open, the most at once since the last
// line and since the API started, the cap, and the refusals at it since the
// last line. /v1/health publishes none of it. Called with s.streams.mu
// held.
func (s *Server) logTipStats(now time.Time) {
	t := &s.streams
	if now.Sub(t.statsAt) < tipStatsEvery {
		return
	}
	if s.log != nil {
		s.log.Printf("tip streams: %d open, at most %d at once in the last %s and %d since the API started, of %d allowed; %d refused at the cap in the last %s",
			len(t.subs), t.recentPeak, fmtMinutes(now.Sub(t.statsAt)), t.peak, t.max, t.recent, fmtMinutes(now.Sub(t.statsAt)))
	}
	t.statsAt, t.recentPeak, t.recent = now, len(t.subs), 0
}

// tipStreamsCheck is /v1/health's tip_streams row. It fails while streams
// were refused at the cap in tipRefusedMinutes distinct minutes of the last
// tipRefusedWindow: no page shows less for it (a refused page asks /v1/tip
// every second, as every page did before the streams), but the cap is then
// lower than the readers, and the health watch says so. One refusal, or a
// burst, does not. /v1/health is public, so the row says that and no more:
// the streams open, their peak and the cap are in the journal
// (logTipStats).
func (s *Server) tipStreamsCheck(now time.Time) healthCheck {
	t := &s.streams
	t.mu.Lock()
	n := t.refusedMinutes(now)
	t.mu.Unlock()
	if n >= tipRefusedMinutes {
		return healthCheck{"tip_streams", false, fmt.Sprintf("refusing streams at the cap in %d of the last %s: their pages ask /v1/tip every second instead", n, fmtMinutes(tipRefusedWindow))}
	}
	return healthCheck{"tip_streams", true, "ok"}
}
