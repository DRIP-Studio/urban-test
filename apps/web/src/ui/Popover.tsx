import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Anchored popover: closes on outside click and Escape, keeps focus inside while open. */
export function Popover({ trigger, children, align = 'start', width, label = 'Opzioni' }: {
  trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; width?: number; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0);
    (focusable()[0] ?? dialog.current)?.focus();
    const off = (e: MouseEvent) => { if (root.current && !e.composedPath().includes(root.current)) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
      if (e.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!first) { e.preventDefault(); dialog.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc); if (document.activeElement === document.body || root.current?.contains(document.activeElement)) previous?.focus(); };
  }, [open]);
  return (
    <div className="popover-root" ref={root}>
      {trigger(open, () => setOpen((o) => !o))}
      {open ? <div ref={dialog} id={id} tabIndex={-1} aria-label={label} className={`popover popover-${align}`} style={width ? { width } : undefined} role="dialog">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

export function MenuItem({ icon, label, hint, onClick, danger, disabled }: { icon?: ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`menu-item ${danger ? 'is-danger' : ''}`} onClick={onClick} disabled={disabled}>
      {icon}<span>{label}</span>{hint ? <span className="hint">{hint}</span> : null}
    </button>
  );
}
