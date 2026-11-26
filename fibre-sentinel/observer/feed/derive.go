package feed

import (
	"fmt"
	"time"
)

// Beat is one reachability heartbeat as the feed needs it. Rows the
// observer filed as its own failure (PROBE_ERROR) must not be passed in:
// they say nothing about the validator.
type Beat struct {
	At        time.Time
	Host      string
	Reachable bool // TCP and TLS completed
	// Identity is the consensus-key verdict on a reachable beat:
	// "verified", "expired", "mismatch" or "" (not judged: an older row, or
	// a handshake that stopped before the check). Ignored when unreachable.
	Identity string
}

// Event kinds the transition walk produces.
const (
	KindUnreachable      = "unreachable"
	KindRecovered        = "recovered"
	KindIdentityProblem  = "identity"
	KindIdentityRestored = "identity-restored"
)

// Event is one derived state change.
type Event struct {
	Kind string
	At   time.Time // when the change began: the first beat of the run that confirmed it
	Host string
	// Identity is the identity verdict for KindIdentityProblem.
	Identity string
	// Since is the start of the episode a recovery ends (KindRecovered,
	// KindIdentityRestored), so the entry can say how long it lasted. Zero
	// when the episode was not watched throughout (MaxBeatGap): its length
	// is then not known.
	Since time.Time
	// Beats is how many consecutive beats confirmed the change.
	Beats int
}

// MaxBeatGap is the longest pause between two beats that still counts as
// watching. A validator out of the bonded provider list (jailed, unbonding)
// is not checked at all, so an episode that spans such a pause has no known
// length: it may have been put right on the first day and nobody looked.
const MaxBeatGap = time.Hour

// Transitions walks the beats (oldest first) and reports when the endpoint
// became unreachable, when it recovered, when its certificate stopped being
// endorsed by the validator's key and when that was put right.
//
// A change counts only after n consecutive beats agree (n >= 1): with the
// heartbeat every five minutes, n = 3 means a quarter of an hour, which
// keeps a single dropped handshake (half of every path is this observer's
// own) out of anyone's feed reader. The event is dated at the first beat of
// the confirming run, which is when the state actually changed; that date is
// also what the entry's ID is built from, so it is stable across polls.
//
// The state at the start of the input is taken as the baseline, not
// reported: a validator that was already down when the window opened has
// no "became unreachable" inside it, only, perhaps, a recovery.
func Transitions(beats []Beat, n int) []Event {
	if n < 1 {
		n = 1
	}
	var out []Event

	// Reachability: up/down with a confirmation run.
	const unknown, up, down = 0, 1, 2
	state := unknown
	var runStart time.Time
	runLen, runState := 0, unknown
	var downSince, prevAt, gapAt time.Time
	var runHost string
	for _, b := range beats {
		if !prevAt.IsZero() && b.At.Sub(prevAt) > MaxBeatGap {
			gapAt = b.At
		}
		prevAt = b.At
		s := down
		if b.Reachable {
			s = up
		}
		if s != runState {
			runState, runLen, runStart, runHost = s, 0, b.At, b.Host
		}
		runLen++
		if s == state || runLen < n {
			continue
		}
		switch {
		case state == unknown:
			// baseline, not an event
		case s == down:
			out = append(out, Event{Kind: KindUnreachable, At: runStart, Host: runHost, Beats: runLen})
			downSince = runStart
		case s == up:
			since := downSince
			if gapAt.After(since) {
				since = time.Time{} // not watched throughout
			}
			out = append(out, Event{Kind: KindRecovered, At: runStart, Host: runHost, Since: since, Beats: runLen})
		}
		state = s
	}

	// Identity, over reachable beats only: an unreachable beat has no
	// certificate to judge and neither starts nor ends an identity episode.
	// Unjudged beats ("") are skipped for the same reason.
	idState := ""
	var idRunStart, idSince time.Time
	idRunLen, idRun := 0, ""
	var idHost string
	prevAt, gapAt = time.Time{}, time.Time{}
	for _, b := range beats {
		if !prevAt.IsZero() && b.At.Sub(prevAt) > MaxBeatGap {
			gapAt = b.At
		}
		prevAt = b.At
		if !b.Reachable || b.Identity == "" {
			continue
		}
		if b.Identity != idRun {
			idRun, idRunLen, idRunStart, idHost = b.Identity, 0, b.At, b.Host
		}
		idRunLen++
		if b.Identity == idState || idRunLen < n {
			continue
		}
		switch {
		case idState == "":
			// baseline
		case b.Identity == "verified":
			since := idSince
			if gapAt.After(since) {
				since = time.Time{} // not watched throughout
			}
			out = append(out, Event{Kind: KindIdentityRestored, At: idRunStart, Host: idHost, Since: since, Beats: idRunLen})
		default:
			// verified -> problem, or one problem turning into another
			// (expired -> mismatch is a new fact worth an entry).
			out = append(out, Event{Kind: KindIdentityProblem, At: idRunStart, Host: idHost, Identity: b.Identity, Beats: idRunLen})
			if idState == "verified" {
				idSince = idRunStart
			}
		}
		idState = b.Identity
	}
	return out
}

// Span renders a duration the way the site does, coarse: "3 h 20 min".
func Span(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%d s", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%d min", int(d.Minutes()))
	}
	if d < 48*time.Hour {
		h := int(d.Hours())
		m := int(d.Minutes()) - h*60
		if m == 0 {
			return fmt.Sprintf("%d h", h)
		}
		return fmt.Sprintf("%d h %d min", h, m)
	}
	return fmt.Sprintf("%d days", int(d.Hours()/24))
}
