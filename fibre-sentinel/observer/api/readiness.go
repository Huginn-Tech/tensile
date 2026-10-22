package api

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/plsgiveup/fibre/fibre-sentinel/internal/probe"
)

// The readiness a validator row publishes (validatorRow.Readiness), from
// what its endpoint answered when this observer's heartbeat asked whether it
// is ready to take uploads (probe.ReadinessResult).
const (
	readinessReady = "ready"
	// the server reported at least one of its own checks failing at two
	// heartbeats in a row, unanswered ones between them aside
	readinessNotReady = "not_ready"
	// at the newest heartbeat only: one answer is not yet a state, as one
	// timeout is not an outage
	readinessNotReadyOnce = "not_ready_once"
	readinessNotReported  = "not_reported"
	// the newest heartbeat could not ask, or was not answered
	readinessUnchecked = "unchecked"
)

// readinessDepth is how many of an endpoint's newest heartbeats its
// readiness is read from: the newest, and enough before it to reach the
// answer before one or two unanswered questions.
const readinessDepth = 4

// readinessRowsSQL is the newest heartbeats of one validator's host by this
// observer, newest first, up to readinessDepth, by as_of when pinned. It
// walks reachability_latest_answer in rowid order, as the flaky check in
// reachabilityNow does: the host, the vantage and the time are written with
// a unary plus so no other index is a candidate. TestHotQueriesUseIndexes
// pins the plan.
func readinessRowsSQL(asOf string) string {
	pin := ""
	if asOf != "" {
		pin = ` AND +q.started_at <= ?`
	}
	return `SELECT q.started_at, q.tls_ok, q.identity_ok, q.raw_json FROM reachability q
		WHERE q.validator_address = ? AND q.outcome <> 'PROBE_ERROR' AND +q.validator_host = ? AND +q.vantage = ?` + pin + `
		ORDER BY q.rowid DESC LIMIT ` + strconv.Itoa(readinessDepth)
}

// readinessAnswer is one heartbeat's part in an endpoint's readiness: when
// it ran, whether it verified the identity, and the answer it got (a
// probe.Readiness* status), empty when it asked nothing: its identity was
// not verified, or it ran before the question was asked.
type readinessAnswer struct {
	at       string
	verified bool
	status   string
}

// readiness is what an endpoint's newest heartbeats say (readinessOf).
type readiness struct {
	state     string // a readiness* word; empty when nothing is known
	checkedAt string // the newest heartbeat
	// lastAnswer and lastAnswerAt, when unchecked, are the newest answer
	// before it, as a readiness* word, and when it was given
	lastAnswer, lastAnswerAt string
}

// readinessOf reads an endpoint's readiness from its newest heartbeats,
// newest first. The newest decides: ready, not reported, or not ready (a
// state only when the answer before it, unanswered questions skipped, said
// so too). A newest heartbeat that was not answered, or did not reach a
// verified identity while the endpoint still counts as up (one failure after
// a success, or another vantage's check), is unchecked, never the answer
// before it as current; that answer goes beside it with its time. Nothing is
// known when no heartbeat of them was answered.
func readinessOf(rows []readinessAnswer) readiness {
	answered := false
	for _, r := range rows {
		if r.status != "" {
			answered = true
			break
		}
	}
	if !answered {
		return readiness{}
	}
	r0 := rows[0]
	out := readiness{checkedAt: r0.at}
	switch {
	case r0.status == probe.ReadinessServing:
		out.state = readinessReady
	case r0.status == probe.ReadinessNotReported:
		out.state = readinessNotReported
	case r0.status == probe.ReadinessNotServing:
		out.state = readinessNotReadyOnce
		for _, r := range rows[1:] {
			if r.status == probe.ReadinessUnmeasured {
				continue
			}
			if r.status == probe.ReadinessNotServing {
				out.state = readinessNotReady
			}
			break
		}
	case r0.status == probe.ReadinessUnmeasured || !r0.verified:
		out.state = readinessUnchecked
		for _, r := range rows[1:] {
			if w := readinessWord(r.status); w != "" {
				out.lastAnswer, out.lastAnswerAt = w, r.at
				break
			}
		}
	default:
		// verified and not asked: a heartbeat from before the question, on
		// an endpoint whose later ones were answered, which rowid order
		// does not give; nothing is claimed
		return readiness{}
	}
	return out
}

// readinessWord is an answer as a readiness* word; empty for none or an
// unanswered question.
func readinessWord(status string) string {
	switch status {
	case probe.ReadinessServing:
		return readinessReady
	case probe.ReadinessNotServing:
		return readinessNotReady
	case probe.ReadinessNotReported:
		return readinessNotReported
	}
	return ""
}

// readinessStatus is the readiness answer an endpoint check record carries,
// empty when it has none or cannot be read.
func readinessStatus(line []byte) string {
	var r struct {
		Readiness *probe.ReadinessResult `json:"readiness"`
	}
	if json.Unmarshal(line, &r) != nil || r.Readiness == nil {
		return ""
	}
	return r.Readiness.Status
}

// readinessNow is the readiness of addr's endpoint at host from this
// observer's newest heartbeats of it, by asOf when pinned (readinessOf).
func (s *Server) readinessNow(ctx context.Context, addr, host, asOf string) (readiness, error) {
	args := []any{addr, host, s.vantage}
	if asOf != "" {
		args = append(args, asOf)
	}
	q := s.q(ctx)
	rows, err := q.QueryContext(ctx, readinessRowsSQL(asOf), args...)
	if err != nil {
		return readiness{}, err
	}
	type heartbeat struct {
		a   readinessAnswer
		raw []byte
	}
	var hbs []heartbeat
	for rows.Next() {
		var h heartbeat
		var tls, id int
		if err := rows.Scan(&h.a.at, &tls, &id, &h.raw); err != nil {
			rows.Close()
			return readiness{}, err
		}
		h.a.verified = tls == 1 && id == 1
		hbs = append(hbs, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return readiness{}, err
	}
	// The records are read once the rows are closed (ReachRecord). One that
	// cannot be read counts as a heartbeat that asked nothing.
	answers := make([]readinessAnswer, len(hbs))
	for i, h := range hbs {
		answers[i] = h.a
		if !h.a.verified {
			continue
		}
		if line, err := s.st.ReachRecord(ctx, q, h.raw); err == nil {
			answers[i].status = readinessStatus(line)
		}
	}
	return readinessOf(answers), nil
}

// setReadiness publishes rd on v.
func (v *validatorRow) setReadiness(rd readiness) {
	if rd.state == "" {
		return
	}
	v.Readiness = rd.state
	switch rd.state {
	case readinessReady:
		yes := true
		v.Ready = &yes
	case readinessNotReady:
		no := false
		v.Ready = &no
	}
	at := rd.checkedAt
	v.ReadinessCheckedAt = &at
	if rd.lastAnswer != "" {
		last := rd.lastAnswerAt
		v.ReadinessLastAnswer, v.ReadinessLastAnswerAt = rd.lastAnswer, &last
	}
}
