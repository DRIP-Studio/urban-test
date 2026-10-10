import type { Road, VerticalProfile } from '../model/types';
import { LocalFrame } from '../geo/projection';
import { lengthOf } from '../geo/polyline';

export interface UnderpassDesign {
  readonly usage: 'road' | 'pedestrian';
  readonly depthM: number;
  readonly clearanceM: number;
  readonly slabM: number;
  readonly rampLengthM: number;
  readonly maxGradePct: number;
  /** Explicit orthometric elevations, from a survey/DTM or supplied by the designer. */
  readonly entryElevationM: number;
  readonly exitElevationM: number;
}
export function underpassDesign(road: Road, design: UnderpassDesign) {
  const frame = new LocalFrame(road.axis[0]!);
  const lengthM = lengthOf(road.axis.map(p => frame.toMetric(p)));
  const errors: string[] = [];
  if (!['road', 'pedestrian'].includes(design.usage) || Object.entries(design).some(([k,v]) => k !== 'usage' && !Number.isFinite(v))) errors.push('Parametri o uso non validi');
  if (!(design.depthM > 0 && design.depthM <= 40 && design.clearanceM >= 2 && design.clearanceM <= 12 && design.slabM >= .15 && design.slabM <= 3)) errors.push('Profondità, luce o soletta non valida');
  if (design.depthM < design.clearanceM + design.slabM) errors.push('La profondità non contiene luce libera e soletta');
  if (!(design.rampLengthM > 0 && lengthM - 2 * design.rampLengthM >= 2)) errors.push('Asse troppo corto per due rampe e tratto coperto: prolungare il tracciato');
  if (!(design.maxGradePct > 0 && design.maxGradePct <= (design.usage === 'pedestrian' ? 8 : 12))) errors.push('Pendenza limite di progetto non valida');
  if (Math.abs(design.entryElevationM) > 9000 || Math.abs(design.exitElevationM) > 9000) errors.push('Quote fuori campo');
  const floorM = Math.min(design.entryElevationM, design.exitElevationM) - design.depthM;
  const entryGradePct = (design.entryElevationM - floorM) / design.rampLengthM * 100;
  const exitGradePct = (design.exitElevationM - floorM) / design.rampLengthM * 100;
  if (Math.max(entryGradePct, exitGradePct) > design.maxGradePct + 1e-6) errors.push(`Rampe ${Math.max(entryGradePct, exitGradePct).toFixed(2)}% oltre limite ${design.maxGradePct}%: aumentare la lunghezza`);
  const vertical: VerticalProfile = {pvis: [
    {station: 0, elevation: design.entryElevationM},
    {station: design.rampLengthM, elevation: floorM},
    {station: lengthM - design.rampLengthM, elevation: floorM},
    {station: lengthM, elevation: design.exitElevationM},
  ]};
  return {lengthM, coveredLengthM: lengthM - 2 * design.rampLengthM, floorM, entryGradePct, exitGradePct, vertical, errors};
}
