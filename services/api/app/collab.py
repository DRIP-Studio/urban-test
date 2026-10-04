"""Real-time collaboration: in-process event hub behind ``GET /api/projects/{pid}/events`` (SSE).

Every open EventSource is a subscriber with its own bounded asyncio queue. Events are published from
request threads (scenario saves run in the threadpool) and handed to each subscriber's event loop with
``call_soon_threadsafe``; a full queue drops its oldest message, so a slow client never blocks a save.
The connection itself is the presence record: it is removed when the stream closes.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

QUEUE_SIZE = 100
HEARTBEAT_S = 15.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


@dataclass(eq=False)
class Subscriber:
    pid: str
    name: str
    username: str
    client_id: str
    scenario_id: str | None
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(QUEUE_SIZE))
    since: str = field(default_factory=_now)
    seq: int = 0

    def push(self, msg: str) -> None:
        """Runs on the subscriber's loop: enqueue, dropping the oldest message when full."""
        while True:
            try:
                self.queue.put_nowait(msg)
                return
            except asyncio.QueueFull:
                try:
                    self.queue.get_nowait()
                except asyncio.QueueEmpty:  # pragma: no cover — another consumer emptied it
                    pass


class Hub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: dict[str, list[Subscriber]] = {}
        self._seq = itertools.count(1)

    # ------------------------------------------------------------ subscriptions

    def subscribe(self, pid: str, name: str, username: str, client_id: str = "", scenario_id: str | None = None) -> Subscriber:
        """Must be called from the event loop that will consume the queue."""
        sub = Subscriber(pid=pid, name=name, username=username, client_id=client_id[:64], scenario_id=scenario_id or None,
                         loop=asyncio.get_running_loop(), seq=next(self._seq))
        with self._lock:
            self._subs.setdefault(pid, []).append(sub)
        self._broadcast_presence(pid)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            rows = self._subs.get(sub.pid, [])
            if sub in rows:
                rows.remove(sub)
            if not rows:
                self._subs.pop(sub.pid, None)
        self._broadcast_presence(sub.pid)

    def set_scenario(self, pid: str, username: str, scenario_id: str | None, client_id: str = "") -> int:
        """Updates the scenario a user is viewing (one connection by client id, or all of the user's). Returns matches."""
        changed = 0
        with self._lock:
            for s in self._subs.get(pid, []):
                if s.username == username and (not client_id or s.client_id == client_id):
                    if s.scenario_id != scenario_id:
                        s.scenario_id, s.since = scenario_id, _now()
                        changed += 1
        if changed:
            self._broadcast_presence(pid)
        return changed

    # ------------------------------------------------------------ events

    def presence(self, pid: str) -> list[dict]:
        """One row per user (their most recently active connection)."""
        with self._lock:
            rows = list(self._subs.get(pid, []))
        by_user: dict[str, Subscriber] = {}
        for s in rows:
            cur = by_user.get(s.username)
            if cur is None or (s.since, s.seq) > (cur.since, cur.seq):
                by_user[s.username] = s
        return [{"name": s.name, "username": s.username, "scenarioId": s.scenario_id, "since": s.since}
                for s in sorted(by_user.values(), key=lambda x: x.seq)]

    def publish(self, pid: str, event: str, data: Any) -> int:
        """Thread-safe; never blocks. Returns the number of subscribers the event was handed to."""
        msg = sse(event, data)
        with self._lock:
            rows = list(self._subs.get(pid, []))
        n = 0
        for s in rows:
            try:
                s.loop.call_soon_threadsafe(s.push, msg)
                n += 1
            except RuntimeError:  # loop closed: the stream is gone without having unsubscribed
                with self._lock:
                    if s in self._subs.get(pid, []):
                        self._subs[pid].remove(s)
        return n

    def _broadcast_presence(self, pid: str) -> None:
        self.publish(pid, "presence", {"users": self.presence(pid)})

    def count(self, pid: str) -> int:
        with self._lock:
            return len(self._subs.get(pid, []))


hub = Hub()


async def stream(sub: Subscriber, heartbeat: float = HEARTBEAT_S):
    """SSE body: queued events, a comment line every ``heartbeat`` seconds; unsubscribes when closed."""
    try:
        yield "retry: 5000\n\n"
        while True:
            try:
                msg = await asyncio.wait_for(sub.queue.get(), heartbeat)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            yield msg
    finally:
        hub.unsubscribe(sub)
