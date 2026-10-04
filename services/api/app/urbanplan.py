"""Piano urbanistico (PUC/PRG): import of zoning and constraint layers into the project document ``urbanplan``.

Formats
-------
* **Shapefile** zipped (``.zip`` with ``.shp`` + ``.dbf``, optional ``.prj`` and ``.cpg``): a minimal
  pure-Python reader for Polygon / PolygonZ records (shape types 5 and 15); other shape types are
  rejected. Rings are grouped into polygons with holes (outer rings clockwise, as the ESRI spec says;
  files with every ring counter-clockwise are read as outer rings).
* **GeoJSON** FeatureCollection with Polygon / MultiPolygon geometries, in WGS84 (RFC 7946) unless a
  legacy ``crs`` member or the ``epsg`` option says otherwise.

Coordinate systems (from the ``.prj`` WKT, or an EPSG code)
------------------------------------------------------------
* WGS84 / ETRS89 / RDN2008 geographic (EPSG 4326, 4258, 6706) — passed through.
* UTM zones 32/33/34 on WGS84 / ETRS89 / RDN2008 (EPSG 326xx, 258xx, 6707–6709) — transverse Mercator
  inverse on the GRS80/WGS84 ellipsoid (the datum difference ETRS89/RDN2008 ↔ WGS84 is a few decimetres,
  ignored).
* Monte Mario / Gauss-Boaga fuso Ovest / Est (EPSG 3003 / 3004, datum Roma 1940, ellipsoid
  Internazionale 1924) — transverse Mercator inverse, then a 7-parameter Helmert datum shift
  ROMA40 → WGS84 with the values PROJ/EPSG commonly use for the Italian mainland
  (+towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68, position-vector convention).
  **Accuracy: a few metres (typically 1–5 m on the mainland, worse in Sicily and Sardinia)** — the
  official IGM grids (.gsb/.gr1, «Verto») are needed for sub-metre accuracy. Adequate for zoning at
  plan scale (1:2 000–1:10 000), not for cadastral boundaries.
* ED50 / UTM 32–34 (EPSG 23032–23034) — 3-parameter shift -87,-98,-121 (European mean, ~5–10 m).
"""
from __future__ import annotations

import io
import json
import math
import re
import struct
import zipfile
from dataclasses import dataclass
from typing import Any

# ------------------------------------------------------------------ ellipsoids and datums

WGS84 = (6378137.0, 1 / 298.257223563)
GRS80 = (6378137.0, 1 / 298.257222101)
INTL1924 = (6378388.0, 1 / 297.0)

#: Monte Mario (Roma 1940) → WGS84, position-vector Helmert: tx, ty, tz (m), rx, ry, rz (arc-seconds), ds (ppm).
ROMA40_TOWGS84 = (-104.1, -49.1, -9.9, 0.971, -2.917, 0.714, -11.68)
#: ED50 → WGS84, 3-parameter European mean.
ED50_TOWGS84 = (-87.0, -98.0, -121.0, 0.0, 0.0, 0.0, 0.0)


@dataclass(frozen=True)
class Crs:
    name: str
    kind: str                     # 'geographic' | 'tm'
    ellipsoid: tuple[float, float] = WGS84
    lon0: float = 0.0
    lat0: float = 0.0
    k0: float = 0.9996
    x0: float = 500000.0
    y0: float = 0.0
    towgs84: tuple[float, ...] | None = None
    accuracy_m: float = 0.5

    def to_json(self) -> dict:
        return {"name": self.name, "accuracyM": self.accuracy_m, "datumShift": bool(self.towgs84)}


GEO_WGS84 = Crs("WGS84 geografico (EPSG 4326)", "geographic", WGS84, accuracy_m=0.0)


