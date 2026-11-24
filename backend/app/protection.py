"""Elementos de proteção simulados: 50/51 (sobrecorrente), 27/59 (tensão, níveis 1 a 4, incluindo VS) e 81D (frequência).
Os elementos 27I/59I (tempo inverso), 3P27/3P59, 25 (sincronismo), 3PWR (potência) e 593SRMS estão em ``protection_v.py``.

Os elementos são criados a partir dos ajustes do grupo ativo. Pickups em ``OFF``
desabilitam o elemento. Os bits do Relay Word seguem o padrão do SEL-751
(ex.: 50P1P / 50P1T, 51P1P / 51P1T, 51AP / 51AT, 59P1 / 59P1T, 81D1 / 81D1T).
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from . import curves
from .protection_v import build_extra

if TYPE_CHECKING:  # pragma: no cover
    from .engine import RelayEngine

_EPS = 1e-9
_HYST = 0.95

class _QtyLabel(dict):
    """Rótulos das grandezas; no SEL-787 as chaves por enrolamento (``W2_IG``, ``IN1``) são derivadas das base."""

    def __missing__(self, key: str) -> str:
        if key.startswith("W") and "_" in key:
            return f"{dict.__getitem__(self, key.split('_', 1)[1])} (W{key[1]})"
        return {"IN1": "corrente de neutro (IN1)"}.get(key, key)


QTY_LABEL = _QtyLabel({
    "IMAX": "máx. corrente de fase", "IA": "corrente fase A", "IB": "corrente fase B",
    "IC": "corrente fase C", "IN": "corrente de neutro (IN)", "IG": "corrente residual (IG)",
    "I2": "3I2 (seq. negativa)",
})
_INST_QTY = {"P": "IMAX", "N": "IN", "G": "IG", "Q": "I2"}
_TIME_QTY = {"A": "IA", "B": "IB", "C": "IC", "P": "IMAX", "Q": "I2", "N": "IN", "G": "IG"}


class _Element:
    kind = ""

    def __init__(self, eng: "RelayEngine", base: str, tc_key: str | None) -> None:
        self.eng = eng
        self.base = base
        self.tc_key = tc_key
        self.dir_key = ""          # bit de controle direcional (ex.: P1DIR); vazio = não direcional
        self.pk = False
        self.timed = False
        self.measured = 0.0

    def tc_only(self) -> bool:
        if not self.tc_key:
            return True
        return bool(self.eng.ev(self.eng.group_cls, self.tc_key)) if self.eng.group_has(self.tc_key) else True

    def dir_ok(self) -> bool:
        """Controle direcional (figuras 4.41, 4.42, 4.60 e 4.61): vale 1 se o nível é não direcional."""
        return bool(self.eng.vals.get(self.dir_key, 1.0)) if self.dir_key else True

    def tc(self) -> bool:
        return self.tc_only() and self.dir_ok()

    def publish(self) -> None:
        v = self.eng.vals
        v[self.pk_bit] = 1.0 if self.pk else 0.0
        v[self.t_bit] = 1.0 if self.timed else 0.0

    def info(self) -> dict:  # pragma: no cover - sobrescrito
        raise NotImplementedError


class InstOc(_Element):
    """Instantâneo/tempo definido (50P, 50N, 50G, 50Q), figura 4.2 do manual.

    ``phase_bits``: nos elementos 50P1 e 50P2 de fase máxima também existem os bits por fase
    (50A1P, 50B1P, 50C1P...), cada um comparando |IA|, |IB| ou |IC| com o mesmo pickup.
    """
    kind = "50"

    def __init__(self, eng, base: str, qty: str, pickup: float, delay: float | None, tc_key: str | None) -> None:
        super().__init__(eng, base, tc_key)
        self.qty, self.pickup = qty, pickup
        self.delay_off = delay is None          # atraso OFF: elemento desabilitado
        self.delay = delay or 0.0
        self.pk_bit, self.t_bit = base + "P", base + "T"
        self.dir_bits = (f"67{base[2:]}P", f"67{base[2:]}T")   # versões "67" (controladas pelo sentido)
        self.elapsed = 0.0
        self.phase_pk: dict[str, bool] = {}
        if base[2] == "P" and base[3] in "12":
            self.phase_pk = {ph: False for ph in "ABC"}

    def update(self, dt: float) -> None:
        meas = self.eng.meas[self.qty]
        self.measured = meas
        thr = self.pickup
        enabled = self.tc()
        for ph in self.phase_pk:
            mph = self.eng.meas["I" + ph]
            self.phase_pk[ph] = bool(enabled and (mph >= thr or (self.phase_pk[ph] and mph >= _HYST * thr)))
            self.eng.vals[f"50{ph}{self.base[3]}P"] = 1.0 if self.phase_pk[ph] else 0.0
        self.pk = bool(enabled and not self.delay_off and (meas >= thr or (self.pk and meas >= _HYST * thr)))
        if self.pk:
            self.elapsed += dt
            self.timed = self.elapsed >= self.delay - _EPS
        else:
            self.elapsed = 0.0
            self.timed = False
        self.publish()
        self.eng.vals[self.dir_bits[0]] = 1.0 if self.pk else 0.0
        self.eng.vals[self.dir_bits[1]] = 1.0 if self.timed else 0.0

    def info(self) -> dict:
        return {
            "name": self.base, "kind": "Instantâneo (50)", "quantity": QTY_LABEL[self.qty],
            "pickup": self.pickup,
            "setting": f"{self.pickup:g} A sec., atraso " + ("OFF (desabilitado)" if self.delay_off else f"{self.delay:g} s"),
            "multiple": round(self.measured / self.pickup, 3) if self.pickup else 0.0,
            "tc": self.tc_key and self.eng.expr_text(self.eng.group_cls, self.tc_key) or "",
            "measured": round(self.measured, 3), "pickup_bit": self.pk_bit, "timed_bit": self.t_bit,
            "pk": self.pk, "timed": self.timed,
            "dir_bit": self.dir_key, "dir_ok": self.dir_ok(),
            "progress": min(100.0, 100.0 * self.elapsed / self.delay) if self.delay > 0 and self.pk else (100.0 if self.timed else 0.0),
        }


class TimeOc(_Element):
    kind = "51"

    def __init__(self, eng, base: str, qty: str, pickup: float, curve: str, td: float,
                 reset_em: bool, const_time: float, min_resp: float, tc_key: str | None) -> None:
        super().__init__(eng, base, tc_key)
        self.qty, self.pickup, self.curve, self.td = qty, pickup, curve, td
        self.reset_em, self.const_time, self.min_resp = reset_em, const_time, min_resp
        self.pk_bit, self.t_bit, self.r_bit = base + "P", base + "T", base + "R"
        self.progress = 0.0      # fração do disco já percorrida (0 a 1)
        self.multiple = 0.0
        self.t_op = float("inf")
        self.idle = 0.0          # tempo desde a queda do pickup (reset de 1 ciclo)
        self.reset = True        # bit 51_R: elemento totalmente rearmado
        self.saturate = (eng.settings.get("G", "51SAT", "Y").strip().upper() != "N")

    def _operate_time(self) -> float:
        """Tempo total da curva para o múltiplo atual, com 51_MR (piso) e 51_CT (somador)."""
        t = curves.operate_time(self.curve, self.multiple, self.td, self.saturate)
        if t == float("inf"):
            return t
        return max(t, self.min_resp) + self.const_time

    def update(self, dt: float) -> None:
        meas = self.eng.meas[self.qty]
        self.measured = meas
        thr = self.pickup
        enabled = self.tc()
        self.pk = bool(enabled and (meas >= thr or (self.pk and meas >= _HYST * thr)))
        if self.pk:
            self.idle = 0.0
            self.multiple = meas / thr
            self.t_op = self._operate_time()
            if self.t_op != float("inf"):
                self.progress += dt / self.t_op
            if self.progress >= 1.0 - _EPS:
                self.progress = 1.0
                self.timed = True
        else:
            self.timed = False
            self.multiple = 0.0
            self.t_op = float("inf")
            if self.reset_em:
                # reset eletromecânico: o disco volta na velocidade dada pela corrente atual (M < 1)
                m = (meas / thr) if (enabled and thr > 0) else 0.0
                self.progress = max(0.0, self.progress - dt / curves.reset_time(self.curve, self.td, m))
            else:
                # reset em 1 ciclo da frequência nominal
                self.idle += dt
                if self.idle >= 1.0 / self.eng.nominal_freq - _EPS:
                    self.progress = 0.0
        self.reset = bool(not self.pk and self.progress <= _EPS)
        self.eng.vals[self.r_bit] = 1.0 if self.reset else 0.0
        self.publish()

    def info(self) -> dict:
        return {
            "name": self.base, "kind": f"Temporizado (51) {self.curve}", "quantity": QTY_LABEL[self.qty],
            "pickup": self.pickup,
            "setting": f"{self.pickup:g} A sec., curva {self.curve}, dial {self.td:g}"
                       + (f", CT {self.const_time:g} s" if self.const_time else "")
                       + (f", MR {self.min_resp:g} s" if self.min_resp else "")
                       + (", reset EM" if self.reset_em else ", reset 1 ciclo"),
            "multiple": round(self.multiple, 3),
            "t_op": None if self.t_op == float("inf") else round(self.t_op, 3),
            "reset_bit": self.r_bit, "reset": self.reset,
            "tc": self.tc_key and self.eng.expr_text(self.eng.group_cls, self.tc_key) or "",
            "measured": round(self.measured, 3), "pickup_bit": self.pk_bit, "timed_bit": self.t_bit,
            "pk": self.pk, "timed": self.timed, "progress": round(100.0 * self.progress, 1),
            "dir_bit": self.dir_key, "dir_ok": self.dir_ok(),
        }


class DefiniteElement(_Element):
    """Elemento de tempo definido: 27 / 59 (fase, fase-fase, VS, residual, seq. negativa) / 81D."""

    def __init__(self, eng, base: str, family: str, pickup: float, delay: float, tc_key: str | None = None) -> None:
        super().__init__(eng, base, tc_key)
        self.family, self.pickup, self.delay = family, pickup, delay
        self.pk_bit, self.t_bit = base, base + "T"
        self.elapsed = 0.0

    def _measure(self) -> tuple[float, bool]:
        """Retorna (valor medido, é_sub?)."""
        m = self.eng.meas
        f = self.family
        if f == "27P":
            return min(m["VA"], m["VB"], m["VC"]), True
        if f == "27PP":
            return min(m["VAB"], m["VBC"], m["VCA"]), True
        if f == "27S":
            return m["VS"], True
        if f == "59S":
            return m["VS"], False
        if f == "59P":
            return max(m["VA"], m["VB"], m["VC"]), False
        if f == "59PP":
            return max(m["VAB"], m["VBC"], m["VCA"]), False
        if f == "59G":
            return m["VG"], False
        if f == "59Q":
            return m["V2"], False
        freq = m["FREQ"]
        return freq, self.pickup < self.eng.nominal_freq

    def update(self, dt: float) -> None:
        meas, under = self._measure()
        self.measured = meas
        thr = self.pickup
        if under:
            self.pk = bool(meas <= thr or (self.pk and meas <= thr / _HYST)) if self.family != "81D" else bool(meas <= thr)
        else:
            self.pk = bool(meas >= thr or (self.pk and meas >= _HYST * thr)) if self.family != "81D" else bool(meas >= thr)
        if self.pk:
            self.elapsed += dt
            self.timed = self.elapsed >= self.delay - _EPS
        else:
            self.elapsed = 0.0
            self.timed = False
        self.publish()

    def info(self) -> dict:
        unit = "Hz" if self.family == "81D" else "V sec."
        return {
            "name": self.base, "kind": {"27P": "Subtensão fase (27)", "27PP": "Subtensão fase-fase (27)",
                                        "27S": "Subtensão VS (27)", "59S": "Sobretensão VS (59)",
                                        "59P": "Sobretensão fase (59)", "59PP": "Sobretensão fase-fase (59)",
                                        "59G": "Sobretensão residual (59G)", "59Q": "Sobretensão seq. neg. (59Q)",
                                        "81D": "Frequência (81)"}[self.family],
            "quantity": "tensão/frequência", "pickup": self.pickup,
            "setting": f"{self.pickup:g} {unit}, atraso {self.delay:g} s", "tc": "",
            "measured": round(self.measured, 3), "pickup_bit": self.pk_bit, "timed_bit": self.t_bit,
            "pk": self.pk, "timed": self.timed,
            "progress": min(100.0, 100.0 * self.elapsed / self.delay) if self.delay > 0 and self.pk else (100.0 if self.timed else 0.0),
        }


_RE_INST = re.compile(r"^50([PNGQ])([1-4])P$")
_RE_TIME = re.compile(r"^51(A|B|C|P1|P2|Q|N1|N2|G1|G2)P$")
_RE_VOLT = re.compile(r"^(27P|27PP|27S|59P|59PP|59S|59G|59Q)([1-4])P$")
_RE_FREQ = re.compile(r"^81D([1-6])TP$")


def build_elements(eng: "RelayEngine") -> tuple[list[_Element], int]:
    """Cria os elementos habilitados do grupo ativo. Retorna (elementos, qtde desabilitados)."""
    st = eng.settings
    gcls = eng.group_cls
    elements: list[_Element] = []
    off = 0

    def num(key: str, default: float | None = None) -> float | None:
        return st.number(gcls, key, default)

    for key in st.sections[gcls]:
        # registra os bits (mesmo com o elemento desabilitado) para que as equações os enxerguem
        if eng.model != "787" and (_RE_INST.match(key) or _RE_TIME.match(key)):
            eng.vals.setdefault(key, 0.0)
            eng.vals.setdefault(key[:-1] + "T", 0.0)
            if _RE_TIME.match(key):
                eng.vals.setdefault(key[:-1] + "R", 0.0)
            if key[:4] in ("50P1", "50P2"):
                for ph in "ABC":
                    eng.vals.setdefault(f"50{ph}{key[3]}P", 0.0)
            if _RE_INST.match(key):
                eng.vals.setdefault(f"67{key[2:-1]}P", 0.0)
                eng.vals.setdefault(f"67{key[2:-1]}T", 0.0)
        elif _RE_VOLT.match(key):
            eng.vals.setdefault(key[:-1], 0.0)
            eng.vals.setdefault(key[:-1] + "T", 0.0)
        elif _RE_FREQ.match(key):
            eng.vals.setdefault(key[:-2], 0.0)
            eng.vals.setdefault(key[:-2] + "T", 0.0)
        m = None if eng.model == "787" else _RE_INST.match(key)
        if m:
            pickup = num(key)
            if pickup is None or pickup <= 0:
                off += 1
                continue
            base = key[:-1]
            tc = base + "TC"
            # atraso OFF desabilita o elemento (manual, tabelas 4.9 a 4.12)
            delay = None if st.get(gcls, base + "D", "0").strip().upper() == "OFF" else (num(base + "D", 0.0) or 0.0)
            el = InstOc(eng, base, _INST_QTY[m.group(1)], pickup, delay, tc if eng.group_has(tc) else None)
            el.dir_key = f"{m.group(1)}{m.group(2)}DIR"       # nível n: DIRn (P/N/G/Q)
            elements.append(el)
            continue
        m = None if eng.model == "787" else _RE_TIME.match(key)        # SEL-787: 50/51 por enrolamento em protection_787.py
        if m:
            pickup = num(key)
            if pickup is None or pickup <= 0:
                off += 1
                continue
            base = key[:-1]
            tc = base + "TC"
            el = TimeOc(
                eng, base, _TIME_QTY[m.group(1)[0]], pickup, st.get(gcls, base + "C", "C1").strip() or "C1",
                num(base + "TD", 1.0) or 1.0, st.get(gcls, base + "RS", "N").strip().upper() == "Y",
                num(base + "CT", 0.0) or 0.0, num(base + "MR", 0.0) or 0.0, tc if eng.group_has(tc) else None)
            letter = "P" if m.group(1)[0] in "ABC" else m.group(1)[0]
            el.dir_key = f"{letter}1DIR"                      # todos os 51 são controlados pelo nível 1 (DIR1)
            elements.append(el)
            continue
        m = _RE_VOLT.match(key)
        if m:
            pickup = num(key)
            if pickup is None:
                off += 1
                continue
            base = key[:-1]
            elements.append(DefiniteElement(eng, base, m.group(1), pickup, num(base + "D", 0.0) or 0.0))
            continue
        m = _RE_FREQ.match(key)
        if m:
            pickup = num(key)
            if pickup is None:
                off += 1
                continue
            base = f"81D{m.group(1)}"
            tc = base + "TC"
            elements.append(DefiniteElement(eng, base, "81D", pickup, num(base + "TD", 0.0) or 0.0))
    eng.vals.setdefault("ORED50T", 0.0)
    eng.vals.setdefault("ORED51T", 0.0)
    elements += build_extra(eng)
    if eng.model == "787":
        from .protection_787 import build_787

        e787, o787 = build_787(eng)
        return elements + e787, off + o787
    return elements, off


def update_ored(eng: "RelayEngine", elements: list[_Element]) -> None:
    """ORED50T / ORED51T: OU de todos os bits de tempo dos elementos 50 e 51."""
    eng.vals["ORED50T"] = 1.0 if any(e.timed for e in elements if e.kind == "50") else 0.0
    eng.vals["ORED51T"] = 1.0 if any(e.timed for e in elements if e.kind == "51") else 0.0
