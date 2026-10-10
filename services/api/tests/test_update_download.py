import hashlib
from contextlib import contextmanager
import httpx
import pytest
from app.platform import updates

@pytest.fixture
def download_env(tmp_path, monkeypatch):
    monkeypatch.setattr(updates, "_dir", lambda: tmp_path)
    monkeypatch.setattr(updates.jobs, "start", lambda kind, label, run: run(lambda *args: None))
    payload = b"test release archive bytes"
    monkeypatch.setitem(updates._state, "latest", {"version": "2.1.0", "url": "https://release.example/package.zip", "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)})
    @contextmanager
    def stream(*args, **kwargs):
        yield httpx.Response(200, content=payload, request=httpx.Request("GET", "https://release.example/package.zip"))
    monkeypatch.setattr(updates.httpx, "stream", stream)
    return tmp_path, payload

def test_verified_download_and_retry_after_failure(download_env):
    path, payload = download_env
    updates._state["latest"]["sha256"] = "0" * 64
    with pytest.raises(RuntimeError, match="SHA-256"):
        updates.download()
    assert not list(path.glob("*.part")) and not (path / "ready.json").exists()
    updates._state["latest"]["sha256"] = hashlib.sha256(payload).hexdigest()
    assert updates.download()["version"] == "2.1.0"
    assert (path / "drip-urban-2.1.0.zip").read_bytes() == payload
    assert not updates._download_lock.locked()

def test_declared_size_mismatch_does_not_mark_ready(download_env):
    path, payload = download_env
    updates._state["latest"]["size"] = len(payload) + 1
    with pytest.raises(ValueError, match="Dimensione HTTP"):
        updates.download()
    assert not (path / "ready.json").exists() and not list(path.glob("*.part"))
    assert not updates._download_lock.locked()

def test_concurrent_download_is_rejected(download_env):
    updates._download_lock.acquire()
    try:
        with pytest.raises(ValueError, match="già in corso"):
            updates.download()
    finally:
        updates._download_lock.release()
