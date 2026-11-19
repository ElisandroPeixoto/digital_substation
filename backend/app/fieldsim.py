"""Simulação do "campo": fasores de corrente/tensão, falta e disjuntor.

Convenções: correntes em A primários, tensões em V primários (fase-neutro),
ângulos em graus. As tensões de referência são A=0°, B=-120°, C=+120°.
"""
from __future__ import annotations

import cmath
import math
from dataclasses import dataclass, field

A_OP = cmath.rect(1.0, math.radians(120.0))
A_OP2 = A_OP * A_OP

FAULT_TYPES = ("AG", "BG", "CG", "AB", "BC", "CA", "ABC")
_V_ANG = {"A": 0.0, "B": -120.0, "C": 120.0}
_FAULT_ANGLE = -75.0   # ângulo da corrente de falta em relação à tensão do laço

# (ângulo da corrente, fases afetadas, sinal) por tipo de falta
_FAULT_PHASORS: dict[str, dict[str, tuple[float, float]]] = {
    "AG": {"A": (-75.0, 1.0)},
    "BG": {"B": (-195.0, 1.0)},
    "CG": {"C": (45.0, 1.0)},
    "AB": {"A": (-45.0, 1.0), "B": (-45.0, -1.0)},
    "BC": {"B": (-165.0, 1.0), "C": (-165.0, -1.0)},
    "CA": {"C": (75.0, 1.0), "A": (75.0, -1.0)},
    "ABC": {"A": (-75.0, 1.0), "B": (-195.0, 1.0), "C": (45.0, 1.0)},
}
# Afundamento de tensão (fator) por fase durante a falta
_SAG: dict[str, dict[str, float]] = {
    "AG": {"A": 0.15}, "BG": {"B": 0.15}, "CG": {"C": 0.15},
    "AB": {"A": 0.55, "B": 0.55}, "BC": {"B": 0.55, "C": 0.55}, "CA": {"C": 0.55, "A": 0.55},
    "ABC": {"A": 0.15, "B": 0.15, "C": 0.15},
}


@dataclass
class SimConfig:
    # Fasores injetados (valores PRIMÁRIOS): módulo em A / V (fase-neutro) e ângulo em graus
    ia_mag: float = 100.0
    ia_ang: float = -18.0              # fp ~0,95 indutivo
    ib_mag: float = 100.0
    ib_ang: float = -138.0
    ic_mag: float = 100.0
    ic_ang: float = 102.0
    va_mag: float = 7967.4             # 13,8 kV / raiz(3); o motor ajusta pelo VNOM x PTR do relé
    va_ang: float = 0.0
    vb_mag: float = 7967.4
    vb_ang: float = -120.0
    vc_mag: float = 7967.4
    vc_ang: float = 120.0
    freq: float = 60.0
    vdc: float = 125.0
    open_ms: float = 60.0              # tempo mecânico de abertura do disjuntor
    close_ms: float = 100.0            # tempo mecânico de fechamento
    fault_type: str | None = None
    fault_current: float = 2400.0
    fault_persistent: bool = True
    lop: bool = False                  # perda de potencial simulada (bit LOP), acionada pelo usuário
    breaker_auto: bool = True          # 52A (IN101) acompanha o modelo do disjuntor
    analog_on: bool = False            # injeção analógica (inicia DESLIGADA: desligada = tensões e correntes zero)
    analog_off_on_output: bool = False  # desliga a injeção analógica quando uma saída digital (OUTxxx) atua
    analog_off_outputs: list = field(default_factory=list)  # saídas que disparam o desligamento (vazio = qualquer)
    halarm: bool = False
    linka: bool = True
    linkb: bool = True
    tsntpp: bool = True
    tsntpb: bool = True

    def to_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class Breaker:
    closed: bool = True
    moving: str | None = None          # "opening" | "closing"
    left: float = 0.0
    open_count: int = 0

    def state(self) -> str:
        if self.moving:
            return self.moving
        return "closed" if self.closed else "open"


