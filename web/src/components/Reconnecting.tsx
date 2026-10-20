"use client";
import { useEffect, useState } from "react";
import { isDown, onReach } from "@/lib/api";

/** how long the connection has to stay lost before the line shows: a Wi-Fi or VPN switch of a second or two passes unseen */
const AFTER_MS = 3000;

/**
 * One small line at the foot of the screen while this browser does not reach Tensile (lib/api.ts, reached and lost):
 * "Reconnecting…", or "No connection" first when the browser itself says it has no network. Nothing on the page
 * moves or empties meanwhile, and the line goes as soon as an answer comes back.
 */
export default function Reconnecting() {
  const [shown, setShown] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let t: number | undefined;
    const set = (down: boolean) => {
      window.clearTimeout(t);
      if (!down) { setShown(false); return; }
      t = window.setTimeout(() => setShown(true), AFTER_MS);
    };
    const net = () => setOffline(navigator.onLine === false);
    net();
    if (isDown()) set(true);
    const off = onReach(set);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      off();
      window.clearTimeout(t);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, []);
  if (!shown) return null;
  return (
    <div className="reconn" role="status">
      <i className="reconn-d" aria-hidden="true" />
      {offline ? "No connection. Reconnecting…" : "Reconnecting…"}
    </div>
  );
}
