import type { WeatherPreset } from '@drip-urban/core';
import * as Cesium from 'cesium';

/**
 * Time of day in the Twin: the sun (or the moon) lights the city for a chosen date and local hour at the
 * project's real position, with building shadows by day and street lamps on at night.
 */

/** UTC instant of a local wall-clock time in `tz` (handles daylight saving through Intl). */
export function zonedInstant(dateIso: string, hour: number, tz: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const h = Math.floor(hour), min = Math.round((hour - h) * 60);
  const guess = Date.UTC(y, m - 1, d, h, min);
  // Offset of the zone at that instant: format the guess in the zone and compare.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asZone = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (asZone - guess));
}

/** Solar elevation (degrees) at a place and instant (NOAA approximation, ±0,5°). */
export function solarElevation(lon: number, lat: number, when: Date): number {
  const rad = Math.PI / 180;
  const jd = when.getTime() / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = ((gmst * 15 + lon) * rad) - ra;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha)) / rad;
}

export interface Lamp { readonly lon: number; readonly lat: number; readonly h: number }

export const DAY_PRESETS: readonly { readonly value: string; readonly label: string; readonly hour: number }[] = [
  { value: 'dawn', label: 'Alba', hour: 6.5 }, { value: 'morning', label: 'Mattino', hour: 9.5 }, { value: 'noon', label: 'Mezzogiorno', hour: 13 },
  { value: 'sunset', label: 'Tramonto', hour: 19 }, { value: 'night', label: 'Notte', hour: 22.5 },
];

/** Resolve named solar moments for this project's latitude, date and time zone. */
export function solarDayPresets(origin: readonly [number,number], date: string, timeZone: string) {
  const anchor = zonedInstant(date, 0, timeZone).getTime();
  const samples = Array.from({length:289},(_,index) => ({ minute:index*5, elevation:solarElevation(origin[0],origin[1],new Date(anchor+index*300000)) }));
  const localHour = (minute:number) => {
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(anchor+minute*60000));
    return Number(parts.find(p=>p.type==='hour')!.value) + Number(parts.find(p=>p.type==='minute')!.value)/60;
  };
  const crossing = (elevation:number,rising:boolean):number|null => {
    for(let i=1;i<samples.length;i++) {
      const before=samples[i-1]!,after=samples[i]!;
      if(rising ? before.elevation<elevation&&after.elevation>=elevation : before.elevation>elevation&&after.elevation<=elevation) return localHour(before.minute+5*(elevation-before.elevation)/(after.elevation-before.elevation));
    }
    return null; // Polar day/night: do not invent a sunrise or sunset.
  };
  const noon=samples.reduce((best,sample)=>sample.elevation>best.elevation?sample:best);
  const moments:Record<string,number|null>={dawn:crossing(-.833,true),noon:localHour(noon.minute),sunset:crossing(-.833,false),'blue-hour':crossing(-5,false)};
  return [...DAY_PRESETS.slice(0,4),{value:'blue-hour',label:'Ora blu',hour:19.5},DAY_PRESETS[4]!].flatMap(p=>moments[p.value]===null?[]:[{...p,hour:moments[p.value]??p.hour}]);
}

/** Owns the lighting state of one viewer: sun or moon light, shadows, sky, lamps. */
export class Daylight {
  private lamps: Cesium.PointPrimitiveCollection;
  private glow: Cesium.PointPrimitiveCollection;
  private readonly sun = new Cesium.SunLight();
  private readonly moon = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(new Cesium.Cartesian3(0.3, 0.4, -1), new Cesium.Cartesian3()), color: Cesium.Color.fromCssColorString('#a9bde0'), intensity: 0.3 });

  constructor(private readonly viewer: Cesium.Viewer, private readonly origin: readonly [number, number]) {
    this.glow = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection;
    this.lamps = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as Cesium.PointPrimitiveCollection;
    viewer.scene.globe.enableLighting = true;
    // Sky and globe atmosphere follow the real sun (dark sky at night, warm at sunset).
    viewer.scene.atmosphere.dynamicLighting = Cesium.DynamicAtmosphereLightingType.SUNLIGHT;
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    viewer.scene.shadowMap.softShadows = true;
    viewer.scene.shadowMap.darkness = 0.45;
    viewer.scene.shadowMap.maximumDistance = 900;
    viewer.scene.shadowMap.size = 4096;
    viewer.clock.shouldAnimate = false;
  }

  setLamps(lamps: readonly Lamp[]): void {
    this.lamps.removeAll(); this.glow.removeAll();
    const near = new Cesium.NearFarScalar(30, 1, 1500, 0.25);
    for (const l of lamps) {
      const position = Cesium.Cartesian3.fromDegrees(l.lon, l.lat, l.h);
      this.glow.add({ position, pixelSize: 26, color: Cesium.Color.fromCssColorString('#ffcf87').withAlpha(0.22), scaleByDistance: near });
      this.lamps.add({ position, pixelSize: 6, color: Cesium.Color.fromCssColorString('#fff2d6'), scaleByDistance: near });
    }
  }

  /** Applies a local time: returns the solar elevation used. */
  apply(when: Date, weather: WeatherPreset = 'clear', intensity = 1): number {
    const v = this.viewer;
    v.clock.currentTime = Cesium.JulianDate.fromDate(when);
    const elev = solarElevation(this.origin[0], this.origin[1], when);
    const night = elev < -4;
    if (night) v.scene.light = this.moon;
    else { this.sun.intensity = Math.max(0.6, Math.min(2.0, 0.6 + elev / 25)) * (weather === 'clear' ? 1 : 1 - intensity * (weather === 'cloudy' ? .35 : .65)); v.scene.light = this.sun; }
    v.shadows = elev > 1.5;
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = v.scene.globe.show;
    v.scene.fog.enabled = v.scene.globe.show;
    v.scene.fog.density = weather === 'fog' ? .0002 + intensity * .003 : weather === 'rain' ? .0005 : .0002;
    if(v.scene.skyAtmosphere) { v.scene.skyAtmosphere.brightnessShift = weather === 'clear' ? 0 : -.15 * intensity; v.scene.skyAtmosphere.saturationShift = weather === 'clear' ? 0 : -.5 * intensity; }
    this.lamps.show = this.glow.show = elev < 2;
    v.scene.requestRender();
    return elev;
  }

  destroy(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.lamps);
    this.viewer.scene.primitives.remove(this.glow);
  }
}
