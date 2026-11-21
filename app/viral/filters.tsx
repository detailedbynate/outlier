"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition, type CSSProperties, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import { FORMATS, RANGES, SORTS, readState, viralHref, type TermParam, type ViralState } from "./options";

export interface TermGroup {
  param: TermParam;
  label: string;
  options: { key: string; label: string; description: string }[];
}

/**
 * The filter bar. Each set is one segmented control whose highlight slides to
 * the new choice the moment it's clicked, while the videos load underneath; a
 * thin line runs along the bar until they arrive. Links stay real links, so
 * opening one in a new tab still works.
 */
export function ViralFilters({ groups }: { groups: TermGroup[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const actual = readState(
    (key) => params.get(key),
    (param, key) => groups.some((g) => g.param === param && g.options.some((o) => o.key === key)),
  );
  const [shown, setShown] = useOptimistic(actual);
  const [busy, startTransition] = useTransition();

  const go = (event: MouseEvent<HTMLAnchorElement>, overrides: Partial<ViralState>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const next = { ...shown, ...overrides };
    startTransition(() => {
      setShown(next);
      router.push(viralHref(next), { scroll: false });
    });
  };

  const filtering = Boolean(shown.style || shown.hook || shown.angle);

  return (
    <div className="vv-bar" data-busy={busy ? "" : undefined}>
      <div className="vv-bar-row">
        <Segment label="Published" options={RANGES} value={shown.range} href={(key) => viralHref(shown, { range: key as ViralState["range"] })} onPick={(e, key) => go(e, { range: key as ViralState["range"] })} />
        <Segment label="Format" options={FORMATS} value={shown.format} href={(key) => viralHref(shown, { format: key as ViralState["format"] })} onPick={(e, key) => go(e, { format: key as ViralState["format"] })} />
        <Segment label="Sort by" options={SORTS} value={shown.sort} href={(key) => viralHref(shown, { sort: key as ViralState["sort"] })} onPick={(e, key) => go(e, { sort: key as ViralState["sort"] })} />
      </div>
      <div className="vv-bar-row vv-terms" aria-label="Filter by what made them work">
        <span className="vv-label">What worked</span>
        {groups.map((group) => (
          <TermPicker key={group.param} group={group} value={shown[group.param]} href={(key) => viralHref(shown, { [group.param]: key })} onPick={(e, key) => go(e, { [group.param]: key })} />
        ))}
        {filtering ? (
          <a className="vv-clear" href={viralHref(shown, { style: "", hook: "", angle: "" })} onClick={(e) => go(e, { style: "", hook: "", angle: "" })}>
            Clear
          </a>
        ) : (
          <span className="vv-terms-note">Only videos Claude has explained match these.</span>
        )}
      </div>
    </div>
  );
}

function Segment({
  label,
  options,
  value,
  href,
  onPick,
}: {
  label: string;
  options: readonly { key: string; label: string }[];
  value: string;
  href: (key: string) => string;
  onPick: (event: MouseEvent<HTMLAnchorElement>, key: string) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.key === value),
  );
  return (
    <div className="vv-group">
      <span className="vv-label">{label}</span>
      <div className="vv-seg" role="group" aria-label={label} style={{ "--n": options.length, "--i": index } as CSSProperties}>
        <span className="vv-seg-ink" aria-hidden="true" />
        {options.map((o) => (
          <a key={o.key} href={href(o.key)} className="vv-seg-opt" aria-current={o.key === value ? "true" : undefined} onClick={(e) => onPick(e, o.key)}>
            {o.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** "Hook: Any" and a list to choose from, each with what it means. */
function TermPicker({
  group,
  value,
  href,
  onPick,
}: {
  group: TermGroup;
  value: string;
  href: (key: string) => string;
  onPick: (event: MouseEvent<HTMLAnchorElement>, key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chosen = group.options.find((o) => o.key === value);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const choose = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
    setOpen(false);
    onPick(event, key);
  };

  return (
    <div className="vv-term" ref={box} data-set={chosen ? "" : undefined}>
      <button type="button" className="vv-term-button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        {group.label}: <strong>{chosen?.label ?? "Any"}</strong>
        <ChevronDownIcon size={14} />
      </button>
      {open ? (
        <div className="vv-popover" role="group" aria-label={group.label}>
          <a href={href("")} className="vv-term-opt" aria-current={!chosen ? "true" : undefined} onClick={(e) => choose(e, "")}>
            <span>
              <strong>Any {group.label.toLowerCase()}</strong>
            </span>
            {!chosen ? <CheckIcon size={14} /> : null}
          </a>
          {group.options.map((o, i) => (
            <a key={o.key} href={href(o.key)} className="vv-term-opt" style={{ "--i": i } as CSSProperties} aria-current={o.key === value ? "true" : undefined} onClick={(e) => choose(e, o.key)}>
              <span>
                <strong>{o.label}</strong>
                <small>{o.description}</small>
              </span>
              {o.key === value ? <CheckIcon size={14} /> : null}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
