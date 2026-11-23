package probe

import (
	"context"
	"errors"
	"net"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// held is how many of host's slots are taken, waiting how many requests
// wait for one, and hosts how many hosts have a slot taken or waited for.
func (s *endpointSlots) held(host string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if l := s.lines[endpointKey(host)]; l != nil {
		return len(l.slots)
	}
	return 0
}

func (s *endpointSlots) waiting(host string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if l := s.lines[endpointKey(host)]; l != nil {
		return l.users - len(l.slots)
	}
	return 0
}

func (s *endpointSlots) hosts() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.lines)
}

// The prober holds no more connections to one server than its limit: forty
// requests to one host asked for at once, with room for three, are in
// flight three at a time at most, every one is let go in the end, and
// nothing is left taken. A host's name reads the same in either case.
func TestTheEndpointLimitHolds(t *testing.T) {
	const limit, n = 3, 40
	p := testProber(t)
	p.cfg.EndpointConcurrency = limit
	p.initPace()
	var busy, most, done atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			host := "fibre.one.example:7980"
			if i%2 == 1 {
				host = "Fibre.One.Example:7980"
			}
			release, _, err := p.admitBy(context.Background(), time.Time{}, host, 1, 1)
			if err != nil {
				t.Error(err)
				return
			}
			defer release()
			b := busy.Add(1)
			defer busy.Add(-1)
			for {
				m := most.Load()
				if b <= m || most.CompareAndSwap(m, b) {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
			done.Add(1)
		}(i)
	}
	wg.Wait()
	if done.Load() != n {
		t.Fatalf("%d of %d requests let go", done.Load(), n)
	}
	if m := most.Load(); m < 1 || m > limit {
		t.Fatalf("%d requests to one server in flight at once, want at most %d", m, limit)
	}
	if p.endpoints.hosts() != 0 || len(p.reqs) != 0 || p.bytes.inFlight() != 0 {
		t.Fatalf("left taken: %d hosts, %d requests, %d bytes", p.endpoints.hosts(), len(p.reqs), p.bytes.inFlight())
	}
}

// A request waiting for a server's slot is let go when one frees, and not
// before; a request to another server does not wait behind it; and a slot
// given back twice is given back once.
func TestAWaiterGoesWhenASlotFrees(t *testing.T) {
	s := newEndpointSlots(1)
	const host = "fibre.one.example:7980"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	first, ok := s.acquire(ctx, host, nil)
	if !ok {
		t.Fatal("the first request was not let go")
	}
	got := make(chan func(), 1)
	go func() {
		if release, ok := s.acquire(ctx, host, nil); ok {
			got <- release
		}
	}()
	waitFor(t, 5*time.Second, func() bool { return s.waiting(host) == 1 })
	other, ok := s.acquire(ctx, "fibre.two.example:7980", nil)
	if !ok {
		t.Fatal("a request to another server waited behind this one's")
	}
	other()
	select {
	case <-got:
		t.Fatal("the second request was let go while the first held the server's one slot")
	case <-time.After(100 * time.Millisecond):
	}
	first()
	first()
	var second func()
	select {
	case second = <-got:
	case <-time.After(5 * time.Second):
		t.Fatal("the waiter was not let go when the slot freed")
	}
	if s.held(host) != 1 || s.waiting(host) != 0 {
		t.Fatalf("%d slots taken with %d waiting, want the waiter's one and none", s.held(host), s.waiting(host))
	}
	second()
	if s.hosts() != 0 {
		t.Fatalf("%d hosts kept with nothing taken", s.hosts())
	}
}