def utm(zone: int, datum: str = "WGS84") -> Crs:
    ell, tow, acc = {"WGS84": (WGS84, None, 0.5), "ETRS89": (GRS80, None, 0.5), "RDN2008": (GRS80, None, 0.5), "ED50": (INTL1924, ED50_TOWGS84, 10.0)}[datum]
    return Crs(f"{datum} / UTM {zone}N", "tm", ell, lon0=zone * 6 - 183, k0=0.9996, x0=500000.0, towgs84=tow, accuracy_m=acc)


GB_OVEST = Crs("Monte Mario / Gauss-Boaga fuso Ovest (EPSG 3003)", "tm", INTL1924, lon0=9.0, k0=0.9996, x0=1500000.0, towgs84=ROMA40_TOWGS84, accuracy_m=5.0)
GB_EST = Crs("Monte Mario / Gauss-Boaga fuso Est (EPSG 3004)", "tm", INTL1924, lon0=15.0, k0=0.9996, x0=2520000.0, towgs84=ROMA40_TOWGS84, accuracy_m=5.0)

EPSG: dict[int, Crs] = {
    4326: GEO_WGS84, 4258: Crs("ETRS89 geografico (EPSG 4258)", "geographic", GRS80), 6706: Crs("RDN2008 geografico (EPSG 6706)", "geographic", GRS80),
    4265: Crs("Monte Mario geografico (EPSG 4265)", "geographic", INTL1924, towgs84=ROMA40_TOWGS84, accuracy_m=5.0),
    3003: GB_OVEST, 3004: GB_EST,
    **{32600 + z: utm(z, "WGS84") for z in (32, 33, 34)},
    **{25800 + z: utm(z, "ETRS89") for z in (32, 33, 34)},
    6707: utm(32, "RDN2008"), 6708: utm(33, "RDN2008"), 6709: utm(34, "RDN2008"),
    **{23000 + z: utm(z, "ED50") for z in (32, 33, 34)},
}


# ------------------------------------------------------------------ transverse Mercator (Snyder, USGS PP 1395)

def _meridian_arc(phi: float, a: float, e2: float) -> float:
    return a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
                + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))


