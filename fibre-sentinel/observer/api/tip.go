package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/plsgiveup/fibre/fibre-sentinel/internal/status"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// tipResponse is the newest block, for the site's block ticker: the one figure
// on the page that moves with every block, so a reader can see the observer is
// following the chain without a status paragraph telling them so. With a node
// to ask (WithTipRPC) it is the node's newest committed block, asked when the
// cached answer is a quarter of a second old; otherwise the newest the scanner
// has read.
type tipResponse struct {
	Height int64 `json:"height"`
	// BlockTime is the block's own timestamp; absent while the scanner is
	// catching up, when the block it last read is not the tip.
	BlockTime   *time.Time `json:"block_time,omitempty"`
	FibreActive bool       `json:"fibre_active"`
	// LatestBlob is the newest blob the store holds, in /v1/blobs' own order;
	// absent while it holds none. It is here so a page can tell that a blob
	// arrived from the stream it already reads every second, and ask
	// /v1/blobs only then, rather than every few seconds in case one did.
	LatestBlob *tipBlob `json:"latest_blob,omitempty"`
	// LatestEndpointEvent is the newest endpoint registration or change on
	// record, of any validator; absent while there is none. The overview's map
	// names it, and names the next one as soon as the stream it already reads
	// every second carries it.
	LatestEndpointEvent *tipEndpointEvent `json:"latest_endpoint_event,omitempty"`
	ServerTime          time.Time         `json:"server_time"`
}

// tipBlob names a blob: the marker a page compares with the blobs it holds,
// and the height it settled at, so the marker can be told from an older one
// without a second request.
type tipBlob struct {
	PromiseHash      string `json:"promise_hash"`
	SettlementHeight int64  `json:"settlement_height"`
}

// tipEndpointEvent is one validator's newest successful endpoint
// registration, as its endpoint_history words it: registered (its first
// endpoint) or changed (another than the one before). A registration of the
// endpoint it already had (same), a failed one, and a change a scan gap hid
// (after_gap) are not events here.
type tipEndpointEvent struct {
	Address         string `json:"address"` // the consensus address, as /v1/validators' address
	OperatorAddress string `json:"operator_address,omitempty"`
	Moniker         string `json:"moniker,omitempty"`
	Outcome         string `json:"outcome"` // registered | changed
	Host            string `json:"host"`
	PreviousHost    string `json:"previous_host,omitempty"` // changed only
	Height          int64  `json:"height"`
	// Time is the block's time as the store writes it (store.TS), as
	// endpoint_history gives it.
	Time   string `json:"time"`
	TxHash string `json:"tx_hash,omitempty"`
}

// hostEventsMarkSQL moves whenever a registration is stored: host_events'
// highest rowid, which SQLite reads from the table's last entry (its min/max
// optimisation, which a wrapping COALESCE would turn off). Rows are only
// ever inserted, never updated or deleted, so an unchanged mark is an
// unchanged table.
const hostEventsMarkSQL = `SELECT MAX(rowid) FROM host_events`

// newestEndpointEventsSQL is the newest registrations read from the chain's
// transactions, newest first across every validator, each with the hash of
// the transaction it came from when its cost line is on record (the join
// hostWalkSQL makes). Asked only when the mark moves.
const newestEndpointEventsSQL = `SELECT h.cons_address, h.from_height, h.from_tx_index, h.host, h.time, COALESCE(c.tx_hash, '')
	FROM host_events h
	LEFT JOIN tx_costs c ON c.height = h.from_height AND c.tx_index = h.from_tx_index - 1
	WHERE h.source = 'event'
	ORDER BY h.from_height DESC, h.from_tx_index DESC, h.cons_address DESC LIMIT 64`