// A request that gives up while it waits for a server's slot, because the
// run stopped or its start cutoff came, holds nothing: the slot goes to the
// next request once it frees, and nothing is left taken.
func TestARequestThatGivesUpLeavesNoSlot(t *testing.T) {
	s := newEndpointSlots(1)
	const host = "fibre.one.example:7980"
	first, ok := s.acquire(context.Background(), host, nil)
	if !ok {
		t.Fatal("the first request was not let go")
	}
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan bool, 1)
	go func() {
		_, ok := s.acquire(ctx, host, nil)
		stopped <- !ok
	}()
	waitFor(t, 5*time.Second, func() bool { return s.waiting(host) == 1 })
	cancel()
	if !<-stopped {
		t.Fatal("a stopped run's request was let go past the limit")
	}
	start := time.Now()
	cutoff := time.NewTimer(150 * time.Millisecond)
	defer cutoff.Stop()
	if _, ok := s.acquire(context.Background(), host, cutoff.C); ok {
		t.Fatal("a request was let go past the limit at its cutoff")
	}
	if waited := time.Since(start); waited < 100*time.Millisecond {
		t.Fatalf("the request gave up after %s, want it to wait until its cutoff", waited)
	}
	if s.held(host) != 1 || s.waiting(host) != 0 {
		t.Fatalf("%d slots taken with %d waiting, want the first request's one and none", s.held(host), s.waiting(host))
	}
	first()
	if s.hosts() != 0 {
		t.Fatalf("%d hosts kept with nothing taken", s.hosts())
	}
	bounded, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	next, ok := s.acquire(bounded, host, nil)
	if !ok {
		t.Fatal("the slot was not free after the requests that gave up")
	}
	next()
	if s.hosts() != 0 {
		t.Fatalf("%d hosts kept with nothing taken", s.hosts())
	}
}