def tm_forward(lon: float, lat: float, crs: Crs) -> tuple[float, float]:
    """Geographic (on the CRS ellipsoid) → projected easting, northing."""
    a, f = crs.ellipsoid
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    phi, lam, lam0 = math.radians(lat), math.radians(lon), math.radians(crs.lon0)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T, C, A = math.tan(phi) ** 2, ep2 * math.cos(phi) ** 2, math.cos(phi) * (lam - lam0)
    M, M0 = _meridian_arc(phi, a, e2), _meridian_arc(math.radians(crs.lat0), a, e2)
    x = crs.x0 + crs.k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120)
    y = crs.y0 + crs.k0 * (M - M0 + N * math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y


def tm_inverse(x: float, y: float, crs: Crs) -> tuple[float, float]:
    """Projected easting, northing → geographic lon, lat (degrees, on the CRS ellipsoid)."""
    a, f = crs.ellipsoid
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    M = _meridian_arc(math.radians(crs.lat0), a, e2) + (y - crs.y0) / crs.k0
    mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    s1, c1, t1 = math.sin(p1), math.cos(p1), math.tan(p1)
    C1, T1 = ep2 * c1 ** 2, t1 ** 2
    N1 = a / math.sqrt(1 - e2 * s1 ** 2)
    R1 = a * (1 - e2) / (1 - e2 * s1 ** 2) ** 1.5
    D = (x - crs.x0) / (N1 * crs.k0)
    phi = p1 - (N1 * t1 / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
                                + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720)
    lam = math.radians(crs.lon0) + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / c1
    return math.degrees(lam), math.degrees(phi)


# ------------------------------------------------------------------ datum shift (Helmert, position vector)

def _to_ecef(lon: float, lat: float, h: float, ell: tuple[float, float]) -> tuple[float, float, float]:
    a, f = ell
    e2 = f * (2 - f)
    phi, lam = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    return ((N + h) * math.cos(phi) * math.cos(lam), (N + h) * math.cos(phi) * math.sin(lam), (N * (1 - e2) + h) * math.sin(phi))


def _from_ecef(X: float, Y: float, Z: float, ell: tuple[float, float]) -> tuple[float, float, float]:
    a, f = ell
    e2 = f * (2 - f)
    lon = math.atan2(Y, X)
    p = math.hypot(X, Y)
    phi = math.atan2(Z, p * (1 - e2))
    h = 0.0
    for _ in range(8):
        N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
        h = p / math.cos(phi) - N
        phi = math.atan2(Z, p * (1 - e2 * N / (N + h)))
    return math.degrees(lon), math.degrees(phi), h


def helmert(X: float, Y: float, Z: float, p: tuple[float, ...], inverse: bool = False) -> tuple[float, float, float]:
    """7-parameter similarity transformation, position-vector convention (EPSG 9606, PROJ towgs84)."""
    sec = math.pi / (180 * 3600)
    sgn = -1.0 if inverse else 1.0
    tx, ty, tz = (sgn * v for v in p[:3])
    rx, ry, rz = (sgn * v * sec for v in p[3:6])
    s = 1 + sgn * p[6] * 1e-6
    return (tx + s * (X - rz * Y + ry * Z), ty + s * (rz * X + Y - rx * Z), tz + s * (-ry * X + rx * Y + Z))


def to_wgs84(x: float, y: float, crs: Crs) -> tuple[float, float]:
    lon, lat = (x, y) if crs.kind == "geographic" else tm_inverse(x, y, crs)
    if not crs.towgs84:
        return lon, lat
    X, Y, Z = _to_ecef(lon, lat, 0.0, crs.ellipsoid)
    lon2, lat2, _ = _from_ecef(*helmert(X, Y, Z, crs.towgs84), WGS84)
    return lon2, lat2


def from_wgs84(lon: float, lat: float, crs: Crs) -> tuple[float, float]:
    """Inverse of :func:`to_wgs84` (the inverse Helmert with negated parameters is exact to the millimetre here)."""
    if crs.towgs84:
        X, Y, Z = _to_ecef(lon, lat, 0.0, WGS84)
        lon, lat, _ = _from_ecef(*helmert(X, Y, Z, crs.towgs84, inverse=True), crs.ellipsoid)
    return (lon, lat) if crs.kind == "geographic" else tm_forward(lon, lat, crs)


# ------------------------------------------------------------------ .prj (ESRI WKT) → Crs

def _param(wkt: str, name: str) -> float | None:
    m = re.search(r'PARAMETER\[\s*"' + name + r'"\s*,\s*([-+0-9.eE]+)', wkt, re.I)
    return float(m.group(1)) if m else None


def crs_from_prj(wkt: str) -> Crs:
    w = wkt.strip()
    up = w.upper().replace(" ", "_")
    m = re.search(r'AUTHORITY\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]\s*$', w, re.I)
    if m and int(m.group(1)) in EPSG:
        return EPSG[int(m.group(1))]
    if "MONTE_MARIO" in up or "ROMA_1940" in up or "ROME_1940" in up or "ROMA40" in up:
        datum, ell, tow, acc = "Monte Mario (Roma 1940)", INTL1924, ROMA40_TOWGS84, 5.0
    elif "EUROPEAN_1950" in up or "ED50" in up or "ED_1950" in up:
        datum, ell, tow, acc = "ED50", INTL1924, ED50_TOWGS84, 10.0
    elif any(k in up for k in ("WGS_1984", "WGS84", "WGS_84", "ETRS_1989", "ETRS89", "ETRF2000", "RDN2008", "RDN_2008", "GRS_1980")):
        datum, ell, tow, acc = "WGS84/ETRS89/RDN2008", GRS80 if ("ETRS" in up or "RDN" in up or "ETRF" in up) else WGS84, None, 0.5
    else:
        raise ValueError("Sistema di riferimento del .prj non riconosciuto: usa WGS84, UTM 32/33/34 (WGS84, ETRS89, RDN2008, ED50) o Gauss-Boaga (Monte Mario)")
    if not up.startswith("PROJCS") and not up.startswith("PROJCRS"):
        return Crs(f"{datum} geografico", "geographic", ell, towgs84=tow, accuracy_m=acc if tow else 0.0)
    if "TRANSVERSE_MERCATOR" not in up and "GAUSS" not in up:
        raise ValueError("Proiezione non supportata: sono ammessi solo UTM e Gauss-Boaga (trasversa di Mercatore)")
    lon0 = _param(w, "central_meridian")
    k0 = _param(w, "scale_factor") or 0.9996
    x0 = _param(w, "false_easting") or 0.0
    y0 = _param(w, "false_northing") or 0.0
    lat0 = _param(w, "latitude_of_origin") or 0.0
    if lon0 is None:
        raise ValueError("Il .prj non indica il meridiano centrale")
    # Gauss-Boaga files sometimes give the central meridian from Monte Mario (12°27'08.4" E of Greenwich).
    if tow is ROMA40_TOWGS84 and abs(lon0 + 3.4523) < 0.01:
        lon0 = 9.0
    elif tow is ROMA40_TOWGS84 and abs(lon0 - 2.5477) < 0.01:
        lon0 = 15.0
    if abs(x0) > 1e9 or not (-30 <= lon0 <= 60):
        raise ValueError("Parametri di proiezione non plausibili")
    name = f"{datum} / TM {lon0:g}° (falsa origine E {x0:,.0f} m)".replace(",", ".")
    return Crs(name, "tm", ell, lon0=lon0, lat0=lat0, k0=k0, x0=x0, y0=y0, towgs84=tow, accuracy_m=acc)


def crs_from_epsg(code: int) -> Crs:
    if code not in EPSG:
        raise ValueError(f"EPSG {code} non supportato: usa 4326, 4258, 6706, 3003, 3004, 32632–32634, 25832–25834, 6707–6709, 23032–23034")
    return EPSG[code]


# ------------------------------------------------------------------ Shapefile + DBF

POLYGON_TYPES = {5, 15, 25}


def read_shp(data: bytes) -> list[list[list[tuple[float, float]]] | None]:
    """Parts (rings) of every record of a Polygon / PolygonZ / PolygonM .shp; None for null shapes."""
    if len(data) < 100:
        raise ValueError("File .shp troppo corto")
    code, = struct.unpack(">i", data[0:4])
    if code != 9994:
        raise ValueError("Non è un file .shp (codice di file errato)")
    length_words, = struct.unpack(">i", data[24:28])
    shape_type, = struct.unpack("<i", data[32:36])
    if shape_type not in POLYGON_TYPES and shape_type != 0:
        raise ValueError(f"Tipo di geometria {shape_type} non supportato: servono poligoni (tipo 5 o 15)")
    end = min(len(data), length_words * 2)
    out: list[list[list[tuple[float, float]]] | None] = []
    pos = 100
    while pos + 8 <= end:
        _num, clen = struct.unpack(">ii", data[pos:pos + 8])
        rec = data[pos + 8:pos + 8 + clen * 2]
        pos += 8 + clen * 2
        if len(rec) < 4:
            break
        st, = struct.unpack("<i", rec[0:4])
        if st == 0:
            out.append(None)
            continue
        if st not in POLYGON_TYPES:
            raise ValueError(f"Record di tipo {st} non supportato")
        nparts, npts = struct.unpack("<ii", rec[36:44])
        parts = list(struct.unpack(f"<{nparts}i", rec[44:44 + 4 * nparts]))
        base = 44 + 4 * nparts
        coords = struct.unpack(f"<{2 * npts}d", rec[base:base + 16 * npts])
        pts = [(coords[2 * i], coords[2 * i + 1]) for i in range(npts)]
        rings = [pts[parts[k]:(parts[k + 1] if k + 1 < nparts else npts)] for k in range(nparts)]
        out.append([r for r in rings if len(r) >= 3])
    return out


def read_dbf(data: bytes, encoding: str = "cp1252") -> tuple[list[str], list[dict[str, Any]]]:
    """Field names and records of a dBASE III/IV table (C, N, F, L, D, I fields)."""
    if len(data) < 32:
        raise ValueError("File .dbf troppo corto")
    nrec, hlen, rlen = struct.unpack("<IHH", data[4:12])
    fields: list[tuple[str, str, int, int]] = []
    pos = 32
    while pos + 32 <= hlen and data[pos] != 0x0D:
        raw = data[pos:pos + 32]
        name = raw[0:11].split(b"\x00", 1)[0].decode("ascii", errors="replace").strip()
        fields.append((name, chr(raw[11]), raw[16], raw[17]))
        pos += 32
    rows: list[dict[str, Any]] = []
    for i in range(nrec):
        start = hlen + i * rlen
        rec = data[start:start + rlen]
        if len(rec) < rlen:
            break
        row: dict[str, Any] = {"__deleted": rec[0:1] == b"*"}
        off = 1
        for name, typ, size, dec in fields:
            raw = rec[off:off + size]
            off += size
            if typ == "I" and size == 4:
                row[name] = struct.unpack("<i", raw)[0]
                continue
            txt = raw.decode(encoding, errors="replace").strip().strip("\x00")
            if typ in ("N", "F"):
                try:
                    v = float(txt) if txt and txt not in ("*" * len(txt),) else None
                    row[name] = int(v) if v is not None and dec == 0 and v.is_integer() else v
                except ValueError:
                    row[name] = None
            elif typ == "L":
                row[name] = True if txt[:1] in ("T", "t", "Y", "y") else False if txt[:1] in ("F", "f", "N", "n") else None
            else:
                row[name] = txt
        rows.append(row)
    return [f[0] for f in fields], rows


def _signed_area(r: list[tuple[float, float]]) -> float:
    return sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r))) / 2


