// earcut 3 ships no type declarations: the one function used to triangulate roofs.
declare module 'earcut' {
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[];
}
