"""Painel frontal do SEL-311C: LEDs de alvo, 10 botões com LED, display 2×16 (pontos DP) e bits locais (LB).

- LEDs de alvo: ENABLED, TRIP (LED12), TIME (13), COMM (14), SOTF (15), RS (16), LO (17), 51 (18), FAULT TYPE A/B/C/G (19–22)
  e ZONE/LEVEL 1–4 (23–26). O texto de cada um vem de ``LEDnnA`` (Global) e a retenção de ``LEDnnL``; a equação ``LEDnn``
  (Lógica) define o acionamento – no padrão ela cita os bits de alvo ``LTRIP``, ``LTIME``, ``LZONE1``…, que o relé grava no
  disparo e só apaga com TARGET RESET (ou ao fechar o disjuntor, se RSTLED = Y/Y1).
- FAULT TYPE: fases com corrente ≥ 60 % da maior no disparo; G com 3I0 ≥ 10 % dela (e ≥ 0,5 A sec.). Simplificação do simulador.
- Botões PB1–PB10: LEDs ``LED1``–``LED10`` (Lógica). O texto do botão fica só no navegador (como no 751).
- Display: tela de medição (IA/IB/IC/IN primários) e pontos ``DPn`` (bit em Lógica, textos ``DPn_1``/``DPn_0`` em Text).
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from .selogic import Expr

if TYPE_CHECKING:  # pragma: no cover
    from .engine311c import Relay311CEngine

TARGET_LEDS = [(12, "TRIP"), (13, "TIME"), (14, "COMM"), (15, "SOTF"), (16, "RS"), (17, "LO"), (18, "51"),
               (23, "ZONE1"), (24, "ZONE2"), (25, "ZONE3"), (26, "ZONE4")]
FAULT_LEDS = [(19, "A"), (20, "B"), (21, "C"), (22, "G")]
TARGET_BITS = ["LTRIP", "LTIME", "LCOMM", "LSOTF", "L51", "LZONE1", "LZONE2", "LZONE3", "LZONE4"]
_ZONE_RE = [re.compile(r"^[MZ]([1-4])(?:P|G|PT|GT|T)$"), re.compile(r"^(?:MAB|MBC|MCA|MPP|MABC|[MX][ABC]G)([1-4])$"),
            re.compile(r"^(?:50|67)[PGQ]([1-4])T?$")]


class Panel311C:
    def __init__(self, eng: "Relay311CEngine") -> None:
        self.eng = eng
        self.latched: dict[int, bool] = {}
        self.led_on: dict[int, bool] = {}
        self.fault: dict[str, bool] = {"A": False, "B": False, "C": False, "G": False}
        self.dps: list[tuple[str, str, str]] = []
        self.prev_52a = True

    @property
    def T(self) -> dict:
        return self.eng.settings.sections.get("T", {})

    def _g(self, key: str, default: str = "") -> str:
        return self.eng.settings.get("G", key, default).strip()

    def rebuild(self) -> None:
        T, lc = self.T, self.eng.logic_cls
        self.dps = []
        for n in range(1, 17):
            expr = self.eng.settings.get(lc, f"DP{n}", "").strip().upper()
            t1, t0 = T.get(f"DP{n}_1", ""), T.get(f"DP{n}_0", "")
            if expr and expr not in ("NA", "0") and (t1 or t0):
                self.dps.append((expr, t1, t0))

    # ------------------------------------------------------------- disparo
    def capture(self, trcomm: bool, trsotf: bool) -> None:
        """Grava os alvos no instante do disparo (bordas de subida de TRIP)."""
        eng, v = self.eng, self.eng.vals
        if self._g("RSTLED", "N").upper().startswith("Y"):
            self.clear_targets()
        lc = eng.logic_cls
        active = [i for i in eng.expr(lc, "TR").idents if v.get(i)] + \
                 ([i for i in eng.expr(lc, "TRSOTF").idents if v.get(i)] if trsotf else []) + \
                 ([i for i in eng.expr(lc, "TRCOMM").idents if v.get(i)] if trcomm else [])
        tg = {"LTRIP": True, "LCOMM": trcomm, "LSOTF": trsotf}
        for ident in active:
            for rx in _ZONE_RE:
                m = rx.match(ident)
                if m:
                    tg[f"LZONE{m.group(1)}"] = True
            if ident in ("51PT", "51GT", "51QT"):
                tg["L51"] = True
            d = eng.delay_of(ident)
            if d is not None and d > 0:
                tg["LTIME"] = True
        for k, on in tg.items():
            if on:
                v[k] = 1.0
        I = eng.core.I
        mags = {p: abs(I[p]) for p in "ABC"}
        imax = max(mags.values())
        if imax > 1e-6:
            for p in "ABC":
                if mags[p] >= 0.6 * imax:
                    self.fault[p] = True
            ig = abs(I["A"] + I["B"] + I["C"])
            if ig >= max(0.5, 0.1 * imax):
                self.fault["G"] = True

    def clear_targets(self) -> None:
        for k in TARGET_BITS:
            self.eng.vals[k] = 0.0
        self.latched = {}
        self.fault = {k: False for k in self.fault}

    # ------------------------------------------------------------- ciclo
    def update(self, dt: float) -> None:
        eng, v = self.eng, self.eng.vals
        a52 = bool(v.get("52A"))
        if v.get("TRGTR") or bool(eng.ev(eng.logic_cls, "RSTTRGT")):
            self.clear_targets()
        elif a52 and not self.prev_52a and self._g("RSTLED", "N").upper().startswith("Y") and not v.get("TRIP"):
            self.clear_targets()                      # RSTLED = Y/Y1: alvos apagam ao fechar o disjuntor
        self.prev_52a = a52
        lc = eng.logic_cls
        for n in list(range(1, 11)) + [n for n, _ in TARGET_LEDS]:
            key = f"LED{n}"
            if eng.group_has(key):
                on = bool(eng.ev(lc, key))
            else:
                lab = self._g(f"LED{n}A", "").upper()
                on = bool(v.get(f"L{lab}", 0.0)) if lab and lab not in ("RS", "LO") else bool(v.get(f"79{lab}", 0.0)) if lab else False
            if n >= 12 and self._g(f"LED{n}L", "N").upper() == "Y":
                if on:
                    self.latched[n] = True
                on = on or self.latched.get(n, False)
            self.led_on[n] = on

    # ------------------------------------------------------------- snapshot
    def static_info(self) -> dict:
        targets = [{"id": f"T{n}", "label": self._g(f"LED{n}A", d) or d, "latched": self._g(f"LED{n}L", "N").upper() == "Y",
                    "color": "red"} for n, d in TARGET_LEDS]
        pbs = [{"n": n, "label_a": Expr(self.eng.settings.get(self.eng.logic_cls, f"LED{n}", "")).text, "label_b": ""}
               for n in range(1, 11)]
        return {"targets": targets, "pb": pbs, "enabled_color": "green", "trip_color": "red",
                "local_bits": self.local_bits_static()}

    def local_bits_static(self) -> list[dict]:
        T = self.T
        out = []
        for n in range(1, 17):
            name = T.get(f"NLB{n}", "").strip()
            if name:
                out.append({"n": n, "name": name, "clear": T.get(f"CLB{n}", "").strip(), "set": T.get(f"SLB{n}", "").strip(),
                            "pulse": T.get(f"PLB{n}", "").strip()})
        return out

    def lcd_points(self) -> list[str]:
        v = self.eng.vals
        lines: list[str] = []
        for expr, t1, t0 in self.dps:
            val = True if expr == "1" else bool(v.get(expr, 0.0))
            text = t1 if val else t0
            if text:
                lines.append(text.rstrip()[:16])
        return lines

    def snapshot(self) -> dict:
        eng = self.eng
        sim = eng.field.cfg
        tg = [{"id": f"T{n}", "on": self.led_on.get(n, False), "color": "red", "latched": self.latched.get(n, False)}
              for n, _ in TARGET_LEDS]
        return {
            "enabled": {"on": not sim.halarm, "color": "green"},
            "trip": {"on": self.led_on.get(12, False), "color": "red"},
            "targets": tg,
            "fault_type": [{"id": k, "on": self.fault[k]} for k in "ABCG"],
            "pb": [{"n": n, "a": {"on": self.led_on.get(n, False), "color": "amber" if self.led_on.get(n, False) else "off"},
                    "b": {"on": False, "color": "off"}} for n in range(1, 11)],
            "lcd": self.lcd_points(),
            "local_bits": [{**lb, "on": bool(eng.vals.get(f"LB{lb['n']}", 0.0)), "held": eng.fixed.get(f"LB{lb['n']}")}
                           for lb in self.local_bits_static()],
        }