// hostBeforeSQL is the host a validator had before (height, from_tx_index):
// its step just before it, of any source, as the walk takes it
// (sqlite_autoindex_host_events_1).
const hostBeforeSQL = `SELECT host FROM host_events
	WHERE cons_address = ? AND (from_height < ? OR (from_height = ? AND from_tx_index < ?))
	ORDER BY from_height DESC, from_tx_index DESC LIMIT 1`

// tipEndpointMaxAge is how long the newest endpoint event is kept when no
// registration arrives: long enough that the tip asks for it again about
// once a minute, short enough that a validator's new moniker shows.
const tipEndpointMaxAge = time.Minute

// latestBlobSQL is the newest publication in /v1/blobs' order (settlement
// height, then position in the block, both descending). The highest height
// comes from publications_settlement's last entry, which SQLite reads without
// walking the index (its min/max optimisation), and only that block's
// publications are then sought through the same index and sorted: a handful of
// rows however many millions the table holds. The page's own statement with
// LIMIT 1 would read the index from its top and stop just as soon, but its plan
// prints as a SCAN, the shape TestHotQueriesUseIndexes exists to refuse.
const latestBlobSQL = `SELECT promise_hash, settlement_height FROM publications
	WHERE settlement_height = (SELECT MAX(settlement_height) FROM publications)
	ORDER BY settlement_tx_index DESC LIMIT 1`

// tipStoreTimeout bounds the store's reads of one answer: those before the
// node is asked together, and the collector's meta row after it, when that
// answers, together again. A read in WAL mode is never blocked by the
// collector writing, but it waits for a connection of the pool while long
// reads hold them all; the cache's mutex is held while readTip runs, and
// every reader waits on it.
const tipStoreTimeout = 500 * time.Millisecond

// tipCache keeps one answer for a quarter of a second: every open page polls
// this route every second, so however many readers there are, the node and the
// store are each asked at most four times a second, and a new block (or a new
// blob) shows within that of the node committing it (or the collector storing
// it).
type tipCache struct {
	mu sync.Mutex
	at time.Time
	v  tipResponse
	// blobErrAt is when a failure to read the newest blob was last logged,
	// so a store that keeps failing is said once a minute, not four times a
	// second.
	blobErrAt time.Time
	// gen counts the reads, so a tip stream can tell an answer from an
	// older one (tipstream.go).
	gen uint64
	// ep is the newest endpoint event (latestEndpointEvent), worked out at
	// epAt when host_events' mark was epMark: worked out again only when the
	// mark moves or tipEndpointMaxAge has passed, so the answer costs one
	// read of the mark, not a walk of the registrations. epErrAt is as
	// blobErrAt.
	ep      *tipEndpointEvent
	epMark  int64
	epAt    time.Time
	epErrAt time.Time
}

const tipTTL = 250 * time.Millisecond

// tipRPCTimeout bounds one ask of the node; past it the scanner's file answers.
const tipRPCTimeout = 800 * time.Millisecond

func (s *Server) handleTip(w http.ResponseWriter, r *http.Request) {
	v, _ := s.cachedTip()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}

// cachedTip is the answer /v1/tip gives now: the one kept, read afresh once
// it is tipTTL old, with the server's time. gen is the read it came from
// (tipCache.gen). /v1/tip and the tip streams' producer both read it here,
// so the node and the store are asked at the one pace however many read.
// The lock is let go deferred: a read that panics leaves no later reader
// waiting on it.
func (s *Server) cachedTip() (tipResponse, uint64) {
	now := s.now()
	s.tip.mu.Lock()
	defer s.tip.mu.Unlock()
	if now.Sub(s.tip.at) >= tipTTL {
		s.tip.v = s.readTip(now)
		s.tip.at = now
		s.tip.gen++
	}
	v := s.tip.v
	v.ServerTime = now.UTC()
	return v, s.tip.gen
}

