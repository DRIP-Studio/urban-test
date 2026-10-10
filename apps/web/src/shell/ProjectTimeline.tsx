import { configureProjectClock, seekProjectTime, installProjectTimePlayback, playProjectTime, rewindProjectTime, setProjectWallTime, useProjectClock, useProjectTime } from '../state/projectTime';
import { useEffect, useState } from 'react';
import { engine } from '../engine/engine';
import { IconButton, NumberField, Select, Toggle } from '../ui/controls';

import { EnvironmentControl } from './EnvironmentControl';
import { useApp } from '../state/store';

const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export function ProjectTimeline() {
  const { clock, time, elapsedS } = useProjectClock();
  const live = useApp(s => s.network?.environment?.mode === 'live');
  const [preview, setPreview] = useState<number | null>(null);
  const [seeking, setSeeking] = useState(false);
  useEffect(() => { const id = setInterval(() => setSeeking(Boolean(engine.simSeeking)), 100); return () => clearInterval(id); }, []);
  const applySeek = () => { if (preview !== null) { seekProjectTime(preview); setPreview(null); } };
  const playing = useProjectTime((s) => s.playing);
  useEffect(installProjectTimePlayback, []);
  const hhmm = `${String(Math.floor(time.minutes / 60)).padStart(2, '0')}:${String(Math.floor(time.minutes % 60)).padStart(2, '0')}`;
  return <div className="project-timeline" role="group" aria-label="Clock globale del progetto">
    <strong>Tempo progetto</strong>
    <span className="timeline-day">{DAYS[time.day]}</span>
    <input type="date" aria-label="Data progetto" value={time.date} onChange={(e) => e.target.value && setProjectWallTime(e.target.value, time.minutes)} />
    <input type="time" aria-label="Ora progetto" value={hhmm} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (h !== undefined && m !== undefined) setProjectWallTime(time.date, h * 60 + m); }} />
    <span className="muted timeline-zone">{clock.timeZone}</span>
    <IconButton disabled={live} icon={playing ? 'pause' : 'play'} onClick={() => playProjectTime(!playing)} label={playing ? 'Pausa tempo progetto' : 'Avanza tempo progetto'} />
    <IconButton disabled={live} icon="refresh" onClick={rewindProjectTime} label="Riavvolgi tempo progetto" />
    <input className="timeline-range" type="range" min={0} max={clock.durationS} step={1} value={preview ?? Math.min(clock.durationS, elapsedS)} disabled={seeking || live} aria-label="Timeline progetto" onChange={(e) => setPreview(Number(e.target.value))} onPointerUp={applySeek} onKeyUp={applySeek} onBlur={applySeek} />
    {seeking ? <span role="status">Ricalcolo timeline…</span> : null}
    <span className="timeline-duration"><NumberField value={clock.durationS / 60} min={1} decimals={0} unit="min" ariaLabel="Durata progetto" onCommit={(v) => configureProjectClock({ durationS: v * 60 })} /></span>
    <Select value={String(clock.speed)} ariaLabel="Velocità tempo progetto" options={[1, 4, 10, 30, 60].map((v) => ({ value: String(v), label: `${v}×` }))} onChange={(v) => configureProjectClock({ speed: Number(v) })} />
    <EnvironmentControl />
    <Toggle label="Giorno festivo" checked={clock.holiday} onChange={(holiday) => configureProjectClock({ holiday })} />
  </div>;
}
