package scan

import (
	"encoding/hex"
	"strings"
	"testing"

	fibretypes "github.com/celestiaorg/celestia-app/v11/x/fibre/types"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/cosmos/cosmos-sdk/types/bech32"
)

// From app version 12 the module moves the canonical account whatever case
// a deposit's or a withdrawal request's signer was sent in; before it, the
// account is the string as sent. The record follows the block's version.
func TestEscrowSignerIsCanonicalFromTheChargeSwitchVersion(t *testing.T) {
	key := secp256k1.GenPrivKey().PubKey().(*secp256k1.PubKey)
	lower, err := accountFromPubKey(&fibretypes.PaymentPromise{SignerPublicKey: *key})
	if err != nil {
		t.Fatal(err)
	}
	upper := strings.ToUpper(lower)
	if upper == lower {
		t.Fatalf("no upper-case form of %s", lower)
	}

	// Below the gate: verbatim, on both forms.
	for _, v := range []uint64{0, FibreAppVersion, minGasPriceAppVersion - 1} {
		for _, s := range []string{lower, upper} {
			if got := escrowSigner(v, s); got != s {
				t.Errorf("app v%d: escrowSigner(%s) = %s, want it as sent", v, s, got)
			}
		}
	}
	// From the gate: the canonical account, which is the one a settlement
	// of the same key is charged to.
	for _, v := range []uint64{minGasPriceAppVersion, minGasPriceAppVersion + 1} {
		for _, s := range []string{lower, upper} {
			if got := escrowSigner(v, s); got != lower {
				t.Errorf("app v%d: escrowSigner(%s) = %s, want %s", v, s, got, lower)
			}
		}
	}

	// What does not decode as an account of this chain stays as sent: mixed
	// case, which bech32 refuses, another chain's prefix, no address.
	other, err := bech32.ConvertAndEncode("cosmos", key.Address())
	if err != nil {
		t.Fatal(err)
	}
	mixed := strings.ToUpper(lower[:len(accountHRP)]) + lower[len(accountHRP):]
	for _, s := range []string{"", "not an address", mixed, other, strings.ToUpper(other)} {
		if got := escrowSigner(minGasPriceAppVersion, s); got != s {
			t.Errorf("escrowSigner(%q) = %q, want it as sent", s, got)
		}
	}
}

// The publisher read back from a stored promise key is the account the
// payments are charged to: the same derivation, from the same key.
func TestPublisherOfIsThePaymentsAccount(t *testing.T) {
	key := secp256k1.GenPrivKey().PubKey().(*secp256k1.PubKey)
	want, err := accountFromPubKey(&fibretypes.PaymentPromise{SignerPublicKey: *key})
	if err != nil {
		t.Fatal(err)
	}
	got, err := PublisherOf(hex.EncodeToString(key.Key))
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("PublisherOf = %s, the payments account is %s", got, want)
	}
	for _, bad := range []string{"", "zz", hex.EncodeToString(key.Key[:32])} {
		if _, err := PublisherOf(bad); err == nil {
			t.Errorf("PublisherOf(%q) accepted a key that is not 33 bytes of hex", bad)
		}
	}
}
