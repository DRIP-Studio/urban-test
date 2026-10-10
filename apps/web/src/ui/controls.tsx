import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProvenanceKind } from '@drip-urban/core';
import { Icon } from './Icon';

export function Button({ children, onClick, variant = 'default', icon, disabled, type = 'button', title, busy, size = 'md' }: {
  children?: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'project'; icon?: string;
  disabled?: boolean; type?: 'button' | 'submit'; title?: string; busy?: boolean; size?: 'sm' | 'md';
}) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size}`} onClick={onClick} disabled={disabled || busy} title={title} aria-busy={busy || undefined}>
      {busy ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} size={16} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconButton({ icon, label, onClick, active, disabled, shortcut, size = 18, tone }: {
  icon: string; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; shortcut?: string; size?: number; tone?: 'danger';
}) {
  return (
    <button type="button" className={`icon-btn ${active ? 'is-active' : ''} ${tone === 'danger' ? 'is-danger' : ''}`} aria-label={label} aria-pressed={active ?? undefined}
      data-tip={shortcut ? `${label} · ${shortcut}` : label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md', disabled = false }: {
  value: T; options: readonly { value: T; label: string; icon?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md'; disabled?: boolean;
}) {
  return (
    <div className={`segmented seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.icon ? <Icon name={o.icon} size={15} /> : null}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Like Field, for groups of buttons (Segmented, chips): a <label> would name only the first button. */
export function FieldGroup({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Field({ label, children, hint, prov }: { label: string; children: ReactNode; hint?: string; prov?: ProvenanceKind }) {
  return (
    <label className="field">
      <span className="field-label">{label}{prov ? <ProvBadge kind={prov} /> : null}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Numeric input that commits on Enter/blur, supports arrow keys (Shift = ×10) and shows its unit. */
export function NumberField({ value, onCommit, unit, min, max, step = 1, decimals = 2, disabled, ariaLabel }: {
  value: number; onCommit: (v: number) => unknown; unit?: string; min?: number; max?: number; step?: number; decimals?: number; disabled?: boolean; ariaLabel?: string;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** decimals) / 10 ** decimals).replace('.', ',') : '');
  const [text, setText] = useState(fmt(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(fmt(value)); setInvalid(false); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const apply = (v: number) => {
    const result = onCommit(v);
    if (result && typeof result === 'object' && 'ok' in result && result.ok === false) { setText(fmt(value)); setInvalid(true); }
  };
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(v)) { setInvalid(true); return; }
    const c = clamp(v);
    setInvalid(false);
    setText(fmt(c));
    if (c !== value) apply(c);
  };
  return (
    <span className={`num-field ${invalid ? 'is-invalid' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input inputMode="decimal" value={text} disabled={disabled} aria-label={ariaLabel} aria-invalid={invalid || undefined}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') { setText(fmt(value)); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
              apply(Math.round(v * 1e6) / 1e6);
          }
        }} />
      {unit ? <span className="unit">{unit}</span> : null}
    </span>
  );
}

export function TextField({ value, onCommit, placeholder, ariaLabel, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; ariaLabel?: string; multiline?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const done = () => { if (text !== value) onCommit(text); };
  return multiline ? (
    <textarea className="text-field" rows={4} value={text} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => setText(e.target.value)} onBlur={done} />
  ) : (
    <input className="text-field" value={text} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => setText(e.target.value)} onBlur={done}
      onKeyDown={(e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') setText(value); }} />
  );
}

/** Custom listbox select (keyboard: arrows, Enter, Escape, type-ahead). */
export function Select<T extends string>({ value, options, onChange, ariaLabel, placeholder }: {
  value: T | null; options: readonly { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; ariaLabel: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);
  const choose = (i: number) => { const o = options[i]; if (o) { onChange(o.value); setOpen(false); } };
  return (
    <div className="select" ref={root}>
      <button type="button" className="select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={ariaLabel}
        onClick={() => { setOpen(!open); setHi(Math.max(0, options.findIndex((o) => o.value === value))); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!open) setOpen(true); setHi((h) => Math.min(options.length - 1, Math.max(0, h + (e.key === 'ArrowDown' ? 1 : -1)))); }
          else if (e.key === 'Enter' && open) { e.preventDefault(); choose(hi); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
          else if (e.key.length === 1) { const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase())); if (i >= 0) setHi(i); }
        }}>
        <span className={current ? '' : 'muted'}>{current?.label ?? placeholder ?? 'Seleziona'}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <ul className="select-list" role="listbox" id={id} aria-label={ariaLabel}>
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} className={`${i === hi ? 'is-hi' : ''} ${o.value === value ? 'is-sel' : ''}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); choose(i); }}>
              <span>{o.label}</span>{o.hint ? <span className="hint">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, compact }: { checked: boolean; onChange: (v: boolean) => void; label: string; compact?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle-track"><span className="toggle-thumb" /></span><span className={compact ? 'sr-only' : undefined}>{label}</span>
    </button>
  );
}

export function Slider({ value, min, max, step, onChange, label, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider-head"><span>{label}</span><span className="mono">{format ? format(value) : value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} style={{ ['--pct' as string]: `${pct}%` }} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

const PROV_LABEL: Record<ProvenanceKind, string> = {
  existing: 'Esistente', osm: 'OSM', measured: 'Misurato', derived: 'Derivato', estimated: 'Stimato', project: 'Progetto', simulated: 'Simulato', live: 'Live',
};
export function ProvBadge({ kind, title }: { kind: ProvenanceKind; title?: string }) {
  return <span className={`prov prov-${kind}`} title={title ?? PROV_LABEL[kind]}>{PROV_LABEL[kind]}</span>;
}

export function Section({ title, children, actions, defaultOpen = true, count }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; count?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'is-open' : ''}`}>
      <header className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} /><span>{title}</span>{count !== undefined ? <span className="count">{count}</span> : null}
        </button>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </header>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}

export function Empty({ icon, title, children, action }: { icon: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={22} />
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" aria-busy="true" aria-label="Caricamento">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 15}%` }} />)}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Stat({ label, value, unit, prov, delta }: { label: string; value: string | number; unit?: string; prov?: ProvenanceKind; delta?: { value: number; goodWhen: 'up' | 'down'; unit?: string } }) {
  const good = delta ? (delta.goodWhen === 'up' ? delta.value > 0 : delta.value < 0) : false;
  return (
    <div className="stat">
      <span className="stat-label">{label}{prov ? <ProvBadge kind={prov} /> : null}</span>
      <span className="stat-value">{value}{unit ? <small>{unit}</small> : null}</span>
      {delta && delta.value !== 0 ? <span className={`stat-delta ${good ? 'is-good' : 'is-bad'}`}>{delta.value > 0 ? '+' : ''}{delta.value.toLocaleString('it-IT')}{delta.unit ?? ''}</span> : null}
    </div>
  );
}
