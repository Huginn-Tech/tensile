"use client";
import { useEffect, useState } from "react";
import { findBlobs } from "@/lib/blobfind-core";
import { findOther, type Look } from "@/lib/othernet-core";
import { OTHER_SITE } from "@/lib/site";

export type { Look };

/** how long the other site has to answer; past it nothing is shown, as when it has no such record */
const WAIT_MS = 6000;

/**
 * Asks the other network's site (OTHER_SITE) for a record this site has none of, once for these looks: null asks
 * nothing, and a page passes them only once its own API has said the record is not here (a 404, or a blob lookup that
 * found nothing), never while it loads or fails, so a record found here never goes to the other site. asking: the
 * other site has not answered yet; href: the record's page there, null when it has none, did not answer in WAIT_MS or
 * no other site is set (then nothing is ever asked).
 */
export function useOther(looks: Look[] | null): { asking: boolean; href: string | null } {
  const sig = OTHER_SITE && looks?.length ? JSON.stringify(looks) : "";
  const [st, setSt] = useState<{ sig: string; href: string | null } | null>(null);
  useEffect(() => {
    const site = OTHER_SITE;
    if (!sig || !site) return;
    const asked = JSON.parse(sig) as Look[];
    let on = true;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), WAIT_MS);
    // the same page there: this one's path and query
    const here = window.location.pathname + window.location.search;
    findOther(site, asked, here, { get: (url, init) => fetch(url, { ...init, signal: ctl.signal, credentials: "omit" }), find: findBlobs })
      .catch(() => null)
      .then((href) => { clearTimeout(t); if (on) setSt({ sig, href }); });
    return () => { on = false; clearTimeout(t); ctl.abort(); };
  }, [sig]);
  if (!sig) return { asking: false, href: null };
  return st?.sig === sig ? { asking: false, href: st.href } : { asking: true, href: null };
}

/** the line for a record the other network's site has: "This is on Mocha. Open it there →" */
export function OnOther({ href }: { href: string }) {
  return <>This is on {OTHER_SITE?.label}. <a className="go-other" href={href}>Open it there →</a></>;
}
