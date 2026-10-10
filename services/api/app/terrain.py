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


# ------------------------------------------------------------------ point clouds (LAS / XYZ)

#: Point data record formats: byte offset of the classification and record base size.
_LAS_CLASS_OFFSET = {0: 15, 1: 15, 2: 15, 3: 15, 4: 15, 5: 15, 6: 16, 7: 16, 8: 16, 9: 16, 10: 16}
MAX_POINTS = 40_000_000


def read_las(data: bytes) -> tuple[list[float], list[float], list[float], list[int]]:
    """X, Y, Z and classification of a LAS 1.0–1.4 file (uncompressed). LAZ is refused."""
    import struct
    import math
    if len(data) < 227 or data[:4] != b"LASF":
        raise ValueError("Non è un file LAS (firma LASF mancante)")
    vmaj, vmin = data[24], data[25]
    header_size, = struct.unpack_from("<H", data, 94)
    offset, = struct.unpack_from("<I", data, 96)
    if vmaj != 1 or vmin > 4 or header_size < 227 or header_size > len(data) or offset < header_size or offset > len(data):
        raise ValueError('Header/versione LAS non valida')
    fmt = data[104]
    if fmt & 0x80 or fmt & 0x40:
        raise ValueError("LAZ compresso non supportato: decomprimi in LAS")
    fmt &= 0x3F
    rec_len, = struct.unpack_from("<H", data, 105)
    count, = struct.unpack_from("<I", data, 107)
    if vmaj == 1 and vmin >= 4 and header_size >= 375:
        c64, = struct.unpack_from("<Q", data, 247)
        count = c64 or count
    sx, sy, sz, ox, oy, oz = struct.unpack_from("<6d", data, 131)
    if fmt not in _LAS_CLASS_OFFSET:
        raise ValueError(f"Formato punti LAS {fmt} non supportato")
    if count > MAX_POINTS:
        raise ValueError(f"Nuvola di {count:,} punti: oltre {MAX_POINTS:,}, ritaglia l'area o riduci la densità".replace(",", "."))
    if rec_len < _LAS_CLASS_OFFSET[fmt] + 1 or count * rec_len > len(data) - offset:
        raise ValueError('Record LAS troncati o dimensione non valida')
    if any(not math.isfinite(v) for v in (sx,sy,sz,ox,oy,oz)) or min(sx,sy,sz) <= 0:
        raise ValueError('Scala o offset LAS non validi')
    co = _LAS_CLASS_OFFSET[fmt]
    xs, ys, zs, cl = [], [], [], []
    for k in range(count):
        b = offset + k * rec_len
        X, Y, Z = struct.unpack_from("<3i", data, b)
        c = data[b + co]
        xs.append(X * sx + ox); ys.append(Y * sy + oy); zs.append(Z * sz + oz)
        cl.append(c & 0x1F if fmt < 6 else c)
    return xs, ys, zs, cl


def read_laz(data: bytes):
    """Decode actual compressed LAZ using lazrs; retain compact numeric arrays, not boxed point objects."""
    from io import BytesIO
    from array import array
    import laspy
    import math
    try:
        with laspy.open(BytesIO(data)) as reader:
            if not reader.header.are_points_compressed:
                raise ValueError('Il file .laz non contiene punti compressi')
            if reader.header.point_count > MAX_POINTS:
                raise ValueError(f'Nuvola oltre {MAX_POINTS:,} punti: ritaglia la zona di lavoro')
            if reader.header.point_format.id in (4,5,9,10):
                raise ValueError('LAZ con waveform non supportato dal decoder lazrs; esporta punti senza waveform')
            if any(not math.isfinite(float(v)) for v in (*reader.header.scales,*reader.header.offsets)) or min(reader.header.scales) <= 0:
                raise ValueError('Scala o offset LAZ non validi')
            xs,ys,zs,classes=array('d'),array('d'),array('d'),array('B')
            for chunk in reader.chunk_iterator(250_000):
                xs.extend(chunk.x);ys.extend(chunk.y);zs.extend(chunk.z);classes.extend(chunk.classification)
            if len(xs) != reader.header.point_count:
                raise ValueError('Punti LAZ troncati')
            return xs,ys,zs,classes
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('LAZ non decodificabile o danneggiato') from exc


