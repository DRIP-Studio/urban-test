/**
 * Brand lockups from the official vector files (packages/assets/brand, served at /brand).
 * Workstation: DRIP only — mark, wordmark and product name share one cap height.
 * Frattamaggiore Si Trasforma appears only in the civic section and on public pages (CivicLockup).
 */
export function TechnicalLockup() {
  return (
    <div className="lockup lockup-tech" aria-label="DRIP Urban">
      <img className="lk-drip-mark" src="/brand/drip-mark-reverse.svg" alt="" />
      <img className="lk-drip-word" src="/brand/drip-wordmark-reverse.svg" alt="DRIP" />
      <span className="lk-product">Urban</span>
    </div>
  );
}

export function CivicLockup({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div className={`lockup lockup-civic lockup-${size}`}>
      <img className="lk-fst-full" src="/brand/fst-lockup-full.svg" alt="Frattamaggiore Si Trasforma" />
      <span className="lk-by">Tecnologia <img src="/brand/drip-wordmark.svg" alt="DRIP" /> Studio</span>
    </div>
  );
}
