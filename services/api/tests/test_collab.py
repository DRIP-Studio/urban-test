"""Live collaboration hub: presence and scenario.saved events."""
import asyncio
import json

import pytest

from tests.test_api import fresh_app


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    return fresh_app(tmp_path_factory.mktemp("collab"), "open")


def _parse(msg: str) -> tuple[str, dict]:
    lines = dict(line.split(": ", 1) for line in msg.strip().splitlines())
    return lines["event"], json.loads(lines["data"])


async def _next(sub, event: str, timeout: float = 3.0) -> dict:
    while True:
        name, data = _parse(await asyncio.wait_for(sub.queue.get(), timeout))
        if name == event:
            return data


def test_presence_join_change_leave(client):
    from app.collab import Hub

    async def run():
        hub = Hub()
        a = hub.subscribe("p1", "Anna Rossi", "anna", "c-a", "scenario-a")
        assert (await _next(a, "presence"))["users"] == [{"name": "Anna Rossi", "username": "anna", "scenarioId": "scenario-a", "since": a.since}]
        b = hub.subscribe("p1", "Bruno Bianchi", "bruno", "c-b")
        users = (await _next(a, "presence"))["users"]
        assert [u["username"] for u in users] == ["anna", "bruno"]
        assert hub.set_scenario("p1", "bruno", "s-2", "c-b") == 1
        users = (await _next(a, "presence"))["users"]
        assert next(u for u in users if u["username"] == "bruno")["scenarioId"] == "s-2"
        # Another project is unaffected.
        other = hub.subscribe("p2", "Carla", "carla")
        assert [u["username"] for u in (await _next(other, "presence"))["users"]] == ["carla"]
        # Two windows of the same user count once.
        b2 = hub.subscribe("p1", "Bruno Bianchi", "bruno", "c-b2")
        assert [u["username"] for u in hub.presence("p1")] == ["anna", "bruno"]
        hub.unsubscribe(b2)
        hub.unsubscribe(b)
        users = (await _next(a, "presence"))["users"]
        while len(users) != 1:
            users = (await _next(a, "presence"))["users"]
        assert users[0]["username"] == "anna" and hub.count("p1") == 1
        hub.unsubscribe(a)
        assert hub.presence("p1") == [] and hub.count("p1") == 0

    asyncio.run(run())


def test_bounded_queue_drops_oldest(client):
    from app import collab

    async def run():
        hub = collab.Hub()
        s = hub.subscribe("p", "A", "a")
        for i in range(collab.QUEUE_SIZE + 50):
            hub.publish("p", "scenario.saved", {"revision": i})
        await asyncio.sleep(0.05)  # let call_soon_threadsafe callbacks run
        assert s.queue.qsize() == collab.QUEUE_SIZE
        first = _parse(s.queue.get_nowait())[1]
        assert first["revision"] == 50  # the presence message and the 49 oldest saves were dropped

    asyncio.run(run())


def test_publish_from_worker_thread(client):
    from app.collab import Hub

    async def run():
        hub = Hub()
        s = hub.subscribe("p", "A", "a")
        await _next(s, "presence")
        n = await asyncio.to_thread(hub.publish, "p", "scenario.saved", {"scenarioId": "x", "revision": 3})
        assert n == 1
        assert (await _next(s, "scenario.saved"))["revision"] == 3

    asyncio.run(run())


def test_save_route_emits_scenario_saved(client):
    from app.collab import hub
    pid = client.post("/api/projects", json={"template": "empty", "name": "Collab", "bbox": [14.27, 40.94, 14.28, 40.945]}).json()["id"]

    async def run():
        sub = hub.subscribe(pid, "Utente locale", "local", "c-obs", "scenario-a")
        await _next(sub, "presence")
        r = await asyncio.to_thread(lambda: client.put(f"/api/projects/{pid}/scenarios/scenario-a", json={"scenario": {"operations": []}, "baseRevision": 0}, headers={"X-Drip-Client": "c-writer"}))
        assert r.status_code == 200, r.text
        ev = await _next(sub, "scenario.saved")
        assert ev["scenarioId"] == "scenario-a" and ev["revision"] == 1 and ev["clientId"] == "c-writer" and ev["author"]
        # A conflicting save emits nothing.
        r = await asyncio.to_thread(lambda: client.put(f"/api/projects/{pid}/scenarios/scenario-a", json={"scenario": {"operations": []}, "baseRevision": 0}))
        assert r.status_code == 409
        await asyncio.sleep(0.1)
        assert sub.queue.empty()
        # Presence announced over HTTP updates the open connection of that user.
        p = await asyncio.to_thread(lambda: client.post(f"/api/projects/{pid}/presence", json={"scenarioId": "baseline"}).json())
        assert p["users"] == [{"name": "Utente locale", "username": "local", "scenarioId": "baseline", "since": sub.since}]
        hub.unsubscribe(sub)

    asyncio.run(run())


def test_events_endpoint_requires_existing_project(client):
    assert client.get("/api/projects/p-missing00000/events").status_code == 404
