package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/plsgiveup/fibre/fibre-sentinel/internal/status"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// storeBlob writes a blob settled at height h and endorsed by val, and
// returns its promise hash.
func storeBlob(t *testing.T, st *store.Store, idx int, h int64, at time.Time, val string) string {
	t.Helper()
	hash := fmt.Sprintf("%064x", 0x7b0000+idx)
	if _, err := st.DB().Exec(`INSERT INTO publications (
		promise_hash, commitment, blob_version, blob_size, namespace, chain_id,
		promise_height, creation_timestamp, signer, signer_public_key,
		validator_signature_count, settlement_height, settlement_time,
		settlement_tx_hash, settlement_tx_index, settlement_tx_code,
		must_serve_until, must_serve_until_basis, shard_retention_s,
		payment_promise_timeout_s, assignment_error, validator_set_height,
		total_voting_power, sigma_rows, distinct_rows, wrap_overlaps,
		validators_with_rows, recorded_at, raw_json
	) VALUES (?,?,0,1024,'aa','test',?,?,'signer','pk',0,?,?,'tx',0,0,?,'shard_retention',14400,3600,
		'',?,0,0,0,0,0,?,'{}')`,
		hash, hash, h-1, store.TS(at), h, store.TS(at), store.TS(at.Add(4*time.Hour)), h, store.TS(at)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB().Exec(`INSERT INTO assignments (promise_hash, validator_address, voting_power, row_count, rows_json, attested, settlement_height)
		VALUES (?, ?, 10, 9, '[]', 1, ?)`, hash, val, h); err != nil {
		t.Fatal(err)
	}
	return hash
}

// A new blob's rows come in front of the tip that names it, with the total;
// the blob the stream opened with is the page's own read, and is not sent.
func TestTipStreamCarriesANewBlobsRows(t *testing.T) {
	_, st, ts := streamServer(t)
	val := "aa00000000000000000000000000000000000001"
	now := time.Now().UTC()
	storeBlob(t, st, 1, 900, now.Add(-time.Minute), val)
	_, evs := openStream(t, ts)
	tipAt(t, evs, 1000, 3*time.Second)
	// the producer's first read: the blob it opens with
	time.Sleep(400 * time.Millisecond)

	hash := storeBlob(t, st, 2, 901, now, val)
	ev := nextEvent(t, evs, "blobs", 3*time.Second)
	var got struct {
		Blobs []struct {
			PromiseHash string   `json:"promise_hash"`
			Endorsers   []string `json:"endorsers"`
		} `json:"blobs"`
		Total int64 `json:"total"`
	}
	if err := json.Unmarshal([]byte(ev.data), &got); err != nil {
		t.Fatalf("blobs event %q: %v", ev.data, err)
	}
	if len(got.Blobs) != 1 || got.Blobs[0].PromiseHash != hash {
		t.Fatalf("the event's rows are not the new blob's: %s", ev.data)
	}
	if len(got.Blobs[0].Endorsers) != 1 || got.Blobs[0].Endorsers[0] != val {
		t.Errorf("the row's endorsers: %v", got.Blobs[0].Endorsers)
	}
	if got.Total != 2 {
		t.Errorf("total %d, want 2", got.Total)
	}
	if tip := nextEvent(t, evs, "tip", 3*time.Second); !strings.Contains(tip.data, hash) {
		t.Errorf("the tip behind the rows does not name the blob: %s", tip.data)
	}
}

// What comes after the blob last sent: the rows above its height, or the rest
// of its block when the collector stored the block in two reads.
func TestTipBlobRows(t *testing.T) {
	srv, st, _ := streamServer(t)
	val := "aa00000000000000000000000000000000000001"
	now := time.Now().UTC()
	storeBlob(t, st, 1, 900, now, val)
	storeBlob(t, st, 2, 901, now, val)
	newest := storeBlob(t, st, 3, 902, now, val)

	rows, total, err := srv.tipBlobRows(t.Context(), 900, 902)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].PromiseHash != newest || total != 3 {
		t.Errorf("above 900: %d rows, first %s, total %d", len(rows), rows[0].PromiseHash, total)
	}
	rows, _, err = srv.tipBlobRows(t.Context(), 902, 902)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].PromiseHash != newest {
		t.Errorf("the same height: %d rows", len(rows))
	}
}

// The collector's word wakes the producer, and no other file in the status
// directory does; with no data directory there is nothing to watch.
func TestBlobMarkWatch(t *testing.T) {
	dir := t.TempDir()
	s := &Server{dataDir: dir}
	marked, stop := s.blobMarkWatch()
	defer stop()
	if err := os.WriteFile(filepath.Join(dir, "status", "scanner.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case <-marked:
		t.Fatal("another file's write woke the producer")
	case <-time.After(200 * time.Millisecond):
	}
	if err := status.MarkBlob(dir); err != nil {
		t.Fatal(err)
	}
	select {
	case <-marked:
	case <-time.After(3 * time.Second):
		t.Fatal("the word did not wake the producer")
	}

	none, stopNone := (&Server{}).blobMarkWatch()
	defer stopNone()
	if none != nil {
		t.Error("a watch with no data directory")
	}
}

// expireTip makes the next read a new one, whatever the answer's age.
func TestExpireTip(t *testing.T) {
	srv, _, _ := streamServer(t)
	_, before := srv.cachedTip()
	srv.expireTip()
	if _, after := srv.cachedTip(); after == before {
		t.Errorf("the read after expireTip is the same one (%d)", after)
	}
}
