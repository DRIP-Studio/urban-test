import type { ProjectClock } from '../model/types';

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (formatters.size >= 16) formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, value);
  }
  return value;
}
function parts(ms: number, timeZone: string) {
  return Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}
function wallMs(ms: number, timeZone: string) {
  const p = parts(ms, timeZone);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
}

/** Convert local wall time into a real instant. DST gaps are rejected; folds have an explicit choice. */
export function projectInstant(date: string, minutes: number, timeZone: string, fold: 'earlier' | 'later' = 'earlier'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(minutes) || minutes < 0 || minutes >= 1440) throw new Error('Data o ora non valida');
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const base = Date.UTC(y, m - 1, d);
  if (new Date(base).toISOString().slice(0, 10) !== date) throw new Error('Data non valida');
  const wanted = base + Math.round(minutes * 60) * 1000;
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => wallMs(wanted + delta, timeZone) - (wanted + delta)));
  const candidates = [...offsets].map((offset) => wanted - offset).filter((ms) => wallMs(ms, timeZone) === wanted).sort((a, b) => a - b);
  if (!candidates.length) throw new Error('L’ora selezionata non esiste nel fuso del progetto (passaggio all’ora legale).');
  return new Date(fold === 'earlier' ? candidates[0]! : candidates.at(-1)!).toISOString();
}

/** One shared calendar conversion for Flow, routing, lighting, transit and presentation. */
export function projectLocalTime(clock: ProjectClock, elapsedS = 0) {
  const ms = Date.parse(clock.anchor) + elapsedS * 1000;
  const p = parts(ms, clock.timeZone);
  const date = `${p.year}-${p.month}-${p.day}`;
  const seconds = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return { instant: new Date(ms).toISOString(), date, day: (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7, minutes: seconds / 60, hour: seconds / 3600, seconds, holiday: clock.holiday };
}

export function clockErrors(clock: ProjectClock): string[] {
  const errors: string[] = [];
  const ms = Date.parse(clock?.anchor);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== clock.anchor) errors.push('Istante di partenza UTC non valido');
  if (typeof clock?.timeZone !== 'string' || !clock.timeZone.trim()) errors.push('Fuso orario mancante');
  else try { formatter(clock.timeZone); } catch { errors.push('Fuso orario non valido'); }
  if (!Number.isFinite(clock?.durationS) || clock.durationS <= 0 || clock.durationS > 31557600000) errors.push('Durata non valida');
  if (!Number.isFinite(clock?.speed) || clock.speed <= 0 || clock.speed > 60) errors.push('Velocità non valida (0–60×)');
  if (typeof clock?.holiday !== 'boolean') errors.push('Flag festivo non valido');
  return errors;
}
