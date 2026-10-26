package scan

import (
	"math"
	"testing"
	"time"

	celfibre "github.com/celestiaorg/celestia-app/v10/fibre"
	fibretypes "github.com/celestiaorg/celestia-app/v10/x/fibre/types"
	"github.com/celestiaorg/go-square/v4/share"
	abci "github.com/cometbft/cometbft/abci/types"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/bech32"
	cosmostx "github.com/cosmos/cosmos-sdk/types/tx"
)

// rawTx wraps SDK messages in a TxRaw the way a broadcast tx is encoded.
func rawTx(t *testing.T, msgs ...proto) []byte {
	t.Helper()
	body := cosmostx.TxBody{}
	for _, m := range msgs {
		b, err := m.Marshal()
		if err != nil {
			t.Fatal(err)
		}
		body.Messages = append(body.Messages, &codectypes.Any{TypeUrl: m.typeURL(), Value: b})
	}
	bb, err := body.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	raw := cosmostx.TxRaw{BodyBytes: bb, AuthInfoBytes: []byte{}, Signatures: [][]byte{{1}}}
	out, err := raw.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	return out
}

type proto interface {
	Marshal() ([]byte, error)
	typeURL() string
}

type depositMsg struct{ *fibretypes.MsgDepositToEscrow }
type timeoutMsg struct {
	*fibretypes.MsgPaymentPromiseTimeout
}
type withdrawMsg struct {
	*fibretypes.MsgRequestWithdrawal
}
type payMsg struct{ *fibretypes.MsgPayForFibre }

func (depositMsg) typeURL() string  { return msgDepositTypeURL }
func (timeoutMsg) typeURL() string  { return msgTimeoutTypeURL }
func (withdrawMsg) typeURL() string { return msgWithdrawalTypeURL }
func (payMsg) typeURL() string      { return fibretypes.MsgPayForFibreTypeURL }

func testPromise(t *testing.T, key *secp256k1.PrivKey, blobSize uint32) fibretypes.PaymentPromise {
	t.Helper()
	ns := share.MustNewV0Namespace([]byte("economy-t"))
	commit := make([]byte, 32)
	for i := range commit {
		commit[i] = byte(i)
	}
	return fibretypes.PaymentPromise{
		ChainId:           "fibre-devnet",
		Height:            42,
		Namespace:         ns.Bytes(),
		BlobSize:          blobSize,
		BlobVersion:       0,
		Commitment:        commit,
		CreationTimestamp: time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC),
		SignerPublicKey:   *key.PubKey().(*secp256k1.PubKey),
		Signature:         []byte("sig-bytes-not-verified-here"),
	}
}