def _in_ring(p: tuple[float, float], r: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(r) - 1
    for i in range(len(r)):
        a, b = r[i], r[j]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / ((b[1] - a[1]) or 1e-12) + a[0]:
            inside = not inside
        j = i
    return inside


def group_rings(rings: list[list[tuple[float, float]]]) -> list[list[list[tuple[float, float]]]]:
    """Shapefile parts → polygons [outer, *holes]: clockwise rings are outers, counter-clockwise rings holes."""
    outers = [r for r in rings if _signed_area(r) < 0]
    holes = [r for r in rings if _signed_area(r) > 0]
    if not outers:  # every ring counter-clockwise: writer ignored the spec, read them as outers
        return [[r] for r in holes]
    polys = [[o] for o in outers]
    for h in holes:
        host = next((p for p in polys if _in_ring(h[0], p[0])), None)
        if host is not None:
            host.append(h)
        else:
            polys.append([list(reversed(h))])
    return polys


def _strip_closing(r: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return r[:-1] if len(r) > 1 and r[0] == r[-1] else r


@dataclass
class ParsedLayer:
    format: str
    crs: Crs
    fields: list[str]
    #: (polygons in WGS84 [[outer, *holes]], properties)
    features: list[tuple[list[list[list[tuple[float, float]]]], dict[str, Any]]]


def _transform_polys(polys: list[list[list[tuple[float, float]]]], crs: Crs) -> list[list[list[tuple[float, float]]]]:
    out = []
    for poly in polys:
        rings = []
        for ring in poly:
            pts = [to_wgs84(x, y, crs) for x, y in _strip_closing(ring)]
            rings.append([(round(lon, 7), round(lat, 7)) for lon, lat in pts])
        out.append(rings)
    return out


def _check_plausible(layer: ParsedLayer) -> None:
    for polys, _ in layer.features[:50]:
        for lon, lat in polys[0][0][:3]:
            if not (-30 <= lon <= 60 and 25 <= lat <= 75):
                raise ValueError(f"Coordinate fuori dall'Europa dopo la conversione ({lon:.3f}, {lat:.3f}): il sistema di riferimento ({layer.crs.name}) non è quello del file")


def parse_shapefile_zip(data: bytes, epsg: int | None = None) -> ParsedLayer:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("Archivio .zip non valido") from exc
    names = [n for n in zf.namelist() if not n.endswith("/") and "__MACOSX" not in n]
    shp = sorted(n for n in names if n.lower().endswith(".shp"))
    if not shp:
        raise ValueError("Nello .zip manca il file .shp")
    base = shp[0][:-4]

    def member(ext: str) -> bytes | None:
        hit = next((n for n in names if n.lower() == (base + ext).lower()), None)
        return zf.read(hit) if hit else None

    dbf = member(".dbf")
    if dbf is None:
        raise ValueError("Nello .zip manca il file .dbf con gli attributi")
    prj, cpg = member(".prj"), member(".cpg")
    if epsg:
        crs = crs_from_epsg(epsg)
    elif prj:
        crs = crs_from_prj(prj.decode("latin-1"))
    else:
        raise ValueError("Manca il file .prj: indica il sistema di riferimento (EPSG)")
    enc = "cp1252"
    if cpg:
        c = cpg.decode("ascii", errors="ignore").strip().lower()
        enc = "utf-8" if "utf" in c and "8" in c else c if c.startswith(("cp", "iso", "latin")) else "cp1252"
    shapes = read_shp(zf.read(shp[0]))
    fields, rows = read_dbf(dbf, enc)
    feats = []
    for i, rings in enumerate(shapes):
        if not rings or i >= len(rows) or rows[i].get("__deleted"):
            continue
        props = {k: v for k, v in rows[i].items() if k != "__deleted"}
        feats.append((_transform_polys(group_rings(rings), crs), props))
    layer = ParsedLayer("shapefile", crs, fields, feats)
    _check_plausible(layer)
    return layer


def parse_geojson(data: bytes, epsg: int | None = None) -> ParsedLayer:
    try:
        gj = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("GeoJSON non leggibile") from exc
    if gj.get("type") == "Feature":
        gj = {"type": "FeatureCollection", "features": [gj]}
    if gj.get("type") != "FeatureCollection":
        raise ValueError("Serve una FeatureCollection GeoJSON")
    code = epsg
    if not code:
        name = str(((gj.get("crs") or {}).get("properties") or {}).get("name") or "")
        m = re.search(r"EPSG:*(\d+)", name)
        code = int(m.group(1)) if m else 4326
    crs = crs_from_epsg(code)
    fields: list[str] = []
    feats = []
    for ft in gj.get("features") or []:
        g = ft.get("geometry") or {}
        props = ft.get("properties") or {}
        for k in props:
            if k not in fields:
                fields.append(k)
        if g.get("type") == "Polygon":
            polys = [g.get("coordinates") or []]
        elif g.get("type") == "MultiPolygon":
            polys = g.get("coordinates") or []
        else:
            continue
        polys = [[[(float(p[0]), float(p[1])) for p in ring] for ring in poly if len(ring) >= 4] for poly in polys]
        polys = [p for p in polys if p]
        if polys:
            feats.append((_transform_polys(polys, crs), props))
    layer = ParsedLayer("geojson", crs, fields, feats)
    _check_plausible(layer)
    return layer


def parse_upload(data: bytes, filename: str, epsg: int | None = None) -> ParsedLayer:
    low = filename.lower()
    if low.endswith(".zip"):
        return parse_shapefile_zip(data, epsg)
    if low.endswith((".geojson", ".json")):
        return parse_geojson(data, epsg)
    raise ValueError("Formato non supportato: carica uno Shapefile compresso (.zip) o un GeoJSON")


# ------------------------------------------------------------------ mapping to the urbanplan document

#: Indicative rules per DM 1444 class (mirror of packages/core DEFAULT_RULES), replaced by the NTA values.
DEFAULT_RULES: dict[str, dict] = {
    "A": {"maxIndexFondiario": 5, "maxCoverage": 70, "maxHeight": 14, "minDistanceM": 10, "uses": ["residenziale", "commerciale", "servizi"]},
    "B": {"maxIndexFondiario": 3, "maxCoverage": 50, "maxHeight": 13, "minDistanceM": 10, "uses": ["residenziale", "commerciale", "servizi"]},
    "C": {"maxIndexFondiario": 1.5, "maxCoverage": 30, "maxHeight": 10.5, "minDistanceM": 10, "uses": ["residenziale"]},
    "D": {"maxIndexFondiario": 3, "maxCoverage": 50, "maxHeight": 12, "minDistanceM": 10, "uses": ["produttivo", "artigianale", "commerciale"]},
    "E": {"maxIndexFondiario": 0.03, "maxCoverage": 5, "maxHeight": 7.5, "minDistanceM": 20, "uses": ["agricolo", "residenza agricola"]},
    "F": {"maxCoverage": 40, "maxHeight": 12, "uses": ["attrezzature pubbliche"]},
}
CONSTRAINT_TYPES = ("paesaggistico", "idrogeologico", "rispetto_stradale", "cimiteriale", "ferroviario", "altro")
_CODE_RE = re.compile(r"(?:^|[^a-z])([a-f])(?=[\d\s._\-/]|$)", re.I)


def dm1444_from(value: Any) -> str | None:
    s = str(value or "").strip()
    if len(s) == 1 and s.upper() in "ABCDEF":
        return s.upper()
    m = _CODE_RE.search(s)
    return m.group(1).upper() if m else None


def constraint_type_from(value: Any, default: str) -> str:
    s = str(value or "").lower()
    for keys, t in ((("paesagg", "42/2004", "galasso", "bellezz"), "paesaggistico"), (("idrogeo", "pai", "frana", "idraul", "esondaz"), "idrogeologico"),
                    (("strad", "cds"), "rispetto_stradale"), (("cimit",), "cimiteriale"), (("ferrov", "rfi"), "ferroviario")):
        if any(k in s for k in keys):
            return t
    return default


_SUGGEST = {
    "codeField": ("zona", "zto", "sigla", "codice", "cod_zona", "zone", "code", "cod"),
    "classField": ("dm1444", "dm_1444", "classe", "zto_dm", "tipo_zona", "zona_omog", "categoria"),
    "nameField": ("nome", "descr", "descrizione", "denominaz", "name", "legenda"),
    "typeField": ("vincolo", "tipo", "tipologia", "type"),
}


def suggest_mapping(fields: list[str]) -> dict[str, str | None]:
    low = {f.lower(): f for f in fields}
    out: dict[str, str | None] = {}
    for key, cands in _SUGGEST.items():
        out[key] = next((low[c] for c in cands if c in low), None) or next((f for f in fields if any(f.lower().startswith(c) for c in cands)), None)
    return out


def _bbox_hit(polys: list, bbox: list[float] | None, margin: float = 0.03) -> bool:
    if not bbox:
        return True
    w, s, e, n = bbox
    pts = [p for poly in polys for p in poly[0]]
    return not (max(p[0] for p in pts) < w - margin or min(p[0] for p in pts) > e + margin or max(p[1] for p in pts) < s - margin or min(p[1] for p in pts) > n + margin)


def _num(v: Any) -> float | None:
    try:
        x = float(str(v).replace(",", "."))
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def preview(layer: ParsedLayer, bbox: list[float] | None, opts: dict) -> dict:
    mapping = {**suggest_mapping(layer.fields), **{k: v for k, v in opts.items() if v}}
    classes: dict[str, int] = {}
    for _, props in layer.features:
        c = dm1444_from(props.get(mapping.get("classField") or "")) or dm1444_from(props.get(mapping.get("codeField") or "")) or "?"
        classes[c] = classes.get(c, 0) + 1
    inside = sum(1 for polys, _ in layer.features if _bbox_hit(polys, bbox))
    return {
        "format": layer.format, "crs": layer.crs.to_json(), "count": len(layer.features), "insideProject": inside, "fields": layer.fields,
        "sample": [{k: v for k, v in props.items()} for _, props in layer.features[:6]], "suggested": mapping, "classes": classes,
    }


def to_plan_items(layer: ParsedLayer, bbox: list[float] | None, opts: dict, id_prefix: str) -> tuple[list[dict], list[dict], int]:
    """Maps the parsed features to plan zones or constraints (one item per polygon of a multipolygon)."""
    target = opts.get("target") or "zones"
    code_f, class_f, name_f, type_f = opts.get("codeField"), opts.get("classField"), opts.get("nameField"), opts.get("typeField")
    idx_f, cov_f, h_f = opts.get("indexField"), opts.get("coverageField"), opts.get("heightField")
    default_class = (opts.get("defaultClass") or "").upper() or None
    default_type = opts.get("constraintType") if opts.get("constraintType") in CONSTRAINT_TYPES else "altro"
    source = opts.get("source") or "Import"
    zones: list[dict] = []
    cons: list[dict] = []
    skipped = 0
    n = 0
    for polys, props in layer.features:
        if not _bbox_hit(polys, bbox):
            skipped += 1
            continue
        code = str(props.get(code_f) if code_f else "" or "").strip()
        name = str(props.get(name_f) if name_f else "" or "").strip()
        for k, poly in enumerate(polys):
            n += 1
            ring = [list(p) for p in poly[0]]
            holes = [[list(p) for p in h] for h in poly[1:] if len(h) >= 3]
            if len(ring) < 3:
                continue
            suffix = f" ({k + 1})" if len(polys) > 1 else ""
            if target == "constraints":
                t = constraint_type_from(props.get(type_f), default_type) if type_f else default_type
                cons.append({"id": f"{id_prefix}-{n}", "type": t, "name": (name or code or t) + suffix, "polygon": ring, **({"holes": holes} if holes else {}),
                             "note": "; ".join(f"{a}: {b}" for a, b in list(props.items())[:6] if b not in (None, "")), "source": source})
                continue
            cls = dm1444_from(props.get(class_f)) if class_f else None
            cls = cls or dm1444_from(code) or default_class
            if cls not in DEFAULT_RULES:
                skipped += 1
                continue
            rules = dict(DEFAULT_RULES[cls])
            for key, field in (("maxIndexFondiario", idx_f), ("maxCoverage", cov_f), ("maxHeight", h_f)):
                v = _num(props.get(field)) if field else None
                if v is not None:
                    rules[key] = v
            zones.append({"id": f"{id_prefix}-{n}", "code": code or cls, "dm1444": cls, "name": name + suffix if name else suffix.strip(), "polygon": ring,
                          **({"holes": holes} if holes else {}), "rules": rules, "source": source})
    return zones, cons, skipped


def import_into(doc: dict | None, layer: ParsedLayer, bbox: list[float] | None, opts: dict, id_prefix: str, at: str) -> tuple[dict, dict]:
    doc = dict(doc or {})
    zones, cons, skipped = to_plan_items(layer, bbox, opts, id_prefix)
    replace = bool(opts.get("replace"))
    if opts.get("target") == "constraints":
        doc["constraints"] = ([] if replace else list(doc.get("constraints") or [])) + cons
        doc.setdefault("zones", [])
    else:
        doc["zones"] = ([] if replace else list(doc.get("zones") or [])) + zones
        doc.setdefault("constraints", [])
    src = f"{opts.get('source') or 'Import'} · {layer.crs.name}"
    doc["sources"] = [*(s for s in (doc.get("sources") or []) if s != src), src]
    doc["updatedAt"] = at
    return doc, {"zones": len(zones), "constraints": len(cons), "skipped": skipped, "crs": layer.crs.to_json(), "format": layer.format}
