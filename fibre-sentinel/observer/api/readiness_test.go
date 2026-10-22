package api

import (
	"testing"

	"github.com/plsgiveup/fibre/fibre-sentinel/internal/probe"
)

// The newest heartbeat decides; not ready is a state only at two answers in
// a row; an unanswered newest heartbeat is unchecked, never the answer before
// it as current; nothing is claimed before anything was answered.
func TestReadinessOf(t *testing.T) {
	const (
		serving    = probe.ReadinessServing
		notServing = probe.ReadinessNotServing
		notRep     = probe.ReadinessNotReported
		unmeasured = probe.ReadinessUnmeasured
	)
	hb := func(at, status string) readinessAnswer { return readinessAnswer{at: at, verified: true, status: status} }
	failed := func(at string) readinessAnswer { return readinessAnswer{at: at} }
	for _, tc := range []struct {
		name string
		rows []readinessAnswer
		want readiness
	}{
		{"nothing", nil, readiness{}},
		{"before the question", []readinessAnswer{hb("t3", ""), hb("t2", "")}, readiness{}},
		{"a failed check before the question", []readinessAnswer{failed("t3"), hb("t2", "")}, readiness{}},
		{"ready", []readinessAnswer{hb("t3", serving), hb("t2", notServing)}, readiness{state: readinessReady, checkedAt: "t3"}},
		{"not reported", []readinessAnswer{hb("t3", notRep)}, readiness{state: readinessNotReported, checkedAt: "t3"}},
		{"not ready once", []readinessAnswer{hb("t3", notServing), hb("t2", serving)}, readiness{state: readinessNotReadyOnce, checkedAt: "t3"}},
		{"not ready once, first answer", []readinessAnswer{hb("t3", notServing)}, readiness{state: readinessNotReadyOnce, checkedAt: "t3"}},
		{"not ready", []readinessAnswer{hb("t3", notServing), hb("t2", notServing)}, readiness{state: readinessNotReady, checkedAt: "t3"}},
		{"not ready across an unanswered one", []readinessAnswer{hb("t3", notServing), hb("t2", unmeasured), hb("t1", notServing)},
			readiness{state: readinessNotReady, checkedAt: "t3"}},
		{"not ready once after a failed check", []readinessAnswer{hb("t3", notServing), failed("t2"), hb("t1", notServing)},
			readiness{state: readinessNotReadyOnce, checkedAt: "t3"}},
		{"unanswered", []readinessAnswer{hb("t3", unmeasured), hb("t2", unmeasured), hb("t1", serving)},
			readiness{state: readinessUnchecked, checkedAt: "t3", lastAnswer: readinessReady, lastAnswerAt: "t1"}},
		{"unanswered, nothing before", []readinessAnswer{hb("t3", unmeasured)}, readiness{state: readinessUnchecked, checkedAt: "t3"}},
		{"one failed check while up", []readinessAnswer{failed("t3"), hb("t2", notServing)},
			readiness{state: readinessUnchecked, checkedAt: "t3", lastAnswer: readinessNotReady, lastAnswerAt: "t2"}},
	} {
		if got := readinessOf(tc.rows); got != tc.want {
			t.Errorf("%s: %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

// Ready is true only when ready and false only when not ready; the last
// answer goes out only beside an unchecked one.
func TestSetReadiness(t *testing.T) {
	for _, tc := range []struct {
		rd    readiness
		ready *bool
	}{
		{readiness{state: readinessReady, checkedAt: "t"}, readyPtr(true)},
		{readiness{state: readinessNotReady, checkedAt: "t"}, readyPtr(false)},
		{readiness{state: readinessNotReadyOnce, checkedAt: "t"}, nil},
		{readiness{state: readinessNotReported, checkedAt: "t"}, nil},
		{readiness{state: readinessUnchecked, checkedAt: "t", lastAnswer: readinessReady, lastAnswerAt: "s"}, nil},
	} {
		var v validatorRow
		v.setReadiness(tc.rd)
		if v.Readiness != tc.rd.state || v.ReadinessCheckedAt == nil || *v.ReadinessCheckedAt != "t" {
			t.Errorf("%s: readiness %q at %v", tc.rd.state, v.Readiness, v.ReadinessCheckedAt)
		}
		if (v.Ready == nil) != (tc.ready == nil) || (v.Ready != nil && *v.Ready != *tc.ready) {
			t.Errorf("%s: ready %v, want %v", tc.rd.state, v.Ready, tc.ready)
		}
		if (v.ReadinessLastAnswer != "") != (tc.rd.lastAnswer != "") || (v.ReadinessLastAnswerAt != nil) != (tc.rd.lastAnswer != "") {
			t.Errorf("%s: last answer %q at %v", tc.rd.state, v.ReadinessLastAnswer, v.ReadinessLastAnswerAt)
		}
	}
	var v validatorRow
	v.setReadiness(readiness{})
	if v.Readiness != "" || v.Ready != nil || v.ReadinessCheckedAt != nil {
		t.Errorf("nothing known published %+v", v)
	}
}

func readyPtr(b bool) *bool { return &b }
