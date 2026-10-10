import type { WeatherPreset } from '@drip-urban/core';
import { api } from '../api/client';
import { commit, useApp } from './store';

/** WMO codes are translated only when the renderer supports the phenomenon. */
export function weatherPreset(code: number): WeatherPreset | null {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code)) return 'rain';
  return null;
}

export async function captureProviderWeather(): Promise<void> {
  const state = useApp.getState(), origin = state.baseline?.origin;
  if (!origin) throw Error('Apri un progetto per acquisire il meteo.');
  const result = await api.get<{ message?: string; weather?: { values: Record<string, number>; source: string; validAt: string | null; retrievedAt: string } }>(`/api/environment?lat=${origin[1]}&lon=${origin[0]}`);
  const current = useApp.getState();
  if (current.project?.id !== state.project?.id || current.scenario?.id !== state.scenario?.id || current.scenario?.operations !== state.scenario?.operations) throw Error('Scenario cambiato durante l’acquisizione: ripeti sullo scenario corrente.');
  const data = result.weather;
  if (!data) throw Error(result.message || 'Provider meteo non disponibile.');
  const age = Date.now() - Date.parse(data.validAt ?? '');
  if (!Number.isFinite(age) || age < -300000 || age > 7200000) throw Error('Istante meteorologico assente o non attuale: acquisizione non applicata.');
  const code = data.values.weather_code, weather = weatherPreset(code!);
  if (!weather) throw Error(`Fenomeno WMO ${code} non supportato dal renderer; lo scenario resta invariato.`);
  // Precipitation is accumulated over current.interval, not necessarily one hour.
  const mm = data.values.precipitation, interval = data.values.interval;
  const hourly = Number.isFinite(mm) && Number.isFinite(interval) && interval! > 0 ? mm! * 3600 / interval! : null;
  const intensity = weather === 'rain' ? hourly === null ? .5 : Math.min(1, Math.max(.15, hourly / 10)) : 1;
  const applied = commit('environment.set', { weather, intensity, weatherSource: 'provider', weatherCapture: { provider: data.source, validAt: data.validAt!, retrievedAt: data.retrievedAt, code, at: [...origin] } });
  if (!applied.ok) throw Error(applied.issues.map(i => i.message).join(' · '));
}
