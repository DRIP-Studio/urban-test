/**
 * Co-branding from the official vector files (packages/assets/brand, served at /brand).
 * Technical mode: DRIP dominant, FST as civic deployment identifier.
 * Civic / public mode: FST dominant, "Tecnologia DRIP Studio" secondary.
 * Responsive: wide = both full lockups · medium = DRIP lockup + FST mark · narrow = marks only (CSS container queries).
 */
export function TechnicalLockup({ city }: { city: string | null }) {
  const fst = city?.toLowerCase().includes('frattamaggiore');
  return (
    <div className="lockup lockup-tech" aria-label={`DRIP Urban${fst ? ' — deployment civico Frattamaggiore Si Trasforma' : ''}`}>
      <img className="lk-drip-mark" src="/brand/drip-mark.svg" alt="" />
      <img className="lk-drip-word" src="/brand/drip-wordmark-reverse.svg" alt="DRIP" />
      <span className="lk-product">URBAN</span>
      {fst ? (
        <>
          <span className="lk-sep" aria-hidden />
          <span className="lk-civic">
            <img className="lk-fst-mark" src="/brand/fst-mark-reverse.svg" alt="" />
            <img className="lk-fst-word" src="/brand/fst-wordmark-reverse.svg" alt="Frattamaggiore Si Trasforma" />
          </span>
        </>
      ) : null}
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
