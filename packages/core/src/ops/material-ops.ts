import type { ProjectMaterial, BuildingStyle } from '../model/types';
import { defineOperation } from './registry';

export const setMaterial = defineOperation<{ material: ProjectMaterial }>({
  type: 'material.set', label: (p) => `Materiale ${p.material.label}`,
  validate(_net, { material: m }) {
    const errors: string[] = [];
    if (!/^custom\.[a-zA-Z0-9_-]{1,80}$/.test(m.id) || !m.label.trim()) errors.push('Id o nome materiale non valido');
    if (!/^#[0-9a-fA-F]{6}$/.test(m.color)) errors.push('Colore non valido');
    const ranges = { scaleM: [.01, 1000], roughness: [0, 1], metallic: [0, 1], opacity: [0, 1], brightness: [0, 3], contrast: [0, 3], bump: [0, 10], emissive: [0, 10], rotationDeg: [-360, 360] };
    for (const [key, [min, max]] of Object.entries(ranges)) { const value = m[key as keyof typeof ranges]; if (value !== undefined && (!Number.isFinite(value) || value < min! || value > max!)) errors.push(`${key} fuori intervallo`); }
    if (m.offset?.some((v) => !Number.isFinite(v))) errors.push('Offset non valido');
    if (m.crop && (m.crop.some((v) => !Number.isFinite(v) || v < 0 || v > 1) || m.crop[2] <= 0 || m.crop[3] <= 0 || m.crop[0] + m.crop[2] > 1.000001 || m.crop[1] + m.crop[3] > 1.000001)) errors.push('Ritaglio fuori immagine');
    for (const texture of [m.texture, m.normalMap]) if (texture && !/^tex-[a-f0-9]{24}$/.test(texture)) errors.push('Riferimento texture non valido');
    return errors.map((message) => ({ code: 'material.invalid', severity: 'error' as const, message }));
  },
  apply: (net, { material }) => ({ ...net, materials: { ...net.materials, [material.id]: { ...material } } }),
});

export const styleBuilding = defineOperation<{ buildingId: string; style: BuildingStyle }>({
  type: 'building.style', label: () => 'Aspetto edificio',
  validate(_net, p) {
    const errors: string[] = [];
    if (!p.buildingId) errors.push('Edificio non specificato');
    for (const [key, value] of Object.entries(p.style)) {
      if (['heightM', 'minHeightM', 'levels'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000)) errors.push(`${key} non valido`);
    }
    if (p.style.heightM !== undefined && p.style.minHeightM !== undefined && p.style.minHeightM >= p.style.heightM) errors.push('Quota minima deve essere sotto il tetto');
    if (p.style.facadeColor && !/^#[0-9a-fA-F]{6}$/.test(p.style.facadeColor)) errors.push('Colore facciata non valido');
    if (p.style.use && !['residential','commercial','industrial','public'].includes(p.style.use)) errors.push('Uso non valido');
    if (p.style.roofShape && !['flat','gabled','hipped'].includes(p.style.roofShape)) errors.push('Copertura non valida');
    return errors.map((message) => ({ code: 'building.style', severity: 'error' as const, message }));
  },
  apply: (net, p) => ({ ...net, buildingStyles: { ...net.buildingStyles, [p.buildingId]: { ...p.style } } }),
});

export const setEnvironment = defineOperation<Partial<import('../model/types').ProjectEnvironment>>({
  type: 'environment.set', label: () => 'Ambiente del progetto',
  validate: (_net,p) => {
    const errors:string[]=[];
    if(p.weather!==undefined&&!['clear','cloudy','rain','fog','overcast'].includes(p.weather))errors.push('Meteo non valido');
    if(p.intensity!==undefined&&(!Number.isFinite(p.intensity)||p.intensity<0||p.intensity>1))errors.push('Intensità fuori intervallo');
    if(p.mode!==undefined&&!['study','live'].includes(p.mode))errors.push('Modalità ambiente non valida');
    if(p.weatherSource!==undefined&&!['simulated','provider'].includes(p.weatherSource))errors.push('Fonte meteo non valida');
    if(p.weatherCapture){const c=p.weatherCapture;if(typeof c.provider!=='string'||!c.provider.trim()||!Number.isFinite(Date.parse(c.validAt))||!Number.isFinite(Date.parse(c.retrievedAt))||!Number.isInteger(c.code)||c.code<0||c.code>99||!Array.isArray(c.at)||c.at.length!==2||c.at.some(v=>!Number.isFinite(v))||Math.abs(c.at[0])>180||Math.abs(c.at[1])>90)errors.push('Provenienza meteo non valida');}
    if(p.trafficSource!==undefined&&!['live','historical','simulated','hybrid'].includes(p.trafficSource))errors.push('Fonte traffico non valida');
    if(p.pedestrianDemandPerHour!==undefined&&(!Number.isFinite(p.pedestrianDemandPerHour)||p.pedestrianDemandPerHour<0||p.pedestrianDemandPerHour>100000))errors.push('Domanda pedonale non valida');
    if(Object.keys(p).some(k=>!['weather','intensity','mode','weatherSource','weatherCapture','trafficSource','pedestrianDemandPerHour'].includes(k)))errors.push('Campo ambiente sconosciuto');
    return errors.map(message=>({code:'environment.invalid',severity:'error' as const,message}));
  },
  apply: (net,p) => ({...net,environment:{weather:'clear',intensity:1,...net.environment,...p}}),
});

export const cityModel = defineOperation<{ model: import('../model/types').CityModel }>({
  type: 'cityModel.set', label: () => 'Modello territoriale 3D Tiles',
  validate: (_net,{model}) => {
    let valid = false;try { const url=new URL(model.url);valid=['https:','http:'].includes(url.protocol) && !url.username && !url.password; } catch { /* invalid URL */ }
    return valid && model.id && model.name.trim() && typeof model.enabled==='boolean' ? [] : [{code:'cityModel.invalid',severity:'error',message:'URL, id o nome del modello non valido'}];
  },
  apply: (net,{model}) => ({...net,cityModels:{...net.cityModels,[model.id]:{...model}}}),
});
