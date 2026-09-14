"use client";

import { useRef, useState, type ComponentType, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/** Adds an expanding ripple at the pointer position. */
function useRipple() {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const nextId = useRef(0);
  const spawn = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const id = nextId.current++;
    setRipples((current) => [...current, { id, x: event.clientX - rect.left, y: event.clientY - rect.top }]);
    setTimeout(() => setRipples((current) => current.filter((r) => r.id !== id)), 650);
  };
  const layer = (
    <span className="ripple-layer" aria-hidden="true">
      {ripples.map((r) => (
        <span key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />
      ))}
    </span>
  );
  return { spawn, layer };
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Selectable card used for multi- and single-choice questions. */
export function OptionCard({
  icon: Icon,
  label,
  description,
  selected,
  onToggle,
  index = 0,
  role = "checkbox",
}: {
  icon?: ComponentType<{ size?: number }>;
  label: string;
  description?: string;
  selected: boolean;
  onToggle: () => void;
  index?: number;
  role?: "checkbox" | "radio";
}) {
  const { spawn, layer } = useRipple();
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      className={`option-card ${selected ? "is-selected" : ""}`}
      style={{ animationDelay: `${80 + index * 55}ms` }}
      onPointerDown={spawn}
      onClick={onToggle}
    >
      {layer}
      {Icon ? (
        <span className="option-icon">
          <Icon size={20} />
        </span>
      ) : null}
      <span className="option-text">
        <span className="option-label">{label}</span>
        {description ? <span className="option-description">{description}</span> : null}
      </span>
      <span className="option-check" aria-hidden="true">
        <CheckMark />
      </span>
    </button>
  );
}

/** Primary button with ripple feedback. */
export function RippleButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
}) {
  const { spawn, layer } = useRipple();
  return (
    <button
      type={type}
      className={variant === "primary" ? "ob-button" : "ob-button-ghost"}
      disabled={disabled}
      onPointerDown={disabled ? undefined : spawn}
      onClick={onClick}
    >
      {layer}
      {children}
    </button>
  );
}

/** Tag-style input with filtered suggestions. Enter or comma adds; Backspace on empty removes the last tag. */
export function TagInput({
  values,
  suggestions,
  placeholder,
  onAdd,
  onRemove,
  error,
  max,
}: {
  values: string[];
  suggestions: readonly string[];
  placeholder: string;
  onAdd: (value: string) => boolean;
  onRemove: (value: string) => void;
  error: string | null;
  max: number;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = new Set(values.map((v) => v.toLowerCase()));
  const filtered = suggestions
    .filter((s) => !selected.has(s.toLowerCase()) && s.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 14);

  const commit = (value: string) => {
    if (!value.trim()) return;
    if (onAdd(value)) setQuery("");
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(query);
    } else if (event.key === "Backspace" && query === "" && values.length > 0) {
      onRemove(values[values.length - 1]!);
    }
  };

  return (
    <div className="tag-input">
      <div className={`tag-field ${error ? "has-error" : ""}`} onClick={() => inputRef.current?.focus()}>
        {values.map((value) => (
          <span key={value} className="tag">
            {value}
            <button type="button" className="tag-remove" aria-label={`Remove ${value}`} onClick={() => onRemove(value)}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={values.length >= max ? `Up to ${max} niches` : placeholder}
          disabled={values.length >= max}
          aria-label="Add a niche"
          maxLength={40}
        />
      </div>
      <div className="tag-meta">
        {error ? <span className="form-error">{error}</span> : <span className="stat-note">Press Enter to add your own</span>}
        <span className="stat-note">
          {values.length}/{max}
        </span>
      </div>
      {filtered.length > 0 && values.length < max ? (
        <div className="suggestions" aria-label="Suggestions">
          {filtered.map((suggestion, i) => (
            <button
              key={suggestion}
              type="button"
              className="suggestion"
              style={{ animationDelay: `${i * 25}ms` }}
              onClick={() => commit(suggestion)}
            >
              + {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Deterministic confetti burst (no randomness, so server and client markup match). */
export function Confetti({ pieces = 28 }: { pieces?: number }) {
  const colors = ["#8b5cf6", "#ec4899", "#fb923c", "#6366f1", "#34d399", "#facc15"];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: pieces }, (_, i) => {
        const angle = (i / pieces) * Math.PI * 2;
        const distance = 140 + ((i * 37) % 90);
        return (
          <span
            key={i}
            className="confetti-piece"
            style={
              {
                "--dx": `${Math.cos(angle) * distance}px`,
                "--dy": `${Math.sin(angle) * distance - 40}px`,
                "--rot": `${(i * 47) % 360}deg`,
                background: colors[i % colors.length],
                animationDelay: `${(i % 6) * 18}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
