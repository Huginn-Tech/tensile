import Analytics from "@/components/Analytics";
import { ANALYTICS, SITE_NAME } from "@/lib/site";

export const metadata = { title: `Analytics · ${SITE_NAME} · Celestia Fibre` };

export default function AnalyticsPage() {
  if (!ANALYTICS) return <div className="page-head"><h1>Page not found</h1></div>;
  return <Analytics />;
}
