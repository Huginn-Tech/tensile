package scan

import (
	"encoding/hex"
	"fmt"

	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	"github.com/cosmos/cosmos-sdk/types/bech32"
)

// PublisherOf is the account a promise charges, its escrow owner, from the
// hex key that signed the promise (PromiseFields.SignerPublicKey). The module
// derives the same address to find the escrow (x/fibre msg_server:
// SignerPublicKey.Address()), and so does accountFromPubKey for payments. It
// need not be the account that submitted MsgPayForFibre: anyone can submit
// one, typically an endorsing validator.
func PublisherOf(signerPublicKeyHex string) (string, error) {
	b, err := hex.DecodeString(signerPublicKeyHex)
	if err != nil {
		return "", fmt.Errorf("signer public key: %w", err)
	}
	if len(b) != secp256k1.PubKeySize {
		return "", fmt.Errorf("signer public key: %d bytes, want %d", len(b), secp256k1.PubKeySize)
	}
	return bech32.ConvertAndEncode(accountHRP, (&secp256k1.PubKey{Key: b}).Address())
}

// canonicalSignerAppVersion is the app version from which the module keys an
// escrow by the canonical form of a deposit's or a withdrawal request's
// signer: the same version as the charge switch (minGasPriceAppVersion),
// app version 12, and like it read from celestia-app's main branch, in no
// release yet.
const canonicalSignerAppVersion = minGasPriceAppVersion

// escrowSigner is the escrow account a MsgDepositToEscrow or a
// MsgRequestWithdrawal moved, from the signer the message carries and the
// app version its block ran under.
//
// Through app version 11 the module keys the account by the signer string
// as sent (x/fibre msg_server: GetEscrowAccount(ctx, msg.Signer)), so the
// string is the account and is kept verbatim. From 12 it decodes the signer
// and uses the canonical string (sdk.AccAddressFromBech32, then String()):
// the all-upper-case form of an address, which bech32 accepts, moves the
// same account as its lower-case form, the one a settlement is charged to
// (accountFromPubKey). Those two messages are the only ones it does this
// for; a settlement's and a timeout's account come from the promise's key.
//
// A signer that does not decode as an account of this chain is returned as
// sent: the chain refuses such a message, so none reaches a record.
func escrowSigner(appVersion uint64, signer string) string {
	if appVersion < canonicalSignerAppVersion {
		return signer
	}
	hrp, raw, err := bech32.DecodeAndConvert(signer)
	if err != nil || hrp != accountHRP || len(raw) == 0 {
		return signer
	}
	canonical, err := bech32.ConvertAndEncode(accountHRP, raw)
	if err != nil {
		return signer
	}
	return canonical
}
