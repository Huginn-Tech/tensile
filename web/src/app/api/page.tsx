import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Mark } from "@/components/Chrome";
import { SITE_NAME } from "@/lib/site";
import { BaseUrl, Health, Reference } from "./reference";

export const metadata: Metadata = {
  title: `API · ${SITE_NAME} · Celestia Fibre`,
  description: "Reference for the Tensile API: its endpoints, their parameters and example responses. Read-only, no key.",
};

/**
 * The API page: plain documentation. A title, one sentence, the base URL;
 * then every endpoint in order under its resource (endpoints.ts), each
 * opening to its parameters, a Try it and an example response; then what
 * every route shares, one line each; then the poster, closing the page.
 */

const CONVENTIONS: [string, ReactNode][] = [
  ["Authentication", <>None: no key and no sign-up. Only GET and HEAD are answered.</>],
  ["Periods", <><code>window</code> is <code>24h</code> (the default), <code>7d</code>, <code>30d</code> or <code>all</code>; <code>as_of</code>, in RFC 3339, ends the period then instead of now.</>],
  ["Addresses", <>A validator by consensus address (40 hex characters or <code>celestiavalcons1…</code>), operator address (<code>celestiavaloper1…</code>) or account (<code>celestia1…</code>); a publisher by <code>celestia1…</code> account; promise hashes and commitments are 64 hex characters, namespaces 58.</>],
  ["Units", <>Sizes in bytes, amounts in utia (1 TIA is 1,000,000 utia), times in RFC 3339 UTC; <code>_s</code> is seconds, <code>_ms</code> milliseconds.</>],
  ["Pagination", <><code>/v1/blobs</code> pages on from <code>next_before_height</code> and <code>next_before_tx_index</code>, <code>/v1/probes</code> from <code>next_before</code>; <code>truncated</code> is true while more remain.</>],
  ["Errors", <>JSON <code>{"{\"error\": \"…\"}"}</code>: 400 a parameter that cannot be read, 404 nothing on record, 429 over a limit, 503 with <code>&quot;computing&quot;: true</code> while a figure is computed.</>],
  ["Rate limits", <>Per client, 120 requests in a burst, then 10 a second and 16 at once, with <code>/v1/tip</code> counted apart (60 in a burst, then 30 a second) and 30 <code>/v1/tip/stream</code> connections open at once; <code>as_of</code> and <code>exclude</code>, 4 in a burst, then one every 2 seconds, across all clients.</>],
  ["Data license", <><a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener noreferrer" target="_blank">CC BY 4.0</a> for Tensile&rsquo;s own figures, credited as &ldquo;Data from Tensile by Huginn Tech&rdquo; with a link to tensile.huginn.tech.</>],
];

export default function Developers() {
  return (
    <div className="api">
      <header className="api-hero">
        <div className="api-hero-top">
          <h1 className="api-title"><Mark size={34} />Tensile API</h1>
          <Health />
        </div>
        <p className="lede">The API serves Tensile&rsquo;s figures on Fibre validators, blobs, publishers and the network: read-only, with no key.</p>
        <BaseUrl />
      </header>

      <Reference />

      <section className="api-conv" aria-labelledby="conventions">
        <h2 id="conventions">Conventions</h2>
        <dl>
          {CONVENTIONS.map(([term, text]) => (
            <div key={term}><dt>{term}</dt><dd>{text}</dd></div>
          ))}
        </dl>
      </section>

      <figure className="api-poster">
        <img src="/poster/tensile-engraving-1600.webp"
          srcSet="/poster/tensile-engraving-1600.webp 1600w, /poster/tensile-engraving-3200.webp 3200w"
          sizes="(max-width: 1200px) calc(100vw - 32px), 1120px" width={1600} height={900}
          alt="Tensile for Celestia Fibre, tensile.huginn.tech: an engraving of a tensile testing machine, with the line Every blob, checked."
          loading="lazy" decoding="async" />
      </figure>
    </div>
  );
}
