import type { TimeWindow } from '@drip-urban/core';
import { Icon } from './Icon';

const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export const SCHEDULE_PRESETS: { label: string; windows: TimeWindow[] }[] = [
  { label: 'Feriali 8–20', windows: [{ days: [0, 1, 2, 3, 4], from: '08:00', to: '20:00' }] },
  { label: 'Lun–Sab 7:30–19:30', windows: [{ days: [0, 1, 2, 3, 4, 5], from: '07:30', to: '19:30' }] },
  { label: 'Sempre (24 h)', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' }] },
  { label: 'Notturna 21–3', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '21:00', to: '03:00' }] },
  { label: 'Weekend', windows: [{ days: [5, 6], from: '00:00', to: '23:59' }] },
  { label: 'Scuola 7:45–8:30, 13:00–14:00', windows: [{ days: [0, 1, 2, 3, 4, 5], from: '07:45', to: '08:30' }, { days: [0, 1, 2, 3, 4, 5], from: '13:00', to: '14:00' }] },
];

/** Weekly time windows (days 0 = Monday): several windows, day chips, native time inputs, presets. */
export function ScheduleEditor({ value, onChange, presets = SCHEDULE_PRESETS, label = 'Fasce orarie' }: {
  value: readonly TimeWindow[]; onChange: (v: TimeWindow[]) => void; presets?: typeof SCHEDULE_PRESETS; label?: string;
}) {
  const set = (i: number, w: Partial<TimeWindow>) => onChange(value.map((x, j) => (j === i ? { ...x, ...w } : x)));
  return (
    <div className="schedule" role="group" aria-label={label}>
      {value.map((w, i) => (
        <div key={i} className="schedule-row">
          <div className="chips">{DAYS.map((d, k) => (
            <button key={d} type="button" className={`chip chip-sm ${w.days.includes(k) ? 'is-on' : ''}`} aria-pressed={w.days.includes(k)}
              onClick={() => set(i, { days: w.days.includes(k) ? w.days.filter((x) => x !== k) : [...w.days, k].sort((a, b) => a - b) })}>{d}</button>
          ))}</div>
          <div className="schedule-times">
            <input type="time" className="text-field" value={w.from} aria-label="Dalle" onChange={(e) => e.target.value && set(i, { from: e.target.value })} />
            <span className="muted">→</span>
            <input type="time" className="text-field" value={w.to} aria-label="Alle" onChange={(e) => e.target.value && set(i, { to: e.target.value })} />
            <button type="button" className="icon-btn" aria-label="Togli fascia" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
          </div>
        </div>
      ))}
      <div className="chips">
        <button type="button" className="chip chip-sm" onClick={() => onChange([...value, { days: [0, 1, 2, 3, 4], from: '08:00', to: '20:00' }])}>+ Fascia</button>
        {presets.map((p) => <button key={p.label} type="button" className="chip chip-sm" onClick={() => onChange(p.windows.map((w) => ({ ...w, days: [...w.days] })))}>{p.label}</button>)}
      </div>
      {value.some((w) => w.from > w.to) ? <p className="muted">Le fasce che superano la mezzanotte valgono fino al mattino successivo.</p> : null}
    </div>
  );
}

export function describeSchedule(ws: readonly TimeWindow[] | undefined): string {
  if (!ws?.length) return 'sempre';
  return ws.map((w) => {
    const d = w.days.length === 7 ? 'tutti i giorni' : w.days.length === 5 && w.days.every((x) => x < 5) ? 'feriali' : w.days.map((x) => DAYS[x]).join(' ');
    return `${d} ${w.from}–${w.to}`;
  }).join(', ');
}