// The wait for a server's slot is this observer's own, as its other waits
// for room are: it is on the request's load as admit wait, none of it the
// reading-rate ceiling's. A request to another server is not held up. A
// request whose cutoff comes while it waits is not let go, says which limit
// held it and holds nothing, and neither does one whose run stopped.
func TestTheWaitForAServersSlotIsAdmitWait(t *testing.T) {
	p := testProber(t)
	p.cfg.EndpointConcurrency = 1
	p.initPace()
	const host = "fibre.one.example:7980"
	ctx := context.Background()
	first, _, err := p.admitBy(ctx, time.Time{}, host, 1, 1)
	if err != nil {
		t.Fatal(err)
	}

	other, load, err := p.admitBy(ctx, time.Now().Add(5*time.Second), "fibre.two.example:7980", 1, 1)
	if err != nil || load.AdmitWaitMS > 500 {
		t.Fatalf("a request to another server: %v, load %+v", err, load)
	}
	other()

	start := time.Now()
	_, _, err = p.admitBy(ctx, start.Add(200*time.Millisecond), host, 1, 1)
	if !errors.Is(err, errEndpointFull) {
		t.Fatalf("a request past its cutoff: %v, want %v", err, errEndpointFull)
	}
	if waited := time.Since(start); waited < 150*time.Millisecond || waited > 3*time.Second {
		t.Fatalf("the request gave up after %s, want at its cutoff 200 ms on", waited)
	}

	stopping, stop := context.WithCancel(ctx)
	stopped := make(chan error, 1)
	go func() {
		_, _, err := p.admitBy(stopping, time.Time{}, host, 1, 1)
		stopped <- err
	}()
	waitFor(t, 5*time.Second, func() bool { return p.endpoints.waiting(host) == 1 })
	stop()
	if err := <-stopped; !errors.Is(err, context.Canceled) {
		t.Fatalf("a stopped run's request: %v, want %v", err, context.Canceled)
	}
	if p.endpoints.held(host) != 1 || len(p.reqs) != 1 || p.bytes.inFlight() != 1 {
		t.Fatalf("held after two requests gave up: %d slots, %d requests, %d bytes, want the first request's alone",
			p.endpoints.held(host), len(p.reqs), p.bytes.inFlight())
	}

	// The 300 ms count from when the request is already waiting, so the
	// wait it measures is never shorter.
	go func() {
		for end := time.Now().Add(5 * time.Second); p.endpoints.waiting(host) != 1 && time.Now().Before(end); {
			time.Sleep(time.Millisecond)
		}
		time.Sleep(300 * time.Millisecond)
		first()
	}()
	second, load, err := p.admitBy(ctx, time.Now().Add(30*time.Second), "FIBRE.One.Example:7980", 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if load.AdmitWaitMS < 250 || load.RateWaitMS != 0 {
		t.Fatalf("load %+v, want the 300 ms wait for the server's slot as admit wait", load)
	}
	second()
	waitFor(t, 5*time.Second, func() bool { return p.endpoints.hosts() == 0 })
	if len(p.reqs) != 0 || p.bytes.inFlight() != 0 {
		t.Fatalf("left taken: %d requests, %d bytes", len(p.reqs), p.bytes.inFlight())
	}
}

// 0 is no limit: a hundred requests to one server are in flight at once.
// The default sentinel-probe sets is 12, a negative setting is none, and a
// validator with no registered host, to which nothing is dialled, takes no
// slot.
func TestNoEndpointLimitAtZero(t *testing.T) {
	if newEndpointSlots(0) != nil || newEndpointSlots(-1) != nil {
		t.Fatal("a limit of 0 or less keeps slots")
	}
	p := testProber(t)
	if p.cfg.EndpointConcurrency != 0 || p.endpoints != nil {
		t.Fatalf("a configuration without a limit has one: %d", p.cfg.EndpointConcurrency)
	}
	var releases []func()
	for i := 0; i < 100; i++ {
		release, load, err := p.admitBy(context.Background(), time.Now().Add(5*time.Second), "fibre.one.example:7980", 1, 1)
		if err != nil || load.AdmitWaitMS > 500 {
			t.Fatalf("request %d: %v, load %+v", i, err, load)
		}
		releases = append(releases, release)
	}
	if len(p.reqs) != 100 {
		t.Fatalf("%d requests in flight, want all 100", len(p.reqs))
	}
	for _, release := range releases {
		release()
	}
	negative := Config{EndpointConcurrency: -3}.withDefaults()
	if negative.EndpointConcurrency != 0 {
		t.Fatalf("a negative limit became %d, want none", negative.EndpointConcurrency)
	}
	p.cfg.EndpointConcurrency = DefaultEndpointConcurrency
	p.initPace()
	if p.endpoints == nil || p.endpoints.limit != 12 {
		t.Fatal("the default limit of 12 is not set")
	}
	p.cfg.EndpointConcurrency = 1
	p.initPace()
	for i := 0; i < 3; i++ {
		if _, ok := p.endpoints.acquire(context.Background(), "", nil); !ok {
			t.Fatal("a request with no host waited for a slot")
		}
	}
	if p.endpoints.hosts() != 0 {
		t.Fatalf("%d hosts kept for requests with no host", p.endpoints.hosts())
	}
}

// The wait for a server's slot is not the request's time: three promises
// over one blob, read at once with room for one connection to the validator
// they share, reach it one at a time, each row's own time is its request's
// alone, and the last one's wait, about 600 ms, is on its row as admit
// wait. Every one served: waiting on this observer's limit is never counted
// against a validator.
func TestTheWaitForAServersSlotIsNotTheRequestsTime(t *testing.T) {
	f := newReadFixture(t, 4, 8, []fakeVal{{rows: []int{0, 1, 2, 3}, serve: fakeSlow(300 * time.Millisecond)}})
	b2, b3 := *f, *f
	b2.pub.PromiseHash, b3.pub.PromiseHash = strings.Repeat("e2", 32), strings.Repeat("e3", 32)
	p := readProber(t, f, &b2, &b3)
	p.cfg.EndpointConcurrency = 1
	p.initPace()
	ms := readNow(t, p, f.pub, b2.pub, b3.pub)
	if len(ms) != 3 {
		t.Fatalf("%d rows, want one per blob", len(ms))
	}
	if n := f.maxBusy[0].Load(); n != 1 {
		t.Fatalf("the validator had %d requests at once, want one at a time", n)
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].StartedAt.Before(ms[j].StartedAt) })
	for i, m := range ms {
		if m.Outcome != OutcomeServedOK || !m.Download.CommitmentVerified || m.Retry != nil || m.ObserverLoad == nil {
			t.Fatalf("row %d: %s / %s, retry %+v, load %+v", i, m.Outcome, m.Classification, m.Retry, m.ObserverLoad)
		}
		if m.TotalDurationMS >= 750 { // the last two waited about 300 and 600 ms
			t.Fatalf("row %d took %d ms of its own, its wait for room %d ms: the wait was counted in the request's time",
				i, m.TotalDurationMS, m.ObserverLoad.AdmitWaitMS)
		}
	}
	last := ms[2]
	if last.ObserverLoad.AdmitWaitMS < 500 || last.ObserverLoad.RateWaitMS != 0 || last.StartedAt.Sub(ms[0].StartedAt) < 500*time.Millisecond {
		t.Fatalf("the last request waited %d ms (%d of them the ceiling's) and started %s after the first, want about 600 ms",
			last.ObserverLoad.AdmitWaitMS, last.ObserverLoad.RateWaitMS, last.StartedAt.Sub(ms[0].StartedAt))
	}
	if st := p.readStatus(); st["admit_wait_p95_ms"].(int64) < 500 || st["requests_not_started_last_hour"].(int) != 0 {
		t.Fatalf("status %+v", st)
	}
	if p.endpoints.hosts() != 0 {
		t.Fatalf("%d hosts kept with every reading written", p.endpoints.hosts())
	}
}

