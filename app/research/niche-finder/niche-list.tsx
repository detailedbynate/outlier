"use client";

import Link from "next/link";
import { useDeferredValue, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDownIcon, ExternalIcon, SearchIcon } from "@/components/icons";
import { hideNiche } from "./actions";

/** One niche on a Discover board, formatted on the server so the list only has to show and filter it. */
export interface NicheRow {
  key: string;
  name: string;
  href: string;
  badges: string[];
  score: number;
  reason: string;
  /** One value per column, already formatted. */
  stats: string[];
  bars: { label: string; value: number; hint: string }[];
  notes: { title: string; text: string }[];
  tags: string[];
  strong: boolean;
  proof: { label: string; text: string; href: string } | null;
  /** Shows "Not for me", which hides it from this account's board. */
  hideable: boolean;
}

const SHOWN = 20;

/**
 * 65+ strong, 45-64 promising: the same bands as the score colours. Below that
 * the number stands alone; a game kids watch can be a fine bet that scores low on pay.
 */
function band(score: number): { key: "high" | "mid" | "low"; word: string | null } {
  return score >= 65 ? { key: "high", word: "Strong" } : score >= 45 ? { key: "mid", word: "Promising" } : { key: "low", word: null };
}

/**
 * A Discover board as a ranked list: one line per niche with the numbers that
 * matter, opened for the scores behind it. Typing narrows the list as you go.
 */
export function NicheList({
  rows,
  columns,
  noun,
  controls,
  footer,
}: {
  rows: NicheRow[];
  columns: { label: string; hint: string }[];
  noun: string;
  controls?: ReactNode;
  footer?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [strongOnly, setStrongOnly] = useState(false);
  const [all, setAll] = useState(false);
  const typed = useDeferredValue(query);
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const strongCount = rows.filter((r) => r.strong).length;
  const matches = rows
    .map((row, i) => ({ row, rank: i + 1 }))
    .filter(({ row }) => !strongOnly || row.strong)
    .filter(({ row }) => {
      if (words.length === 0) return true;
      const text = [row.name, row.reason, ...row.badges, ...row.tags].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  const narrowed = words.length > 0 || strongOnly;
  const visible = all || narrowed ? matches : matches.slice(0, SHOWN);

  return (
    <div className="nf-board">
      <div className="nf-toolbar">
        <label className="nf-search">
          <SearchIcon size={15} />
          <span className="sr-only">Filter {noun}</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter ${rows.length} ${noun}…`} autoComplete="off" spellCheck={false} />
        </label>
        {strongCount > 0 ? (
          <button type="button" className="nf-toggle" aria-pressed={strongOnly} onClick={() => setStrongOnly((on) => !on)} title="Only niches that score well on everything at once">
            <i aria-hidden="true" />
            Strong all round
            <span>{strongCount}</span>
          </button>
        ) : null}
        {controls ? <div className="nf-controls">{controls}</div> : null}
      </div>

      {matches.length === 0 ? (
        <div className="nf-none">
          <strong>No {noun} match{typed ? <> &ldquo;{typed}&rdquo;</> : null}</strong>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setStrongOnly(false);
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="nf-list" style={{ "--cols": columns.length } as CSSProperties}>
          <div className="nf-head" aria-hidden="true">
            <span>#</span>
            <span>Niche</span>
            {columns.map((c) => (
              <span key={c.label} title={c.hint}>
                {c.label}
              </span>
            ))}
            <span>Score</span>
            <span />
          </div>
          {visible.map(({ row, rank }, i) => (
            <Row key={row.key} row={row} rank={rank} columns={columns} index={i} />
          ))}
        </div>
      )}

      <div className="nf-foot">
        <span>
          Showing <b>{visible.length}</b> of {narrowed ? `${matches.length} matching` : rows.length}
        </span>
        {!all && !narrowed && matches.length > SHOWN ? (
          <button type="button" onClick={() => setAll(true)}>
            Show all {matches.length}
          </button>
        ) : null}
      </div>
      {footer}
    </div>
  );
}

function Row({ row, rank, columns, index }: { row: NicheRow; rank: number; columns: { label: string }[]; index: number }) {
  const b = band(row.score);
  return (
    <details className="nf-row" data-band={b.key} data-top={rank <= 3 || undefined} style={{ "--i": Math.min(index, 12) } as CSSProperties}>
      <summary>
        <span className="nf-rank">{rank}</span>
        <span className="nf-name">
          <span className="nf-title">
            <strong>{row.name}</strong>
            {row.badges.map((badge) => (
              <span key={badge} className="nf-badge" data-mine={badge === "Yours" || undefined}>
                {badge}
              </span>
            ))}
            {row.strong ? <span className="nf-badge" data-strong>Strong all round</span> : null}
          </span>
          <span className="nf-reason">{row.reason}</span>
        </span>
        {row.stats.map((value, i) => (
          <span key={columns[i]!.label} className="nf-stat" data-col={i}>
            <small>{columns[i]!.label}</small>
            {value}
          </span>
        ))}
        <span className="nf-score" title={`${row.score} out of 100`}>
          <b>{row.score}</b>
          {b.word ? <small>{b.word}</small> : null}
        </span>
        <ChevronDownIcon size={16} className="nf-chev" />
      </summary>
      <div className="nf-detail">
        <div className="nf-bars">
          {row.bars.map((bar) => (
            <div key={bar.label} className="nf-bar" title={bar.hint}>
              <span>{bar.label}</span>
              <i style={{ "--w": `${bar.value}%` } as CSSProperties} />
              <b>{bar.value}</b>
            </div>
          ))}
        </div>
        <div className="nf-notes">
          {row.notes.map((note) => (
            <p key={note.title}>
              <strong>{note.title}</strong> {note.text}
            </p>
          ))}
          {row.tags.length > 0 ? (
            <div className="nf-tags">
              {row.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="nf-actions">
          <Link href={row.href} className="nf-go">
            Research this niche
          </Link>
          {row.proof ? (
            <a href={row.proof.href} target="_blank" rel="noreferrer" className="nf-proof">
              <span>{row.proof.label}</span>
              <em>{row.proof.text}</em>
              <ExternalIcon size={13} />
            </a>
          ) : null}
          {row.hideable ? (
            <form action={hideNiche} className="nf-hide">
              <input type="hidden" name="topic" value={row.name} />
              <button type="submit" title="Hide this niche from your Discover board">
                Not for me
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </details>
  );
}
