"""Detailed procedural models for the street-furniture catalogue.

Rewrites the ``model`` (and ``dims``) of every item in packages/assets/furniture/catalog.json from the
definitions below; labels, categories and special fields (signal, led, …) are kept. Run from the repo root:

    python tools/furniture/build_models.py

Part conventions (see apps/web/src/models/parts.ts): metres, x east / y north / z up; box/cylinder/cone/
frustum without ``rot`` are placed by the centre of their base, with ``rot`` (degrees, X→Y→Z) by their centre;
spheres and ellipsoids by their centre. Dimensions follow common Italian street furniture (UNI EN 1176,
UNI 11248 lighting poles, DM 10/7/2002 signals, typical manufacturers' sheets) at catalogue precision.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

CATALOG = Path(__file__).resolve().parents[2] / "packages/assets/furniture/catalog.json"


def box(x, y, z, sx, sy, sz, mat, rot=None):
    p = {"shape": "box", "size": [r(sx), r(sy), r(sz)], "at": [r(x), r(y), r(z)], "mat": mat}
    if rot:
        p["rot"] = [r(a) for a in rot]
    return p


def cyl(x, y, z, rad, h, mat, r2=None, rot=None):
    p = {"shape": "cylinder" if r2 is None else "frustum", "r": r(rad), "h": r(h), "at": [r(x), r(y), r(z)], "mat": mat}
    if r2 is not None:
        p["r2"] = r(r2)
    if rot:
        p["rot"] = [r(a) for a in rot]
    return p


def cone(x, y, z, rad, h, mat):
    return {"shape": "cone", "r": r(rad), "h": r(h), "at": [r(x), r(y), r(z)], "mat": mat}


def sph(x, y, z, rad, mat):
    return {"shape": "sphere", "r": r(rad), "at": [r(x), r(y), r(z)], "mat": mat}


def ell(x, y, z, rx, ry, rz, mat, rot=None):
    p = {"shape": "ellipsoid", "size": [r(rx), r(ry), r(rz)], "at": [r(x), r(y), r(z)], "mat": mat}
    if rot:
        p["rot"] = [r(a) for a in rot]
    return p


def r(v):
    return round(float(v), 3)


def bar(a, b, rad, mat):
    """Cylinder between two points (centre + rotation)."""
    dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    # Local cylinder axis is z: tilt about y by the polar angle, then turn about z by the azimuth.
    tilt = math.degrees(math.acos(max(-1.0, min(1.0, dz / length)))) if length else 0
    az = math.degrees(math.atan2(dy, dx))
    return cyl((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, rad, length, mat, rot=[0, tilt, az])


def beam(a, b, sy, sz, mat):
    """Box between two points in the xz or xy plane (length along the segment)."""
    dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    pitch = -math.degrees(math.atan2(dz, math.hypot(dx, dy)))
    az = math.degrees(math.atan2(dy, dx))
    return box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, length, sy, sz, mat, rot=[0, pitch, az])


# ------------------------------------------------------------------ vegetation

def tree(h=9.0, crown=3.0, trunk=0.18, mat="foliage"):
    t = h - crown * 2
    return [
        cyl(0, 0, 0, trunk * 1.35, 0.25, "bark", r2=trunk),  # root flare
        cyl(0, 0, 0.25, trunk, t - 0.25 + crown * 0.4, "bark", r2=trunk * 0.7),
        bar((0, 0, t * 0.85), (crown * 0.45, 0.2, t + crown * 0.5), trunk * 0.45, "bark"),
        bar((0, 0, t * 0.9), (-crown * 0.35, -crown * 0.3, t + crown * 0.6), trunk * 0.4, "bark"),
        ell(0, 0, t + crown, crown, crown * 0.95, crown * 0.92, mat),
        ell(crown * 0.45, crown * 0.2, t + crown * 0.85, crown * 0.62, crown * 0.6, crown * 0.55, mat),
        ell(-crown * 0.4, -crown * 0.35, t + crown * 1.05, crown * 0.6, crown * 0.58, crown * 0.55, "foliage_dark"),
        ell(0.1, -0.2, t + crown * 1.55, crown * 0.6, crown * 0.6, crown * 0.45, mat),
        box(0, 0, -0.02, 1.4, 1.4, 0.04, "tree_pit"),  # grate/pit flush with the pavement
    ]


def palm():
    m = [cyl(0, 0, 0, 0.26, 0.3, "bark", r2=0.2), cyl(0, 0, 0.3, 0.2, 6.8, "bark", r2=0.16)]
    for i in range(9):
        a = i * 40
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        m.append(ell(ca * 1.1, sa * 1.1, 6.9 - (i % 3) * 0.15, 1.35, 0.32, 0.08, "foliage", rot=[0, 18 + (i % 3) * 8, a]))
    m.append(sph(0, 0, 7.05, 0.35, "foliage_dark"))
    return m


def shrub():
    return [ell(0, 0, 0.45, 0.6, 0.55, 0.45, "foliage"), ell(0.25, 0.15, 0.6, 0.38, 0.35, 0.32, "foliage_dark"), ell(-0.22, -0.18, 0.55, 0.36, 0.34, 0.3, "foliage")]


# ------------------------------------------------------------------ seating

def bench():
    m = []
    for x in (-0.75, 0.75):  # cast-iron side frames: leg, seat support, back support
        m += [box(x, 0.12, 0, 0.07, 0.07, 0.43, "cast_iron"), box(x, -0.18, 0, 0.07, 0.07, 0.43, "cast_iron"),
              box(x, -0.03, 0.4, 0.07, 0.5, 0.05, "cast_iron"), beam((x, -0.25, 0.42), (x, -0.3, 0.82), 0.07, 0.05, "cast_iron"),
              box(x, 0.1, 0.62, 0.07, 0.42, 0.04, "cast_iron")]
    for i in range(4):  # seat slats
        m.append(box(0, 0.2 - i * 0.12, 0.45, 1.8, 0.09, 0.035, "wood"))
    for x in (-0.78, 0.78):  # armrests (DM 236/1989: help to stand up)
        m += [box(x, 0.0, 0.62, 0.06, 0.5, 0.04, "cast_iron"), box(x, 0.2, 0.45, 0.05, 0.05, 0.18, "cast_iron")]
    for i in range(3):  # backrest slats, slightly reclined
        z = 0.56 + i * 0.1
        m.append(box(0, -0.25 - (z - 0.5) * 0.12, z, 1.8, 0.035, 0.08, "wood", rot=[-12, 0, 0]))
    return m


def seat_module():
    return [box(0, 0, 0, 1.2, 0.6, 0.1, "concrete_exposed"), box(0, 0, 0.1, 1.1, 0.5, 0.28, "concrete"),
            *[box(0, 0.24 - i * 0.12, 0.38, 1.2, 0.1, 0.05, "wood") for i in range(5)]]


def outdoor_seating():
    m = [box(0, 0, 0, 3.0, 2.0, 0.05, "wood")]  # deck
    for x in (-0.75, 0.75):
        m += [cyl(x, 0, 0.05, 0.04, 0.7, "steel_dark"), cyl(x, 0, 0.75, 0.4, 0.03, "wood"),
              cyl(x, 0, 0.78, 0.025, 1.4, "steel"), cone(x, 0, 2.05, 1.0, 0.35, "slab_light")]
        for dy in (-0.6, 0.6):
            m += [box(x, dy, 0.05, 0.42, 0.42, 0.4, "steel_dark"), box(x, dy + (0.2 if dy > 0 else -0.2), 0.45, 0.42, 0.04, 0.4, "steel_dark")]
    return m


def play():
    m = [box(0, 0, 0, 3.0, 2.0, 0.04, "rubber")]
    for x in (-1.2, 0.2):
        for y in (-0.5, 0.5):
            m.append(cyl(x, y, 0.04, 0.05, 1.6, "wood"))
    m += [box(-0.5, 0, 1.0, 1.5, 1.1, 0.06, "wood"), cone(-0.5, 0, 1.64, 0.95, 0.75, "plastic_red"),
          beam((0.2, 0.0, 1.0), (1.4, 0.0, 0.1), 0.6, 0.05, "steel"),
          bar((-1.4, -0.9, 0.04), (-1.4, -0.9, 2.0), 0.04, "steel_dark"), bar((-1.4, 0.9, 0.04), (-1.4, 0.9, 2.0), 0.04, "steel_dark"),
          bar((-1.4, -0.9, 2.0), (-1.4, 0.9, 2.0), 0.04, "steel_dark"), box(-1.4, 0, 0.45, 0.25, 0.45, 0.05, "rubber")]
    return m


# ------------------------------------------------------------------ lighting

def light_pole():
    return [
        box(0, 0, 0, 0.36, 0.36, 0.08, "concrete"),
        cyl(0, 0, 0.08, 0.11, 0.9, "steel_dark", r2=0.09),
        box(0, 0.1, 0.45, 0.08, 0.02, 0.25, "steel"),  # inspection door
        cyl(0, 0, 0.98, 0.09, 6.9, "steel", r2=0.06),
        bar((0, 0, 7.75), (0, 1.1, 7.95), 0.035, "steel"),
        box(0, 1.25, 7.92, 0.3, 0.62, 0.08, "steel_dark", rot=[4, 0, 0]),
        box(0, 1.25, 7.87, 0.24, 0.5, 0.02, "led_warm", rot=[4, 0, 0]),
    ]


def light_pedestrian():
    return [
        cyl(0, 0, 0, 0.12, 0.35, "cast_iron", r2=0.08),
        cyl(0, 0, 0.35, 0.065, 3.4, "cast_iron", r2=0.05),
        cyl(0, 0, 3.75, 0.09, 0.12, "cast_iron"),
        cyl(0, 0, 3.87, 0.11, 0.42, "glass", r2=0.17),
        cone(0, 0, 4.29, 0.24, 0.2, "cast_iron"),
        sph(0, 0, 4.5, 0.04, "cast_iron"),
    ]


def smart_pole():
    return [
        box(0, 0, 0, 0.4, 0.4, 0.08, "concrete"),
        cyl(0, 0, 0.08, 0.13, 1.2, "steel_dark"),
        box(0, 0.13, 0.5, 0.18, 0.02, 0.5, "display"),  # EV/info module
        cyl(0, 0, 1.28, 0.1, 6.4, "steel_dark", r2=0.075),
        cyl(0, 0, 4.6, 0.11, 0.35, "steel"),  # camera / sensor ring
        sph(0, 0.12, 4.75, 0.07, "glass"),
        beam((0, 0, 7.6), (0, 1.15, 7.7), 0.08, 0.06, "steel_dark"),
        box(0, 1.2, 7.66, 0.26, 0.55, 0.06, "steel_dark"),
        box(0, 1.2, 7.62, 0.2, 0.45, 0.02, "glass"),
    ]


# ------------------------------------------------------------------ safety

def bollard():
    return [cyl(0, 0, 0, 0.1, 0.82, "cast_iron", r2=0.085), cyl(0, 0, 0.62, 0.092, 0.06, "reflective_white"), cyl(0, 0, 0.5, 0.094, 0.04, "reflective_white"),
            cyl(0, 0, 0.82, 0.07, 0.04, "cast_iron"), sph(0, 0, 0.86, 0.06, "cast_iron")]


def fence():
    m = [box(-0.98, 0, 0, 0.05, 0.05, 1.0, "steel_dark"), box(0.98, 0, 0, 0.05, 0.05, 1.0, "steel_dark"),
         box(0, 0, 0.92, 2.0, 0.04, 0.04, "steel_dark"), box(0, 0, 0.12, 2.0, 0.04, 0.04, "steel_dark")]
    for i in range(13):
        m.append(cyl(-0.9 + i * 0.15, 0, 0.14, 0.009, 0.78, "steel_dark"))
    return m


def barrier():
    return [box(-0.9, 0, 0, 0.08, 0.45, 1.0, "plastic_red"), box(0.9, 0, 0, 0.08, 0.45, 1.0, "plastic_red"),
            box(0, 0, 0.7, 1.9, 0.06, 0.25, "plastic_red"), box(0, 0, 0.72, 0.4, 0.065, 0.2, "road_marking_white"),
            box(-0.6, 0, 0.72, 0.3, 0.065, 0.2, "road_marking_white"), box(0.6, 0, 0.72, 0.3, 0.065, 0.2, "road_marking_white")]


def guardrail():
    m = []
    for x in (-1.5, 0.5):
        m += [box(x, -0.1, 0, 0.12, 0.08, 0.75, "steel"), box(x, 0, 0.45, 0.06, 0.18, 0.22, "steel")]
    m += [box(0, 0.09, 0.48, 4.0, 0.06, 0.31, "steel"), box(0, 0.12, 0.52, 4.0, 0.02, 0.1, "steel_dark")]
    return m


def jersey():
    return [box(0, 0, 0, 2.0, 0.6, 0.08, "concrete"), box(0, 0, 0.08, 2.0, 0.5, 0.2, "concrete"),
            box(0, 0, 0.28, 2.0, 0.3, 0.32, "concrete"), box(0, 0, 0.6, 2.0, 0.17, 0.2, "concrete"),
            box(0, 0.09, 0.62, 0.3, 0.005, 0.12, "road_marking_white")]


# ------------------------------------------------------------------ transit

def bus_shelter(green=False):
    roof_mat = "foliage" if green else "steel_dark"
    m = []
    for x in (-1.9, 0, 1.9):
        m.append(box(x, -0.7, 0, 0.08, 0.08, 2.45, "steel_dark"))
    m += [
        box(0, -0.72, 0.15, 3.7, 0.02, 2.2, "glass"),  # back glazing
        box(-1.95, -0.25, 0.15, 0.02, 0.85, 2.2, "glass"),  # side glazing
        box(1.95, -0.25, 0.4, 0.04, 0.9, 1.8, "display"),  # advertising/info panel (light box)
        box(0, -0.1, 2.45, 4.0, 1.6, 0.12, roof_mat),
        box(0, 0.68, 2.4, 4.0, 0.06, 0.18, "steel_dark"),
        box(-0.6, -0.5, 0.45, 1.6, 0.3, 0.05, "wood"),  # bench
        box(-1.2, -0.5, 0, 0.06, 0.25, 0.45, "steel_dark"), box(0, -0.5, 0, 0.06, 0.25, 0.45, "steel_dark"),
        box(0.9, 0.62, 2.0, 0.6, 0.04, 0.3, "sign_blue"),  # stop name board
        box(0.95, -0.66, 0.3, 0.9, 0.02, 1.7, "slab_light"),  # lit timetable / city map panel
        cyl(2.3, 0.5, 0, 0.05, 0.9, "steel_dark"), cyl(2.3, 0.5, 0.4, 0.2, 0.55, "steel_dark", r2=0.21),  # bin
        box(0, -0.1, 2.57, 4.04, 1.64, 0.02, "steel"),  # roof edge
    ]
    if green:
        m += [ell(-1.0, -0.1, 2.62, 0.9, 0.7, 0.12, "foliage_dark"), ell(0.9, -0.1, 2.62, 0.95, 0.7, 0.13, "foliage")]
    return m


def transit_display():
    return [box(-0.28, 0, 0, 0.08, 0.12, 2.4, "steel_dark"), box(0.28, 0, 0, 0.08, 0.12, 2.4, "steel_dark"),
            box(0, 0, 1.55, 0.7, 0.16, 0.7, "steel_dark"), box(0, 0.085, 1.6, 0.6, 0.01, 0.6, "display"),
            box(0, 0, 2.3, 0.75, 0.2, 0.06, "steel_dark")]


def transit_stop():
    return [cyl(0, 0, 0, 0.04, 2.6, "steel"), box(0, 0, 2.05, 0.4, 0.04, 0.5, "sign_blue"),
            box(0, 0.021, 2.15, 0.3, 0.005, 0.12, "road_marking_white"), box(0, 0.03, 1.3, 0.3, 0.04, 0.4, "slab_light")]


# ------------------------------------------------------------------ mobility

def bike_rack():
    m = [box(0, 0, 0, 2.5, 0.12, 0.04, "steel_dark")]
    for i in range(4):  # Sheffield hoops
        x = -0.9 + i * 0.6
        m += [bar((x, -0.3, 0.02), (x, -0.3, 0.68), 0.024, "steel"), bar((x, 0.3, 0.02), (x, 0.3, 0.68), 0.024, "steel"),
              bar((x, -0.3, 0.68), (x, -0.18, 0.78), 0.024, "steel"), bar((x, 0.3, 0.68), (x, 0.18, 0.78), 0.024, "steel"),
              bar((x, -0.18, 0.78), (x, 0.18, 0.78), 0.024, "steel")]
    return m


def bike_station():
    m = [box(0, 0, 0, 6.0, 1.2, 0.05, "concrete"), box(-2.6, 0, 0.05, 0.5, 0.35, 1.35, "steel_dark"),
         box(-2.6, 0.18, 0.75, 0.38, 0.01, 0.45, "display")]
    for i in range(8):
        x = -1.9 + i * 0.6
        m += [box(x, -0.35, 0.05, 0.14, 0.2, 0.75, "steel"), box(x, -0.2, 0.55, 0.1, 0.12, 0.08, "sign_blue"),
              ell(x, 0.15, 0.45, 0.08, 0.55, 0.32, "steel_dark")]  # docked bike silhouette
    return m


def ev_charger():
    return [box(0, 0, 0, 0.5, 0.35, 0.08, "concrete"), box(0, 0, 0.08, 0.42, 0.26, 1.32, "steel"),
            box(0, 0.135, 0.95, 0.24, 0.01, 0.2, "display"), box(0, 0.12, 1.4, 0.44, 0.04, 0.06, "asphalt_green"),
            cyl(-0.12, 0.15, 0.7, 0.04, 0.14, "signal_housing", rot=[90, 0, 0]), cyl(0.12, 0.15, 0.7, 0.04, 0.14, "signal_housing", rot=[90, 0, 0])]


def parking_meter():
    return [box(0, 0, 0, 0.36, 0.26, 0.06, "concrete"), box(0, 0, 0.06, 0.3, 0.2, 1.2, "steel_dark"),
            box(0, 0, 1.26, 0.34, 0.24, 0.3, "steel_dark", ), box(0, 0.11, 1.35, 0.2, 0.01, 0.14, "display"),
            box(0, 0.105, 1.0, 0.14, 0.01, 0.08, "steel"), box(0, 0, 1.56, 0.4, 0.3, 0.04, "sign_blue")]


# ------------------------------------------------------------------ utility

def hydrant():
    return [cyl(0, 0, 0, 0.16, 0.08, "plastic_red"), cyl(0, 0, 0.08, 0.11, 0.6, "plastic_red"),
            cyl(0, 0, 0.68, 0.13, 0.06, "plastic_red"), sph(0, 0, 0.74, 0.11, "plastic_red"), cyl(0, 0, 0.84, 0.03, 0.06, "plastic_red"),
            cyl(0.15, 0, 0.45, 0.05, 0.12, "steel", rot=[0, 90, 0]), cyl(-0.15, 0, 0.45, 0.05, 0.12, "steel", rot=[0, 90, 0]),
            cyl(0, 0.15, 0.4, 0.065, 0.12, "steel", rot=[90, 0, 0])]


def storm_inlet():
    m = [box(0, 0, -0.02, 0.6, 0.4, 0.03, "cast_iron")]
    for i in range(6):
        m.append(box(-0.25 + i * 0.1, 0, 0.005, 0.04, 0.34, 0.012, "steel_dark"))
    return m


def bin_():
    return [cyl(0, 0, 0, 0.07, 0.9, "steel_dark"), cyl(0, 0, 0.25, 0.23, 0.68, "steel_dark", r2=0.25),
            cyl(0, 0, 0.93, 0.25, 0.04, "steel"), cone(0, 0, 0.97, 0.25, 0.06, "steel_dark")]


def drinking_fountain():
    return [box(0, 0, 0, 0.44, 0.44, 0.08, "granite"), cyl(0, 0, 0.08, 0.17, 0.85, "cast_iron", r2=0.13),
            cyl(0, 0, 0.93, 0.16, 0.08, "cast_iron"), sph(0, 0, 1.05, 0.06, "cast_iron"),
            bar((0, 0.12, 0.75), (0, 0.3, 0.72), 0.02, "steel"), cyl(0, 0.3, 0.0, 0.18, 0.05, "cast_iron")]


def planter(w=1.0, d=1.0):
    return [box(0, 0, 0, w, d, 0.55, "corten"), box(0, 0, 0.5, w - 0.08, d - 0.08, 0.05, "soil"),
            *([ell(0, 0, 0.75, w * 0.42, d * 0.42, 0.3, "foliage"), ell(w * 0.15, -d * 0.1, 0.9, w * 0.25, d * 0.25, 0.22, "foliage_dark")]
              if w == d else [ell(-w * 0.25, 0, 0.75, w * 0.24, d * 0.38, 0.28, "foliage"), ell(w * 0.2, 0, 0.78, w * 0.26, d * 0.38, 0.3, "foliage_dark")])]


def fountain():
    return [cyl(0, 0, 0, 2.0, 0.45, "travertine"), cyl(0, 0, 0.35, 1.85, 0.08, "water"),
            cyl(0, 0, 0.45, 0.35, 0.5, "travertine", r2=0.22), cyl(0, 0, 0.95, 0.75, 0.12, "travertine", r2=0.8),
            cyl(0, 0, 1.0, 0.68, 0.06, "water"), cone(0, 0, 1.07, 0.12, 0.13, "travertine")]


def info_board():
    return [box(-0.55, 0, 0, 0.08, 0.1, 2.2, "steel_dark"), box(0.55, 0, 0, 0.08, 0.1, 2.2, "steel_dark"),
            box(0, 0, 0.8, 1.1, 0.08, 1.2, "steel_dark"), box(0, 0.045, 0.85, 1.0, 0.01, 1.1, "slab_light"),
            box(0, 0, 2.05, 1.25, 0.15, 0.08, "steel_dark")]


def kiosk():
    return [box(0, 0, 0, 3.0, 2.5, 0.12, "concrete"), box(0, -0.1, 0.12, 2.8, 2.2, 2.55, "wood"),
            box(0, 1.02, 1.0, 2.2, 0.04, 1.2, "glass"), box(0, 1.1, 0.9, 2.4, 0.4, 0.06, "wood"),
            box(0, 0, 2.67, 3.2, 2.7, 0.15, "steel_dark"), box(0, 1.36, 2.55, 3.2, 0.04, 0.3, "corten")]


# ------------------------------------------------------------------ signals and traffic

def signal(heads=3, h=3.4, ped=False):
    m = [cyl(0, 0, 0, 0.08, 0.15, "steel_dark", r2=0.06), cyl(0, 0, 0.15, 0.055, h - 0.15, "steel")]
    top = h - 0.05
    m.append(box(0, 0.08, top - 0.32 * heads - 0.1, 0.3 if not ped else 0.28, 0.2, 0.32 * heads + 0.1, "signal_housing"))
    lenses = ["lens_red", "lens_amber", "lens_green"] if heads == 3 else ["lens_red", "lens_green"]
    for i in range(heads):
        z = top - 0.2 - i * 0.32
        m += [cyl(0, 0.19, z - 0.11, 0.1, 0.04, lenses[i], rot=[90, 0, 0]), box(0, 0.24, z + 0.02, 0.24, 0.1, 0.02, "signal_housing", rot=[20, 0, 0])]
    m.append(box(0, 0.09, 1.0, 0.12, 0.1, 0.16, "sign_blue"))  # pedestrian push-button box
    m.append(box(0, 0.04, top - 0.32 * heads - 0.12, 0.42, 0.02, 0.32 * heads + 0.14, "signal_housing"))  # backplate
    return m


def ztl_gate():
    return [box(0, 0, 0, 0.4, 0.4, 0.08, "concrete"), cyl(0, 0, 0.08, 0.1, 4.1, "steel_dark"),
            box(0, 0.1, 2.9, 1.5, 0.18, 0.8, "display"), box(0, 0.1, 3.72, 1.55, 0.2, 0.06, "steel_dark"),
            box(0.45, 0.15, 3.95, 0.28, 0.16, 0.16, "steel"), cyl(0.45, 0.25, 4.03, 0.05, 0.06, "glass", rot=[90, 0, 0]),
            box(0, 0.12, 1.9, 0.6, 0.03, 0.6, "sign_blue")]


def ztl_led():
    return [cyl(0, 0, 0, 0.07, 3.6, "steel_dark"), box(0, 0.08, 2.8, 1.2, 0.15, 0.6, "display"),
            box(0, 0.08, 3.42, 1.24, 0.17, 0.04, "steel_dark")]


def ztl_camera():
    return [box(0, 0, 0, 0.35, 0.35, 0.06, "concrete"), cyl(0, 0, 0.06, 0.08, 4.2, "steel_dark"),
            beam((0, 0, 4.2), (0, 0.6, 4.35), 0.06, 0.06, "steel_dark"),
            box(0, 0.7, 4.3, 0.18, 0.42, 0.16, "steel", rot=[-12, 0, 0]), cyl(0, 0.93, 4.25, 0.05, 0.05, "glass", rot=[78, 0, 0]),
            box(0, 0.7, 4.4, 0.22, 0.46, 0.02, "steel_dark", rot=[-12, 0, 0])]


def vms():
    return [box(0, 0, 0, 0.6, 0.6, 0.1, "concrete"), cyl(0, 0, 0.1, 0.13, 5.0, "steel_dark"),
            box(0, 0.22, 3.75, 2.4, 0.32, 1.25, "steel_dark"), box(0, 0.385, 3.85, 2.2, 0.01, 1.05, "display"),
            box(0, 0.22, 5.05, 2.45, 0.36, 0.08, "steel_dark")]


def ztl_portal():
    """Gantry (bandiera) over the lane: LED panel «ZTL attiva» + two plate-reading cameras (DPR 250/1999)."""
    return [box(0, 0, 0, 0.6, 0.6, 0.12, "concrete"), cyl(0, 0, 0.12, 0.14, 5.6, "steel_dark", r2=0.11),
            beam((0, 0, 5.4), (0, 4.2, 5.4), 0.16, 0.16, "steel_dark"),
            box(0, 2.6, 4.5, 0.2, 1.8, 0.8, "steel_dark"), box(0.11, 2.6, 4.55, 0.01, 1.66, 0.66, "display"),
            box(0, 3.9, 5.05, 0.34, 0.2, 0.18, "steel", rot=[0, -10, 0]), cyl(0.2, 3.9, 5.02, 0.05, 0.06, "glass", rot=[0, 80, 0]),
            box(0, 1.4, 5.05, 0.34, 0.2, 0.18, "steel", rot=[0, -10, 0]), cyl(0.2, 1.4, 5.02, 0.05, 0.06, "glass", rot=[0, 80, 0]),
            box(0.1, 0, 2.2, 0.03, 0.6, 0.6, "sign_blue")]


def ztl_totem():
    """Information totem at the ZTL entrance: timetable, permits and live state."""
    return [box(0, 0, 0, 0.7, 0.4, 0.1, "concrete"), box(0, 0, 0.1, 0.6, 0.25, 2.3, "steel_dark"),
            box(0, 0.13, 1.6, 0.5, 0.01, 0.55, "display"), box(0, 0.13, 0.5, 0.5, 0.01, 0.95, "slab_light"),
            box(0, 0.13, 2.25, 0.5, 0.01, 0.1, "led_amber")]


def crossing_beacon():
    """Illuminated pedestrian-crossing sign with flashing amber lights (art. 135 Reg. CdS fig. II.303)."""
    return [box(0, 0, 0, 0.4, 0.4, 0.08, "concrete"), cyl(0, 0, 0.08, 0.06, 3.4, "steel"),
            box(0, 0.06, 2.6, 0.7, 0.08, 0.7, "sign_blue"), box(0, 0.105, 2.65, 0.5, 0.01, 0.5, "slab_light"),
            sph(-0.3, 0.1, 3.45, 0.09, "lens_amber"), sph(0.3, 0.1, 3.45, 0.09, "lens_amber"), box(0, 0.06, 3.38, 0.75, 0.06, 0.04, "steel_dark"),
            box(0, 0, 3.48, 0.08, 0.08, 0.04, "steel")]


def speed_display():
    """Radar speed display («Rallenta / velocità rilevata»), informative only."""
    return [box(0, 0, 0, 0.36, 0.36, 0.06, "concrete"), cyl(0, 0, 0.06, 0.05, 2.9, "steel"),
            box(0, 0.08, 2.1, 0.6, 0.12, 0.75, "steel_dark"), box(0, 0.145, 2.25, 0.46, 0.01, 0.4, "led_amber"),
            box(0, 0.145, 2.68, 0.5, 0.01, 0.1, "slab_light")]


def manhole():
    m = [cyl(0, 0, -0.02, 0.4, 0.03, "cast_iron")]
    for i in range(5):
        m.append(box(0, -0.28 + i * 0.14, 0.008, 0.6, 0.04, 0.008, "steel_dark"))
    return m


def street_name():
    """Street name plate on a post (toponomastica)."""
    return [cyl(0, 0, 0, 0.04, 2.8, "steel"), box(0.42, 0.0, 2.45, 0.8, 0.03, 0.25, "slab_light"),
            box(0.42, 0.016, 2.45, 0.74, 0.002, 0.19, "sign_blue")]


NEW_ITEMS = {
    "ztl.portal": {"label": "Portale a bandiera ZTL (pannello LED + telecamere)", "category": "ztl", "material": "steel_dark", "led": {"kind": "ztl"}},
    "ztl.totem": {"label": "Totem informativo ZTL (orari, permessi, stato)", "category": "ztl", "material": "steel_dark", "led": {"kind": "ztl"}},
    "traffic.crossing_beacon": {"label": "Segnale luminoso attraversamento pedonale con lampeggianti", "category": "ztl", "material": "steel"},
    "traffic.speed_display": {"label": "Display rilevatore di velocità (informativo)", "category": "ztl", "material": "steel_dark"},
    "furniture.manhole": {"label": "Chiusino in ghisa D400 (pozzetto)", "category": "utility", "material": "cast_iron"},
    "furniture.street_name": {"label": "Targa toponomastica su palo", "category": "public_space", "material": "steel"},
}


MODELS = {
    "ztl.portal": ztl_portal(), "ztl.totem": ztl_totem(), "traffic.crossing_beacon": crossing_beacon(), "traffic.speed_display": speed_display(),
    "furniture.manhole": manhole(), "furniture.street_name": street_name(),
    "vegetation.tree": tree(9, 3.0, 0.18), "vegetation.tree_small": tree(5, 1.6, 0.1),
    "vegetation.citrus": [cyl(0, 0, 0, 0.1, 1.4, "bark", r2=0.08), ell(0, 0, 2.6, 1.6, 1.6, 1.5, "foliage_dark"), ell(0.5, 0.2, 2.9, 0.8, 0.8, 0.7, "foliage"),
                          *[sph(math.cos(a) * 1.3, math.sin(a) * 1.3, 2.3 + (i % 2) * 0.6, 0.07, "plastic_red") for i, a in enumerate([0.3, 1.4, 2.5, 3.6, 4.7, 5.6])],
                          box(0, 0, -0.02, 1.2, 1.2, 0.04, "tree_pit")],
    "vegetation.palm": palm(), "vegetation.shrub": shrub(),
    "furniture.bench": bench(), "furniture.seat_module": seat_module(), "furniture.outdoor_seating": outdoor_seating(),
    "furniture.light_pole": light_pole(), "furniture.light_pedestrian": light_pedestrian(), "furniture.smart_pole": smart_pole(),
    "furniture.bollard": bollard(), "furniture.fence": fence(), "furniture.barrier": barrier(), "furniture.guardrail": guardrail(), "furniture.jersey": jersey(),
    "furniture.bus_shelter": bus_shelter(), "furniture.green_shelter": bus_shelter(True), "furniture.transit_display": transit_display(), "transit.stop": transit_stop(),
    "furniture.bike_rack": bike_rack(), "furniture.bike_station": bike_station(), "furniture.ev_charger": ev_charger(), "furniture.parking_meter": parking_meter(),
    "furniture.hydrant": hydrant(), "furniture.storm_inlet": storm_inlet(), "furniture.bin": bin_(), "furniture.drinking_fountain": drinking_fountain(),
    "furniture.planter": planter(), "furniture.planter_linear": planter(2.4, 0.8), "furniture.fountain": fountain(), "furniture.info_board": info_board(),
    "furniture.kiosk": kiosk(), "furniture.play": play(),
    "signal.vehicle": signal(3), "signal.vehicle_left": signal(3), "signal.vehicle_right": signal(3), "signal.vehicle_straight": signal(3),
    "signal.pedestrian": signal(2, 3.0, True), "signal.cycle": signal(3, 3.0, True), "signal.bus": signal(3, 3.2, True),
    "ztl.gate": ztl_gate(), "ztl.led_panel": ztl_led(), "ztl.camera": ztl_camera(), "traffic.vms": vms(),
}


def bounds(parts):
    """Approximate bounds (rotation-aware via the rotated half-diagonal) for the catalogue dims."""
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for p in parts:
        if p["shape"] in ("sphere", "ellipsoid"):
            rad = [p["r"]] * 3 if p["shape"] == "sphere" else p["size"]
            c = p["at"]
            ext = rad if not p.get("rot") else [max(rad)] * 3
        else:
            if p["shape"] == "box":
                sx, sy, sz = p["size"]
            else:
                rr = max(p["r"], p.get("r2", 0))
                sx = sy = rr * 2
                sz = p["h"]
            if p.get("rot"):
                c = p["at"]
                e = math.sqrt(sx * sx + sy * sy + sz * sz) / 2
                ext = [e, e, e]
            else:
                c = [p["at"][0], p["at"][1], p["at"][2] + sz / 2]
                ext = [sx / 2, sy / 2, sz / 2]
        for k in range(3):
            lo[k] = min(lo[k], c[k] - ext[k])
            hi[k] = max(hi[k], c[k] + ext[k])
    return lo, hi


def main():
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    have = {i["id"] for i in cat["items"]}
    for iid, meta in NEW_ITEMS.items():
        if iid not in have:
            cat["items"].append({"id": iid, **meta, "dims": {"w": 1, "d": 1, "h": 1}, "model": []})
    cat["categories"]["ztl"] = "ZTL, PMV e dispositivi elettronici"
    missing = [i["id"] for i in cat["items"] if i["id"] not in MODELS]
    if missing:
        raise SystemExit(f"Modelli mancanti: {missing}")
    for item in cat["items"]:
        parts = MODELS[item["id"]]
        item["model"] = parts
        lo, hi = bounds(parts)
        # Footprint symmetric about the anchor (the map centres the symbol on it).
        item["dims"] = {"w": r(max(0.1, 2 * max(abs(lo[0]), abs(hi[0])))), "d": r(max(0.1, 2 * max(abs(lo[1]), abs(hi[1])))), "h": r(max(0.02, hi[2]))}
    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(cat['items'])} modelli, {sum(len(i['model']) for i in cat['items'])} parti")


if __name__ == "__main__":
    main()
