from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

VERSION = "2.0.0"
API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]


def _default_data_dir() -> Path:
    explicit = os.environ.get("DRIP_URBAN_DATA")
    if explicit:
        return Path(explicit).expanduser().resolve()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        return base / "DRIP Urban"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "drip-urban"


def _legacy_data_dir() -> Path | None:
    """Data folder of DRIP Urban Planning Studio 28–53 (read-only for migration)."""
    explicit = os.environ.get("DRIP_URBAN_LEGACY_DATA")
    if explicit:
        return Path(explicit)
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        p = base / "DRIP Urban Planning Studio" / "data"
        return p if p.exists() else None
    return None


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    legacy_data_dir: Path | None
    seed_dir: Path
    web_dist: Path
    signs_dir: Path
    brand_dir: Path
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    user_agent: str = f"DRIP-Urban/{VERSION} (+https://studiodrip.it)"
    max_upload_bytes: int = 60 * 1024 * 1024

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def settings_dir(self) -> Path:
        return self.data_dir / "settings"

    @property
    def publications_dir(self) -> Path:
        return self.data_dir / "publications"


SETTINGS = Settings(
    data_dir=_default_data_dir(),
    legacy_data_dir=_legacy_data_dir(),
    seed_dir=API_ROOT / "seed",
    web_dist=Path(os.environ.get("DRIP_URBAN_WEB_DIST") or REPO_ROOT / "apps" / "web" / "dist"),
    signs_dir=REPO_ROOT / "packages" / "assets" / "signs" / "it",
    brand_dir=REPO_ROOT / "packages" / "assets" / "brand",
)