func TestPaymentsInTx_EveryKind(t *testing.T) {
	key := secp256k1.GenPrivKey()
	owner, err := bech32.ConvertAndEncode(accountHRP, key.PubKey().Address())
	if err != nil {
		t.Fatal(err)
	}
	other := "celestia1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
	pp := testPromise(t, key, 1<<20) // 1 MiB → 4 chunks

	raw := rawTx(t,
		depositMsg{&fibretypes.MsgDepositToEscrow{Signer: owner, Amount: sdk.NewInt64Coin("utia", 6_000_000_000)}},
		payMsg{&fibretypes.MsgPayForFibre{Signer: owner, PaymentPromise: pp}},
		timeoutMsg{&fibretypes.MsgPaymentPromiseTimeout{Signer: other, PaymentPromise: pp}},
		withdrawMsg{&fibretypes.MsgRequestWithdrawal{Signer: owner, Amount: sdk.NewInt64Coin("utia", 7)}},
	)
	blk := &Block{Height: 100, Time: time.Date(2026, 9, 17, 11, 0, 0, 0, time.UTC), AppVersion: FibreAppVersion}
	now := time.Now()
	ps, err := paymentsInTx(raw, blk, 3, "abcd", now)
	if err != nil {
		t.Fatalf("paymentsInTx: %v", err)
	}
	if len(ps) != 4 {
		t.Fatalf("want 4 payments, got %d: %+v", len(ps), ps)
	}
	kinds := []string{PaymentDeposit, PaymentSettlement, PaymentTimeout, PaymentWithdrawalRequest}
	for i, p := range ps {
		if p.Kind != kinds[i] {
			t.Errorf("payment %d kind=%s want %s", i, p.Kind, kinds[i])
		}
		if p.Height != 100 || p.TxIndex != 3 || p.TxHash != "abcd" || p.MsgIndex != i {
			t.Errorf("payment %d position wrong: %+v", i, p)
		}
		if p.DedupeKey == "" {
			t.Errorf("payment %d without dedupe key", i)
		}
		if p.Publisher != owner {
			t.Errorf("payment %d publisher=%s want %s", i, p.Publisher, owner)
		}
	}
	if ps[0].AmountUtia != 6_000_000_000 || ps[0].Denom != "utia" {
		t.Errorf("deposit amount: %+v", ps[0])
	}
	// The charge is the module's own formula: (650k + 45k×⌈size/256KiB⌉) gas at 1 utia/gas, v10's rate.
	wantGas := uint64(650_000 + 45_000*4)
	for _, i := range []int{1, 2} {
		if ps[i].GasUnits != wantGas || ps[i].AmountUtia != wantGas {
			t.Errorf("payment %d charge gas=%d amount=%d want %d", i, ps[i].GasUnits, ps[i].AmountUtia, wantGas)
		}
		if ps[i].BlobSize != 1<<20 || ps[i].PromiseHash == "" || ps[i].Namespace == "" {
			t.Errorf("payment %d promise fields: %+v", i, ps[i])
		}
	}
	if ps[1].PromiseHash != ps[2].PromiseHash {
		t.Errorf("settlement and timeout of the same promise must share a hash")
	}
	if ps[1].Processor != owner || ps[2].Processor != other {
		t.Errorf("processor: settlement=%s timeout=%s", ps[1].Processor, ps[2].Processor)
	}
	if ps[3].AmountUtia != 7 {
		t.Errorf("withdrawal request amount: %+v", ps[3])
	}
}

// A block that ran under app v11 is charged at the minimum gas price: the
// same 1 MiB promise's 830,000 gas costs 3,320 utia there, 830,000 under v10.
func TestPaymentsInTx_ChargeByAppVersion(t *testing.T) {
	key := secp256k1.GenPrivKey()
	owner, err := bech32.ConvertAndEncode(accountHRP, key.PubKey().Address())
	if err != nil {
		t.Fatal(err)
	}
	pp := testPromise(t, key, 1<<20) // 1 MiB → 4 chunks
	raw := rawTx(t,
		payMsg{&fibretypes.MsgPayForFibre{Signer: owner, PaymentPromise: pp}},
		timeoutMsg{&fibretypes.MsgPaymentPromiseTimeout{Signer: owner, PaymentPromise: pp}},
	)
	for _, c := range []struct {
		version uint64
		want    uint64
	}{{FibreAppVersion, 830_000}, {11, 3_320}} {
		blk := &Block{Height: 200, Time: time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC), AppVersion: c.version}
		ps, err := paymentsInTx(raw, blk, 0, "abcd", time.Now())
		if err != nil {
			t.Fatalf("v%d: %v", c.version, err)
		}
		if len(ps) != 2 {
			t.Fatalf("v%d: want 2 payments, got %d: %+v", c.version, len(ps), ps)
		}
		for _, p := range ps {
			if p.GasUnits != 830_000 || p.AmountUtia != c.want || p.Denom != "utia" {
				t.Errorf("v%d %s: gas=%d amount=%d%s, want 830000 gas and %d utia", c.version, p.Kind, p.GasUnits, p.AmountUtia, p.Denom, c.want)
			}
		}
	}
}

