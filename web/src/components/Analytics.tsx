"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Mount = (shadow: ShadowRoot, file: unknown) => () => void;
declare global { interface Window { TensileAnalytics?: Mount } }

/** One script, once, however many times the reader comes back to the page. */
const scripts = new Map<string, Promise<void>>();
function script(src: string) {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((ok, no) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => ok();
      s.onerror = () => no(new Error(src));
      document.head.append(s);
    }).catch((e) => { scripts.delete(src); throw e; });
    scripts.set(src, p);
  }
  return p;
}

/** The page has no layout for a window narrower than this yet. */
const WIDE = "(min-width: 980px)";
const onWidth = (on: () => void) => {
  const q = window.matchMedia(WIDE);
  q.addEventListener("change", on);
  return () => q.removeEventListener("change", on);
};

const note = (text: string) => <div className="page-head"><div><h1>Analytics</h1><p className="sub">{text}</p></div></div>;

/**
 * The Analytics page. It is drawn by its own script (public/analytics/app.js) from one file a timer writes on the
 * API's host (deploy/analytics-data.mjs), since it needs every settlement and every validator's record. The shadow root
 * keeps its class names and the site's apart. It reads the theme from the document, so the site's toggle works here.
 */
export default function Analytics() {
  const wide = useSyncExternalStore(onWidth, () => window.matchMedia(WIDE).matches, () => true);
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    let gone = false, stop: (() => void) | undefined;
    (async () => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/analytics/app.css";
      const page = document.createElement("div");
      page.id = "page";
      const styled = new Promise((ok, no) => { css.onload = ok; css.onerror = no; });
      shadow.replaceChildren(css, page);
      const [file] = await Promise.all([
        fetch("/analytics/data.json").then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); }),
        script("/analytics/world.js").then(() => script("/analytics/app.js")),
        styled,
      ]);
      if (!gone) stop = window.TensileAnalytics?.(shadow, file);
    })().catch(() => { if (!gone) setFailed(true); });
    return () => { gone = true; stop?.(); };
  }, [wide]);
  if (!wide) return note("Analytics needs a wider screen for now.");
  if (failed) return note("Analytics could not be loaded. Try again in a few minutes.");
  return <div ref={host} style={{ minHeight: "100vh" }} />;
}
