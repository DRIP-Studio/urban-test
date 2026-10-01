from __future__ import annotations
from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator

class Accuracy(str, Enum):
    surveyed = "surveyed"
    authoritative = "authoritative"
    derived = "derived"
    estimated = "estimated"

class TravelMode(str, Enum):
    car = "car"; bus = "bus"; bike = "bike"; walk = "walk"; emergency = "emergency"

class Point(BaseModel):
    lon: float; lat: float; elevation_m: float | None = None

class Provenance(BaseModel):
    source: str
    accuracy: Accuracy
    measured_at: str | None = None
    uncertainty_m: float | None = None
    source_url: str | None = None

class RoadNode(BaseModel):
    id: str; point: Point; name: str | None = None

class RoadEdge(BaseModel):
    id: str; u: str; v: str
    name: str = "Strada"
    geometry: list[Point] = Field(min_length=2)
    length_m: float = Field(gt=0)
    width_m: float | None = Field(default=None, gt=0)
    lanes: int = Field(default=2, ge=1, le=12)
    speed_kmh: float = Field(default=50, gt=0, le=200)
    oneway: bool = False
    modes: set[TravelMode] = Field(default_factory=lambda: set(TravelMode))
    road_class: str = "residential"
    capacity_vph: float | None = Field(default=None, ge=0)
    width_provenance: Provenance
    geometry_provenance: Provenance
    tags: dict[str, Any] = Field(default_factory=dict)
    lane_profile: list[dict[str, Any]] = Field(default_factory=list)
    section: dict[str, Any] = Field(default_factory=dict)

class BuildingFeature(BaseModel):
    id: str
    footprint: list[Point] = Field(min_length=3)
    height_m: float = Field(default=10.5, gt=0, le=600)
    min_height_m: float = Field(default=0, ge=0, le=600)
    levels: int | None = Field(default=None, ge=1, le=200)
    name: str | None = None
    building_class: str | None = None
    provenance: Provenance
    tags: dict[str, Any] = Field(default_factory=dict)


class CityFeature(BaseModel):
    id: str
    kind: str
    geometry_type: Literal["point", "line", "polygon"]
    points: list[Point] = Field(min_length=1)
    name: str | None = None
    category: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)
    provenance: Provenance


def polyline_length_m(points: list[Point]) -> float:
    from math import asin, cos, radians, sin, sqrt
    total = 0.0
    for a, b in zip(points, points[1:]):
        lat1, lon1, lat2, lon2 = map(radians, (a.lat, a.lon, b.lat, b.lon))
        h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
        total += 2 * 6_371_008.8 * asin(sqrt(h))
    return total
