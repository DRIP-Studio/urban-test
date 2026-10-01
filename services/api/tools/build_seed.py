"""Build the bundled Frattamaggiore baseline from the 53.x OSM city dataset.

Usage: python services/api/tools/build_seed.py <path to 53.x data/city.json>
Writes services/api/seed/frattamaggiore.baseline.json.gz and .legacy-map.json.gz
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.city.legacy_city import convert_city  # noqa: E402

SEED = Path(__file__).resolve().parents[1] / "seed"
BBOX = [14.255, 40.9285, 14.3005, 40.9548]  # data/OSM-SOURCE.json of 53.x, acquired 2026-09-17


def main(src: str) -> None:
    city = json.loads(Path(src).read_text(encoding="utf-8"))
    baseline, edge_map = convert_city(city, "frattamaggiore-osm-2026-09-17", "Frattamaggiore", BBOX)
    baseline["sources"][0]["acquiredAt"] = "2026-09-17"
    SEED.mkdir(exist_ok=True)
    for name, data in (("frattamaggiore.baseline.json.gz", baseline), ("frattamaggiore.legacy-map.json.gz", edge_map)):
        with gzip.open(SEED / name, "wt", encoding="utf-8", compresslevel=9) as fh:
            json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
        print(name, (SEED / name).stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1])
