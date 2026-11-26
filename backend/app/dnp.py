"""Mapa DNP3 simulado (classes D1..D3 do SEL-751).

Não implementa o protocolo na rede: mostra o estado de cada ponto como um mestre
DNP3 leria (estático + eventos) e executa comandos de saída binária (CROB) com
os modos Select-Before-Operate e Direct Operate.
"""
from __future__ import annotations

import re
import time
from collections import deque
from typing import TYPE_CHECKING

from .describe import standard_label

if TYPE_CHECKING:  # pragma: no cover
    from .engine import RelayEngine

SELECT_TIMEOUT = 10.0   # s (tempo simulado)
_RE_KEY = re.compile(r"^(BO|BI|AI|CO)_(\d+)$")
CODES = ("PULSE_ON", "LATCH_ON", "LATCH_OFF")


def _parse_ai(raw: str) -> tuple[str, float, float]:
    parts = raw.split(":")
    name = parts[0].strip().upper()
    try:
        scale = float(parts[1]) if len(parts) > 1 else 1.0
    except ValueError:
        scale = 1.0
    try:
        deadband = float(parts[2]) if len(parts) > 2 else 0.0
    except ValueError:
        deadband = 0.0
    return name, scale, deadband


class DnpMap:
    def __init__(self, eng: "RelayEngine") -> None:
        self.eng = eng
        self.map_id = 1
        self.bo: dict[int, str] = {}
        self.bi: dict[int, str] = {}
        self.ai: dict[int, tuple[str, float, float]] = {}
        self.co: dict[int, str] = {}
        self._bi_prev: dict[int, int] = {}
        self._bi_changed: dict[int, float] = {}
        self._bi_changed_w: dict[int, float] = {}   # horário real (época, s) da última mudança
        self._ai_last_event: dict[int, int] = {}
        self.events: deque[dict] = deque(maxlen=1500)
        self.seq = 0
        self.log: deque[dict] = deque(maxlen=200)
        self.selected: dict | None = None

    def set_map(self, map_id: int) -> None:
        self.map_id = map_id
        self.rebuild()

    def available_maps(self) -> list[int]:
        return [i for i in (1, 2, 3) if f"D{i}" in self.eng.settings.sections]

    def rebuild(self) -> None:
        items = self.eng.settings.sections.get(f"D{self.map_id}", {})
        self.bo, self.bi, self.ai, self.co = {}, {}, {}, {}
        for key, val in items.items():
            m = _RE_KEY.match(key)
            if not m:
                continue
            kind, idx = m.group(1), int(m.group(2))
            if kind == "BO":
                self.bo[idx] = val.strip().upper()
            elif kind == "BI":
                self.bi[idx] = val.strip().upper()
            elif kind == "AI":
                self.ai[idx] = _parse_ai(val)
            else:
                self.co[idx] = val.strip().upper()

    # ----------------------------------------------------------------- ciclo
    @staticmethod
    def _raw(value: float, scale: float) -> tuple[int, str]:
        raw = int(round(value * scale))
        if raw > 32767:
            return 32767, "OVER_RANGE"
        if raw < -32768:
            return -32768, "OVER_RANGE"
        return raw, "ONLINE"

    def update(self) -> None:
        eng = self.eng
        v = eng.vals
        t = round(eng.t, 3)
        for idx, name in self.bi.items():
            if name == "NA":
                continue
            cur = 1 if v.get(name, 0.0) else 0
            prev = self._bi_prev.get(idx)
            self._bi_prev[idx] = cur
            if prev is not None and prev != cur:
                self._bi_changed[idx] = t
                self._bi_changed_w[idx] = time.time()
                self._push({"t": t, "kind": "BI", "index": idx, "name": name, "value": cur, "raw": cur})
        for idx, (name, scale, db) in self.ai.items():
            if name == "NA":
                continue
            raw, _ = self._raw(v.get(name, 0.0), scale)
            last = self._ai_last_event.get(idx)
            if last is None:
                self._ai_last_event[idx] = raw
            elif abs(raw - last) > db:
                self._ai_last_event[idx] = raw
                self._push({"t": t, "kind": "AI", "index": idx, "name": name, "value": raw / scale if scale else raw,
                            "raw": raw})

    def _push(self, ev: dict) -> None:
        self.seq += 1
        ev["seq"] = self.seq
        ev["w"] = time.time()
        self.events.append(ev)

    # --------------------------------------------------------------- comandos
    def command(self, index: int, code: str, mode: str) -> dict:
        eng = self.eng
        t = eng.t
        code = code.upper()
        mode = mode.lower()
        name = self.bo.get(index)
        if name is None:
            status, msg = "FORMAT_ERROR", "Índice de saída binária inexistente no mapa."
        elif name == "NA":
            status, msg = "NOT_SUPPORTED", "Ponto sem bit mapeado (NA)."
        elif code not in CODES:
            status, msg = "FORMAT_ERROR", "Código de controle inválido."
        elif mode == "select":
            self.selected = {"index": index, "code": code, "t": t}
            status, msg = "SUCCESS", f"Ponto selecionado ({SELECT_TIMEOUT:.0f} s para operar)."
        else:
            sel = self.selected
            if mode == "operate":
                if not sel or sel["index"] != index or sel["code"] != code:
                    status, msg = "NO_SELECT", "Nenhuma seleção válida para este ponto/código."
                elif t - sel["t"] > SELECT_TIMEOUT:
                    status, msg = "TIMEOUT", "A seleção expirou."
                    self.selected = None
                else:
                    status, msg = self._execute(name, code)
                    self.selected = None
            else:  # direct
                status, msg = self._execute(name, code)
        result = {"t": round(t, 3), "w": time.time(), "index": index, "name": name or "?", "code": code, "mode": mode,
                  "status": status, "message": msg}
        self.log.appendleft(result)
        return result

    def _execute(self, name: str, code: str) -> tuple[str, str]:
        if code == "LATCH_OFF":
            return "NOT_SUPPORTED", "Bits remotos são pulsos: Latch Off não tem efeito no SEL-751."
        self.eng.pulse(name)
        return "SUCCESS", f"Bit {name} acionado por 1 ciclo de processamento."

    # --------------------------------------------------------------- snapshot
    def snapshot(self, since: int = 0) -> dict:
        eng = self.eng
        v = eng.vals
        labels = eng.labels

        def desc(name: str) -> str:
            return labels.get(name) or standard_label(name)

        bo = [{"index": i, "name": n, "desc": desc(n)} for i, n in sorted(self.bo.items())]
        aliases = getattr(eng, "aliases", {})

        def states(n: str) -> dict:
            al = aliases.get(n)                     # ALIAS do relatório: textos dos estados 1 e 0
            return {"t1": al[1].replace("_", " "), "t0": al[2].replace("_", " ")} if al else {}

        bi = [{"index": i, "name": n, "desc": desc(n), "value": (1 if v.get(n, 0.0) else 0) if n != "NA" else None,
               "changed": self._bi_changed.get(i), "changed_w": self._bi_changed_w.get(i), **states(n)} for i, n in sorted(self.bi.items())]
        ai = []
        for i, (n, scale, db) in sorted(self.ai.items()):
            if n == "NA":
                ai.append({"index": i, "name": n, "desc": "", "scale": scale, "deadband": db, "raw": None,
                           "value": None, "quality": "NA"})
                continue
            val = v.get(n, 0.0)
            raw, quality = self._raw(val, scale)
            ai.append({"index": i, "name": n, "desc": desc(n), "scale": scale, "deadband": db, "raw": raw,
                       "value": round(val, 4), "quality": quality})
        sel = None
        if self.selected:
            left = SELECT_TIMEOUT - (eng.t - self.selected["t"])
            if left > 0:
                sel = {**self.selected, "left": round(left, 1)}
        return {
            "map": self.map_id, "maps": self.available_maps(), "bo": bo, "bi": bi, "ai": ai,
            "co": [{"index": i, "name": n} for i, n in sorted(self.co.items()) if n != "NA"],
            "events": [e for e in self.events if e["seq"] > since][-300:], "last_seq": self.seq,
            "log": list(self.log)[:50], "selected": sel, "time": round(eng.t, 3),
        }
