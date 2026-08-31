"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ⌘K — jump anywhere, or find a moment.
 *
 * The bank is designed to hold several hundred moments and 6.2 says a moment "ready in August is
 * often the right post in November", so the store is meant to be revisited rather than read from the
 * top. Until now the only way through it was a status filter, which is browsing, not finding.
 *
 * WHY A PALETTE RATHER THAN A SEARCH BOX ON EVERY PAGE
 *
 * One thing to learn instead of five, reachable from wherever he already is — the same argument
 * 12.7 makes for putting the weekly pass in Telegram rather than giving it its own place to go. The
 * bank keeps its own search box as well, because that is where you browse deliberately.
 *
 * It degrades honestly: with JavaScript off the palette never opens and every page still works,
 * because navigation is links and the bank's search is a plain form.
 */

interface Hit {
  id: number;
  ref: string;
  status: string;
  pillar: string | null;
  line: string;
}

const ROUTES = [
  { label: "This week", detail: "Drafts, the question, verdicts", href: "/" },
  { label: "Calendar", detail: "What is going out, and when", href: "/calendar" },
  { label: "Idea bank", detail: "Every moment, searchable", href: "/bank" },
  { label: "Reference library", detail: "How it writes — edit anything", href: "/library" },
  { label: "Proposals", detail: "Changes waiting for your call", href: "/proposals" },
  { label: "Export everything", detail: "Every table, as one file", href: "/export" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K anywhere. Escape closes. Deliberately not "/" alone — Josh types prose into this
  // app, and stealing a printable character would fight him mid-sentence.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setCursor(0);
      // Focus after paint, or the input is not in the document yet.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ("");
      setHits([]);
    }
  }, [open]);

  // Debounced, and it drops replies that arrive out of order — a fast typist can otherwise see the
  // results for "fin" land after the results for "finance" and overwrite them.
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (live) setHits(json.moments ?? []);
      } catch {
        if (live) setHits([]);
      } finally {
        if (live) setBusy(false);
      }
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const routes = q.trim()
    ? ROUTES.filter((r) => (r.label + r.detail).toLowerCase().includes(q.trim().toLowerCase()))
    : ROUTES;

  const items: { key: string; label: string; detail: string; go: () => void }[] = [
    ...routes.map((r) => ({
      key: `r:${r.href}`,
      label: r.label,
      detail: r.detail,
      go: () => router.push(r.href),
    })),
    ...hits.map((h) => ({
      key: `m:${h.id}`,
      label: h.ref + (h.pillar ? ` · ${h.pillar}` : ""),
      detail: h.line || h.status,
      go: () => router.push(`/bank?status=${h.status}#m${h.id}`),
    })),
  ];

  const run = useCallback((i: number) => {
    const item = items[i];
    if (!item) return;
    setOpen(false);
    item.go();
  }, [items]);

  if (!open) {
    return (
      <button type="button" className="palette-trigger" onClick={() => setOpen(true)}>
        Search <kbd>⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="palette-scrim" onClick={() => setOpen(false)} role="presentation">
      <div
        className="palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search and jump"
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={q}
          placeholder="Search your moments, or jump to a page…"
          aria-label="Search"
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(cursor);
            }
          }}
        />

        <div className="palette-list">
          {items.length === 0 && (
            <p className="palette-empty">
              {busy
                ? "Searching…"
                : q.trim().length < 2
                ? "Type at least two letters."
                : "Nothing matched. Moments are never deleted — try a word he actually said."}
            </p>
          )}

          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              className="palette-item"
              data-active={i === cursor ? "" : undefined}
              onMouseEnter={() => setCursor(i)}
              onClick={() => run(i)}
            >
              <span className="palette-label">{item.label}</span>
              <span className="palette-detail">{item.detail}</span>
            </button>
          ))}
        </div>

        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
