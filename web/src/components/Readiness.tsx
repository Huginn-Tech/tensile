import type { Validator } from "@/lib/api";

/**
 * How much of the bonded stake has a Fibre provider registered. A
 * MsgPayForFibre settles only with signatures from validators holding at
 * least floor(2/3 of total voting power) (x/fibre, keeper/msg_server.go), and
 * a validator signs only through a Fibre server it has registered in
 * x/valaddr. Both halves are the chain's own records: the bonded set from
 * x/staking, the providers from x/valaddr AllBondedFibreProviders. Whether a
 * host answers is this observer's check, and stays in the table.
 */

/**
 * the endpoint's standing for a publisher: reachable with a certificate it accepts; unreachable when it did not
 * answer; wrong certificate (cert) when it answered without TLS or with a certificate that is not this validator's
 * or has lapsed, so a publisher will not upload to it either; none before its first check. Reachability is the API's
 * endpoint_state when it sends one.
 */
export type EndpointState = "reachable" | "unreachable" | "cert" | "none";
type WithState = Validator & { endpoint_state?: "reachable" | "unreachable" | "none" };
const REJECTED = new Set(["no_tls", "expired", "mismatch"]);

export function endpointState(v: Validator): EndpointState {
  const s = (v as WithState).endpoint_state;
  // a registered host this observer has not checked yet is no one's failure
  const reach: "reachable" | "unreachable" | "none" = s === "reachable" || s === "unreachable" || s === "none" ? s
    : !v.host || v.reachable == null ? "none" : v.reachable ? "reachable" : "unreachable";
  return reach === "reachable" && REJECTED.has(v.identity_status) ? "cert" : reach;
}

/** amber on the dial and the map: a publisher will not upload to it, whichever the reason */
export const isDown = (s: EndpointState) => s === "unreachable" || s === "cert";

export function bondedOf(rows: Validator[]): Validator[] {
  return rows.filter((v) => !v.jailed && (!v.bond_status || v.bond_status === "BOND_STATUS_BONDED"));
}

export function readiness(rows: Validator[]) {
  const bonded = bondedOf(rows);
  const total = bonded.reduce((s, v) => s + (v.voting_power || 0), 0);
  const registered = bonded.filter((v) => !!v.host);
  const regPower = registered.reduce((s, v) => s + (v.voting_power || 0), 0);
  const quorum = Math.floor((total * 2) / 3);
  const pct = (n: number) => (total > 0 ? `${((100 * n) / total).toFixed(1)}%` : "—");
  return { bonded, total, registered, regPower, quorum, pct };
}
