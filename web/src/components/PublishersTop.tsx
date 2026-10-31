"use client";
import { type ReactNode } from "react";
import Link from "next/link";
import { type Window, bytes, int, span, tia, useApi, utcWord } from "@/lib/api";
import type { MarketWithQueue, Params, PublisherWithQueue } from "@/lib/withdrawals";
import { type WindowName, periodName } from "@/lib/window";
import { unit } from "@/components/Unit";
import Ident from "@/components/Ident";
import { Who } from "@/components/Ledger";
import Warn from "@/components/Warn";
import Info from "@/components/Info";
import { Lbl, ShowPeriod, age, dayTime, holding } from "@/components/BlobsDeck";

/**
 * The Publishers page's top: the period's figures in a row of small frames,
 * the Blobs top's own: the publishers active, the blob size, the fees paid and
 * the escrow held now. The table under it ranks the publishers.
 *
 * The figures are one /v1/market answer. While another period loads, the last
 * answer stays, a step back, and the top changes in one step.
 *
 * A period with no blob and no deposit keeps the row: the 0, when the last blob
 * settled and who posted it, and the escrow held now.
 */

const plural = (n: number, w: string) => `${int(n)} ${w}${n === 1 ? "" : "s"}`;

/** a publisher as the table names it: its registry label, else the chip with the address's last four; `short` drops the chip's prefix */
function Name({ p, short }: { p: { publisher: string; label?: string }; short?: boolean }) {
  if (p.label) {
    return (
      <Link className="lg-who tp-lab" href={`/publisher/?addr=${p.publisher}`} title={p.publisher}>
        <Ident addr={p.publisher} /><span className="nm">{p.label}</span>
      </Link>
    );
  }
  return <span className={short ? "tp-who short" : "tp-who"}><Who addr={p.publisher} /></span>;
}

/**
 * The two network parameters a publisher's escrow lives by, one tap away over the table: how long a signed promise
 * has to settle, and how long a withdrawal waits. Read from /v1/params; every parameter is on the methodology page.
 */
export function EscrowParams() {
  const { data: p } = useApi<Params>("/v1/params", 300000);
  const c = p?.current;
  return (
    <Info label="Protocol parameters" className="pp-params" title="Payment promise timeout and withdrawal delay"
      trigger={<>Protocol parameters<span className="pp-i" aria-hidden="true">i</span></>}>
      <dl className="pp-kv">
        <dt>Payment promise timeout</dt><dd>{c ? span(c.payment_promise_timeout_s) : "—"}</dd>
        <dt>Withdrawal delay</dt><dd>{c ? span(c.withdrawal_delay_s) : "—"}</dd>
      </dl>
      <p className="pp-all"><Link href="/methodology/#params">Every parameter →</Link></p>
    </Info>
  );
}

