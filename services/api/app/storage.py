"""Crash-safe file persistence: atomic writes (temp file + fsync + replace)."""
from __future__ import annotations

import gzip
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$")


def safe_id(value: str, what: str = "id") -> str:
    if not ID_RE.match(value or "") or ".." in value:
        raise ValueError(f"{what} non valido: {value!r}")
    return value


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, data: Any, *, gz: bool = False) -> None:
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    _atomic_write_bytes(path, gzip.compress(raw, compresslevel=6) if gz else raw)


def atomic_write_bytes(path: Path, data: bytes) -> None:
    _atomic_write_bytes(path, data)


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    raw = path.read_bytes()
    if path.suffix == ".gz":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))
