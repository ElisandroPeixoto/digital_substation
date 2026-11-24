"""Sessões de simulação e o laço de tempo real."""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from .engine import RelayEngine
from .goose import GooseNetwork
from .mbits import MbNetwork
from .rdb import RdbRelay
from .settings import RelaySettings

BASE_DT = 0.004         # período de varredura (s de tempo real): 4 ms a 1×
MAX_SCANS_PER_WAKE = 25
MAX_SESSIONS = 8
SPEEDS = (0.5, 1.0, 2.0, 5.0, 10.0)


@dataclass
class Session:
    id: str
    filename: str
    relay: RdbRelay
    engine: RelayEngine
    running: bool = True
    speed: float = 1.0
    accum: float = 0.0
    created: float = field(default_factory=time.time)

    def info(self) -> dict:
        st = self.engine.settings
        eng = self.engine
        classes = []
        for cls, items in st.sections.items():
            classes.append({"cls": cls, "name": st.class_names.get(cls, cls), "count": len(items)})
        info = {
            "model": eng.model, "id": self.id, "filename": self.filename, "relay_id": self.relay.id, "device": eng.device_name,
            "header": st.header, "classes": classes, "files": sorted(self.relay.files.keys()),
            "static": eng.panel.static_info(), "ctr": eng.ctr, "ctrn": eng.ctrn, "ptr": eng.ptr, "ptrs": eng.ptrs, "vnom": eng.vnom,
            "presets": None, "ied": None,
        }
        if eng.model == "787":
            from .protection_787 import enabled_windings

            info["ctrs"] = [eng.ctr_of(n) for n in range(1, 5)]
            info["windings"] = enabled_windings(eng) or [1, 2]
        return info


def create_engine(relay: RdbRelay) -> RelayEngine:
    settings = RelaySettings.from_files(relay.files)
    if "787" in settings.header.get("RELAYTYPE", "").upper():
        from .engine787 import Relay787Engine

        return Relay787Engine(settings, device_name=relay.name)
    return RelayEngine(settings, device_name=relay.name)


class SessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.net = GooseNetwork()          # rede GOOSE do módulo IEC61850
        self.mb = MbNetwork()              # links Mirrored Bits do app MBitConfig

    def create(self, relay: RdbRelay, filename: str) -> Session:
        while len(self.sessions) >= MAX_SESSIONS:
            oldest = min(self.sessions.values(), key=lambda s: s.created)
            del self.sessions[oldest.id]
        sess = Session(id=uuid.uuid4().hex[:12], filename=filename, relay=relay, engine=create_engine(relay))
        # alguns ciclos de aquecimento para estabilizar latches e temporizadores
        for _ in range(5):
            sess.engine.step(BASE_DT)
        self.sessions[sess.id] = sess
        return sess

    def get(self, sid: str) -> Session | None:
        return self.sessions.get(sid)

    def restart(self, sess: Session) -> None:
        sess.engine = create_engine(sess.relay)
        for _ in range(5):
            sess.engine.step(BASE_DT)
        sess.accum = 0.0

    def delete(self, sid: str) -> None:
        self.sessions.pop(sid, None)
        self.net.unbind(sid)
        self.mb.drop_session(sid)

    async def run(self) -> None:
        last = time.perf_counter()
        while True:
            await asyncio.sleep(BASE_DT)
            now = time.perf_counter()
            real, last = now - last, now
            for s in list(self.sessions.values()):
                if not s.running:
                    continue
                s.accum += real
                n = 0
                while s.accum >= BASE_DT and n < MAX_SCANS_PER_WAKE:
                    s.engine.step(BASE_DT * s.speed)
                    s.accum -= BASE_DT
                    n += 1
                if n >= MAX_SCANS_PER_WAKE:
                    s.accum = 0.0
            if self.net.project.ieds:
                self.net.tick(now, self.sessions)
            if self.mb.links:
                self.mb.tick(now, self.sessions)
