import type { Area, Zone } from '@drip-urban/core';
import { commit, newId, select } from '../state/store';
import { toast } from '../state/toasts';
import { distribute, makeDrawTool } from './draw';
import { cutTool, makeJunctionPicker, nodeTool, sectionTool } from './edit';
import { roadPen } from './roadPen';
import { pavingTool } from './paving';
import { roundaboutTool } from './roundabout';
import { furnitureTool, signTool } from './place';
import { selectTool } from './select';
import { calmingTool, markingTool } from './streetscape';
import { drainageTool } from './drainage';
import { useTool } from './toolState';
import { usePicks } from './picks';
import type { ToolDef } from './types';

const PROJECT = { kind: 'project' as const, source: 'DRIP Urban scenario' };

const areaDraw = makeDrawTool({
  shape: 'polygon', minPoints: 3, snapEnabled: true,
  finish(points) {
    const t = useTool.getState();
    const area: Area = { id: newId('ar'), kind: t.areaKind, polygon: points.map((p) => p.at), material: t.areaMaterial, state: 'project', properties: {}, provenance: PROJECT };
    const ok = commit('area.set', { area }).ok;
    if (ok) select({ kind: 'area', ids: [area.id] });
    return ok;
  },
});

const zoneDraw = makeDrawTool({
  shape: 'polygon', minPoints: 3, snapEnabled: false,
  finish(points) {
    const kind = useTool.getState().zoneKind;
    const names: Record<string, string> = { ztl: 'ZTL', pedestrian: 'Area pedonale', school: 'Strada scolastica', zone30: 'Zona 30', low_emission: 'Zona a basse emissioni', parking: 'Zona sosta', work: 'Cantiere' };
    const zone: Zone = {
      id: newId('z'), kind, name: names[kind] ?? 'Zona', polygon: points.map((p) => p.at),
      allowedModes: kind === 'ztl' ? ['bus', 'emergency', 'bike', 'walk'] : kind === 'pedestrian' || kind === 'school' ? ['walk', 'bike', 'emergency'] : kind === 'work' ? ['walk', 'emergency'] : ['car', 'bus', 'truck', 'bike', 'walk', 'emergency'],
      ...(kind === 'ztl' ? { schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '20:00', to: '02:00' }] } : {}),
      ...(kind === 'zone30' || kind === 'school' ? { speedKmh: 30 } : {}),
    };
    const ok = commit('zone.set', { zone }).ok;
    if (ok) select({ kind: 'zone', ids: [zone.id] });
    return ok;
  },
});

const crossingDraw = makeDrawTool({
  shape: 'line', minPoints: 2, maxPoints: 2, snapEnabled: false,
  finish(points) {
    const area: Area = { id: newId('ar'), kind: 'crossing', name: 'Attraversamento pedonale', polygon: [points[0]!.at, points[1]!.at], material: 'road_marking_white', depthM: 4, state: 'project', properties: {}, provenance: PROJECT };
    const ok = commit('area.set', { area }).ok;
    if (ok) select({ kind: 'area', ids: [area.id] });
    return ok;
  },
});

const arrayDraw = makeDrawTool({
  shape: 'line', minPoints: 2,
  finish(points, idx) {
    const t = useTool.getState();
    const spots = distribute(idx, points.map((p) => p.at), Math.max(1, t.arraySpacingM));
    if (spots.length > 400) { toast.warn('Troppi oggetti', `${spots.length} posizioni: aumenta il passo.`); return false; }
    const assets = spots.map((s) => ({ id: newId('a'), type: t.arrayItem, at: s.at, rotationDeg: s.bearing + 90, state: 'project' as const, properties: {}, provenance: PROJECT }));
    const ok = commit('asset.add', { assets }).ok;
    if (ok) { select({ kind: 'asset', ids: assets.map((a) => a.id) }); toast.success('Distribuzione', `${assets.length} elementi ogni ${t.arraySpacingM} m`); }
    return ok;
  },
});

