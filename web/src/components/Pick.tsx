"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/** dot: a state dot's class (ok, hold, none), the one the table draws for the choice's rows */
export type PickOption<T extends string> = { value: T; label: string; count?: number; dot?: string };

/**
 * A choice of one from a few, in the site's own list rather than the
 * browser's: the closed control is the pill a select was ("All validators ·
 * 107"); its list opens under it, right-aligned, in the network menu's style,
 * with a choice's state dot at its left, each choice's count in a column of
 * its own and a check after the one chosen. A select-only combobox to
 * assistive technology: the arrows, Home and End move, Enter or Space picks,
 * Escape, Tab and a click elsewhere close.
 */
export default function Pick<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: PickOption<T>[];
  onChange: (v: T) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  // the choice the arrows and the pointer are on while the list is open
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const cur = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const show = () => { setAt(cur); setOpen(true); };
  const pick = (i: number) => {
    setOpen(false);
    button.current?.focus();
    if (options[i].value !== value) onChange(options[i].value);
  };
  const key = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === "Tab") { setOpen(false); return; }
    const to = e.key === "ArrowDown" ? Math.min(options.length - 1, at + 1)
      : e.key === "ArrowUp" ? Math.max(0, at - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? options.length - 1
      : null;
    if (to !== null) { e.preventDefault(); setAt(to); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(at); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  const word = (x: PickOption<T>) => x.label + (x.count !== undefined ? ` · ${x.count}` : "");
  return (
    <div className={"select pick" + (open ? " open" : "")} ref={box}>
      <button type="button" ref={button} role="combobox" aria-label={`${label}: ${word(options[cur])}`} aria-haspopup="listbox"
        aria-expanded={open} aria-controls={id} aria-activedescendant={open ? `${id}-${at}` : undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={key}>
        {/* every choice laid in one place, the others unseen: the pill is as wide as the widest, as a select's was,
            so a new choice never moves the search beside it */}
        <span className="pick-v" aria-hidden="true">
          {options.map((x, i) => <span key={x.value} className={i === cur ? undefined : "off"}>{word(x)}</span>)}
        </span>
      </button>
      {open && (
        <ul className="list" role="listbox" id={id} aria-label={label}>
          {options.map((x, i) => (
            <li key={x.value} id={`${id}-${i}`} role="option" aria-selected={i === cur} className={i === at ? "at" : undefined}
              onPointerEnter={() => setAt(i)} onClick={() => pick(i)}>
              {x.dot && <i className={"dot " + x.dot} />}
              <span>{x.label}</span>
              {x.count !== undefined && <span className="n">{x.count}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
