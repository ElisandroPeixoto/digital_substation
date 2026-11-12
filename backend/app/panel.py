"""Painel frontal: LEDs de alvo, LEDs dos botões, display (pontos DP) e rótulos."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from .describe import format_dp, parse_dp
from .selogic import Expr

if TYPE_CHECKING:  # pragma: no cover
    from .engine import RelayEngine

_COLORS = {"R": "red", "G": "green", "A": "amber", "O": "off", "Y": "amber"}


def _color(code: str) -> str:
    return _COLORS.get(code.upper()[:1], "off")


class Panel:
    def __init__(self, eng: "RelayEngine") -> None:
        self.eng = eng
        self.target_ids: list[str] = []
        self.pb_ids: list[int] = []
        self.dps: list[dict] = []
        self.latched: dict[str, bool] = {}
        self.target_on: dict[str, bool] = {}
        self.pb_state: dict[int, dict] = {}
        self.trip_led = False

    # ------------------------------------------------------------------
    @property
    def F(self) -> dict:
        return self.eng.settings.sections.get("F", {})

    def rebuild(self) -> None:
        F = self.F
        self.target_ids = sorted({m.group(1) for k in F if (m := re.fullmatch(r"T(\d\d)_LED", k))})
        self.pb_ids = sorted({int(m.group(1)) for k in F if (m := re.fullmatch(r"PB(\d)[AB]_LED", k))})
        self.dps = []
        for k in sorted(k for k in F if re.fullmatch(r"DP\d\d", k)):
            dp = parse_dp(F[k])
            if dp:
                dp["key"] = k
                self.dps.append(dp)

    def update(self, dt: float) -> None:
        eng = self.eng
        F = self.F
        v = eng.vals
        trgtr = v["TRGTR"] != 0
        reset_on_trip = F.get("RSTLED", "N").upper() == "Y"
        if eng.trip_rose:
            self.trip_led = True
            if reset_on_trip:
                self.latched = {k: False for k in self.latched}
        elif trgtr and v["TRIP"] == 0:
            self.trip_led = False
        for n in self.target_ids:
            asserted = bool(eng.ev("F", f"T{n}_LED"))
            latch_mode = F.get(f"T{n}LEDL", "N").upper() == "Y"
            if trgtr:
                self.latched[n] = False
            if asserted and latch_mode:
                self.latched[n] = True
            self.target_on[n] = asserted or self.latched.get(n, False)
        for n in self.pb_ids:
            st = {}
            for side in ("A", "B"):
                asserted = bool(eng.ev("F", f"PB{n}{side}_LED"))
                code = (F.get(f"PB{n}{side}LEDC", "AO") + "O")[:2]
                st[side.lower()] = {"on": asserted and _color(code[0]) != "off" or (not asserted and _color(code[1]) != "off"),
                                    "color": _color(code[0]) if asserted else _color(code[1])}
            self.pb_state[n] = st

    # ------------------------------------------------------------------
    def static_info(self) -> dict:
        F = self.F
        targets = []
        for n in self.target_ids:
            e = Expr(F.get(f"T{n}_LED", ""))
            targets.append({"id": f"T{n}", "label": e.comment or e.text, "latched": F.get(f"T{n}LEDL", "N").upper() == "Y",
                            "color": _color(F.get(f"T{n}LEDC", "R"))})
        pbs = []
        for n in range(1, 9):
            ea, eb = Expr(F.get(f"PB{n}A_LED", "")), Expr(F.get(f"PB{n}B_LED", ""))
            pbs.append({"n": n, "label_a": ea.comment if not ea.disabled and ea.text != "0" else "",
                        "label_b": eb.comment if not eb.disabled and eb.text != "0" else ""})
        return {"targets": targets, "pb": pbs, "enabled_color": _color(F.get("LEDENAC", "G")),
                "trip_color": _color(F.get("LEDTRPC", "R"))}

    def lcd_points(self) -> list[str]:
        eng = self.eng
        v = eng.vals
        lines: list[str] = []
        for dp in self.dps:
            name = dp["name"]
            if dp["kind"] == "bool":
                val = True if name == "1" else bool(v.get(name, 0.0))
                text = dp["text1"] if val else dp["text0"]
                if text:
                    lines.append(text.rstrip())
            else:
                if name in v:
                    value = v[name]
                elif name in eng.g:
                    value = eng.g[name]
                else:
                    continue
                lines.append(format_dp(dp["fmt"], value).rstrip())
        return lines

    def snapshot(self) -> dict:
        eng = self.eng
        v = eng.vals
        sim = eng.field.cfg
        return {
            "enabled": {"on": not sim.halarm, "color": _color(self.F.get("LEDENAC", "G"))},
            "trip": {"on": self.trip_led, "color": _color(self.F.get("LEDTRPC", "R"))},
            "targets": [{"id": f"T{n}", "on": self.target_on.get(n, False),
                         "color": _color(self.F.get(f"T{n}LEDC", "R")), "latched": self.latched.get(n, False)}
                        for n in self.target_ids],
            "pb": [{"n": n, **self.pb_state.get(n, {"a": {"on": False, "color": "off"}, "b": {"on": False, "color": "off"}})}
                   for n in range(1, 9)],
            "lcd": self.lcd_points(),
        }
