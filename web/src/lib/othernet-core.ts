import type { BlobKey } from "@/lib/blobkey";
import type { Found, MatchBy } from "@/lib/blobfind-core";

/**
 * Each network has a site of its own, and a link made for one can land on the other: Mocha's links shared before
 * mainnet's site took the address. A blob, a transaction, a publisher or a validator this site has no record of is
 * asked for, once, on the other network's site, and a record there is one line with a link to its page there
 * (othernet.tsx asks; this module is the part with no React and no fetch of its own, for its test). Type imports only:
 * the blob lookup is passed in.
 */

/** the site's name in its titles: "Tensile", with its network's name after it when the build gives one ("Tensile Mocha") */
export function siteName(label?: string | null): string {
  const l = (label ?? "").trim();
  return l ? `Tensile ${l}` : "Tensile";
}

/**
 * a shared link's preview image, from the site's own public/: og.png, or a network's own when the build gives its name,
 * og-<name in lower case>.png (og-mocha.png, which says "Tensile Mocha" and Mocha's address)
 */
export function previewImage(label?: string | null): string {
  const l = (label ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return l ? `/og-${l}.png` : "/og.png";
}

/** the other network's site: its origin, and its network's name as the line prints it */
export type OtherSite = { origin: string; label: string };

/**
 * NEXT_PUBLIC_OTHER_SITE_URL and NEXT_PUBLIC_OTHER_NETWORK_LABEL as a build reads them: both set, and the address an
 * http(s) origin (a final slash is fine), else null, and nothing is ever asked of another site.
 */
export function otherSiteOf(url?: string | null, label?: string | null): OtherSite | null {
  const u = (url ?? "").trim(), l = (label ?? "").trim();
  if (!u || !l) return null;
  const x = (() => { try { return new URL(u); } catch { return null; } })();
  if (!x) return null;
  if (x.protocol !== "https:" && x.protocol !== "http:") return null;
  if (x.username || x.password || x.pathname !== "/" || x.search || x.hash || u.replace(/\/$/, "").toLowerCase() !== x.origin) return null;
  return { origin: x.origin, label: l };
}

/**
 * One way to ask the other site for a record, and the page it opens there (href, a path with its query; none: the
 * page asking, at its own address). route: one record's API route, there when the answer is a success. blob: a blob
 * identifier, asked as the page here asked it (findBlobs), there when it names a blob or a transaction that failed in a
 * block; one: a lone blob opens its own page rather than href.
 */
export type Look =
  | { route: string; href?: string }
  | { blob: BlobKey; as: MatchBy[]; href?: string; one?: boolean };

type Get = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
type Find = (key: BlobKey, opts: { as?: MatchBy[]; limit?: number; base: string; get: Get }) => Promise<Found>;

/**
 * The address of the record's page on the other site: the looks asked in order, the first that finds it giving the
 * page; null when none does, or the site does not answer, which shows nothing. here is the asking page's own path and
 * query. get asks the other site's API (its /api/v1 routes, as this site's pages ask their own), find is findBlobs.
 */
export async function findOther(site: OtherSite, looks: Look[], here: string, deps: { get: Get; find: Find }): Promise<string | null> {
  const base = `${site.origin}/api`;
  for (const l of looks) {
    const href = l.href ?? here;
    if ("route" in l) {
      try {
        if ((await deps.get(base + l.route, { cache: "no-store" })).ok) return site.origin + href;
      } catch { /* no answer: nothing to show */ }
      continue;
    }
    const f: Found | null = await deps.find(l.blob, { as: l.as, limit: 2, base, get: deps.get }).catch(() => null);
    if (!f) continue;
    if (f.rows.length > 0) return site.origin + (l.one && f.rows.length === 1 && f.total === 1 ? `/blob/?hash=${f.rows[0].promise_hash}` : href);
    if (f.failedTx) return site.origin + href;
  }
  return null;
}
