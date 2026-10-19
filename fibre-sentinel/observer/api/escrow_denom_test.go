package api_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cosmos/cosmos-sdk/types/bech32"

	"github.com/plsgiveup/fibre/fibre-sentinel/internal/scan"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/api"
	"github.com/plsgiveup/fibre/fibre-sentinel/observer/store"
)

// otherDenom is an IBC denomination. x/fibre at the pinned v10 takes an
// escrow deposit in any denomination (no denom check until celestia-app PR
// #8143, in v11) and creates the escrow in its first deposit's; every later
// movement of that escrow is in the same one, and the record keeps each as
// the chain wrote it.
const otherDenom = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"

// The transactions of the account whose escrow is held in otherDenom.
var (
	odDepositTx = strings.Repeat("d1", 32)
	odPaidTx    = strings.Repeat("d2", 32) // its first withdrawal request, paid out
	odQueuedTx  = strings.Repeat("d3", 32) // its second, still queued
	odMixedTx   = strings.Repeat("d4", 32) // two signers' deposits, one in each denomination
)

// addOtherDenomAccount stores, beside queueServer's, an account whose escrow
// is held in otherDenom, as the chain would have it, and returns it:
//
//   - a deposit of 1,000,000 31 h before the sample settlement, and ten days
//     ago one of 5,000 in a transaction where otherPublisher deposited 7
//     utia;
//   - a withdrawal of 300,000 requested 30 h before the settlement, read
//     queued, paid out by the begin-blocker once payable and read gone:
//     executed;
//   - a withdrawal of 400,000 requested 5 h before it, still queued;
//   - its escrow read at the last queue read: balance 705,000, available
//     305,000.
func addOtherDenomAccount(t *testing.T, st *store.Store, settle time.Time) string {
	t.Helper()
	b := make([]byte, 20)
	for i := range b {
		b[i] = 0x44
	}
	acct, err := bech32.ConvertAndEncode("celestia", b)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	pay := func(p scan.Payment) {
		t.Helper()
		p.SchemaVersion, p.RecordedAt = 1, p.Time.Add(time.Second)
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		if ok, err := st.UpsertPayment(p, raw); err != nil || !ok {
			t.Fatalf("payment %s: inserted %v, %v", p.DedupeKey, ok, err)
		}
	}
	reqA := settle.Add(-30 * time.Hour).Truncate(time.Second)
	reqB := settle.Add(-5 * time.Hour).Truncate(time.Second)
	mixed := now.Add(-10 * 24 * time.Hour)
	pay(scan.Payment{DedupeKey: odMixedTx + ":0", Kind: scan.PaymentDeposit, Height: 35, Time: mixed, TxHash: odMixedTx,
		Publisher: acct, Denom: otherDenom, AmountUtia: 5_000})
	pay(scan.Payment{DedupeKey: odMixedTx + ":1", Kind: scan.PaymentDeposit, Height: 35, Time: mixed, TxHash: odMixedTx, MsgIndex: 1,
		Publisher: otherPublisher, Denom: "utia", AmountUtia: 7})
	pay(scan.Payment{DedupeKey: odDepositTx + ":0", Kind: scan.PaymentDeposit, Height: 40, Time: settle.Add(-31 * time.Hour), TxHash: odDepositTx,
		Publisher: acct, Denom: otherDenom, AmountUtia: 1_000_000})
	pay(scan.Payment{DedupeKey: odPaidTx + ":0", Kind: scan.PaymentWithdrawalRequest, Height: 41, Time: reqA, TxHash: odPaidTx,
		Publisher: acct, Denom: otherDenom, AmountUtia: 300_000})
	pay(scan.Payment{DedupeKey: "h55:executed:0", Kind: scan.PaymentWithdrawalExecuted, Height: 55, Time: reqA.Add(24*time.Hour + 10*time.Second), TxIndex: -1,
		Publisher: acct, Denom: otherDenom, AmountUtia: 300_000})
	pay(scan.Payment{DedupeKey: odQueuedTx + ":0", Kind: scan.PaymentWithdrawalRequest, Height: 60, Time: reqB, TxHash: odQueuedTx,
		Publisher: acct, Denom: otherDenom, AmountUtia: 400_000})

	w := func(req time.Time, amt uint64) scan.PendingWithdrawal {
		return scan.PendingWithdrawal{Signer: acct, Denom: otherDenom, AmountUtia: amt, RequestedAt: req, AvailableAt: req.Add(24 * time.Hour)}
	}
	obs := func(h int64, at time.Time, ws ...scan.PendingWithdrawal) {
		t.Helper()
		if _, err := st.ObserveWithdrawals(store.WithdrawalRead{Publisher: acct, Height: h, BlockTime: at, Withdrawals: ws}, now); err != nil {
			t.Fatal(err)
		}
	}
	obs(42, reqA.Add(time.Minute), w(reqA, 300_000))
	if err := st.UpsertEscrowAccount(scan.Escrow{Signer: acct, Denom: otherDenom, BalanceUtia: 705_000, AvailableUtia: 305_000, Height: 70, Found: true}, now); err != nil {
		t.Fatal(err)
	}
	obs(70, settle.Add(-4*time.Hour), w(reqB, 400_000))
	if _, err := st.ResolveWithdrawals(context.Background(), 100); err != nil {
		t.Fatal(err)
	}
	return acct
}

