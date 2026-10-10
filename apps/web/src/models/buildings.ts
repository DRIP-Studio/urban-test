import type { BuildingStyle } from '@drip-urban/core';
/** Italian plaster facades and roofs, picked per building (stable by id). */
export const FACADES = ['#e9dfcc', '#e4d3b4', '#dccbb0', '#efe6d6', '#d9b99a', '#e8d7c3', '#cfc6b8', '#e6c9a8', '#f0ebe1', '#d8cdbd', '#e3c7a1', '#c9bfb1'];
export const TILE_ROOFS = ['#b5654a', '#a85b43', '#9c5a48', '#b87358', '#a8634f'];
export function buildingLook(id: string, heightM: number, style: BuildingStyle = {}): { facade: string; roof: string; roofH: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h >>>= 0;
  const pitched = style.roofShape ? style.roofShape !== 'flat' : heightM <= 16 && h % 5 !== 0;
  return { facade: style.facadeColor ?? FACADES[h % FACADES.length]!, roof: pitched ? TILE_ROOFS[(h >>> 4) % TILE_ROOFS.length]! : '#a29e96', roofH: pitched ? 1.1 : 0.45 };
}
