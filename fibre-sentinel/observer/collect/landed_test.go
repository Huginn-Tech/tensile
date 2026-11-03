package collect_test

import (
	"context"
	"testing"
	"time"
)

// A pass that stores a new blob tells Landed once, after the read; a pass
// that finds nothing new does not, so the API is not sent to the store for
// nothing.
func TestAPassThatStoresABlobTellsLanded(t *testing.T) {
	now := time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC)
	c := newCollector(t, testdataDir(t, false), &fakeStatus{})
	told := 0
	c.Landed = func() { told++ }
	if errs := c.Pass(context.Background(), now); len(errs) != 0 {
		t.Fatalf("first pass: %v", errs)
	}
	if told != 1 {
		t.Fatalf("a pass that stored the record's blobs told %d times, want 1", told)
	}
	if errs := c.Pass(context.Background(), now.Add(10*time.Second)); len(errs) != 0 {
		t.Fatalf("second pass: %v", errs)
	}
	if told != 1 {
		t.Fatalf("a pass with nothing new told: %d in all, want 1", told)
	}
}