// readTip asks the node first (WithTipRPC): its newest committed block, the
// moment it has it. Without a node, or when it does not answer in time, the
// scanner's status file answers (written within a second of each block while
// it follows the tip, after reading it), and the collector's meta row (a poll
// behind) when the scanner has written nothing. The newest blob comes from the
// store whichever of them answers.
//
// The store is read within tipStoreTimeout, never through Store.Meta, which
// takes no context and waited for a free connection for as long as the reads
// ahead of it ran, with the cache's mutex held. A store that does not answer
// in time costs this answer its store figures, not the answer: Fibre's state
// stays the last answer's, which the store has not been seen to change, and
// so does the block when the collector's row is the one left to name it.
// Called with s.tip.mu held.
func (s *Server) readTip(now time.Time) tipResponse {
	var out tipResponse
	ctx, cancel := context.WithTimeout(context.Background(), tipStoreTimeout)
	defer cancel()
	if active, err := s.metaWithin(ctx, "fibre_active"); err == nil {
		out.FibreActive = active == "yes"
	} else {
		out.FibreActive = s.tip.v.FibreActive
	}
	out.LatestBlob = s.latestBlob(ctx, now)
	out.LatestEndpointEvent = s.latestEndpointEvent(ctx, now)
	cancel()
	if s.tipRPC != "" {
		if h, t, ok := nodeTip(s.tipRPC); ok {
			out.Height, out.BlockTime = h, &t
			return out
		}
	}
	if s.dataDir != "" {
		if r, ok := status.ReadOne(filepath.Join(s.dataDir, "status"), "scanner"); ok {
			out.Height = r.Height
			if v, ok := r.Detail["chain_tip"].(float64); ok && int64(v) > out.Height {
				out.Height = int64(v)
			}
			if v, ok := r.Detail["tip_block_time"].(string); ok {
				if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
					out.BlockTime = &t
				}
			}
			if out.Height > 0 {
				return out
			}
		}
	}
	// The meta row is read within a timeout of its own, begun only now: a
	// node that does not answer takes tipRPCTimeout to say so, longer than
	// the reads above were given.
	mctx, mcancel := context.WithTimeout(context.Background(), tipStoreTimeout)
	defer mcancel()
	v, err := s.metaWithin(mctx, "chain_height")
	if err != nil {
		out.Height, out.BlockTime = s.tip.v.Height, s.tip.v.BlockTime
		return out
	}
	if v != "" {
		out.Height, _ = strconv.ParseInt(v, 10, 64)
	}
	if v, _ := s.metaWithin(mctx, "chain_tip_time"); v != "" {
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			out.BlockTime = &t
		}
	}
	return out
}

