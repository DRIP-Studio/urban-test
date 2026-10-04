"""Digital terrain model (DTM) of a project, stored as the project document ``terrain``.

Two sources:

* **Copernicus DEM GLO-90** through the Open-Meteo Elevation API (no key, 90 m native resolution,
  sampled on a regular grid over the project area). Good for profiles and earthworks at
  preliminary-design level.
* **File** — ESRI ASCII Grid (``.asc``), the format regional geoportals use for LiDAR DTMs (1–5 m),
  in WGS84 degrees or UTM (WGS84 / ETRS89 / RDN2008, zones 32–34). It is resampled bilinearly on a
  lon/lat grid over the project area.

Grid layout (shared with packages/core TerrainGrid): ``z[j * nx + i]``, i west→east, j south→north.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Callable

import httpx

from app.settings import SETTINGS

MAX_CELLS = 90_000           # ≈ 300 × 300: a few MB of JSON at most
OPEN_METEO_BATCH = 100       # the Elevation API accepts up to 100 coordinates per request
M_PER_DEG = 111_320.0

# EPSG → (UTM zone, northern hemisphere). WGS84 UTM, ETRS89 UTM, RDN2008 UTM (Italy).
UTM_EPSG = {**{32600 + z: z for z in range(1, 61)}, 25832: 32, 25833: 33, 25834: 34, 6707: 32, 6708: 33, 6709: 34}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def grid_shape(bbox: list[float], spacing_m: float) -> tuple[int, int]:
    w, s, e, n = bbox
    lat0 = math.radians((s + n) / 2)
    width = (e - w) * M_PER_DEG * math.cos(lat0)
    height = (n - s) * M_PER_DEG
    nx = max(2, int(round(width / spacing_m)) + 1)
    ny = max(2, int(round(height / spacing_m)) + 1)
    # Keep the grid within MAX_CELLS by coarsening uniformly.
    k = math.sqrt(nx * ny / MAX_CELLS)
    if k > 1:
        nx, ny = max(2, int(nx / k)), max(2, int(ny / k))
    return nx, ny


def _resolution(bbox: list[float], nx: int, ny: int) -> float:
    w, s, e, n = bbox
    lat0 = math.radians((s + n) / 2)
    return round(max((e - w) * M_PER_DEG * math.cos(lat0) / (nx - 1), (n - s) * M_PER_DEG / (ny - 1)), 1)


def fetch_open_meteo(bbox: list[float], spacing_m: float = 60.0, report: Callable[[float, str], None] | None = None,
                     client: httpx.Client | None = None) -> dict:
    """Samples the Copernicus GLO-90 DEM on a grid over ``bbox`` ([w, s, e, n])."""
    w, s, e, n = bbox
    nx, ny = grid_shape(bbox, spacing_m)
    pts = [(s + (n - s) * j / (ny - 1), w + (e - w) * i / (nx - 1)) for j in range(ny) for i in range(nx)]
    z: list[float] = []
    own = client is None
    c = client or httpx.Client(timeout=20, headers={"User-Agent": SETTINGS.user_agent})
    try:
        batches = range(0, len(pts), OPEN_METEO_BATCH)
        for b, k in enumerate(batches):
            chunk = pts[k:k + OPEN_METEO_BATCH]
            params = {"latitude": ",".join(f"{p[0]:.6f}" for p in chunk), "longitude": ",".join(f"{p[1]:.6f}" for p in chunk)}
            for attempt in range(4):
                try:
                    r = c.get("https://api.open-meteo.com/v1/elevation", params=params)
                    if r.status_code == 429:
                        raise httpx.HTTPStatusError("limite di richieste", request=r.request, response=r)
                    r.raise_for_status()
                    vals = r.json().get("elevation") or []
                    if len(vals) != len(chunk):
                        raise ValueError("risposta incompleta")
                    z.extend(float(v) if v is not None and math.isfinite(float(v)) else math.nan for v in vals)
                    break
                except (httpx.HTTPError, ValueError) as exc:
                    if attempt == 3:
                        raise RuntimeError(f"Servizio altimetrico non raggiungibile: {exc}") from exc
                    time.sleep(1.5 * (attempt + 1))
            if report:
                report(0.05 + 0.9 * (b + 1) / len(batches), f"Quote {min(len(pts), k + OPEN_METEO_BATCH):,}/{len(pts):,}".replace(",", "."))
    finally:
        if own:
            c.close()
    return {"west": w, "south": s, "east": e, "north": n, "nx": nx, "ny": ny, "z": [round(v, 2) for v in _fill(z, nx, ny)],
            "source": "Copernicus DEM GLO-90 (© DLR e Airbus, distribuito da ESA) tramite Open-Meteo Elevation API",
            "resolutionM": _resolution(bbox, nx, ny), "fetchedAt": _now()}


def _fill(z: list[float], nx: int, ny: int) -> list[float]:
    """Replaces NaN cells with the mean of valid neighbours, growing inwards; all-NaN → 0."""
    z = list(z)
    if all(math.isnan(v) for v in z):
        raise ValueError("Nessuna quota valida nell'area del progetto")
    for _ in range(max(nx, ny)):
        missing = [k for k, v in enumerate(z) if math.isnan(v)]
        if not missing:
            break
        nxt = list(z)
        for k in missing:
            i, j = k % nx, k // nx
            ns = [z[jj * nx + ii] for ii, jj in ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)) if 0 <= ii < nx and 0 <= jj < ny and not math.isnan(z[jj * nx + ii])]
            if ns:
                nxt[k] = sum(ns) / len(ns)
        z = nxt
    return z


# ------------------------------------------------------------------ ESRI ASCII Grid

def to_utm(lon: float, lat: float, zone: int) -> tuple[float, float]:
    """WGS84 → UTM (Krüger series), same formulas as the DXF export."""
    a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    phi, lam = math.radians(lat), math.radians(lon)
    lam0 = math.radians((zone - 1) * 6 - 180 + 3)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T, C, A = math.tan(phi) ** 2, ep2 * math.cos(phi) ** 2, math.cos(phi) * (lam - lam0)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720))
    if lat < 0:
        y += 10_000_000
    return x, y


def parse_ascii_grid(text: str) -> dict:
    head: dict[str, float] = {}
    lines = text.splitlines()
    k = 0
    while k < len(lines) and lines[k].strip() and lines[k].split()[0].replace("_", "").isalpha():
        key, val = lines[k].split()[:2]
        head[key.lower()] = float(val)
        k += 1
    for req in ("ncols", "nrows", "cellsize"):
        if req not in head:
            raise ValueError(f"File ASCII Grid non valido: manca {req.upper()}")
    ncols, nrows, cell = int(head["ncols"]), int(head["nrows"]), head["cellsize"]
    if "xllcorner" in head:
        x0, y0 = head["xllcorner"] + cell / 2, head["yllcorner"] + cell / 2
    elif "xllcenter" in head:
        x0, y0 = head["xllcenter"], head["yllcenter"]
    else:
        raise ValueError("File ASCII Grid non valido: manca XLLCORNER/XLLCENTER")
    nodata = head.get("nodata_value", -9999.0)
    vals = [float(v) for line in lines[k:] for v in line.split()]
    if len(vals) < ncols * nrows:
        raise ValueError(f"File ASCII Grid incompleto: {len(vals)} valori su {ncols * nrows}")
    # Rows are written north → south.
    z = [[math.nan if vals[r * ncols + c] == nodata else vals[r * ncols + c] for c in range(ncols)] for r in range(nrows)]
    return {"ncols": ncols, "nrows": nrows, "x0": x0, "y0": y0, "cell": cell, "z": z}


def _sample_src(g: dict, x: float, y: float) -> float:
    """Bilinear in the source grid (x, y in its CRS); NaN outside or next to no-data."""
    fx = (x - g["x0"]) / g["cell"]
    fy = (y - g["y0"]) / g["cell"]
    if fx < 0 or fy < 0 or fx > g["ncols"] - 1 or fy > g["nrows"] - 1:
        return math.nan
    i, j = min(int(fx), g["ncols"] - 2), min(int(fy), g["nrows"] - 2)
    tx, ty = fx - i, fy - j
    row = lambda jj: g["z"][g["nrows"] - 1 - jj]  # noqa: E731 — rows stored north → south
    a, b, c, d = row(j)[i], row(j)[i + 1], row(j + 1)[i], row(j + 1)[i + 1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def resample_ascii(text: str, epsg: int, bbox: list[float]) -> dict:
    """Resamples an ESRI ASCII Grid DTM on a lon/lat grid over the project ``bbox``."""
    src = parse_ascii_grid(text)
    if epsg == 4326:
        to_src = lambda lon, lat: (lon, lat)  # noqa: E731
        cell_m = src["cell"] * M_PER_DEG
    elif epsg in UTM_EPSG:
        zone = UTM_EPSG[epsg]
        to_src = lambda lon, lat: to_utm(lon, lat, zone)  # noqa: E731
        cell_m = src["cell"]
    else:
        raise ValueError("Sistema di riferimento non supportato: usa EPSG 4326 o UTM (326xx, 25832–25834, 6707–6709)")
    w, s, e, n = bbox
    nx, ny = grid_shape(bbox, max(cell_m, 1.0))
    z = [_sample_src(src, *to_src(w + (e - w) * i / (nx - 1), s + (n - s) * j / (ny - 1))) for j in range(ny) for i in range(nx)]
    covered = sum(1 for v in z if not math.isnan(v)) / len(z)
    if covered == 0:
        raise ValueError("Il file DTM non copre l'area del progetto (controlla il sistema di riferimento)")
    return {"west": w, "south": s, "east": e, "north": n, "nx": nx, "ny": ny, "z": [round(v, 2) for v in _fill(z, nx, ny)],
            "source": f"DTM da file (ESRI ASCII Grid, EPSG:{epsg}, cella {src['cell']:g})", "resolutionM": _resolution(bbox, nx, ny),
            "coverage": round(covered, 3), "fetchedAt": _now()}
