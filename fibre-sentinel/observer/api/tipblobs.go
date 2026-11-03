package api

// A new blob's row on the tip stream.
//
// A page used to learn of a new blob from the tip, wait up to half a second
// at a time of its own, and ask /v1/blobs for the row: one read of the store
// and one round trip per open page, per block with a blob, and most of the
// wait between a block and its blob on the overview. The stream now carries
// the row: as the producer finds a newest blob the last answer did not name,
// it reads the rows settled since the newest blob it saw before once, however
// many pages are open, and sends them, newest first, in front of the tip that
// names them.
// After a pause, or two blocks stored in one tick, they span blocks; a block
// stored in two reads is sent again whole, so a row can come twice:
//
//	event: blobs
//	data: {"blobs":[<rows as /v1/blobs?endorsers=1 gives them>],"total":n}
//
// total is the settlements on record, /v1/blobs' total, read in the same
// snapshot as the rows. The two events go out as one write, and a slow
// reader's newer event replaces the pair (offer), so a page can miss rows; a
// read the store does not answer in time sends none. It finds out from
// total, or from a tip
// naming a blob it does not hold, and asks /v1/blobs as it did before; a page
// with no stream never hears of this event.
//
// The collector's word (internal/status, MarkBlob) makes the producer look at
// once rather than at the tip's next read. Without the word the rows still
// come, a quarter of a second later at most.

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/plsgiveup/fibre/fibre-sentinel/internal/status"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

const (
	// tipBlobsMax is the most rows one event holds: as many as a page of
	// /v1/blobs?endorsers=1, and more than the overview's grid shows, so a
	// busy block does not send every open page to /v1/blobs at once. A page
	// told of more by the total reads /v1/blobs.
	tipBlobsMax = maxEndorsersPage
	// tipBlobsTimeout bounds the reads of one event: the producer waits for
	// them, and a tip that waits longer is worth more than the rows.
	tipBlobsTimeout = time.Second
)

// tipBlobsEvent is a blobs event's data.
type tipBlobsEvent struct {
	Blobs []blobRow `json:"blobs"`
	Total int64     `json:"total"`
}

// tipBlobsFrame is the blobs event for newest, the tip's latest_blob, when it
// is not sent, the last it sent; nil when there is nothing to send or the
// store did not answer in time, and a page then reads /v1/blobs. The first
// blob the producer sees is noted and not sent: a page has it from its own
// read.
func (s *Server) tipBlobsFrame(sent *tipBlob, newest *tipBlob) []byte {
	if newest == nil || newest.PromiseHash == sent.PromiseHash {
		return nil
	}
	last := *sent
	*sent = *newest
	if last.PromiseHash == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), tipBlobsTimeout)
	defer cancel()
	rows, total, err := s.tipBlobRows(ctx, last.SettlementHeight, newest.SettlementHeight)
	if err != nil {
		s.tipErr(&s.streams.blobsErrAt, s.now(), "newest blobs' rows", err)
		return nil
	}
	if len(rows) == 0 {
		return nil
	}
	b, err := json.Marshal(tipBlobsEvent{Blobs: rows, Total: total})
	if err != nil {
		return nil
	}
	frame := make([]byte, 0, len(b)+22)
	frame = append(frame, "event: blobs\ndata: "...)
	frame = append(frame, b...)
	return append(frame, "\n\n"...)
}

// tipBlobRows is what the event holds: the rows above height from, or those
// of the height when the newest blob is at the height last sent (a block
// whose rows the collector stored in two reads), newest first, and the total.
// The rows and the total are one snapshot of the store when a transaction
// slot is free (readTx): a block stored between two separate reads would put
// the total ahead of the rows, and every page would take that for rows it
// missed. The transaction holds a connection while blobRows reads the
// charges and the probe marks through the database, which is why it takes a
// slot. With none free, or a store with one connection, it reads as before,
// statement by statement, rather than keep the tip waiting: a total ahead of
// the rows only sends the pages to /v1/blobs.
func (s *Server) tipBlobRows(ctx context.Context, from, height int64) ([]blobRow, int64, error) {
	where := `settlement_height > ?`
	if height <= from {
		where = `settlement_height = ?`
	}
	var rows []blobRow
	var total int64
	read := func(q store.Querier) (err error) {
		if rows, err = s.blobRows(withQuerier(ctx, q), where, tipBlobsMax, from); err != nil {
			return err
		}
		return q.QueryRowContext(ctx, `SELECT COUNT(*) FROM publications`).Scan(&total)
	}
	var err error
	select {
	case s.txSlots <- struct{}{}: // never, with no slots (a nil channel)
		tx, e := s.st.DB().BeginTx(ctx, nil)
		if err = e; err == nil {
			err = read(tx)
			_ = tx.Rollback()
		}
		<-s.txSlots
	default:
		err = read(s.st.DB())
	}
	if err != nil {
		return nil, 0, err
	}
	rows, _ = trim(rows, tipBlobsMax)
	for i := range rows {
		rows[i].CreationTimestamp = ""
	}
	if err := s.blobEndorsers(ctx, rows); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// expireTip makes the next read of the tip a new one.
func (s *Server) expireTip() {
	s.tip.mu.Lock()
	defer s.tip.mu.Unlock()
	s.tip.at = time.Time{}
}

// blobMarkWatch watches the collector's word for as long as the producer
// runs: a channel that receives when the word is written, and how to stop. A
// watch that cannot start is said once and costs nothing else: the channel is
// nil, which is never ready, and the producer reads at its own pace.
func (s *Server) blobMarkWatch() (<-chan struct{}, func()) {
	if s.dataDir == "" {
		return nil, func() {}
	}
	path := filepath.Clean(status.BlobMarkPath(s.dataDir))
	w, err := fsnotify.NewWatcher()
	if err == nil {
		err = os.MkdirAll(filepath.Dir(path), 0o755)
		if err == nil {
			err = w.Add(filepath.Dir(path))
		}
		if err != nil {
			_ = w.Close()
		}
	}
	if err != nil {
		if s.log != nil {
			s.log.Printf("tip streams: cannot watch for new blobs (%v): the tip's own reads find them", err)
		}
		return nil, func() {}
	}
	c := make(chan struct{}, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if filepath.Clean(ev.Name) != path || ev.Op == fsnotify.Chmod {
					continue
				}
				select {
				case c <- struct{}{}:
				default: // one is already waiting for the producer
				}
			case err, ok := <-w.Errors:
				if !ok {
					return
				}
				if s.log != nil && !errors.Is(err, fsnotify.ErrEventOverflow) {
					s.log.Printf("tip streams: watching for new blobs: %v", err)
				}
			}
		}
	}()
	return c, func() {
		_ = w.Close()
		<-done
	}
}