def read_xyz(text: str) -> tuple[list[float], list[float], list[float], list[int]]:
    """x y z [class] per line; separators space, tab, comma or semicolon; header lines skipped."""
    import re
    xs, ys, zs, cl = [], [], [], []
    sep = re.compile(r"[\s,;]+")
    for line in text.splitlines():
        parts = [p for p in sep.split(line.strip()) if p]
        if len(parts) < 3:
            continue
        try:
            x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
        except ValueError:
            continue
        xs.append(x); ys.append(y); zs.append(z)
        try:
            cl.append(int(float(parts[3])) if len(parts) > 3 else 0)
        except ValueError:
            cl.append(0)
        if len(xs) > MAX_POINTS:
            raise ValueError("Troppi punti nel file XYZ")
    if not xs:
        raise ValueError("Nessun punto x y z leggibile nel file")
    return xs, ys, zs, cl


def grid_from_points(xs: list[float], ys: list[float], zs: list[float], cls: list[int], epsg: int, bbox: list[float],
                     spacing_m: float = 2.0, ground_only: bool = True, label: str = "nuvola di punti") -> dict:
    """DTM on the project lon/lat grid from points in EPSG 4326 or UTM: ground points (class 2) when
    classified, lowest point per cell otherwise; empty cells filled from the neighbours."""
    if epsg == 4326:
        to_src = lambda lon, lat: (lon, lat)  # noqa: E731
        cell = spacing_m / M_PER_DEG
    elif epsg in UTM_EPSG:
        zone = UTM_EPSG[epsg]
        to_src = lambda lon, lat: to_utm(lon, lat, zone)  # noqa: E731
        cell = spacing_m
    else:
        raise ValueError("Sistema di riferimento non supportato: usa EPSG 4326 o UTM (326xx, 25832–25834, 6707–6709)")
    has_ground = ground_only and any(c == 2 for c in cls)
    buckets: dict[tuple[int, int], list[float]] = {}
    used = 0
    for x, y, z, c in zip(xs, ys, zs, cls):
        if has_ground and c != 2:
            continue
        if not has_ground and c in (7, 18):  # noise
            continue
        key = (int(x // cell), int(y // cell))
        b = buckets.get(key)
        if b is None:
            buckets[key] = [z, z, 1]
        else:
            b[0] = min(b[0], z); b[1] += z; b[2] += 1
        used += 1
    if not buckets:
        raise ValueError("Nessun punto di terreno nella nuvola")
    w, s, e, n = bbox
    nx, ny = grid_shape(bbox, max(spacing_m, 0.5))
    z_out: list[float] = []
    for j in range(ny):
        for i in range(nx):
            sx, sy = to_src(w + (e - w) * i / (nx - 1), s + (n - s) * j / (ny - 1))
            ki, kj = int(sx // cell), int(sy // cell)
            v = float("nan")
            for r in (0, 1):
                vals = [(b[1] / b[2]) if has_ground else b[0] for di in range(-r, r + 1) for dj in range(-r, r + 1) if (b := buckets.get((ki + di, kj + dj)))]
                if vals:
                    v = min(vals) if not has_ground else sum(vals) / len(vals)
                    break
            z_out.append(v)
    covered = sum(1 for v in z_out if not math.isnan(v)) / len(z_out)
    if covered == 0:
        raise ValueError("La nuvola di punti non copre l'area del progetto (controlla il sistema di riferimento)")
    return {"west": w, "south": s, "east": e, "north": n, "nx": nx, "ny": ny, "z": [round(v, 2) for v in _fill(z_out, nx, ny)],
            "source": f"DTM da {label} (EPSG:{epsg}, {format(used, ',').replace(',', '.')} punti{' di terreno' if has_ground else ''}, cella {spacing_m:g} m)",
            "resolutionM": _resolution(bbox, nx, ny), "coverage": round(covered, 3), "fetchedAt": _now()}
