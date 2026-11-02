import Analytics from "@/components/Analytics";
import { ANALYTICS, SITE_NAME } from "@/lib/site";

export const metadata = { title: `Analytics · ${SITE_NAME} · Celestia Fibre` };

export default function AnalyticsPage() {
  if (!ANALYTICS) return <div className="page-head"><h1>Page not found</h1></div>;
  return <>
    {/* The HTML asks for these at once; left to the component they wait for the site's scripts. */}
    <link rel="preload" href="/analytics/app.css" as="style" />
    <link rel="preload" href="/analytics/world.js" as="script" />
    <link rel="preload" href="/analytics/app.js" as="script" />
    <link rel="preload" href="/analytics/data.json" as="fetch" crossOrigin="anonymous" />
    <Analytics />
  </>;
}
