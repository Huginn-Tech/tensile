package api

import "testing"

// /v1/health and the alerts read from it name a component's error only by
// its stage, and the names a status file gives (work stages, stop reasons)
// only when they are plain words: never a host name, an address, a path or
// markup, whatever a status file holds.
func TestHealthSaysOnlyPlainWordsOfAStatusFile(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"", "none"},
		{"chain status: rpc error: code = Unavailable", "chain status"},
		{"gap at h=1234: missing block", "gap at h=1234"},
		{"export: open /var/lib/x: denied", "export"},
		{"dial tcp 10.0.0.1:9090: refused", "in its journal"},
		{"no colon at all", "in its journal"},
		{"lookup rpc.example.com: no such host", "in its journal"},
		{"<b>x</b>: y", "in its journal"},
		{"@everyone: y", "in its journal"},
		{"a stage name that runs on far past forty letters: y", "in its journal"},
	} {
		if got := errorStage(c.in); got != c.want {
			t.Errorf("errorStage(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	for _, c := range []struct{ in, want string }{
		{"exit", "exit"},
		{"late verdicts", "late verdicts"},
		{"", "unnamed"},
		{"<a href=x>", "unnamed"},
		{"10.0.0.1", "unnamed"},
		{"[x](http://y)", "unnamed"},
	} {
		if got := publicWord(c.in); got != c.want {
			t.Errorf("publicWord(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
