// The Analytics page's one data file. The page draws every settlement and every validator's record, some two hundred
// API reads, so a timer on the API's host reads them once (fibre-analytics@) and each visitor fetches the result. No IPs
// and no host strings go in. Node's standard library only, as site-server.cjs.
//
//   API_LISTEN       observer-api's host:port, default 127.0.0.1:8081, the same variable its unit reads
//   NETWORK          the network's name, the instance of the unit
//   STATE_DIRECTORY  where this run's data.json goes and what the last run read is kept, set by systemd
//
// A run that cannot read something stops before writing, so the page keeps the last whole file and says when it was read.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const API = `http://${process.env.API_LISTEN || "127.0.0.1:8081"}/v1`;
const NET = process.env.NETWORK || "mocha";
const DIR = process.env.STATE_DIRECTORY || ".";
const WINDOWS = ["7d", "30d", "all"];
// The last day of settlements is read again each run: a recent blob's availability is still being decided.
const REREAD_S = 24 * 3600;
// A validator's own page costs the database a third of a second, and what is taken from it moves slowly.
const DETAILS_EVERY_MS = 3600 * 1e3;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function get(p) {
  const r = await fetch(API + p, { headers: { "user-agent": "tensile-analytics" } });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
}
function readJson(name, fallback) {
  try { return JSON.parse(readFileSync(path.join(DIR, name), "utf8")); } catch { return fallback; }
}
// Whole or not at all: site and state only ever see a finished file.
function writeJson(name, value) {
  const f = path.join(DIR, name);
  writeFileSync(f + ".new", JSON.stringify(value));
  renameSync(f + ".new", f);
}

// Namespaces are often ASCII names, with leading zeros and sometimes a binary tail.
const nsName = (hex) => {
  const s = Buffer.from(hex.replace(/^(00)+/, ""), "hex").toString("latin1");
  const m = s.match(/^[\x21-\x7e]{3,}/);
  return m ? m[0] : null;
};
const short = (a) => `${a.slice(0, 9)}…${a.slice(-6)}`;
const nameOf = (row) => {
  for (const n of row.namespaces || []) { const s = nsName(n.namespace); if (s) return s; }
  return null;
};