// The rate follows the app version: through v10 it is the pinned module's
// own PaymentAmount, one utia per gas; from v11 it is ceil(gas × 0.004),
// which upstream's test (celestia-app #7931) prices at 3,500, 9,980 and
// 74,780 utia for 1, 10 and 100 MiB of data at their padded upload size.
// A version past v11 keeps v11's rate until its charge is checked.
func TestChargeUtia(t *testing.T) {
	for _, c := range []struct {
		mib  int
		want uint64
	}{{1, 3_500}, {10, 9_980}, {100, 74_780}} {
		size := uint32(celfibre.DefaultBlobConfigV0().UploadSize(c.mib << 20))
		gas := fibretypes.EstimateGasForPayForFibre(size)
		if got, want := chargeUtia(FibreAppVersion, gas), fibretypes.PaymentAmount(size).Amount.Uint64(); got != want {
			t.Errorf("%d MiB at v10: %d utia, the module charges %d", c.mib, got, want)
		}
		for _, v := range []uint64{11, 12} {
			if got := chargeUtia(v, gas); got != c.want {
				t.Errorf("%d MiB (upload %d bytes, %d gas) at v%d: %d utia, want %d", c.mib, size, gas, v, got, c.want)
			}
		}
	}
	// a whole utia is charged for any part of one
	if got := chargeUtia(11, 1); got != 1 {
		t.Errorf("1 gas at v11: %d utia, want 1", got)
	}
	if got := chargeUtia(11, 250); got != 1 {
		t.Errorf("250 gas at v11: %d utia, want 1", got)
	}
	if got := chargeUtia(11, 251); got != 2 {
		t.Errorf("251 gas at v11: %d utia, want 2", got)
	}
}

// otherDenom is an IBC denomination. x/fibre at the pinned v10 takes an
// escrow deposit in it (no denom check until celestia-app PR #8143, in v11).
const otherDenom = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"

// A deposit and a withdrawal request in another denomination are recorded
// as the chain wrote them, denom and amount: the record keeps the fact, and
// a reader counts AmountUtia only where Denom is utia.
func TestPaymentsInTx_OtherDenomAsWritten(t *testing.T) {
	owner := "celestia1d3mmg652pxj776dyqwlsrc93y64088g6ux8deq"
	raw := rawTx(t,
		depositMsg{&fibretypes.MsgDepositToEscrow{Signer: owner, Amount: sdk.NewInt64Coin(otherDenom, 5_000_000)}},
		withdrawMsg{&fibretypes.MsgRequestWithdrawal{Signer: owner, Amount: sdk.NewInt64Coin(otherDenom, 2_000_000)}},
	)
	ps, err := paymentsInTx(raw, &Block{Height: 100, Time: time.Date(2026, 10, 20, 4, 0, 0, 0, time.UTC)}, 0, "abcd", time.Now())
	if err != nil {
		t.Fatalf("paymentsInTx: %v", err)
	}
	if len(ps) != 2 {
		t.Fatalf("want 2 payments, got %d: %+v", len(ps), ps)
	}
	for i, want := range []struct {
		kind   string
		amount uint64
	}{{PaymentDeposit, 5_000_000}, {PaymentWithdrawalRequest, 2_000_000}} {
		if p := ps[i]; p.Kind != want.kind || p.Denom != otherDenom || p.AmountUtia != want.amount || p.Publisher != owner {
			t.Errorf("payment %d: %+v, want a %s of %d %s", i, p, want.kind, want.amount, otherDenom)
		}
	}
}

func TestPaymentsInTx_NotAnSDKTx(t *testing.T) {
	ps, err := paymentsInTx([]byte("garbage"), &Block{Height: 1}, 0, "x", time.Now())
	if err != nil || len(ps) != 0 {
		t.Fatalf("want nothing, got %v %v", ps, err)
	}
}

