"""Elementos de proteção simulados: 50/51 (sobrecorrente), 27/59 (tensão) e 81D (frequência).

Os elementos são criados a partir dos ajustes do grupo ativo. Pickups em ``OFF``
desabilitam o elemento. Os bits do Relay Word seguem o padrão do SEL-751
(ex.: 50P1P / 50P1T, 51P1P / 51P1T, 51AP / 51AT, 59P1 / 59P1T, 81D1 / 81D1T).
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from . import curves

if TYPE_CHECKING:  # pragma: no cover
    from .engine import RelayEngine

_EPS = 1e-9
_HYST = 0.95

QTY_LABEL = {
    "IMAX": "máx. corrente de fase", "IA": "corrente fase A", "IB": "corrente fase B",
    "IC": "corrente fase C", "IN": "corrente de neutro (IN)", "IG": "corrente residual (IG)",
    "I2": "3I2 (seq. negativa)",
}
_INST_QTY = {"P": "IMAX", "N": "IN", "G": "IG", "Q": "I2"}
_TIME_QTY = {"A": "IA", "B": "IB", "C": "IC", "P": "IMAX", "Q": "I2", "N": "IN", "G": "IG"}


class _Element:
    kind = ""

    def __init__(self, eng: "RelayEngine", base: str, tc_key: str | None) -> None:
        self.eng = eng
        self.base = base
        self.tc_key = tc_key
        self.pk = False
        self.timed = False
        self.measured = 0.0

    def tc(self) -> bool:
        if not self.tc_key:
            return True
        return bool(self.eng.ev(self.eng.group_cls, self.tc_key)) if self.eng.group_has(self.tc_key) else True

    def publish(self) -> None:
        v = self.eng.vals
        v[self.pk_bit] = 1.0 if self.pk else 0.0
        v[self.t_bit] = 1.0 if self.timed else 0.0

    def info(self) -> dict:  # pragma: no cover - sobrescrito
        raise NotImplementedError


class InstOc(_Element):
    kind = "50"

    def __init__(self, eng, base: str, qty: str, pickup: float, delay: float, tc_key: str | None) -> None:
        super().__init__(eng, base, tc_key)
        self.qty, self.pickup, self.delay = qty, pickup, delay
        self.pk_bit, self.t_bit = base + "P", base + "T"
        self.elapsed = 0.0

    def update(self, dt: float) -> None:
        meas = self.eng.meas[self.qty]
        self.measured = meas
        thr = self.pickup
        enabled = self.tc()
        self.pk = bool(enabled and (meas >= thr or (self.pk and meas >= _HYST * thr)))
        if self.pk:
            self.elapsed += dt
            self.timed = self.elapsed >= self.delay - _EPS
        else:
            self.elapsed = 0.0
            self.timed = False
        self.publish()

    def info(self) -> dict:
        return {
            "name": self.base, "kind": "Instantâneo (50)", "quantity": QTY_LABEL[self.qty],
            "pickup": self.pickup, "setting": f"{self.pickup:g} A sec., atraso {self.delay:g} s",
            "tc": self.tc_key and self.eng.expr_text(self.eng.group_cls, self.tc_key) or "",
            "measured": round(self.measured, 3), "pickup_bit": self.pk_bit, "timed_bit": self.t_bit,
            "pk": self.pk, "timed": self.timed,
            "progress": min(100.0, 100.0 * self.elapsed / self.delay) if self.delay > 0 and self.pk else (100.0 if self.timed else 0.0),
        }


class TimeOc(_Element):
    kind = "51"

    def __init__(self, eng, base: str, qty: str, pickup: float, curve: str, td: float,
                 reset_em: bool, const_time: float, tc_key: str | None) -> None:
        super().__init__(eng, base, tc_key)
        self.qty, self.pickup, self.curve, self.td = qty, pickup, curve, td
        self.reset_em, self.const_time = reset_em, const_time
        self.pk_bit, self.t_bit = base + "P", base + "T"
        self.progress = 0.0
        self.multiple = 0.0

    def update(self, dt: float) -> None:
        meas = self.eng.meas[self.qty]
        self.measured = meas
        thr = self.pickup
        enabled = self.tc()
        self.pk = bool(enabled and (meas >= thr or (self.pk and meas >= _HYST * thr)))
        if self.pk:
            self.multiple = meas / thr
            t_op = curves.operate_time(self.curve, self.multiple, self.td) + self.const_time
            if t_op != float("inf"):
                self.progress += dt / t_op
            if self.progress >= 1.0 - _EPS:
                self.progress = 1.0
                self.timed = True
        else:
            self.timed = False
            self.multiple = 0.0
            if self.reset_em:
                self.progress = max(0.0, self.progress - dt / curves.reset_time(self.curve, self.td))
            else:
                self.progress = 0.0
        self.publish()

    def info(self) -> dict:
        return {
            "name": self.base, "kind": f"Temporizado (51) {self.curve}", "quantity": QTY_LABEL[self.qty],
            "pickup": self.pickup,
            "setting": f"{self.pickup:g} A sec., curva {self.curve}, dial {self.td:g}",
            "tc": self.tc_key and self.eng.expr_text(self.eng.group_cls, self.tc_key) or "",
            "measured": round(self.measured, 3), "pickup_bit": self.pk_bit, "timed_bit": self.t_bit,
            "pk": self.pk, "timed": self.timed, "progress": round(100.0 * self.progress, 1),
        }


class DefiniteElement(_Element):
    """Elemento de tempo definido: 27 / 59 / 81D."""

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
_RE_VOLT = re.compile(r"^(27P|27PP|59P|59PP|59G|59Q)([12])P$")
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
        if _RE_INST.match(key) or _RE_TIME.match(key):
            eng.vals.setdefault(key, 0.0)
            eng.vals.setdefault(key[:-1] + "T", 0.0)
        elif _RE_VOLT.match(key):
            eng.vals.setdefault(key[:-1], 0.0)
            eng.vals.setdefault(key[:-1] + "T", 0.0)
        elif _RE_FREQ.match(key):
            eng.vals.setdefault(key[:-2], 0.0)
            eng.vals.setdefault(key[:-2] + "T", 0.0)
        m = _RE_INST.match(key)
        if m:
            pickup = num(key)
            if pickup is None or pickup <= 0:
                off += 1
                continue
            base = key[:-1]
            tc = base + "TC"
            elements.append(InstOc(eng, base, _INST_QTY[m.group(1)], pickup, num(base + "D", 0.0) or 0.0,
                                   tc if eng.group_has(tc) else None))
            continue
        m = _RE_TIME.match(key)
        if m:
            pickup = num(key)
            if pickup is None or pickup <= 0:
                off += 1
                continue
            base = key[:-1]
            tc = base + "TC"
            elements.append(TimeOc(
                eng, base, _TIME_QTY[m.group(1)[0]], pickup, st.get(gcls, base + "C", "C1").strip() or "C1",
                num(base + "TD", 1.0) or 1.0, st.get(gcls, base + "RS", "N").strip().upper() == "Y",
                num(base + "CT", 0.0) or 0.0, tc if eng.group_has(tc) else None))
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
    return elements, off
