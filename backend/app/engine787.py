"""Motor do SEL-787 (proteção de transformador, 2 a 4 enrolamentos), construído sobre o motor do SEL-751.

Diferenças em relação ao 751:
- correntes por enrolamento (W1 a W4) mais o canal IN1; o enrolamento 1 usa a injeção ``ia_*``/``ib_*``/``ic_*`` e os demais ``wNia_*``...;
- proteções 87, REF1 e 50/51 por enrolamento (``protection_787.py``);
- disparo por enrolamento: ``TRn`` → ``TRIPn``, ``TRXFMR`` → ``TRIPXFMR`` (retenção ``TDURD`` e ``ULTRIPn``/``ULTRXFMR``) e um disjuntor
  simulado por enrolamento (bobinas deduzidas das saídas OUTxxx que citam ``TRIPn``/``TRIPXFMR``/``CLOSEn``);
- sem religamento (79).
"""
from __future__ import annotations

import cmath
import math
import re

from .engine import EPS, RelayEngine, SQRT3
from .fieldsim import A_OP, A_OP2, FieldSim
from .selogic import split_comment

_RE_IN = re.compile(r"IN\d{3}")


class Relay787Engine(RelayEngine):
    def __init__(self, settings, device_name: str = "") -> None:
        self.wph: dict[int, list[complex]] = {}        # correntes secundárias (A) de cada enrolamento: [A, B, C]
        self.in1_ph: complex = 0j                      # corrente secundária do canal IN1
        self._wf: dict[int, FieldSim] = {}
        self.bk_inputs: dict[int, str] = {}
        self.coils: dict[int, dict[str, list[str]]] = {n: {"trip": [], "close": []} for n in range(1, 5)}
        self._cl_prev = {n: False for n in range(1, 5)}
        self._close_t = {n: 0.0 for n in range(1, 5)}
        self._trip_t = {k: 0.0 for k in ("1", "2", "3", "4", "XFMR")}
        super().__init__(settings, device_name)
        names = ["TRIPXFMR", "TRXFMR", "ULTRXFMR", "TRIP"] + [f"{p}{n}" for n in range(1, 5) for p in ("TRIP", "TR", "CLOSE", "CF", "CL", "52A", "52B")]
        for n in names:
            self.vals.setdefault(n, 0.0)
        self._load_defaults()

    # ------------------------------------------------------------ utilitários
    def ctr_of(self, n: int) -> float:
        return self.settings.number(self.group_cls, f"CTR{n}", 1.0) or 1.0

    def wfield(self, n: int) -> FieldSim:
        """Disjuntor simulado do enrolamento n (o do enrolamento 1 é ``self.field``; os demais compartilham a configuração)."""
        if n == 1:
            return self.field
        f = self._wf.get(n)
        if f is None:
            f = self._wf[n] = FieldSim()
            f.cfg = self.field.cfg
        return f

    def _load_defaults(self) -> None:
        """Injeção inicial coerente com o ajuste: carga passante (100 % do TAP) que o diferencial enxerga como corrente nula."""
        from .protection_787 import enabled_windings, winding_taps

        st, g, cfg = self.settings, self.group_cls, self.field.cfg
        en = enabled_windings(self) or [1, 2]
        tap = winding_taps(self)
        ctc = {n: int(st.number(g, f"W{n}CTC", 0) or 0) for n in range(1, 5)}
        ref = en[0]
        mag1 = tap[ref] * self.ctr_of(ref)
        a1 = -18.0
        cfg.ia_mag = cfg.ib_mag = cfg.ic_mag = mag1
        cfg.ia_ang, cfg.ib_ang, cfg.ic_ang = a1, a1 - 120.0, a1 + 120.0
        n = en[1]                                          # segundo enrolamento: corrente passante oposta à de W1 (os demais ficam em zero)
        mag = tap[n] * self.ctr_of(n)
        ang = a1 + 30.0 * (ctc[ref] - ctc[n]) + 180.0     # a compensação CTC(m) gira os fasores de +30°·m
        for k, ph in enumerate("abc"):
            setattr(cfg, f"w{n}i{ph}_mag", mag)
            setattr(cfg, f"w{n}i{ph}_ang", ang - 120.0 * k)

    # ------------------------------------------------------------ configuração
    def _setup_inputs(self) -> None:
        super()._setup_inputs()
        # estado do disjuntor de cada enrolamento: 52An = INxxx (valor "0" = sem entrada de estado)
        self.bk_inputs = {}
        for n in range(1, 5):
            text, _ = split_comment(self.settings.get("1", f"52A{n}", "0"))
            if _RE_IN.fullmatch(text.upper() or ""):
                self.bk_inputs[n] = text.upper()
        if "IN101" in self.inputs and "IN101" not in self.bk_inputs.values():          # desfaz a suposição do 751 (52A = IN101)
            d = self._default_input("IN101")
            self.inputs["IN101"].raw = self.inputs["IN101"].filt = d
            self.vals["IN101"] = 1.0 if d else 0.0
        self.bk_input = self.bk_inputs.get(1, "")
        for n, name in self.bk_inputs.items():
            if name in self.inputs:
                self.inputs[name].raw = self.inputs[name].filt = True
                self.vals[name] = 1.0

    def _detect_coils(self) -> None:
        self.coils = {n: {"trip": [], "close": []} for n in range(1, 5)}
        allw = [n for n in range(1, 5) if self.settings.get(self.group_cls, f"E87W{n}", "Y").strip().upper() != "N" or n <= 2]
        for key in self.out_keys:
            ids = set(self.expr(self.logic_cls, key).idents)
            tn = [n for n in range(1, 5) if f"TRIP{n}" in ids]
            for n in tn:
                self.coils[n]["trip"].append(key)
            if not tn and "TRIPXFMR" in ids:
                for n in allw:
                    self.coils[n]["trip"].append(key)
            for n in range(1, 5):
                if f"CLOSE{n}" in ids:
                    self.coils[n]["close"].append(key)
        self.trip_outs = sorted({k for c in self.coils.values() for k in c["trip"]})
        self.close_outs = sorted({k for c in self.coils.values() for k in c["close"]})

    def input_raw(self, inp) -> bool:
        if self.field.cfg.breaker_auto:
            for n, name in self.bk_inputs.items():
                if inp.name == name:
                    return self.wfield(n).breaker.closed
        return inp.raw

    def set_input(self, name: str, value: bool) -> None:
        name = name.upper()
        if self.field.cfg.breaker_auto:
            for n, nm in self.bk_inputs.items():
                if nm == name:
                    self.wfield(n).force_position(bool(value))
                    return
        super().set_input(name, value)

    # ------------------------------------------------------------ medição
    def _update_meas(self, dt: float) -> None:
        super()._update_meas(dt)                       # tensões, energia e correntes do enrolamento 1 (field.phasors)
        cfg = self.field.cfg
        on = cfg.analog_on
        i1, _ = self.field.phasors()
        prim = {1: [i1["A"], i1["B"], i1["C"]]}
        for n in (2, 3, 4):
            if on and self.wfield(n).breaker.closed:
                prim[n] = [cmath.rect(getattr(cfg, f"w{n}i{p}_mag"), math.radians(getattr(cfg, f"w{n}i{p}_ang"))) for p in "abc"]
            else:
                prim[n] = [0j, 0j, 0j]
        m, v = self.meas, self.vals
        for n in range(1, 5):
            ctr = self.ctr_of(n)
            sec = [c / ctr for c in prim[n]]
            self.wph[n] = sec
            ia, ib, ic = (abs(c) for c in sec)
            m[f"W{n}_IA"], m[f"W{n}_IB"], m[f"W{n}_IC"] = ia, ib, ic
            m[f"W{n}_IMAX"] = max(ia, ib, ic)
            m[f"W{n}_IG"] = abs(sum(sec))
            m[f"W{n}_I2"] = abs(sec[0] + A_OP2 * sec[1] + A_OP * sec[2])
            for p, c, s in zip("ABC", prim[n], sec):
                v[f"I{p}W{n}_MAG"] = abs(c)
                v[f"I{p}W{n}_ANG"] = math.degrees(cmath.phase(c)) if abs(c) > 1e-9 else 0.0
                v[f"I{p}W{n}"] = abs(s)
                self.analog_keys.update((f"I{p}W{n}_MAG", f"I{p}W{n}_ANG", f"I{p}W{n}"))
        ctrn = self.settings.number(self.group_cls, "CTRN1", 1.0) or 1.0
        i_n = cmath.rect(cfg.in1_mag, math.radians(cfg.in1_ang)) if on else 0j
        self.in1_ph = i_n / ctrn
        m["IN1"] = abs(self.in1_ph)
        v["IN1_MAG"] = abs(i_n)
        self.analog_keys.add("IN1_MAG")

    # ------------------------------------------------------------ disparo / fechamento
    def _trip_stage(self, dt: float) -> None:
        v, g = self.vals, self.group_cls
        for n in range(1, 5):
            a52 = bool(self.ev(g, f"52A{n}")) if self.group_has(f"52A{n}") else False
            v[f"52A{n}"] = 1.0 if a52 else 0.0
            v[f"52B{n}"] = (1.0 if self.ev(g, f"52B{n}") else 0.0) if self.group_has(f"52B{n}") else (0.0 if a52 else 1.0)
        v["52A"], v["52B"] = v["52A1"], v["52B1"]
        v["FAULT"] = 1.0 if self.ev("G", "FAULT") else 0.0
        v["ER"] = 1.0 if self.ev("R", "ER") else 0.0
        rem = bool(self.ev(g, "REMTRIP")) if self.group_has("REMTRIP") else False
        tdurd = self.settings.number(g, "TDURD", 0.5) or 0.5
        self.trip_rose = False
        any_trip = False
        for key in ("1", "2", "3", "4", "XFMR"):
            tr_name = f"TR{key}"
            tr = bool(self.ev(g, tr_name)) if self.group_has(tr_name) else False
            ul = bool(self.ev(g, f"ULTR{'XFMR' if key == 'XFMR' else 'IP' + key}")) if self.group_has(f"ULTR{'XFMR' if key == 'XFMR' else 'IP' + key}") else True
            cond = tr or (rem and key != "XFMR")
            name = f"TRIP{key}"
            trip = v.get(name, 0.0) != 0
            if cond and not trip:
                trip = True
                self._trip_t[key] = 0.0
                self.trip_rose = True
                self.fault_cur.update({"FIA": v["IA_MAG"], "FIB": v["IB_MAG"], "FIC": v["IC_MAG"], "FIG": v["IG_MAG"], "FIN": v["IN1_MAG"]})
            elif trip:
                self._trip_t[key] += dt
                if self._trip_t[key] >= tdurd - EPS and ul and not cond:
                    trip = False
            v[name] = 1.0 if trip else 0.0
            v[tr_name] = 1.0 if tr else 0.0
            any_trip = any_trip or trip
        v["TRIP"] = 1.0 if any_trip else 0.0

    def _recloser_stage(self, dt: float) -> None:
        for b in ("79RS", "79CY", "79LO", "SH0", "SH1", "SH2", "SH3", "SH4"):
            self.vals[b] = 0.0

    def _close_stage(self, dt: float) -> None:
        v, g = self.vals, self.group_cls
        any_close = False
        for n in range(1, 5):
            cl = bool(self.ev(g, f"CL{n}")) if self.group_has(f"CL{n}") else False
            ulcl = bool(self.ev(g, f"ULCL{n}")) if self.group_has(f"ULCL{n}") else False
            cfd = self.settings.number(g, f"CFD{n}", 0.5) or 0.5
            a52 = v.get(f"52A{n}", 0.0) != 0
            name = f"CLOSE{n}"
            close = v.get(name, 0.0) != 0
            if cl and not self._cl_prev[n] and not close and not a52 and not ulcl:
                close, self._close_t[n] = True, 0.0
            self._cl_prev[n] = cl
            v[f"CF{n}"] = 0.0
            if close:
                self._close_t[n] += dt
                if a52 or ulcl:
                    close = False
                elif self._close_t[n] >= cfd - EPS:
                    close = False
                    v[f"CF{n}"] = 1.0
            v[name] = 1.0 if close else 0.0
            any_close = any_close or close
        v["CLOSE"] = 1.0 if any_close else 0.0

    def _breaker_stage(self, dt: float) -> None:
        v = self.vals
        for n in range(1, 5):
            trip_coil = any(v.get(k, 0.0) for k in self.coils[n]["trip"])
            close_coil = any(v.get(k, 0.0) for k in self.coils[n]["close"])
            self.wfield(n).step_breaker(dt, bool(trip_coil), bool(close_coil))
        if self._analog_off_pending and not self.field.breaker.closed:
            self._analog_off_pending = False
            if self.field.cfg.analog_off_on_output:
                self.field.cfg.analog_on = False

    def local_breaker(self, closed: bool) -> None:
        self.field.force_position(closed)
        self.vals["CLOSE1"] = 0.0
        self._close_t[1] = 0.0

    def set_winding_breaker(self, n: int, closed: bool) -> None:
        """Manobra local do disjuntor do enrolamento n (n = 1 a 4)."""
        if n == 1:
            self.local_breaker(closed)
        else:
            self.wfield(n).force_position(closed)
            self.vals[f"CLOSE{n}"] = 0.0
            self._close_t[n] = 0.0