export default function PublishersTop({ m, win, list, all, now, pre, onWin }: {
  /** /v1/market for the period; the last answer stays while another period loads */
  m: MarketWithQueue | null;
  /** the period selected: the labels' until the first answer lands */
  win: WindowName;
  /** /v1/publishers for the period: who only moved escrow, for the first figure's title */
  list: { publishers: PublisherWithQueue[]; count: number; window?: Window } | null;
  /** every account on record: the newest blob for a quiet period */
  all: { publishers: PublisherWithQueue[] } | null;
  /** the observer's clock */
  now: number;
  /** before activation: every figure is a dash */
  pre: boolean;
  onWin: (w: WindowName) => void;
}) {
  const shownWin = (m?.window.name ?? win) as WindowName;
  const per = periodName(shownWin);
  const quiet = !!m && m.settlements === 0;

  let activeTitle = "Accounts that paid for at least one blob in the period.";
  if (m && list && list.window?.name === m.window.name && list.count > m.publishers_active) {
    activeTitle = activeTitle.slice(0, -1) + `; ${int(list.count - m.publishers_active)} more only moved escrow.`;
  }

  // ---- the escrow, held now ----
  const held = m ? m.escrow_total_utia ?? m.escrow_held_utia : 0;
  const queued = m?.withdrawal_queue?.pending;
  const accounts = !!m && (m.escrow_total_utia == null || m.escrow_total_utia === m.escrow_held_utia);
  const heldTitle = m ? [
    queued && queued.count > 0 ? `${tia(queued.utia)} queued to withdraw${queued.next_available_at ? `, the next payable from ${utcWord(queued.next_available_at)}` : ""}` : "",
    m.escrow_total_at ? `As of ${utcWord(m.escrow_total_at)}` : "",
  ].filter(Boolean).join("; ") || undefined : undefined;

  // another period is on its way: what is shown stays, a step back, until it lands
  const pending = !!m && m.window.name !== win;
  const cls = (more: string) => `tp tp-p tc${more}${pending ? " is-pending" : ""}`;

  // ---- a period with no blob and no deposit: the row, the 0, when the last blob was, and the escrow held now ----
  if (m && quiet && m.deposits.count === 0) {
    const newest = all
      ? all.publishers.reduce<PublisherWithQueue | null>((a, p) => (p.last_settlement_at && (!a || Date.parse(p.last_settlement_at) > Date.parse(a.last_settlement_at!)) ? p : a), null)
      : null;
    const newestAt = newest?.last_settlement_at ? Date.parse(newest.last_settlement_at) : 0;
    const next = newest && now ? holding(shownWin, newestAt, now) : null;
    return (
      <section className={cls(" is-quiet")} aria-label="The period's publishers" aria-busy={pending || undefined}>
        <div className="tc-tabs">
          <div className="tc-tab">
            <Lbl name="Publishers" per={per} />
            <p className="tc-v zero"><span title="Accounts that paid for at least one blob in the period.">0<span className="u"> active</span></span></p>
          </div>
          <div className="tc-tab tc-say">
            <h2 className="tc-k">Last blob</h2>
            <p className="tc-v">
              {newest
                ? <span className="say">settled {now ? <span className="age" title={dayTime(newest.last_settlement_at!)}>{age(now - newestAt)} ago</span> : <span className="wait">0 d 00 h ago</span>} by <Name p={newest} short /></span>
                : <span className="say">{all ? "None on record" : <span className="wait">settled 0 d 00 h ago by 0000</span>}</span>}
              {next && <ShowPeriod to={next} onWin={onWin} />}
            </p>
          </div>
          <div className="tc-tab">
            <Lbl name="Escrow held" per="now" />
            <p className="tc-v">
              <span title={heldTitle}>{unit(tia(held))}</span>
              {accounts && <span className="beside"><b>{int(m.escrow_accounts)}</b> {m.escrow_accounts === 1 ? "account" : "accounts"}</span>}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // a payment promise that timed out: the warning beside the fees
  const timedOut = m && m.timeouts > 0 ? `${plural(m.timeouts, "payment promise")} timed out in the period; ${tia(m.timed_out_utia)} charged all the same` : null;

  // ---- the frames: each a figure of the period (the escrow's now) ----
  const FRAMES: { name: string; per: string; title: string | undefined; wait: string; figure: (m: MarketWithQueue) => ReactNode }[] = [
    {
      name: "Publishers", per, title: m ? `${activeTitle} ${plural(m.settlements, "settlement")} in the period.` : activeTitle, wait: "0 active",
      figure: (m) => <>{int(m.publishers_active)}<span className="u"> active</span></>,
    },
    {
      name: "Total size", per: "", title: "Summed over settlements: a blob settled twice counts twice.", wait: "000.00 GiB",
      figure: (m) => unit(bytes(m.bytes)),
    },
    {
      name: "Fees paid", per: "", wait: "00,000 TIA",
      title: m?.paid_per_mib_utia != null ? `${tia(m.paid_per_mib_utia)} per MiB` : undefined,
      figure: (m) => <>{unit(tia(m.fees_settled_utia))}{timedOut && <Warn tone="fault" text={timedOut} />}</>,
    },
    {
      name: "Escrow held", per: "now", wait: "00,000 TIA",
      title: m ? [accounts ? plural(m.escrow_accounts, "account") : "", `${tia(m.deposits.utia)} deposited in the period${m.deposits.count > 0 ? ` (${plural(m.deposits.count, "deposit")})` : ""}`, heldTitle ?? ""].filter(Boolean).join("; ") : undefined,
      figure: (m) => <>{unit(tia(held))}{accounts && <span className="beside"><b>{int(m.escrow_accounts)}</b> {m.escrow_accounts === 1 ? "account" : "accounts"}</span>}</>,
    },
  ];

  return (
    <section className={cls("")} aria-label="The period's publishers" aria-busy={pending || undefined}>
      <div className="tc-tabs">
        {FRAMES.map((x) => (
          <div key={x.name} className="tc-tab" title={x.title}>
            <span className="tc-k">{x.name}{x.per && <span className="per"> · {x.per}</span>}</span>
            <span className="tc-v">{m ? x.figure(m) : pre ? "—" : <span className="wait">{x.wait}</span>}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
