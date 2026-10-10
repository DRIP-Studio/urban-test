import { useState } from 'react';
import { commit, useApp } from '../state/store';
import { captureProviderWeather } from '../state/weatherProvider';
import { setProjectTimeMode } from '../state/projectTime';
import { toast } from '../state/toasts';
import { TrafficSourceControl, TRAFFIC_SOURCE_LABELS } from '../traffic/TrafficSourceControl';
import { useLive } from '../traffic/live';
import { Button, Field, Segmented, Select, Slider } from '../ui/controls';
import { Popover } from '../ui/Popover';

const weatherLabels = { clear: 'Sereno', cloudy: 'Nuvoloso', overcast: 'Coperto', rain: 'Pioggia', fog: 'Nebbia' };
export function EnvironmentControl() {
  const [weatherBusy, setWeatherBusy] = useState(false);
  const environment = useApp(s => s.network?.environment);
  const mode = environment?.mode ?? 'study', weather = environment?.weather ?? 'clear';
  const traffic = useLive(s => s.traffic), source = environment?.trafficSource ?? 'simulated';
  const apply = (payload: object) => { const result = commit('environment.set', payload); if (!result.ok) toast.error('Ambiente', result.issues.map(i => i.message).join(' · ')); };
  return <Popover label="Ambiente globale del progetto" align="end" width={380} trigger={(open, toggle) =>
    <button type="button" className={`environment-status ${mode === 'live' ? 'is-live' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
      <span className="environment-dot" aria-hidden />{mode === 'live' ? 'LIVE' : 'Studio'}<span> · {weatherLabels[weather]} · {TRAFFIC_SOURCE_LABELS[source]}</span>
    </button>}>{() => <div className="environment-details">
      <strong>Ambiente del progetto</strong>
      <Segmented<'live' | 'study'> label="Modalità tempo" value={mode} options={[{ value: 'study', label: 'Studio' }, { value: 'live', label: 'Ora reale' }]}
        onChange={value => { const result = setProjectTimeMode(value); if (!result.ok) toast.error('Tempo globale', result.issues.map(i => i.message).join(' · ')); }} />
      <p className="muted">{mode === 'live' ? 'L’orologio segue l’ora reale. Avviare una simulazione fissa l’istante e passa a Studio.' : 'Data, luce, ZTL, servizi TPL e semafori usano il tempo del progetto.'}</p>
      <Field label="Meteo di studio"><Select ariaLabel="Meteo globale" value={weather} options={Object.entries(weatherLabels).map(([value, label]) => ({ value, label }))}
        onChange={value => apply({ weather: value, weatherSource: 'simulated' })} /></Field>
      {weather !== 'clear' ? <Slider label="Intensità meteo" value={environment?.intensity ?? 1} min={0} max={1} step={.05} onChange={intensity => apply({ intensity, weatherSource: 'simulated' })} /> : null}
      <Button busy={weatherBusy} onClick={async () => { setWeatherBusy(true); try { await captureProviderWeather(); } catch (error) { toast.error('Meteo provider', String(error instanceof Error ? error.message : error)); } finally { setWeatherBusy(false); } }}>Acquisisci meteo attuale</Button>
      <p className="muted">{environment?.weatherSource === 'provider' && environment.weatherCapture ? `${environment.weatherCapture.provider} · valido ${new Date(environment.weatherCapture.validAt).toLocaleString('it-IT')} · WMO ${environment.weatherCapture.code}. Istantanea modellata conservata nello scenario, rappresentazione visiva semplificata; aggiornamento manuale.` : 'Meteo impostato nello scenario; non è una misura meteorologica dal vivo.'}</p>
      <TrafficSourceControl />
      {traffic?.mode === source ? <p className="muted">Calcolo traffico: {new Date(traffic.generatedAt).toLocaleTimeString('it-IT')} · {traffic.calibration.method}</p> : null}
    </div>}</Popover>;
}
