#!/usr/bin/env bash
#
# rpc-check: is this RPC node enough for the observer?
#
# The scanner, collector, prober and heartbeat read one CometBFT RPC. Every
# figure on the site is downstream of it, so before the observer is trusted
# the node behind it has to be: on the right chain, in sync, and keeping
# enough history for what the observer asks of it. What it asks:
#
#   block, block_results  at every height it scans (block_results needs
#                         storage.discard_abci_responses = false on the node)
#   validators?height=    at the PROMISE height, twice. The scanner asks when it
#                         reads the settlement, up to PaymentPromiseHeightWindow
#                         blocks later (1,000 through app v11, 3,250 from
#                         v12). The prober asks again when it reads the blob,
#                         ten minutes before the serving window ends: about 4
#                         hours after the promise with the chain's defaults
#                         (shard_retention 4 h), which is about 5,500 blocks at
#                         the 2.6 s blocks through app v11 and about 18,000 at
#                         the 0.8 s blocks from v12
#   abci_query?height=    x/fibre params at every height of a params-uncertainty
#                         range, up to 5000 heights back (scan.maxVerifyHeights)
#
# A node pruned tighter than that records scan gaps, holds verdicts and leaves
# blobs unread (NOT_PROBED), and the site says so, but the operator should
# know before, not after. The prober's 4 hours is the longest of these, and
# it is longer than a node on the default min-retain-blocks keeps: 3,000
# blocks in celestia-app v11 and 9,750 in v12, about 2 hours 10 minutes on
# both. Set min-retain-blocks = 0, or a count that covers the serving window.
#
# x/fibre answering "unknown query path" (code 6) is the expected state
# before app version 10 and a failure from 10 on: a node that reports the
# upgrade and still cannot answer for the module is not serving the chain
# the observer thinks it is.
#
# A second RPC, when given, cross-checks the block hash at one height: two
# independent nodes agreeing on a hash is the only sync check that does not
# trust the node it is checking. Given and unreachable is a failure, not a
# skipped check.
#
# Usage: deploy/test/rpc-check.sh <rpc-url> [second-rpc-url]
#   RPC_CHAIN_ID  the chain expected (default mocha-5)
#   RPC_LOOKBACK  how far back history must reach, in blocks. The default
#                 follows the node's app version, as the block pace does:
#                 6000 through app v11 (the prober's 4 hours at 2.6 s blocks,
#                 about 5,500; also the scanner's 1,000 promise window + 5000
#                 uncertainty verify) and 22000 from v12 (the same 4 hours at
#                 0.8 s blocks, about 18,000, with room; it also covers the
#                 3,250 promise window + 5000). Below v12 a node that keeps
#                 fewer than 22000 gets a warning, not a failure
#
# Exit 0 when every check passes, 1 otherwise. Needs curl and python3.
set -o errexit -o nounset -o pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

RPC="${1:?rpc url}"
RPC2="${2:-}"
WANT_CHAIN="${RPC_CHAIN_ID:-mocha-5}"
LOOKBACK="${RPC_LOOKBACK:-}"
V12_LOOKBACK=22000
FIBRE_APP_VERSION=10

# get <url> -> body on stdout; empty on transport failure.
get() { curl -sS -m 25 "$1" 2>/dev/null || true; }

# field <json> <python-expr over d> -> value, or "" when absent.
field() {
  printf '%s' "$1" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
try:
    print(eval(sys.argv[1]))
except Exception:
    pass
' "$2"
}
rpc_err() { field "$1" 'd.get("error",{}).get("data") or d.get("error") or "no result in the answer"'; }

echo "== $RPC"
status=$(get "$RPC/status")
[ -n "$status" ] || { fail "no answer from $RPC/status"; echo "rpc-check: FAILED for $RPC"; exit 1; }
chain=$(field "$status" 'd["result"]["node_info"]["network"]')
tip=$(field "$status" 'int(d["result"]["sync_info"]["latest_block_height"])')
tip_time=$(field "$status" 'd["result"]["sync_info"]["latest_block_time"]')
earliest=$(field "$status" 'int(d["result"]["sync_info"]["earliest_block_height"])')
catching=$(field "$status" 'd["result"]["sync_info"]["catching_up"]')
moniker=$(field "$status" 'd["result"]["node_info"]["moniker"]')
version=$(field "$status" 'd["result"]["node_info"]["version"]')
[ -n "$tip" ] || { fail "$RPC/status is not a CometBFT status answer"; echo "rpc-check: FAILED for $RPC"; exit 1; }
echo "  node $moniker cometbft $version chain $chain tip $tip ($tip_time) earliest $earliest"