// metaWithin is Store.Meta within ctx: one meta value, "" when the key is
// not there.
func (s *Server) metaWithin(ctx context.Context, key string) (string, error) {
	var v string
	err := s.st.DB().QueryRowContext(ctx, `SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// latestBlob is the newest blob the store holds (latestBlobSQL); nil when it
// holds none, or when the store could not say within ctx, in which case the
// answer leaves the field out and a page reads /v1/blobs at its slow pace, as
// it would from an API that never published it. Called with s.tip.mu held.
func (s *Server) latestBlob(ctx context.Context, now time.Time) *tipBlob {
	var b tipBlob
	if err := s.st.DB().QueryRowContext(ctx, latestBlobSQL).Scan(&b.PromiseHash, &b.SettlementHeight); err != nil {
		if !errors.Is(err, sql.ErrNoRows) && s.log != nil && now.Sub(s.tip.blobErrAt) >= time.Minute {
			s.tip.blobErrAt = now
			s.log.Printf("tip: newest blob: %v", err)
		}
		return nil
	}
	return &b
}

// latestEndpointEvent is the newest endpoint event on record, kept in the
// tip's cache: the mark is read with every answer the cache makes (at most
// four a second, whoever is reading), and the registrations are walked only
// when it moved or the event is tipEndpointMaxAge old. A store that does not
// answer within ctx leaves the last event standing. Called with s.tip.mu
// held.
func (s *Server) latestEndpointEvent(ctx context.Context, now time.Time) *tipEndpointEvent {
	var mark sql.NullInt64
	if err := s.st.DB().QueryRowContext(ctx, hostEventsMarkSQL).Scan(&mark); err != nil {
		s.tipErr(&s.tip.epErrAt, now, "newest endpoint event", err)
		return s.tip.ep
	}
	if !s.tip.epAt.IsZero() && mark.Int64 == s.tip.epMark && now.Sub(s.tip.epAt) < tipEndpointMaxAge {
		return s.tip.ep
	}
	ev, err := s.newestEndpointEvent(ctx)
	if err != nil {
		s.tipErr(&s.tip.epErrAt, now, "newest endpoint event", err)
		return s.tip.ep
	}
	s.tip.ep, s.tip.epMark, s.tip.epAt = ev, mark.Int64, now
	return ev
}

// tipErr logs a failed read of the tip's, once a minute at most (at).
func (s *Server) tipErr(at *time.Time, now time.Time, what string, err error) {
	if s.log != nil && now.Sub(*at) >= time.Minute {
		*at = now
		s.log.Printf("tip: %s: %v", what, err)
	}
}

// newestEndpointEvent walks the newest registrations, newest first, to the
// first that registered or changed an endpoint (eventOutcome, the walk's own
// word); nil when none of them did.
func (s *Server) newestEndpointEvent(ctx context.Context) (*tipEndpointEvent, error) {
	type reg struct {
		addr, host, at, hash string
		height               int64
		fromTx               int
	}
	rows, err := s.st.DB().QueryContext(ctx, newestEndpointEventsSQL)
	if err != nil {
		return nil, err
	}
	var regs []reg
	for rows.Next() {
		var r reg
		if err := rows.Scan(&r.addr, &r.height, &r.fromTx, &r.host, &r.at, &r.hash); err != nil {
			rows.Close()
			return nil, err
		}
		regs = append(regs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, r := range regs {
		var prev string
		prevSet := true
		err := s.st.DB().QueryRowContext(ctx, hostBeforeSQL, r.addr, r.height, r.height, r.fromTx).Scan(&prev)
		if errors.Is(err, sql.ErrNoRows) {
			prevSet = false
		} else if err != nil {
			return nil, err
		}
		outcome := eventOutcome(prevSet, prev, r.host)
		if outcome != endpointRegistered && outcome != endpointChanged {
			continue
		}
		ev := &tipEndpointEvent{Address: strings.ToLower(r.addr), Outcome: outcome, Host: r.host, Height: r.height,
			Time: store.TS(parseTS(r.at)), TxHash: strings.ToLower(r.hash)}
		if outcome == endpointChanged {
			ev.PreviousHost = prev
		}
		ops, err := s.operatorAddrs(ctx)
		if err != nil {
			return nil, err
		}
		names, err := s.monikers(ctx)
		if err != nil {
			return nil, err
		}
		ev.OperatorAddress, ev.Moniker = ops[ev.Address], names[ev.Address]
		return ev, nil
	}
	return nil, nil
}

// nodeTip asks a CometBFT RPC's /status for its newest committed block.
func nodeTip(rpc string) (int64, time.Time, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), tipRPCTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(rpc, "/")+"/status", nil)
	if err != nil {
		return 0, time.Time{}, false
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, time.Time{}, false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, time.Time{}, false
	}
	var body struct {
		Result struct {
			SyncInfo struct {
				Height string `json:"latest_block_height"`
				Time   string `json:"latest_block_time"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return 0, time.Time{}, false
	}
	h, err := strconv.ParseInt(body.Result.SyncInfo.Height, 10, 64)
	if err != nil || h <= 0 {
		return 0, time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, body.Result.SyncInfo.Time)
	if err != nil {
		return 0, time.Time{}, false
	}
	return h, t.UTC(), true
}
