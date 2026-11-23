package probe

// The limit on connections to one validator's server.
//
// Every request opens a connection of its own (downloadAndVerify), where
// celestia-app's Fibre client keeps one connection to a validator and sends
// every request over it. From celestia-app v12 a Fibre server allows 16
// connections per source address and closes the rest at once
// (fibre/internal/grpc: DefaultMaxConnectionsPerIP, limitedListener); before
// v12 it allowed 16 in all and left the rest waiting to be accepted. A
// connection closed that way reads here as a handshake that failed, the
// validator's failure, although this observer's own connections filled the
// server's count: up to BlobConcurrency readings (16) can each have a
// request open to one validator, beside the one later attempt in flight to
// it (retry.go) and the endpoint check's connection (observer-heartbeat, a
// process of its own at the same address).
//
// So the prober holds at most Config.EndpointConcurrency connections to one
// server at a time (DefaultEndpointConcurrency, 12): the readings'
// requests, the later attempts and the connect checks of this observer's
// own side (Prober.networkUp) together.
//
// A server counts by source address on the address it listens at, so the
// slots are kept by the host a request is dialled at, the validator's
// registered host:port (Target.Host, in lower case), not by validator. Two
// validators registered at one host:port share its slots, as they share the
// server's count. Two different names for one server do not: the address a
// name resolves to is known only inside the request, when its time is
// already running.
//
// Like this observer's other limits it only delays. A request takes its
// slot in Prober.admitBy, before its time starts, and the wait is on its
// row with the rest of its wait for room (LoadInfo.AdmitWaitMS); the wait
// is bounded by the request's start cutoff, and one that could not start by
// then is not made (NOT_PROBED, this observer's gap). The slot is held
// until the request has ended and its connection is closed. The client's
// one re-dial within a request goes out under the slot the request already
// holds, after the first try's connection is closed, so it never waits for
// a slot of its own.
//
// The limit is for the connection count alone. A v12 server also refuses,
// with ResourceExhausted, a request from an address that already has 8
// being received (fibre/internal/grpc admission.go: admissionPerIP). A
// request counts as being received until its body is read, its wait of up
// to 3 s for the server's request memory budget included. With that budget
// free the time is too short for nine of this observer's requests to
// overlap; with it full, the 9th to 12th open to one server at once are
// refused where a client's one request would have waited, and the row reads
// RPC_THROTTLED, the validator's answer (classify.go). A limit under 8
// would rule that out and leave 12 to 14 blobs a minute with one server
// holding every request its whole time, below what mocha has settled
// (deploy/README.md, "What the prober sustains"), so it is not taken.

import (
	"context"
	"strings"
	"sync"
	"time"
)

// DefaultEndpointConcurrency is the connections held at once to one
// validator's server that sentinel-probe sets when -endpoint-concurrency is
// not given: 12 of the 16 a celestia-app v12 server allows one source
// address. The four left are for the endpoint check's connection, from the
// same address, and for the connections this side has closed and the server
// has not counted out yet when the next one reaches it: a re-dial, the next
// request waiting for the slot, or the second address of a host raced
// beside the first (raceDial). With 16 readings at once, at most 17
// requests can want one validator's server at the same moment (one of each
// reading and one later attempt), so the limit binds only when nearly every
// reading in progress is waiting on the same server. What it costs then: a
// reading keeps its blob slot until its last answer is in, so with one
// server that every reading asks and that holds each request its whole time
// (15 s, and 15 s more for the re-dial), 12 readings end in 30 s where 16
// did: 24 blobs a minute against 32, and 22 while that server's later
// attempt holds a slot too.
const DefaultEndpointConcurrency = 12

// endpointSlots bounds the connections held at once to each host. A nil
// *endpointSlots is no limit.
type endpointSlots struct {
	limit int

	mu    sync.Mutex
	lines map[string]*endpointLine
}

// endpointLine is one host's slots: a send takes one, waiting its turn
// while they are all taken, and a receive gives one back. users counts
// those holding a slot or waiting for one, so the line is dropped when the
// last of them leaves.
type endpointLine struct {
	slots chan struct{}
	users int
}

// newEndpointSlots allows limit connections to each host at once; nil (no
// limit) when limit is not positive.
func newEndpointSlots(limit int) *endpointSlots {
	if limit <= 0 {
		return nil
	}
	return &endpointSlots{limit: limit, lines: map[string]*endpointLine{}}
}

// endpointKey is the name a host's slots are kept under: the host:port as
// dialled, in lower case, as a host name reads the same in either case.
func endpointKey(host string) string { return strings.ToLower(host) }

// acquire takes one of host's slots, waiting for one while they are all
// taken, until ctx ends or expired fires (nil: no bound). ok is false, with
// nothing held, when no slot came in time. release gives the slot back, and
// does so once however often it is called. No limit (a nil receiver) and no
// host (nothing is dialled) take nothing and never wait.
func (s *endpointSlots) acquire(ctx context.Context, host string, expired <-chan time.Time) (release func(), ok bool) {
	key := endpointKey(host)
	if s == nil || key == "" {
		return func() {}, true
	}
	s.mu.Lock()
	l := s.lines[key]
	if l == nil {
		l = &endpointLine{slots: make(chan struct{}, s.limit)}
		s.lines[key] = l
	}
	l.users++
	s.mu.Unlock()
	leave := func() {
		s.mu.Lock()
		if l.users--; l.users == 0 {
			delete(s.lines, key)
		}
		s.mu.Unlock()
	}
	// A free slot is taken at once, whatever else is ready: only a request
	// that had to wait can be told there was none.
	select {
	case l.slots <- struct{}{}:
	default:
		select {
		case l.slots <- struct{}{}:
		case <-ctx.Done():
			leave()
			return nil, false
		case <-expired:
			leave()
			return nil, false
		}
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			<-l.slots
			leave()
		})
	}, true
}