// A company's name as people say it, for the networks the hosting data has only a registry handle for.
const NAMES = { "SERVERS-COM": "Servers.com", "CDN77 _": "CDN77", "GRUPO ZGH SPA": "Grupo ZGH", "ORACLE-BMC-31898": "Oracle Cloud", "M247": "M247", "EQUINIX": "Equinix", "NETCUP": "netcup", "PEBBLEHOST": "PebbleHost", "CDNEXT": "CDNEXT", "FREEHOST": "Freehost", "XENYA": "Xenya", "AMARUTU-TECHNOLOGY": "Amarutu", "ATT-INTERNET4": "AT&T", "IS": "Internet Solutions", "ELIXIOR-CLOUD": "Elixior Cloud", "ECAD-INFRA-00": "ECAD Infra", "AS-01NODE": "01node", "RL5-AS": "RL5", "IWEB-AS": "iWeb", "HOSTKEY-AS": "Hostkey", "IPAX-AS": "IPAX", "ADMAN-AS": "Adman", "AS275783 - KARSI169": "Karsi" };
const PRE = [[/^IONOS-AS/, "IONOS"], [/^MYLOC-AS/, "myLoc"], [/^NETSEC-HK/, "Netsec"], [/^RETN-LV/, "RETN"], [/^CORBINA-AS/, "Vimpelcom"], [/^TIER4CLOU/, "Tier 4 Cloud"], [/^POWERVIS/, "LG Powercomm"]];
function pretty(org, asn) {
  if (!org) return asn ? `AS${asn}` : "Unknown";
  if (NAMES[org]) return NAMES[org];
  for (const [re, n] of PRE) if (re.test(org)) return n;
  const s = org.split(/\s+/)[0].replace(/^AS-/, "").replace(/-AS\d*$/, "").replace(/-\d+$/, "").replace(/[-_]+/g, " ").trim();
  if (!s) return asn ? `AS${asn}` : "Unknown";
  return s.length <= 4 ? s.toUpperCase() : s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
const region = new Intl.DisplayNames(["en"], { type: "region" });
const cname = (cc) => { try { return region.of(cc); } catch { return cc; } };
const rate = (n, d) => (d > 0 ? +(n / d).toFixed(6) : null);

// Every settlement, newest first: [unix s, size, publisher, fee utia, attested share, availability, namespace name, height, tx index].
async function settlements(known) {
  const from = known.length ? known[0][0] - REREAD_S : 0;
  const rows = [];
  let cur = "";
  for (;;) {
    const list = (await get(`/blobs?limit=100${cur}`)).blobs || [];
    for (const b of list) {
      rows.push([
        Math.round(new Date(b.settlement_time).getTime() / 1000), b.blob_size, b.publisher, b.charge?.fee_utia ?? null,
        b.total_voting_power ? +(b.attested_voting_power / b.total_voting_power).toFixed(4) : null, b.reconstructable?.status ?? null, nsName(b.namespace),
        b.settlement_height, b.settlement_tx_index,
      ]);
    }
    const last = list[list.length - 1];
    if (!last || list.length < 100 || rows[rows.length - 1][0] < from) break;
    cur = `&before_height=${last.settlement_height}&before_tx_index=${last.settlement_tx_index}`;
    await sleep(50);
  }
  const end = rows[rows.length - 1];
  return end ? [...rows, ...known.filter((r) => r[7] < end[7] || (r[7] === end[7] && r[8] < end[8]))] : known;
}

async function usage(rows) {
  const params = await get("/params");
  const market = {}, publishers = {};
  for (const w of WINDOWS) {
    const m = await get(`/market?window=${w}`);
    market[w] = {
      window: m.window, settlements: m.settlements, blobs: m.blobs, bytes: m.bytes, fees_utia: m.fees_settled_utia,
      publishers_active: m.publishers_active, paid_per_mib_utia: m.paid_per_mib_utia, timeouts: m.timeouts, timed_out_utia: m.timed_out_utia,
      deposits: m.deposits, escrow_held_utia: m.escrow_held_utia, escrow_accounts: m.escrow_accounts, namespaces: m.namespaces,
      withdrawn: m.withdrawal_queue?.executed, withdrawal_pending: m.withdrawal_queue?.pending, consumed: m.withdrawal_queue?.consumed, daily: m.daily || [],
    };
    const p = await get(`/publishers?window=${w}&limit=100`);
    publishers[w] = p.publishers.map((r) => ({
      address: r.publisher, short: short(r.publisher), name: r.label || nameOf(r), settlements: r.settlements, bytes: r.bytes, bytes_share: r.bytes_share,
      fees_utia: r.fees_utia, fees_share: r.fees_share, paid_per_mib_utia: r.paid_per_mib_utia, avg_blob_bytes: r.avg_blob_bytes, largest_blob_bytes: r.largest_blob_bytes,
      timeouts: r.timeouts, first_settlement_at: r.first_settlement_at, last_settlement_at: r.last_settlement_at, namespaces_total: r.namespaces_total,
      namespaces: (r.namespaces || []).map((n) => nsName(n.namespace)).filter(Boolean).slice(0, 4),
      escrow_utia: r.escrow?.balance_utia ?? null, escrow_available_utia: r.escrow?.available_utia ?? null,
    }));
  }
  const addresses = [...new Set(rows.map((r) => r[2]))];
  const index = new Map(addresses.map((a, i) => [a, i]));
  const sizes = {};
  for (const r of rows) if (r[6]) (sizes[r[2]] ||= {})[r[6]] = (sizes[r[2]][r[6]] || 0) + r[1];
  const largest = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    read_at: new Date().toISOString(),
    params: { price_formula: params.price_formula, max_blob_size_bytes: params.protocol?.max_blob_size_bytes, withdrawal_delay_s: params.current?.withdrawal_delay_s, shard_retention_s: params.current?.shard_retention_s },
    market, publishers, addresses, address_names: Object.fromEntries(addresses.map((a) => [a, largest(sizes[a])])),
    settlements: rows.map(([t, size, pub, fee, share, status, ns]) => [t, size, index.get(pub), fee, share, status, ns]),
  };
}

// What each validator's own page adds to the list, kept between runs.
async function details(list, known) {
  if (known.read_at && Date.now() - known.read_at < DETAILS_EVERY_MS && list.every((v) => known.by[v.operator_address])) return known;
  const by = {};
  for (const v of list) {
    const d = await get(`/validators/${v.operator_address}?window=30d`);
    by[v.operator_address] = { reach: d.validator?.reachability_window ?? null, endpoint_since: d.validator?.endpoint_since ?? null, moves: (d.endpoint_history ?? []).length };
    await sleep(100);
  }
  return { read_at: Date.now(), by };
}