// An escrow held in another denomination than utia is in no utia figure:
// every figure of the market, and of a utia account's page, reads as it did
// without that account, and the account's own deposits, withdrawals, payout
// and balance are listed with their coin and summed nowhere.
func TestOtherDenomInNoUtiaFigure(t *testing.T) {
	before, st, settle := queueServer(t)
	// queueServer's figures, read before the account is stored.
	const market, sample = "/v1/market?window=7d", "/v1/publishers/" + samplePublisher + "?window=7d"
	var m0, p0 map[string]json.RawMessage
	if get(t, before, market, &m0) != 200 || get(t, before, sample, &p0) != 200 {
		t.Fatal("queueServer's figures")
	}
	acct := addOtherDenomAccount(t, st, settle)
	ts := httptest.NewServer(api.NewWithVantage(st, api.VantageInfo{Name: "test"}, nil))
	t.Cleanup(ts.Close)

	// The market: deposits, escrow held and its accounts, and the whole
	// withdrawal queue (pending, its publishers, outcomes, payout delays).
	var m1, p1 map[string]json.RawMessage
	if get(t, ts, market, &m1) != 200 || get(t, ts, sample, &p1) != 200 {
		t.Fatal("the figures with the account")
	}
	for _, k := range []string{"deposits", "escrow_held_utia", "escrow_accounts", "withdrawal_queue"} {
		if string(m1[k]) != string(m0[k]) {
			t.Errorf("market %s: %s with the account, %s without", k, m1[k], m0[k])
		}
	}
	var m struct {
		Deposits   struct{ Count, Utia int64 } `json:"deposits"`
		EscrowHeld int64                       `json:"escrow_held_utia"`
		Accounts   int64                       `json:"escrow_accounts"`
		Q          struct {
			Pending    pSum                        `json:"pending"`
			Publishers int64                       `json:"publishers"`
			Executed   struct{ Count, Utia int64 } `json:"executed"`
		} `json:"withdrawal_queue"`
	}
	get(t, ts, market, &m)
	if m.Deposits.Count != 1 || m.Deposits.Utia != 6_000_000_000 || m.EscrowHeld != 1000 || m.Accounts != 1 {
		t.Errorf("market: %+v", m)
	}
	if m.Q.Pending.Count != 2 || m.Q.Pending.Utia != 300 || m.Q.Publishers != 1 || m.Q.Executed.Count != 1 || m.Q.Executed.Utia != 1000 {
		t.Errorf("market queue: %+v", m.Q)
	}
	// A utia account's page: its escrow, queue and check as they were.
	if string(p1["withdrawals"]) != string(p0["withdrawals"]) {
		t.Errorf("the sample's withdrawals: %s with the account, %s without", p1["withdrawals"], p0["withdrawals"])
	}
	var pub0, pub1 map[string]json.RawMessage
	if err := json.Unmarshal(p0["publisher"], &pub0); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(p1["publisher"], &pub1); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"escrow", "pending_withdrawals"} {
		if string(pub1[k]) != string(pub0[k]) {
			t.Errorf("the sample's %s: %s with the account, %s without", k, pub1[k], pub0[k])
		}
	}

	type escrow struct {
		Found     bool   `json:"found"`
		Denom     string `json:"denom"`
		Balance   int64  `json:"balance_utia"`
		Available int64  `json:"available_utia"`
	}
	// The account in the list: its escrow names its denomination and reads
	// 0, and its queue holds no utia.
	var list struct {
		Publishers []struct {
			Publisher string  `json:"publisher"`
			Escrow    *escrow `json:"escrow"`
			Pending   *pSum   `json:"pending_withdrawals"`
		} `json:"publishers"`
	}
	get(t, ts, "/v1/publishers?window=7d", &list)
	listed := false
	for _, p := range list.Publishers {
		if p.Publisher != acct {
			continue
		}
		listed = true
		if p.Escrow == nil || !p.Escrow.Found || p.Escrow.Denom != otherDenom || p.Escrow.Balance != 0 || p.Escrow.Available != 0 {
			t.Errorf("its escrow in the list: %+v", p.Escrow)
		}
		if p.Pending == nil || p.Pending.Count != 0 || p.Pending.Utia != 0 || p.Pending.Next != nil {
			t.Errorf("its queue in the list: %+v", p.Pending)
		}
	}
	if !listed {
		t.Fatalf("the account is not listed: %+v", list.Publishers)
	}

	// Its page: the escrow as in the list, no utia queued and no check; its
	// withdrawals and movements listed with their coin and no utia amount.
	var d struct {
		Publisher struct {
			Escrow *escrow `json:"escrow"`
		} `json:"publisher"`
		Withdrawals *struct {
			pSum
			Pending   []map[string]json.RawMessage `json:"pending"`
			LeftQueue []map[string]json.RawMessage `json:"left_queue"`
			Check     *map[string]any              `json:"check"`
		} `json:"withdrawals"`
		Payments []map[string]json.RawMessage `json:"recent_payments"`
	}
	if code := get(t, ts, "/v1/publishers/"+acct, &d); code != 200 {
		t.Fatalf("its page: %d", code)
	}
	if e := d.Publisher.Escrow; e == nil || !e.Found || e.Denom != otherDenom || e.Balance != 0 || e.Available != 0 {
		t.Errorf("its escrow: %+v", e)
	}
	q := d.Withdrawals
	if q == nil || q.Count != 0 || q.Utia != 0 || q.Reduced != 0 || q.Check != nil || len(q.Pending) != 1 || len(q.LeftQueue) != 1 {
		t.Fatalf("its withdrawals: %+v", q)
	}
	coin := func(what string, row map[string]json.RawMessage, amount string) {
		t.Helper()
		if got := string(row["amount"]); got != `"`+amount+otherDenom+`"` {
			t.Errorf("%s: amount %s, want %s%s", what, got, amount, otherDenom)
		}
		for _, k := range []string{"amount_utia", "first_amount_utia", "reduced_utia"} {
			if v, ok := row[k]; ok && string(v) != "0" {
				t.Errorf("%s: %s is %s", what, k, v)
			}
		}
		if v, ok := row["paid_utia"]; ok {
			t.Errorf("%s: paid_utia is %s", what, v)
		}
	}
	coin("its queued withdrawal", q.Pending[0], "400000")
	coin("its paid withdrawal", q.LeftQueue[0], "300000")
	if got := string(q.LeftQueue[0]["outcome"]); got != `"`+store.WithdrawalExecuted+`"` {
		t.Errorf("its paid withdrawal's outcome: %s", got)
	}
	if len(d.Payments) != 5 {
		t.Fatalf("its recent payments: %d, want 5", len(d.Payments))
	}
	for _, p := range d.Payments {
		if _, ok := p["amount_utia"]; ok || !strings.HasSuffix(string(p["amount"]), otherDenom+`"`) {
			t.Errorf("a recent payment: %v", p)
		}
	}

	// Its transactions: every row with its coin, the statement's sums 0.
	var txs struct {
		Total int64 `json:"total"`
		Txs   []struct {
			Kind       string `json:"kind"`
			AmountUtia *int64 `json:"amount_utia"`
			Amount     string `json:"amount"`
			Payout     *struct {
				State    string `json:"state"`
				PaidUtia *int64 `json:"paid_utia"`
			} `json:"payout"`
		} `json:"txs"`
		Sums map[string]int64 `json:"sums"`
	}
	if code := get(t, ts, "/v1/publishers/"+acct+"/txs?view=escrow", &txs); code != 200 {
		t.Fatalf("its transactions: %d", code)
	}
	if txs.Total != 4 || len(txs.Txs) != 4 {
		t.Fatalf("its transactions: %+v", txs)
	}
	for _, x := range txs.Txs {
		if x.AmountUtia != nil || !strings.HasSuffix(x.Amount, otherDenom) {
			t.Errorf("its %s: amount_utia %v, amount %q", x.Kind, x.AmountUtia, x.Amount)
		}
		if x.Payout != nil && (x.Payout.PaidUtia != nil || (x.Amount == "300000"+otherDenom && x.Payout.State != "paid")) {
			t.Errorf("its %s's payout: %+v", x.Kind, *x.Payout)
		}
	}
	for k, v := range txs.Sums {
		if strings.HasSuffix(k, "_utia") && v != 0 {
			t.Errorf("its statement's %s: %d", k, v)
		}
	}

	// The transaction pages: a movement in otherDenom gives its coin and no
	// amount_utia; one of two signers in two denominations gives both.
	effect := func(hash string) map[string]json.RawMessage {
		t.Helper()
		var a struct {
			Effect map[string]json.RawMessage `json:"effect"`
		}
		if code := get(t, ts, "/v1/txs/"+hash, &a); code != 200 {
			t.Fatalf("tx %s: %d", hash, code)
		}
		return a.Effect
	}
	if e := effect(odDepositTx); len(e) != 1 || string(e["amount"]) != `"1000000`+otherDenom+`"` {
		t.Errorf("its deposit's effect: %v", e)
	}
	e := effect(odPaidTx)
	if _, ok := e["amount_utia"]; ok || string(e["amount"]) != `"300000`+otherDenom+`"` {
		t.Errorf("its paid request's effect: %v", e)
	}
	var wd map[string]json.RawMessage
	if err := json.Unmarshal(e["withdrawal"], &wd); err != nil || string(wd["outcome"]) != `"paid"` {
		t.Errorf("its paid request's withdrawal: %s (%v)", e["withdrawal"], err)
	}
	if _, ok := wd["reduced_utia"]; ok {
		t.Errorf("its paid request's withdrawal carries reduced_utia: %s", e["withdrawal"])
	}
	if e := effect(odMixedTx); string(e["amount_utia"]) != "7" || string(e["amount"]) != `"5000`+otherDenom+`"` {
		t.Errorf("the two signers' deposits: %v", e)
	}
}
