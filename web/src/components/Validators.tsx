"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { type Validator, int, pctOf, ago, utcWord, whenUTC, shortMid, failedWords } from "@/lib/api";
import { WINDOWS, periodName } from "@/lib/window";
import Avatar from "./Avatar";
import Copy from "./Copy";
import Info from "./Info";
import Pick from "./Pick";
import { endpointState } from "./Readiness";
import { HostingCell } from "./Hosting";
import { SELF_VALIDATOR } from "@/lib/site";
import { isOperatorAccount, validatorHref } from "@/lib/addr";
import { openRow } from "@/lib/row";
import { usePhone } from "@/lib/phone";

/**
 * The validators table: who, whether the endpoint answers right now, how
 * much stake, and what the chain records of its endorsements: how often it
 * endorsed in the period, and when it last did. Default order
 * is voting power, descending, which is the chain's own order and never a
 * performance rank; the filters are for inspection. Serving, throughput, the
 * shard data it stored and the raw rows are on the validator's page.
 */

const bonded = (v: Validator) => !v.jailed && (!v.bond_status || v.bond_status === "BOND_STATUS_BONDED");
// Out of the bonded set (jailed, unbonding) with nothing in the period: no promise assigned it rows, no obligation, no
// endorsed shard. Its row would only say so; the list leaves it out unless a search names it, and its page stays.
const idle = (v: Validator) => !bonded(v) && !v.obligations?.total && !(v.signing && (v.signing.assigned > 0 || v.signing.unknown > 0)) && !(v.load && v.load.promises > 0);

// Whether a row is the validator this observer's own operator runs. It marks
// and nothing else: no filter, no exclusion, no adjustment.
function isSelf(v: Validator): boolean {
  if (!SELF_VALIDATOR) return false;
  return [v.address, v.cons_address, v.operator_address].some((a) => !!a && a.toLowerCase() === SELF_VALIDATOR);
}

type Filter = "all" | "providers" | "unreachable" | "cert" | "notready" | "nohost";
type SortKey = "power" | "signed" | "last";

/** each order's heading; per: it counts the selected period, which follows it in brackets */
const ORDERS: Record<SortKey, { label: string; per?: boolean }> = {
  power: { label: "Voting power" },
  signed: { label: "Endorsements", per: true },
  last: { label: "Last endorsement" },
};

/**
 * A rejected certificate, in a word: the reason a client refuses it, after the
 * Fibre TLS identity spec (specs/src/fibre_tls_identity.md). The verifier
 * splits the spec's outside_validity_window into expired and not yet valid;
 * no_certificate is a peer that sent none, before the spec's checks.
 */
function certificate(reason: string | undefined): string {
  switch (reason) {
    case "cert_expired": return "Certificate expired";
    case "cert_not_yet_valid": return "Certificate not yet valid";
    case "no_certificate": return "No certificate";
    default: return "Wrong certificate";
  }
}