func TestWithdrawalsExecuted(t *testing.T) {
	blk := &Block{Height: 7, Time: time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)}
	evs := []abci.Event{
		{Type: "some.other.Event", Attributes: []abci.EventAttribute{{Key: "signer", Value: `"x"`}}},
		{Type: eventWithdrawExecutedType, Attributes: []abci.EventAttribute{
			{Key: "signer", Value: `"celestia1abc"`},
			{Key: "amount", Value: `{"denom":"utia","amount":"123"}`},
		}},
		{Type: eventWithdrawExecutedType, Attributes: []abci.EventAttribute{
			{Key: "amount", Value: `{"denom":"utia","amount":"5"}`},
			{Key: "signer", Value: `"celestia1def"`},
		}},
	}
	ps, err := withdrawalsExecuted(evs, blk, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 {
		t.Fatalf("want 2, got %d", len(ps))
	}
	if ps[0].Publisher != "celestia1abc" || ps[0].AmountUtia != 123 || ps[0].Kind != PaymentWithdrawalExecuted {
		t.Errorf("first: %+v", ps[0])
	}
	if ps[1].Publisher != "celestia1def" || ps[1].AmountUtia != 5 {
		t.Errorf("second: %+v", ps[1])
	}
	if ps[0].DedupeKey == ps[1].DedupeKey || ps[0].DedupeKey == "" {
		t.Errorf("dedupe keys: %q %q", ps[0].DedupeKey, ps[1].DedupeKey)
	}
	if ps[0].TxHash != "" || ps[0].TxIndex != -1 {
		t.Errorf("begin-block payout must not claim a tx: %+v", ps[0])
	}

	bad := []abci.Event{{Type: eventWithdrawExecutedType, Attributes: []abci.EventAttribute{
		{Key: "signer", Value: `"celestia1abc"`}, {Key: "amount", Value: `not json`}}}}
	if _, err := withdrawalsExecuted(bad, blk, time.Now()); err == nil {
		t.Error("malformed amount must error")
	}
}

// A payout of another denomination past uint64 is kept at uint64's maximum,
// as coinAmount keeps a deposit's, with its denom; the payouts after it in
// the block are still read, where an error used to drop them, the utia one
// included. A figure that is no number is still refused.
func TestWithdrawalsExecutedPastUint64(t *testing.T) {
	blk := &Block{Height: 8, Time: time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)}
	payout := func(signer, coin string) abci.Event {
		return abci.Event{Type: eventWithdrawExecutedType, Attributes: []abci.EventAttribute{
			{Key: "signer", Value: `"` + signer + `"`}, {Key: "amount", Value: coin}}}
	}
	ps, err := withdrawalsExecuted([]abci.Event{
		payout("celestia1abc", `{"denom":"`+otherDenom+`","amount":"25000000000000000000"}`),
		payout("celestia1def", `{"denom":"utia","amount":"123"}`),
	}, blk, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 {
		t.Fatalf("want 2 payouts, got %d: %+v", len(ps), ps)
	}
	if ps[0].Denom != otherDenom || ps[0].AmountUtia != math.MaxUint64 || ps[0].Publisher != "celestia1abc" {
		t.Errorf("past uint64: %+v", ps[0])
	}
	if ps[1].Denom != "utia" || ps[1].AmountUtia != 123 || ps[1].Publisher != "celestia1def" {
		t.Errorf("the utia payout after it: %+v", ps[1])
	}
	if _, err := withdrawalsExecuted([]abci.Event{payout("celestia1abc", `{"denom":"utia","amount":"12x"}`)}, blk, time.Now()); err == nil {
		t.Error("an amount that is no number must error")
	}
}

func TestStore_PaymentsDedupeAndResume(t *testing.T) {
	dir := t.TempDir()
	st, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	p := Payment{SchemaVersion: 1, DedupeKey: "k1", Kind: PaymentDeposit, Height: 1, Publisher: "a", AmountUtia: 1}
	for i := 0; i < 3; i++ {
		if err := st.AppendPayment(p); err != nil {
			t.Fatal(err)
		}
	}
	p.DedupeKey = "k2"
	if err := st.AppendPayment(p); err != nil {
		t.Fatal(err)
	}
	if err := st.AppendPayment(Payment{Kind: "x"}); err == nil {
		t.Error("empty dedupe key must be refused")
	}
	if err := st.Sync(); err != nil {
		t.Fatal(err)
	}
	st.Close()

	st2, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	if !st2.PaymentSeen("k1") || !st2.PaymentSeen("k2") || st2.PaymentSeen("k3") {
		t.Error("seen set not reloaded")
	}
	got, err := LoadPayments(st2.PaymentsPath())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Errorf("want 2 lines, got %d", len(got))
	}
}