const measureDraw = makeDrawTool({ shape: 'line', minPoints: 99, finish: () => false });

const transitDraw = makeDrawTool({
  shape: 'line', minPoints: 2,
  finish(points) {
    usePicks.getState().addTransitRoute(points.map((p) => p.at));
    return true;
  },
});

export const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Seleziona', icon: 'select', shortcut: 'V', group: 'draw', modes: ['design', 'analyze', 'traffic', 'transit'], hint: 'Clic per selezionare · Shift+clic aggiunge · Shift+trascina per riquadro · trascina un oggetto selezionato per spostarlo', handler: selectTool },
  { id: 'road', label: 'Strada', icon: 'road', shortcut: 'R', group: 'draw', modes: ['design'], hint: 'Clic: vertice · clic e trascina: curva · Shift: 15° · Backspace: togli punto · Invio o doppio clic: crea · Alt: niente snap', cursor: 'crosshair', handler: roadPen },
  { id: 'nodes', label: 'Nodi', icon: 'node', shortcut: 'N', group: 'draw', modes: ['design'], hint: 'Seleziona una strada · trascina estremi e vertici (Shift: raccordo morbido) · rilascia un estremo su un incrocio o una strada per agganciarlo · i punti chiari inseriscono un vertice · clic destro elimina', handler: nodeTool },
  { id: 'cut', label: 'Taglia', icon: 'cut', shortcut: 'X', group: 'draw', modes: ['design'], hint: 'Clic sull\'asse per dividere la strada', cursor: 'crosshair', handler: cutTool },
  { id: 'section', label: 'Sezione', icon: 'section', shortcut: 'S', group: 'civil', modes: ['design'], hint: 'Clic su una strada per modificare corsie, marciapiedi, sosta, ciclabili', handler: sectionTool },
  { id: 'junction', label: 'Junction Lab', icon: 'junction', shortcut: 'J', group: 'civil', modes: ['design', 'analyze'], hint: 'Clic su un incrocio: corsie, svolte, conflitti, regolazione', handler: makeJunctionPicker('junction') },
  { id: 'drainage', label: 'Drenaggio', icon: 'wave', shortcut: 'C', group: 'civil', modes: ['design'], hint: 'Clic: caditoie e pozzetti collegati da condotte in pendenza · clic su un nodo per collegarlo · Invio/Esc chiude il tratto', cursor: 'crosshair', handler: drainageTool },
  { id: 'roundabout', label: 'Rotatoria', icon: 'roundabout', shortcut: 'O', group: 'civil', modes: ['design'], hint: 'Clic ovunque (si aggancia agli incroci) · [ ] diametro · Invio crea · Esc riposiziona', handler: roundaboutTool },
  { id: 'signals', label: 'Semafori', icon: 'signal', shortcut: 'T', group: 'civil', modes: ['design', 'traffic'], hint: 'Clic su un incrocio: Signal Studio con fasi e ciclo', handler: makeJunctionPicker('signals') },
  { id: 'signs', label: 'Cartelli', icon: 'sign', shortcut: 'G', group: 'street', modes: ['design'], hint: 'Scegli il segnale e clic per posarlo · Alt+clic su un cartello aggiunge un pannello allo stesso palo · Q/E ruota', cursor: 'crosshair', handler: signTool },
  { id: 'crossing', label: 'Attraversamento', icon: 'crossing', shortcut: 'K', group: 'street', modes: ['design'], hint: 'Due clic da un bordo all\'altro della carreggiata', cursor: 'crosshair', handler: crossingDraw },
  { id: 'marking', label: 'Segnaletica orizzontale', icon: 'marking', shortcut: 'W', group: 'street', modes: ['design'], hint: 'Linee e aree: clic sui vertici, Invio per finire · scritte, simboli e frecce: un clic sulla corsia (orientati sul senso di marcia)', cursor: 'crosshair', handler: markingTool },
  { id: 'calming', label: 'Moderazione traffico', icon: 'calming', shortcut: 'D', group: 'street', modes: ['design'], hint: 'Clic sulla carreggiata: dossi, piattaforme e attraversamenti rialzati, cuscini berlinesi, bande rumorose · clic su un incrocio per rialzarlo', cursor: 'crosshair', handler: calmingTool },
  { id: 'furniture', label: 'Arredo', icon: 'furniture', shortcut: 'F', group: 'space', modes: ['design'], hint: 'Scegli l\'elemento · si allinea alla strada più vicina (Alt per libero) · Q/E o Shift+rotella ruota', cursor: 'crosshair', handler: furnitureTool },
  { id: 'array', label: 'Distribuisci', icon: 'array', shortcut: 'Y', group: 'space', modes: ['design'], hint: 'Disegna un percorso: oggetti ogni N metri (alberi, lampioni, dissuasori)', cursor: 'crosshair', handler: arrayDraw },
  { id: 'paving', label: 'Pavimentazione', icon: 'material', shortcut: 'M', group: 'space', modes: ['design'], hint: 'Clic: pavimenta la superficie · Shift+clic: tutti i marciapiedi della strada · Alt+clic: preleva il materiale', cursor: 'crosshair', handler: pavingTool },
  { id: 'area', label: 'Superficie', icon: 'area', shortcut: 'A', group: 'space', modes: ['design'], hint: 'Piazze, verde, sosta, giardini della pioggia: clic per i vertici, Invio per chiudere', cursor: 'crosshair', handler: areaDraw },
  { id: 'zone', label: 'Zone', icon: 'zone', shortcut: 'Z', group: 'space', modes: ['design', 'traffic'], hint: 'ZTL, zona 30, strada scolastica, cantiere: disegna il perimetro', cursor: 'crosshair', handler: zoneDraw },
  { id: 'measure', label: 'Misura', icon: 'measure', shortcut: 'U', group: 'analysis', modes: ['design', 'analyze', 'traffic', 'transit'], hint: 'Clic per misurare distanze; con 3+ punti anche l\'area · Esc per azzerare', cursor: 'crosshair', handler: measureDraw },
  { id: 'route', label: 'Navigatore', icon: 'route', shortcut: 'P', group: 'traffic', modes: ['traffic', 'analyze'], hint: 'Clic per origine, poi destinazione · «Aggiungi tappa» nel pannello per passare da punti intermedi', cursor: 'crosshair', handler: { click: (e) => usePicks.getState().pickRoutePoint(e.lngLat) } },
  { id: 'isochrone', label: 'Isocrona', icon: 'walk', shortcut: 'I', group: 'analysis', modes: ['analyze'], hint: 'Clic su un punto: area raggiungibile in 5/7/10/15 minuti', cursor: 'crosshair', handler: { click: (e) => usePicks.getState().pickIsochrone(e.lngLat) } },
  { id: 'transitRoute', label: 'Linea TPL', icon: 'transit', shortcut: 'L', group: 'transit', modes: ['transit'], hint: 'Clic sui punti di passaggio, Invio per finire: bus, BRT, tram e filobus seguono le strade; metro e treno restano come disegnati', cursor: 'crosshair', handler: transitDraw },
  { id: 'bikeStation', label: 'Stazione bike sharing', icon: 'bike', shortcut: 'H', group: 'transit', modes: ['transit'], hint: 'Clic per aggiungere una stazione di bike sharing', cursor: 'crosshair', handler: { click: (e) => usePicks.getState().addBikeStation(e.lngLat) } },
  { id: 'transitStop', label: 'Fermata', icon: 'bus', shortcut: 'B', group: 'transit', modes: ['transit'], hint: 'Clic per aggiungere una fermata alla linea selezionata', cursor: 'crosshair', handler: { click: (e) => usePicks.getState().addTransitStop(e.lngLat) } },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id) ?? TOOLS[0]!;

export const GROUP_LABEL: Record<ToolDef['group'], string> = { draw: 'Disegno', civil: 'Civile', street: 'Strada', space: 'Spazio', analysis: 'Analisi', traffic: 'Traffico', transit: 'TPL' };