/** the endpoint right now: the chain's own words first, then the newest handshake */
export function endpoint(v: Validator): { dot: string; word: string; title: string; warn?: boolean } {
  if (v.jailed) return { dot: "none", word: "Jailed", title: "Jailed: out of the bonded set, so not checked. Shards it endorsed are still owed." };
  if (!bonded(v)) {
    const w = v.bond_status!.replace("BOND_STATUS_", "").toLowerCase();
    return { dot: "none", word: "Not bonded", title: `${w.charAt(0).toUpperCase()}${w.slice(1)}: out of the bonded set, so not checked.` };
  }
  if (!v.host) return { dot: "none", word: "No endpoint", title: v.last_host ? `No open Fibre endpoint; last registered ${v.last_host}.` : "No Fibre provider registered." };
  if (v.reachable === null) return { dot: "none", word: "Not checked yet", title: `${v.host}: no handshake attempted yet.` };
  const checked = v.last_seen_at ? ` · checked ${ago(v.last_seen_at)}` : "";
  if (v.reachable === false) return { dot: "hold", word: "Unreachable", title: `${v.host}: no TLS handshake in the last two checks${v.last_reachable_at ? `; last reachable ${ago(v.last_reachable_at)}` : ""}${checked}`, warn: true };
  if (v.identity_status === "no_tls") return { dot: "hold", word: "No TLS", title: `${v.host}: answered TCP, but no TLS handshake completed${checked}`, warn: true };
  if (v.identity_status === "expired" || v.identity_status === "mismatch") {
    return { dot: "hold", word: certificate(v.identity_reason), title: `${v.host}: answered TLS with a certificate a client rejects${checked}`, warn: true };
  }
  if (v.identity_status && v.identity_status !== "verified") return { dot: "hold", word: "Reachable, unverified", title: `${v.host}: answered TLS; no certificate check recorded yet${checked}`, warn: true };
  // Reachable is dated by the last handshake this location completed (one
  // failed check after it still counts as reachable); a host only a second
  // location reached has no handshake of ours to date.
  const when = v.confirmed_from ? ", reached from a second location" : v.last_reachable_at ? ` · last handshake ${ago(v.last_reachable_at)}` : checked;
  const says = `${v.host}: TLS with this validator's key${when}.`;
  // Upload readiness, the server's own answer on the same heartbeats: a record beside the endpoint's state that never
  // moves it. Not ready only after two answers in a row; one is in the words, as one timeout is not an outage.
  const at = whenUTC(v.readiness_checked_at);
  switch (v.readiness) {
    case "ready":
      return { dot: "ok", word: "Ready", title: `${says} The server reports itself ready for uploads: its own checks of the app node, Fibre module, signer, active set, provider registration and store all pass. Checked ${at}.` };
    case "not_ready":
      return { dot: "hold", word: "Not ready", title: `${says} The server reported itself not ready for uploads in its last two checks, the latest at ${at}. A server says so when at least one of its own checks fails: app node, Fibre module, signer, active set, provider registration or store. Which one is in the operator's log. Uploads to it may fail.`, warn: true };
    case "not_ready_once":
      return { dot: "ok", word: "Reachable", title: `${says} At ${at} the server reported itself not ready for uploads; it shows as Not ready if the next check says so too.` };
    case "not_reported":
      return { dot: "ok", word: "Reachable", title: `${says} This endpoint does not report upload readiness.` };
    case "unchecked": {
      const last = v.readiness_last_answer === "ready" ? "ready" : v.readiness_last_answer === "not_ready" ? "not ready" : "readiness not reported";
      return { dot: "ok", word: "Reachable", title: `${says} Upload readiness could not be checked at ${at}${v.readiness_last_answer ? `; last answer ${last} at ${whenUTC(v.readiness_last_answer_at)}` : ""}.` };
    }
  }
  return { dot: "ok", word: "Reachable", title: says.slice(0, -1) };
}

const time = (s: string | null | undefined) => (s ? new Date(s).getTime() : null);

function sortValue(v: Validator, k: SortKey): number | null {
  switch (k) {
    case "power": return v.voting_power;
    // Every validator with a settlement in the period is ranked by its share;
    // one with none has no share and sorts last.
    case "signed": { const s = v.signing; return s && s.assigned > 0 ? s.signed / s.assigned : null; }
    case "last": return time(v.signing?.last_endorsed_at);
  }
}

/** the search field's mark, the site search's own */
const FIND = <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
/** the phone's order control's mark: three lines, longest first */
const ORDER = <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h7.5M2.5 12h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;

/** a sticky element resting at its sticky top, the page scrolled: it then draws the hairline that parts it from the rows under it */
function markStuck(el: HTMLElement | null) {
  if (!el) return;
  el.toggleAttribute("data-stuck", window.scrollY > 0 && el.getBoundingClientRect().top <= parseFloat(getComputedStyle(el).top) + 0.5);
}

/**
 * `periodSwitch`, the page's period control, sits under the heading, on one band with the search and the filter: the
 * period it selects is the Endorsements column's, named in its heading. `failed`: the list could not
 * be read and nothing of it is on screen, which the empty table says rather than "no validators on record"
 */
