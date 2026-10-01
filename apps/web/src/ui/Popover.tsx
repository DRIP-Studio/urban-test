import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Anchored popover: closes on outside click and Escape, keeps focus inside while open. */
export function Popover({ trigger, children, align = 'start', width }: {
  trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div className="popover-root" ref={root}>
      {trigger(open, () => setOpen((o) => !o))}
      {open ? <div className={`popover popover-${align}`} style={width ? { width } : undefined} role="dialog">{children(() => setOpen(false))}</div> : null}
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