class FieldSim:
    def __init__(self) -> None:
        self.cfg = SimConfig()
        self.breaker = Breaker()

    # ------------------------------------------------------------ fasores
    def phasors(self, ignore_switch: bool = False):
        """Retorna (I, V) como dicts de complexos em valores primários. `ignore_switch`: ignora a chave de injeção (valores ajustados, só para exibição).

        Base = fasores injetados pelo usuário. Uma falta ativa (com o disjuntor fechado) substitui
        as correntes das fases envolvidas e afunda as tensões. Disjuntor aberto = corrente zero.
        """
        cfg = self.cfg
        if not cfg.analog_on and not ignore_switch:
            return {ph: 0j for ph in "ABC"}, {ph: 0j for ph in "ABC"}
        faulted = self.breaker.closed and cfg.fault_type in _FAULT_PHASORS
        sag = _SAG.get(cfg.fault_type or "", {}) if faulted else {}
        V = {}
        I = {}
        for ph in "ABC":
            k = ph.lower()
            V[ph] = cmath.rect(getattr(cfg, f"v{k}_mag") * sag.get(ph, 1.0), math.radians(getattr(cfg, f"v{k}_ang")))
            if self.breaker.closed:
                I[ph] = cmath.rect(getattr(cfg, f"i{k}_mag"), math.radians(getattr(cfg, f"i{k}_ang")))
            else:
                I[ph] = 0j
        if faulted:
            for ph, (ang, sign) in _FAULT_PHASORS[cfg.fault_type].items():
                I[ph] = cmath.rect(cfg.fault_current * sign, math.radians(ang))
        return I, V

    def set_balanced_load(self, mag: float, angle: float = -18.0) -> None:
        cfg = self.cfg
        cfg.ia_mag = cfg.ib_mag = cfg.ic_mag = mag
        cfg.ia_ang, cfg.ib_ang, cfg.ic_ang = angle, angle - 120.0, angle + 120.0

    # -------------------------------------------------------------- falta
    def apply_fault(self, ftype: str, current: float | None = None, persistent: bool | None = None) -> None:
        if ftype not in FAULT_TYPES:
            raise ValueError(f"tipo de falta inválido: {ftype}")
        self.cfg.fault_type = ftype
        if current is not None:
            self.cfg.fault_current = float(current)
        if persistent is not None:
            self.cfg.fault_persistent = bool(persistent)

    def clear_fault(self) -> None:
        self.cfg.fault_type = None

    # ---------------------------------------------------------- disjuntor
    def step_breaker(self, dt: float, trip_coil: bool, close_coil: bool) -> None:
        bk = self.breaker
        cfg = self.cfg
        if bk.closed:
            if trip_coil and bk.moving != "opening":
                bk.moving = "opening"
                bk.left = cfg.open_ms / 1000.0
            if bk.moving == "opening":
                bk.left -= dt
                if bk.left <= 1e-9:
                    bk.closed = False
                    bk.moving = None
                    bk.open_count += 1
                    if not cfg.fault_persistent:
                        cfg.fault_type = None
        else:
            if close_coil and not trip_coil and bk.moving != "closing":
                bk.moving = "closing"
                bk.left = cfg.close_ms / 1000.0
            if bk.moving == "closing":
                if trip_coil:
                    bk.moving = None
                else:
                    bk.left -= dt
                    if bk.left <= 1e-9:
                        bk.closed = True
                        bk.moving = None

    def force_position(self, closed: bool) -> None:
        self.breaker.closed = closed
        self.breaker.moving = None
        if not closed and not self.cfg.fault_persistent:
            self.cfg.fault_type = None


PRESETS: dict[str, dict] = {
    "normal": {"label": "Carga normal (100 A)", "fault": None, "load": 100.0},
    "overload": {"label": "Sobrecarga (400 A)", "fault": None, "load": 400.0},
    "ag": {"label": "Falta fase A-terra (2400 A)", "fault": "AG", "current": 2400.0},
    "bc": {"label": "Falta bifásica B-C (2000 A)", "fault": "BC", "current": 2000.0},
    "abc": {"label": "Falta trifásica (3000 A)", "fault": "ABC", "current": 3000.0},
}
