import { otherSiteOf, previewImage, siteName } from "@/lib/othernet-core";

/**
 * Who this deployment says it is.
 *
 * Read at build time so an operator running this code for their own network
 * puts their own repository and validator here without editing a component —
 * and so that moving this repository, which is a decision still open, is one
 * environment variable rather than a search across the site.
 */
export const SOURCE_URL = (process.env.NEXT_PUBLIC_SOURCE_URL ?? "https://github.com/Huginn-Tech/tensile").replace(/\/$/, "");

/**
 * The API's public /v1 address, which the API page prints without the /v1 as
 * its base URL. The site's own pages call the same routes on their own origin
 * (/api), so this is only what a reader copies. Unset, the page prints its
 * own site's /api once it runs, since one export serves every network's site,
 * and the public deployment's address until then.
 */
export const API_URL_FIXED = !!process.env.NEXT_PUBLIC_API_URL;
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://tensile.huginn.tech/api/v1").replace(/\/$/, "");

/**
 * This network's site, the origin of its API address: a link preview needs the
 * absolute address of its image, so each network's build names its own site.
 */
export const SITE_URL = new URL(API_URL).origin;

/** The dispute route: what to do about a verdict you think is wrong. */
export const DISPUTE_URL = `${SOURCE_URL}/blob/main/docs/verdicts.md#disputing-a-verdict`;

/**
 * The validator this observer's own operator runs on the measured network,
 * as the API reports its address. Empty disables the marking entirely.
 *
 * It is used for one thing: marking that row in the table, because a site
 * that grades operators and is run by one of them should say which row is
 * its own. Nothing filters, excludes, ranks or adjusts on it — the figures
 * about that validator come from the same code and the same rows as
 * everyone else's, which is the point of saying which row it is.
 */
export const SELF_VALIDATOR = (process.env.NEXT_PUBLIC_SELF_VALIDATOR ?? "").trim().toLowerCase();

/**
 * The site's name in its titles, the tab's and a shared link's preview: "Tensile" with this network's name after it
 * (NEXT_PUBLIC_NETWORK_LABEL, "Mocha" in web/.env.production), so a Mocha page is never taken for mainnet's. The
 * mainnet build sets it empty, and its titles stay plain "Tensile".
 */
export const SITE_NAME = siteName(process.env.NEXT_PUBLIC_NETWORK_LABEL);

/** A shared link's preview image, by the same name: public/og.png on mainnet, public/og-mocha.png on Mocha. */
export const PREVIEW_IMAGE_PATH = previewImage(process.env.NEXT_PUBLIC_NETWORK_LABEL);

/**
 * The other network's site, its origin (NEXT_PUBLIC_OTHER_SITE_URL) and its name (NEXT_PUBLIC_OTHER_NETWORK_LABEL): a
 * blob, a transaction, a publisher or a validator this site has no record of is asked for there, once, and one there
 * shows as a line with a link to its page (lib/othernet.tsx). Unset, or either one missing, nothing is ever asked. The
 * site's server has to let the pages reach it (SITE_CONNECT_SRC, deploy/site-server.cjs).
 */
export const OTHER_SITE = otherSiteOf(process.env.NEXT_PUBLIC_OTHER_SITE_URL, process.env.NEXT_PUBLIC_OTHER_NETWORK_LABEL);