export default function Validators({ rows, window: win, notLive, loading, failed, periodSwitch }: { rows: Validator[]; window: string; notLive?: boolean; loading?: boolean; failed?: { error: string | null; status?: number } | null; periodSwitch?: ReactNode }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "power", dir: -1 });
  const router = useRouter();
  const go = (_: React.MouseEvent, to: string) => router.push(to);
  // A phone reads the list one row a validator: the order is one control over it whose list holds the four orders, and
  // a tapped row opens in place (its address, its other figures, the way to its page) rather than leaving the list.
  const phone = usePhone();
  const [sortOpen, setSortOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const band = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);
  const sortId = useId();

  // the band and the head stay under the header while the list is read; each draws its hairline only once it rests there
  useEffect(() => {
    if (!phone) return;
    const els = [band.current, head.current];
    let raf = 0;
    const read = () => { raf = 0; els.forEach(markStuck); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      els.forEach((el) => el?.removeAttribute("data-stuck"));
    };
  }, [phone]);

  // the orders' list closes on a tap outside the head (an (i)'s panel is outside it, in <body>) and on Escape, which
  // first closes an open (i)
  useEffect(() => {
    if (!sortOpen) return;
    const away = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest(".info-pop") || head.current?.contains(t)) return;
      setSortOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".info-pop")) return;
      setSortOpen(false);
      sortBtn.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", key); };
  }, [sortOpen]);

  const counts = useMemo(() => ({
    all: rows.filter((v) => !idle(v)).length,
    providers: rows.filter((v) => bonded(v) && !!v.host).length,
    unreachable: rows.filter((v) => bonded(v) && !!v.host && endpointState(v) === "unreachable").length,
    cert: rows.filter((v) => bonded(v) && !!v.host && endpointState(v) === "cert").length,
    notready: rows.filter((v) => bonded(v) && !!v.host && endpointState(v) === "reachable" && v.readiness === "not_ready").length,
    nohost: rows.filter((v) => bonded(v) && !v.host).length,
  }), [rows]);

  // The hosting column only exists while the lookup is on (observer/hosting):
  // a column of dashes would read as "nobody knows", which is not what off means.
  const showHosting = useMemo(() => rows.some((v) => !!v.hosting), [rows]);
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const pool = rows.filter((v) => {
      switch (filter) {
        case "providers": return bonded(v) && !!v.host;
        case "unreachable": case "cert": return bonded(v) && !!v.host && endpointState(v) === filter;
        case "notready": return bonded(v) && !!v.host && endpointState(v) === "reachable" && v.readiness === "not_ready";
        case "nohost": return bonded(v) && !v.host;
        default: return !idle(v) || !!needle;
      }
    }).filter((v) => !needle
      || v.address.toLowerCase().includes(needle)
      || (v.cons_address ?? "").toLowerCase().includes(needle)
      || (v.moniker ?? "").toLowerCase().includes(needle)
      || (v.operator_address ?? "").toLowerCase().includes(needle)
      || isOperatorAccount(needle, v.operator_address)
      || (v.host || v.last_host || "").toLowerCase().includes(needle)
      || (v.hosting ? [v.hosting.provider, v.hosting.as_org, v.hosting.country, v.hosting.asn ? "as" + v.hosting.asn : ""].join(" ").toLowerCase().includes(needle) : false));
    return [...pool].sort((a, b) => {
      const av = sortValue(a, sort.key), bv = sortValue(b, sort.key);
      if (av === null && bv === null) return b.voting_power - a.voting_power;
      if (av === null) return 1;
      if (bv === null) return -1;
      // Equal shares: the one resting on more settlements first (8 of 8 before 1 of 1).
      const more = sort.key === "signed" ? (b.signing?.assigned ?? 0) - (a.signing?.assigned ?? 0) : 0;
      return (av - bv) * sort.dir || more || b.voting_power - a.voting_power;
    });
  }, [rows, filter, needle, sort]);

  // a new order is read from its first row: on a phone the list of orders closes and, with the head resting mid-list, the
  // list's top comes back under the head. The page moves up, so the header's tabs come back: its full height is counted
  const toListTop = () => {
    const tb = body.current, th = head.current, b = band.current;
    if (!tb || !th || !b || !th.hasAttribute("data-stuck")) return;
    const bar = document.querySelector("header.top")?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: window.scrollY + tb.getBoundingClientRect().top - (bar + b.offsetHeight + th.offsetHeight) });
  };
  const clickSort = (k: SortKey, dflt: 1 | -1) => {
    setSort((s) => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: dflt }));
    if (!phone) return;
    setSortOpen(false);
    sortBtn.current?.focus({ preventScroll: true });
    toListTop();
  };
  // A heading with a definition carries it behind an (i), opened by a click:
  // nothing appears on hover. The (i) sits outside the label's box so the
  // label stays centred over its column. A heading that counts the selected
  // period names it after the label, in its own case: "Endorsements (24h)". The
  // period sits in a box as wide as the widest period's name (every name is laid
  // over it, unseen), so switching periods never moves a heading or, where the
  // columns follow their headings, the table.
  const period = periodName(win);
  const sortName = ORDERS[sort.key].label + (ORDERS[sort.key].per ? ` (${period})` : "");
  const perLabel = (
    <span className="per">
      <span>({period})</span>
      {WINDOWS.map((w) => <span key={w} className="per-w" aria-hidden="true">({periodName(w)})</span>)}
    </span>
  );
  const Th = ({ k, dflt, label, title, info, col, per }: { k: SortKey; dflt: 1 | -1; label: string; title?: string; info?: string; col: string; per?: boolean }) => (
    <th className={"num " + col + (info ? " has-i" : "")} title={title}>
      <span className="thi">
        <button type="button" className="sort" aria-pressed={sort.key === k} onClick={() => clickSort(k, dflt)}>
          {label}{per && <> {perLabel}</>}{sort.key === k && <span className="arrow" aria-hidden="true">{sort.dir === -1 ? "↓" : "↑"}</span>}
        </button>
        {info && <span className="thi-i"><Info label={label}><p>{info}</p></Info></span>}
      </span>
    </th>
  );
  const href = (v: Validator, hash = "") => validatorHref(v.operator_address, v.address, `${win !== "24h" ? `&window=${win}` : ""}${hash}`);

  // The endorsement share, with the counts behind it in the title and a thin bar of it under it, from the first
  // settlement on; a dash with its reason when nothing was assigned. Never a fault colour. A phone's row has no column
  // to explain a lone dash: it says so in words, or says nothing where the row's state already does (no endpoint,
  // jailed, not bonded, not checked yet: `quiet`).
  const signed = (v: Validator, quiet: boolean) => {
    const s = v.signing;
    if (!s || s.assigned === 0) {
      const title = s && s.unknown > 0 ? `${int(s.unknown)} assigned promise${s.unknown === 1 ? "" : "s"} recorded before signatures were verified: nothing to say either way.` : "No settled promise assigned this validator rows in this period.";
      if (phone) return quiet ? null : <span className="muted na" title={title}>{s && s.unknown > 0 ? "Not recorded" : "None assigned"}</span>;
      return <span className="muted" title={title}>—</span>;
    }
    return (
      <span className="rate share endorsed" title={`${int(s.signed)} of ${int(s.assigned)} settled promises endorsed`}>
        {pctOf(s.signed, s.assigned)}
        <i className="eb" aria-hidden="true"><i style={{ width: `${Math.min(100, (100 * s.signed) / s.assigned)}%` }} /></i>
      </span>
    );
  };
  const last = (v: Validator) => {
    const at = v.signing?.last_endorsed_at;
    return at ? <span title={utcWord(at)}>{ago(at)}</span> : <span className="muted">—</span>;
  };

  return (
    <section className="vlist">
      <div className="vhead">
        <h2>Validators</h2>
        <p className="sub">{notLive ? "Bonded set" : "Endorsements over the selected period"}</p>
      </div>
      <div className="vband">
        {periodSwitch}
        <div className="tools" ref={band}>
          <label className="search">{FIND}<span className="sr-only">Search validators</span><input type="search" placeholder="Search name or address" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <Pick label="Filter validators" value={filter} onChange={setFilter} options={[
            { value: "all", label: "All validators", count: counts.all },
            { value: "providers", label: "Fibre providers", count: counts.providers, dot: "ok" },
            { value: "unreachable", label: "Unreachable now", count: counts.unreachable, dot: "hold" },
            { value: "cert", label: "Wrong certificate now", count: counts.cert, dot: "hold" },
            { value: "notready", label: "Not ready now", count: counts.notready, dot: "hold" },
            { value: "nohost", label: "No endpoint", count: counts.nohost, dot: "none" },
          ]} />
        </div>
      </div>
      <div className="tablewrap framed">
        <table className={"vt" + (phone && sortOpen ? " sort-open" : "")} data-by={phone ? sort.key : undefined}>
          <thead ref={head}>
            {/* the phone's order control, over the row of headings that becomes its list (globals.css) */}
            {phone && (
              <tr className="vt-sb">
                <th>
                  <button type="button" className="vt-sort" ref={sortBtn} aria-expanded={sortOpen} aria-controls={sortId}
                    aria-label={`Sorted by ${sortName}, ${sort.dir === -1 ? "descending" : "ascending"}`} onClick={() => setSortOpen((o) => !o)}>
                    {ORDER}<span>{sortName}</span><span className="vt-sort-a" aria-hidden="true">{sort.dir === -1 ? "↓" : "↑"}</span>
                  </button>
                </th>
              </tr>
            )}
            <tr id={phone ? sortId : undefined}>
              <th className="col-pin">Validator</th>
              <th className="c-ep" title="Whether the validator's Fibre server answered Tensile's latest check, and, from celestia-app v10.5, whether it reports itself ready for uploads.">Endpoint now</th>
              {showHosting && <th className="c-host" title="Where the validator's Fibre server is hosted.">Hosting</th>}
              <Th col="c-power" k="power" dflt={-1} label={ORDERS.power.label} title="The default order. Not a performance ranking." />
              <Th col="c-end" k="signed" dflt={-1} label={ORDERS.signed.label} per info="How often this validator’s signature is in the settlement, counted while it had a Fibre provider. A settlement needs signatures from ⅔ of the stake, and the first validators to respond fill it." />
              <Th col="c-last" k="last" dflt={-1} label={ORDERS.last.label} info="The last time this validator signed a blob, in any period." />
            </tr>
          </thead>
          <tbody ref={body}>
            {list.length === 0 && (
              <tr className="empty"><td colSpan={5 + (showHosting ? 1 : 0)}>
                {loading && rows.length === 0 ? "Loading…"
                  : rows.length === 0 && failed ? `${failedWords(failed)}.`
                  : rows.length === 0 ? "No validators on record yet."
                  : needle ? `Nothing matches “${q}”.`
                  : filter === "unreachable" ? "Every registered endpoint answered its newest check."
                  : filter === "cert" ? "No endpoint answered its newest check with a certificate a publisher rejects."
                  : filter === "providers" ? "No bonded validator has registered a Fibre provider yet."
                  : "Every bonded validator has registered a Fibre provider."}
              </td></tr>
            )}
            {list.map((v) => {
              const e = endpoint(v);
              const isOpen = phone && open === v.address;
              const toggle = () => setOpen((o) => (o === v.address ? null : v.address));
              const addr = v.moniker ? (v.operator_address || v.cons_address || v.address) : (v.cons_address || v.address);
              // a phone's row names its figures for assistive tech, and shows the names once it is open (globals.css)
              const named = (label: string) => phone && <span className="vt-l">{label}</span>;
              return (
                // The whole row opens the validator; links keep their own target. On a phone a tap opens the row in
                // place instead, and its name and the open row's last line are the links to its page.
                <tr key={v.address} className={[e.warn ? "warn" : "", isOpen ? "open" : ""].filter(Boolean).join(" ") || undefined}
                  onClick={(ev) => {
                    if (!phone) return openRow(ev, href(v), go);
                    if (!(ev.target as HTMLElement).closest("a, button") && !window.getSelection()?.toString()) toggle();
                  }}
                  onAuxClick={(ev) => openRow(ev, href(v), go)}>
                  <td className="id col-pin">
                    <span className="who">
                      <Avatar v={v} />
                      <span>
                        <Link className="mon" href={href(v)}>{v.moniker || shortMid(v.operator_address || v.cons_address || v.address, 18, 4)}</Link>
                        {isSelf(v) && <span className="ours" title="Huginn Tech runs both this validator and Tensile. It is measured like every other validator.">runs Tensile</span>}
                        {notLive && v.signaled_upgrade === true && <span className="ours" title="Signalled on chain for the app version that brings Fibre.">signalled</span>}
                        {notLive && v.signaled_upgrade === false && <span className="ours" title="Has not signalled on chain for the app version that brings Fibre.">not signalled</span>}
                        {/* The operator address is the one operators and delegators know (explorers list it); the consensus address stays in the tooltip and on the validator page. */}
                        {/* Without a moniker the name above already is the operator address; the line then gives the consensus address rather than the same one twice. */}
                        {(v.moniker || v.operator_address) && <span className="addr mono" title={[v.operator_address, v.cons_address || v.address].filter(Boolean).join(" · ")}>{shortMid(addr, 18, 4)}</span>}
                        {isOpen && (v.moniker || v.operator_address) && <Copy text={addr} label={addr === v.operator_address ? "the valoper address" : "the consensus address"} />}
                        {/* the row's toggle for a keyboard or a screen reader, unseen: a tap anywhere on the row is the same */}
                        {phone && <button type="button" className="vt-tg sr-only" aria-expanded={isOpen} onClick={toggle}>Details</button>}
                      </span>
                    </span>
                  </td>
                  <td className="vt-ep"><span className="state" title={e.title}><i className={"dot " + e.dot} />{e.word}</span></td>
                  {showHosting && <td className="vt-ho"><HostingCell h={v.hosting} full={phone} /></td>}
                  <td className="num fig vt-vp">{named(ORDERS.power.label)}{int(v.voting_power)}</td>
                  <td className="num soft-col fig vt-en">{signed(v, e.dot === "none")}</td>
                  <td className="num vt-le">{named(ORDERS.last.label)}{last(v)}</td>
                  {isOpen && <td className="vt-go"><Link href={href(v)}>Validator page <span aria-hidden="true">→</span></Link></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