// A later attempt takes one of the same slots as the readings' requests:
// with room for one connection to a validator, the attempt it is owed on
// one blob, due while another blob's reading is asking it, waits for that
// request to end, and the wait is on the attempt's row. The validator never
// has two requests at once.
func TestALaterAttemptSharesTheServersSlots(t *testing.T) {
	f := newReadFixture(t, 4, 8, []fakeVal{{rows: []int{0, 1, 2, 3}, serve: firstThen(1, fakeNotFound, fakeSlow(500*time.Millisecond))}})
	other := *f
	other.pub.PromiseHash = strings.Repeat("e2", 32)
	p := readProber(t, f, &other)
	p.cfg.EndpointConcurrency = 1
	p.initPace()
	p.cfg.RetrySpacing = 50 * time.Millisecond
	ms := readFull(t, p, f.pub, other.pub)
	if len(ms) != 3 || f.calls[0].Load() != 3 {
		t.Fatalf("%d rows, the validator asked %d times, want both readings' requests and one later attempt", len(ms), f.calls[0].Load())
	}
	if n := f.maxBusy[0].Load(); n != 1 {
		t.Fatalf("the validator had %d requests at once, want the later attempt to wait for the reading's", n)
	}
	for _, m := range ms {
		if m.Attempt != 1 {
			continue
		}
		if m.Outcome != OutcomeServedOK || m.ObserverLoad == nil || m.ObserverLoad.AdmitWaitMS < 200 {
			t.Fatalf("the later attempt: %s, load %+v, want it served after waiting for the server's slot", m.Outcome, m.ObserverLoad)
		}
		return
	}
	t.Fatal("no later attempt on record")
}

// The client's re-dial goes out under the slot its request already holds:
// with room for one connection to the validator, a request whose first try
// ran out of time is made again at once and serves, and the slot is free
// when the reading is written.
func TestTheRedialTakesNoSecondSlot(t *testing.T) {
	f := newReadFixture(t, 4, 8, []fakeVal{{rows: []int{0, 1, 2, 3}, serve: firstThen(1, fakeHangs, fakeServes)}})
	p := readProber(t, f)
	p.cfg.EndpointConcurrency = 1
	p.initPace()
	p.cfg.Timeouts.Download = 300 * time.Millisecond
	ms := readNow(t, p, f.pub)
	if len(ms) != 1 {
		t.Fatalf("%d rows, want one", len(ms))
	}
	if m := ms[0]; !m.Download.CommitmentVerified || m.Retry == nil || m.Retry.FirstOutcome != OutcomeRPCTimeout || f.calls[0].Load() != 2 {
		t.Fatalf("%s, retry %+v, asked %d times, want served on the re-dial", m.Outcome, m.Retry, f.calls[0].Load())
	}
	if p.endpoints.hosts() != 0 {
		t.Fatalf("%d hosts kept with the reading written", p.endpoints.hosts())
	}
}

// The connect check of this observer's own side is one of the connections
// held to the server it tries: with that server's one slot taken the check
// does not connect, and waits no longer than its own time; with the slot
// free it connects, and gives the slot back.
func TestTheConnectCheckTakesAServersSlot(t *testing.T) {
	up, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer up.Close()
	p := testProber(t)
	p.cfg.EndpointConcurrency = 1
	p.initPace()
	const host = "fibre.ok.example:7980"
	p.reach.note(answered("v1", host, time.Now().UTC().Add(-time.Minute), up.Addr().String(), true))
	held, ok := p.endpoints.acquire(context.Background(), host, nil)
	if !ok {
		t.Fatal("the server's slot was not free")
	}
	short, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	if p.networkUp(short, "v9", "") {
		t.Fatal("the check connected to a server whose one slot was taken")
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Fatalf("the check waited %s for the slot, want no longer than its own time", took)
	}
	held()
	// one check answers for ten seconds: the next is of another kind
	if !p.networkUp(context.Background(), "v9", "IPv4") {
		t.Fatal("the check did not connect with the server's slot free")
	}
	if p.endpoints.hosts() != 0 {
		t.Fatalf("%d hosts kept after the check", p.endpoints.hosts())
	}
}