echo "== chain identity and sync"
if [ "$chain" = "$WANT_CHAIN" ]; then pass "chain id $chain"; else fail "chain id is $chain, want $WANT_CHAIN"; fi
if [ "$catching" = "False" ]; then pass "not catching up"; else fail "catching_up=$catching"; fi
age=$(python3 -c '
import sys, datetime
t = sys.argv[1].rstrip("Z")
t = t[:26] if "." in t else t
dt = datetime.datetime.fromisoformat(t).replace(tzinfo=datetime.timezone.utc)
print(int((datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds()))
' "$tip_time" 2>/dev/null || echo 999999)
if [ "$age" -le 120 ]; then pass "newest block ${age}s old"; else fail "newest block ${age}s old: the node is behind the chain, or its clock is"; fi
abci=$(get "$RPC/abci_info")
appv=$(field "$abci" 'int(d["result"]["response"]["app_version"])')
if [ -n "$appv" ]; then pass "app version $appv (x/fibre exists from $FIBRE_APP_VERSION)"; else fail "abci_info gave no app_version"; appv=0; fi
# The default lookback follows the node's app version, as the block pace does.
later=""
if [ -z "$LOOKBACK" ]; then
  if [ "$appv" -ge 12 ]; then LOOKBACK=$V12_LOOKBACK; else LOOKBACK=6000; later=$((tip - V12_LOOKBACK)); fi
fi

echo "== history the observer needs (lookback $LOOKBACK blocks)"
need=$((tip - LOOKBACK))
[ "$need" -lt 1 ] && need=1
if [ "$earliest" -le "$need" ]; then
  pass "earliest_block_height $earliest <= $need"
else
  fail "earliest_block_height $earliest > $need: pruned tighter than the observer's lookback"
fi
# What the node will be asked for once the chain runs app v12: said now, never a failure before then.
if [ -n "$later" ] && [ "$later" -ge 1 ] && [ "$earliest" -gt "$later" ]; then
  warn "from app v12 (0.8 s blocks) the observer reads back $V12_LOOKBACK blocks; this node keeps $((tip - earliest))"
fi
h=$need
blk=$(get "$RPC/block?height=$h")
bh=$(field "$blk" 'd["result"]["block_id"]["hash"]')
if [ -n "$bh" ]; then pass "block $h readable ($bh)"
elif [ -z "$blk" ]; then fail "block $h: no answer (timeout, reset, or too large for 25 s)"
else fail "block $h: $(rpc_err "$blk")"; fi
res=$(get "$RPC/block_results?height=$h")
rh=$(field "$res" 'd["result"]["height"]')
if [ -n "$rh" ]; then pass "block_results $h readable"
elif [ -z "$res" ]; then fail "block_results $h: no answer (timeout or reset)"
else fail "block_results $h: $(rpc_err "$res") — the scanner reads results at every height; the node must keep them (storage.discard_abci_responses = false)"; fi
vals=$(get "$RPC/validators?height=$h&page=1&per_page=100")
vt=$(field "$vals" 'int(d["result"]["total"])')
vn=$(field "$vals" 'len(d["result"]["validators"])')
if [ -n "$vt" ]; then pass "validators at $h: $vn of $vt on page 1"
else fail "validators at $h: $(rpc_err "$vals") — the scanner fetches the set at the promise height, and the prober again when it reads the blob"; fi
sp=$(get "$RPC/abci_query?path=%22/cosmos.staking.v1beta1.Query/Params%22&height=$h")
code=$(field "$sp" 'd["result"]["response"]["code"]')
if [ "$code" = "0" ]; then pass "abci_query at height $h answers (historical state kept)"
else fail "abci_query at height $h: code=${code:-none} log=$(field "$sp" 'd["result"]["response"]["log"]') — params reconcile reads state at past heights"; fi

echo "== x/fibre against the app version"
fp=$(get "$RPC/abci_query?path=%22/celestia.fibre.v1.Query/Params%22&height=$tip")
fcode=$(field "$fp" 'd["result"]["response"]["code"]')
flog=$(field "$fp" 'd["result"]["response"]["log"]')
if [ "$fcode" = "0" ] && [ "$appv" -ge "$FIBRE_APP_VERSION" ]; then
  pass "x/fibre params answer at $tip on app version $appv: Fibre is active"
elif [ "$fcode" = "6" ] && [ "$appv" -lt "$FIBRE_APP_VERSION" ]; then
  pass "x/fibre not active yet at $tip (code 6: $flog) on app version $appv: expected before $FIBRE_APP_VERSION"
elif [ "$fcode" = "6" ]; then
  fail "x/fibre params unknown (code 6: $flog) on app version $appv: the node reports the upgrade and cannot answer for the module"
elif [ "$fcode" = "0" ]; then
  fail "x/fibre params answer on app version $appv, before the module exists: this node is not on the chain it claims"
else
  fail "x/fibre params at $tip: code=${fcode:-none} log=$flog"
fi

if [ -n "$RPC2" ]; then
  echo "== cross-check against $RPC2"
  s2=$(get "$RPC2/status")
  c2=$(field "$s2" 'd["result"]["node_info"]["network"]')
  t2=$(field "$s2" 'int(d["result"]["sync_info"]["latest_block_height"])')
  if [ -z "$t2" ]; then
    fail "no answer from $RPC2: the hash cross-check could not be done (given a second node, this check must run)"
  else
    [ "$c2" = "$chain" ] && pass "same chain id" || fail "second node is on $c2"
    ch=$(( (tip < t2 ? tip : t2) - 20 ))
    h1=$(field "$(get "$RPC/block?height=$ch")" 'd["result"]["block_id"]["hash"]')
    h2=$(field "$(get "$RPC2/block?height=$ch")" 'd["result"]["block_id"]["hash"]')
    if [ -z "$h1" ] || [ -z "$h2" ]; then
      fail "block $ch could not be read from both nodes (first: ${h1:-none}, second: ${h2:-none}); no hash comparison"
    elif [ "$h1" = "$h2" ]; then
      pass "block $ch hash agrees: $h1"
    else
      fail "block $ch hash differs: $h1 vs $h2"
    fi
    d=$(( tip > t2 ? tip - t2 : t2 - tip ))
    [ "$d" -le 10 ] && pass "tips within $d blocks" || warn "tips $d blocks apart"
  fi
else
  warn "no second RPC given: the hash cross-check is the one sync check that does not trust the node; pass one as the second argument"
fi

echo
if [ "$FAILED" = 0 ]; then echo "rpc-check: every check passed for $RPC"; else echo "rpc-check: FAILED for $RPC"; exit 1; fi