function hosting(listed, by, tip, host, params) {
  const list = listed.validators;
  const bonded = (v) => !v.jailed && (!v.bond_status || v.bond_status === "BOND_STATUS_BONDED");
  const T = list.filter(bonded).reduce((a, v) => a + (v.voting_power || 0), 0);
  const rows = list.map((v) => {
    const d = by[v.operator_address] || {};
    const h = v.hosting || null;
    const company = h ? (h.provider && h.provider !== "Other" ? h.provider : pretty(h.as_org, h.asn)) : null;
    return {
      moniker: v.moniker, valoper: v.operator_address, vp: v.voting_power || 0, share: bonded(v) && T ? +(v.voting_power / T).toFixed(6) : 0, bonded: bonded(v), jailed: !!v.jailed, has_host: !!v.host,
      company, asn: h?.asn ?? null, cc: h?.country ?? null, country: h?.country ? cname(h.country) : null, city: h?.city ?? null, lat: h?.lat != null ? +h.lat.toFixed(2) : null, lon: h?.lon != null ? +h.lon.toFixed(2) : null,
      reachable_now: v.reachable ?? null, readiness: v.readiness ?? null, reach: d.reach ? { num: d.reach.num, den: d.reach.den } : null,
      obligations: v.obligations ? { total: v.obligations.total, served: v.obligations.served, broken: v.obligations.broken } : null,
      signing: v.signing ? { assigned: v.signing.assigned, signed: v.signing.signed } : null, endpoint_since: d.endpoint_since ?? null, moves: d.moves ?? 0,
    };
  }).sort((a, b) => b.vp - a.vp);
  const hosted = rows.filter((r) => r.has_host && r.bonded);
  const group = (keyf) => {
    const m = new Map();
    for (const r of hosted) {
      const k = keyf(r); if (k == null) continue;
      if (!m.has(k)) m.set(k, { key: k, vp: 0, hosts: 0, validators: [], countries: new Set(), cities: new Set(), companies: new Set(), asns: new Set(), rn: 0, rd: 0, ready_vp: 0, ready: 0, not_ready: 0, not_reported: 0, served: 0, total: 0, broken: 0, signed: 0, assigned: 0 });
      const g = m.get(k);
      g.vp += r.vp; g.hosts++; g.validators.push({ moniker: r.moniker, share: r.share });
      if (r.cc) g.countries.add(r.cc);
      if (r.city) g.cities.add(r.city);
      if (r.company) g.companies.add(r.company);
      if (r.asn) g.asns.add(r.asn);
      if (r.reach) { g.rn += r.reach.num; g.rd += r.reach.den; }
      if (r.readiness === "ready") { g.ready++; g.ready_vp += r.vp; } else if (r.readiness === "not_ready") g.not_ready++; else g.not_reported++;
      if (r.obligations) { g.served += r.obligations.served; g.total += r.obligations.total; g.broken += r.obligations.broken; }
      if (r.signing) { g.signed += r.signing.signed; g.assigned += r.signing.assigned; }
    }
    return [...m.values()].sort((a, b) => b.vp - a.vp).map((g, i) => ({
      rank: i + 1, name: g.key, share: +(g.vp / T).toFixed(6), vp: g.vp, hosts: g.hosts, host_share: +(g.hosts / hosted.length).toFixed(6), countries: [...g.countries], cities: [...g.cities], companies: [...g.companies], asns: [...g.asns],
      reachability: rate(g.rn, g.rd), checks: g.rd, failed_checks: g.rd - g.rn, ready_hosts: g.ready, not_ready_hosts: g.not_ready, not_reported_hosts: g.not_reported, ready_share: rate(g.ready_vp, g.vp),
      served: g.served, shards: g.total, not_served: g.broken, signed: g.signed, assigned: g.assigned, validators: g.validators.sort((a, b) => b.share - a.share),
    }));
  };
  const providers = group((r) => r.company);
  const countries = group((r) => r.cc).map((c) => ({ ...c, cc: c.name, name: cname(c.name) }));
  const cities = group((r) => (r.city ? `${r.city}|${r.cc}` : null)).map((c) => {
    const [city, cc] = c.name.split("|"), f = hosted.find((r) => r.city === city && r.cc === cc);
    return { ...c, name: city, cc, country: cname(cc), lat: f?.lat ?? null, lon: f?.lon ?? null };
  });
  const noHost = rows.filter((r) => !r.has_host && r.bonded);
  return {
    read_at: listed.computed_at, height: tip.height, hosting_looked_up_at: host.sources?.looked_up_at,
    fibre_live_at: params.history?.[0]?.effective_from_time ?? params.current?.effective_from_time ?? null,
    totals: {
      voting_power: T, validators_bonded: rows.filter((r) => r.bonded).length, hosts: hosted.length, host_vp_share: +hosted.reduce((a, r) => a + r.share, 0).toFixed(6), no_host_validators: noHost.length, no_host_vp_share: +noHost.reduce((a, r) => a + r.share, 0).toFixed(6),
      providers: providers.length, countries: countries.length, cities: cities.length, asns: new Set(hosted.map((r) => r.asn).filter(Boolean)).size,
      ready_hosts: hosted.filter((r) => r.readiness === "ready").length, not_ready_hosts: hosted.filter((r) => r.readiness === "not_ready").length, not_reported_hosts: hosted.filter((r) => !["ready", "not_ready"].includes(r.readiness)).length, ready_vp_share: +hosted.filter((r) => r.readiness === "ready").reduce((a, r) => a + r.share, 0).toFixed(6),
    },
    providers, countries, cities, validators: rows.filter((r) => r.bonded),
  };
}

const state = readJson("state.json", { rows: [], details: {} });
const rows = await settlements(state.rows);
const listed = await get("/validators?window=30d");
const known = await details(listed.validators, state.details);
const [tip, host, params] = [await get("/tip"), await get("/hosting"), await get("/params")];
writeJson("data.json", { net: NET, usage: await usage(rows), data: hosting(listed, known.by, tip, host, params) });
writeJson("state.json", { rows, details: known });
console.log(`analytics-data: ${rows.length} settlements, ${listed.validators.length} validators`);
