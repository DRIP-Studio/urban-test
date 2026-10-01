import { useEffect, useRef } from 'react';
import { create } from 'zustand';

interface ConfirmReq { title: string; body: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
const useConfirm = create<{ req: ConfirmReq | null }>(() => ({ req: null }));

export function confirmAction(title: string, body: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ req: { title, body, confirmLabel: opts.confirmLabel ?? 'Conferma', danger: opts.danger ?? false, resolve } }));
}

export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (req) ok.current?.focus(); }, [req]);
  if (!req) return null;
  const done = (v: boolean) => { req.resolve(v); useConfirm.setState({ req: null }); };
  return (
    <div className="modal-backdrop" onMouseDown={() => done(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') done(false); }}>
        <h2 id="cf-title">{req.title}</h2>
        <p>{req.body}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-md" onClick={() => done(false)}>Annulla</button>
          <button type="button" ref={ok} className={`btn btn-md ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)}>{req.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
