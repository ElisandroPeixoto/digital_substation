"""Motor de simulação do SEL-751.

Ciclo de varredura (cada ``step(dt)``):

 1. consome 1 evento da fila (botão, bit remoto, comando OC/CC, target reset)
 2. entradas digitais (com debounce) e grandezas analógicas
 3. elementos de proteção (50/51/27/59/81)
 4. equação TR -> TRIP, religamento (79), CL -> CLOSE
 5. lógica SELogic do usuário: SV (temporizadores) -> SC -> MV -> latches -> OUT
 6. modelo do disjuntor (bobinas -> posição -> entrada 52A)
 7. seleção de grupo de ajustes, LEDs, SER e mapa DNP3

Cada equação é avaliada exatamente uma vez por ciclo.
"""
from __future__ import annotations

import cmath
import math
import re
from collections import deque
from dataclasses import dataclass, field

from .describe import build_labels, normal_state
from .dnp import DnpMap
from .fieldsim import A_OP, A_OP2, FieldSim
from .panel import Panel
from .protection import build_elements
from .selogic import Expr, split_comment
from .settings import RelaySettings

EPS = 1e-9
_DISABLED = Expr("NA")
_RE_INPUT = re.compile(r"\bIN\d{3}\b")
_RE_OUT = re.compile(r"^OUT\d{3}$")
SQRT3 = math.sqrt(3.0)


@dataclass
class _Input:
    name: str
    raw: bool = False
    filt: bool = False
    debounce: float = 0.01
    pending: float = 0.0
    label: str = ""


@dataclass
class _Timer:
    name: str
    inp: bool = False
    out: bool = False
    pu: float = 0.0
    do: float = 0.0
    pu_el: float = 0.0
    do_el: float = 0.0
    expr_key: str = ""


@dataclass
class _Latch:
    name: str
    set_key: str
    rst_key: str
    last_set: bool = False
    last_rst: bool = False


@dataclass
class _Counter:
    name: str
    key: str
    prev_cu: bool = False
    prev_cd: bool = False


@dataclass
class _Recloser:
    state: str = "RS"
    phase: str = "open"      # open | reset (dentro do ciclo)
    shot: int = 0
    oi: float = 0.0
    rs: float = 0.0
    started: bool = False
    last_event: str = ""


def _base_names() -> list[str]:
    names = ["TRIP", "CLOSE", "CF", "52A", "52B", "79RS", "79CY", "79LO", "SH0", "SH1", "SH2", "SH3", "SH4",
             "OC", "CC", "TRGTR", "HALARM", "LINKA", "LINKB", "TSNTPP", "TSNTPB", "DCLO", "DCHI", "FAULT", "ER",
             "SG1", "SG2", "SG3", "SG4", "ENABLED", "REMTRIP", "TR", "ULTRIP", "CL", "ULCL"]
    names += [f"IN{n}" for n in (101, 102)] + [f"IN{b}{i:02d}" for b in (3, 4, 5) for i in range(1, 15)]
    names += ["OUT101", "OUT102", "OUT103"] + [f"OUT{b}{i:02d}" for b in (3, 4, 5) for i in range(1, 9)]
    names += [f"PB{i:02d}" for i in range(1, 9)] + [f"RB{i:02d}" for i in range(1, 33)]
    names += [f"LT{i:02d}" for i in range(1, 33)]
    names += [f"SV{i:02d}" for i in range(1, 33)] + [f"SV{i:02d}T" for i in range(1, 33)]
    names += [f"SC{i:02d}Q" for i in range(1, 33)]
    return names


class RelayEngine:
    def __init__(self, settings: RelaySettings, device_name: str = "") -> None:
        self.settings = settings
        self.device_name = device_name or settings.device_name or settings.header.get("RELAYTYPE", "SEL-751")
        self.t = 0.0
        self.scan = 0
        self.vals: dict[str, float] = {n: 0.0 for n in _base_names()}
        self.analog_keys: set[str] = set()
        self.unresolved: set[str] = set()
        self.field = FieldSim()
        self.queue: deque[dict] = deque()
        self.pulses: set[str] = set()
        self._ex: dict[tuple[str, str], Expr] = {}
        self.meas: dict[str, float] = {k: 0.0 for k in (
            "IA", "IB", "IC", "IMAX", "IN", "IG", "I2", "VA", "VB", "VC", "VAB", "VBC", "VCA", "VG", "V2", "FREQ")}
        self.group = 1
        self.pending_group: int | None = None
        self.group_timer = 0.0
        self.trip_timer = 0.0
        self.close_timer = 0.0
        self._prev_cl = False
        self._prev_ri = False
        self._rc_request = False
        self.rc = _Recloser()
        self.sv_state: dict[str, _Timer] = {}
        self.energy = {"MWH3P": 0.0, "MWH3PI": 0.0, "MVARH3PO": 0.0, "MVARH3PI": 0.0}
        self.inputs: dict[str, _Input] = {}
        self.timers: list[_Timer] = []
        self.latches: list[_Latch] = []
        self.counters: list[_Counter] = []
        self.math_keys: list[str] = []
        self.out_keys: list[str] = []
        self.elements: list = []
        self.n_off = 0
        self.ser_log: deque[dict] = deque(maxlen=3000)
        self.ser_seq = 0
        self._ser_prev: dict[str, float] = {}
        self.fault_cur = {"FIA": 0.0, "FIB": 0.0, "FIC": 0.0, "FIG": 0.0, "FIN": 0.0, "FLOC": 0.0}
        self.trip_rose = False
        self.labels = build_labels(settings)
        self.trip_outs: list[str] = []
        self.close_outs: list[str] = []
        self.bk_input = "IN101"
        self.panel = Panel(self)
        self.dnp = DnpMap(self)
        self._first_scan = True
        self._setup_inputs()
        self._rebuild()
        self.field.breaker.closed = self.inputs[self.bk_input].raw if self.bk_input in self.inputs else True
        self._detect_coils()

    # ------------------------------------------------------------ utilitários
    def resolve(self, name: str) -> float:
        try:
            return self.vals[name]
        except KeyError:
            self.unresolved.add(name)
            return 0.0

    def expr(self, cls: str, key: str) -> Expr:
        src = self.settings.sections.get(cls, {}).get(key)
        if src is None:
            return _DISABLED
        cached = self._ex.get((cls, key))
        if cached is None or cached.source != src:
            cached = Expr(src)
            self._ex[(cls, key)] = cached
        return cached

    def ev(self, cls: str, key: str) -> float:
        return self.expr(cls, key).eval(self.resolve)

    def expr_text(self, cls: str, key: str) -> str:
        return self.expr(cls, key).text

    def group_has(self, key: str) -> bool:
        return key in self.g

    @property
    def nominal_freq(self) -> float:
        return self.settings.number("G", "FNOM", 60.0) or 60.0

    # ------------------------------------------------------------ configuração
    def _rebuild(self) -> None:
        st = self.settings
        self.group_cls = str(self.group) if str(self.group) in st.sections else "1"
        self.g = st.sections[self.group_cls]
        lcls = f"L{self.group}"
        self.logic_cls = lcls if lcls in st.sections else ("L1" if "L1" in st.sections else "")
        self.l = st.sections.get(self.logic_cls, {})
        self.ctr = st.number(self.group_cls, "CTR", 1.0) or 1.0
        self.ctrn = st.number(self.group_cls, "CTRN", self.ctr) or self.ctr
        self.ptr = st.number(self.group_cls, "PTR", 1.0) or 1.0
        self.vnom = st.number(self.group_cls, "VNOM", 115.0) or 115.0
        self.elements, self.n_off = build_elements(self)
        self._build_logic()
        self.panel.rebuild()
        self.dnp.rebuild()
        self._build_ser()

    def _setup_inputs(self) -> None:
        names: set[str] = {"IN101"}
        for cls, items in self.settings.sections.items():
            if cls in ("M", "I") or cls.startswith("E"):
                continue  # Modbus, IEC 103 e EtherNet/IP: fora do escopo
            for val in items.values():
                names.update(_RE_INPUT.findall(val))
        # só entradas que existem fisicamente nos ajustes globais
        g = self.settings.sections.get("G", {})
        for name in sorted(names):
            deb_ms = self.settings.number("G", f"{name}D", 10.0) if f"{name}D" in g else 10.0
            default = self._default_input(name)
            self.inputs[name] = _Input(name=name, raw=default, filt=default, debounce=(deb_ms or 0.0) / 1000.0,
                                       label=self.labels.get(name, ""))
            self.vals.setdefault(name, 0.0)
            self.vals[name] = 1.0 if default else 0.0
        # entrada do estado do disjuntor (52A)
        expr52 = self.settings.get("1", "52A", "IN101")
        text, _ = split_comment(expr52)
        self.bk_input = text if re.fullmatch(r"IN\d{3}", text.upper() or "") else "IN101"
        self.bk_input = self.bk_input.upper()
        if self.bk_input in self.inputs:
            self.inputs[self.bk_input].raw = True
            self.inputs[self.bk_input].filt = True
            self.vals[self.bk_input] = 1.0

    def _default_input(self, name: str) -> bool:
        ns = normal_state(self.settings, name)
        if ns is not None:
            return ns
        # SVnn = INxxx -> usa o estado "normal" da variável SVnnT
        for key, val in self.settings.sections.get("L1", {}).items():
            if re.fullmatch(r"SV\d\d", key) and split_comment(val)[0].upper() == name:
                ns = normal_state(self.settings, key + "T")
                if ns is not None:
                    return ns
        return False

    def _detect_coils(self) -> None:
        trips: list[str] = []
        closes: list[str] = []
        for key in self.out_keys:
            e = self.expr(self.logic_cls, key)
            ids = set(e.idents)
            c = e.comment.upper()
            if "CLOSE" in ids or "FECHAMENTO" in c or "FECHAR" in c:
                closes.append(key)
            elif "TRIP" in ids or "ABERTURA" in c or "TRIP" in c:
                trips.append(key)
        self.trip_outs, self.close_outs = trips, closes

    def _build_logic(self) -> None:
        l = self.l
        lcls = self.logic_cls
        self.latches = []
        elat = int(self.settings.number(lcls, "ELAT", 0) or 0)
        for n in range(1, elat + 1):
            nn = f"{n:02d}"
            self.latches.append(_Latch(f"LT{nn}", f"SET{nn}", f"RST{nn}"))
        self.timers = []
        esv = int(self.settings.number(lcls, "ESV", 0) or 0)
        for n in range(1, esv + 1):
            nn = f"{n:02d}"
            name = f"SV{nn}"
            tm = self.sv_state.setdefault(name, _Timer(name))
            tm.expr_key = name
            tm.pu = self.settings.number(lcls, f"{name}PU", 0.0) or 0.0
            tm.do = self.settings.number(lcls, f"{name}DO", 0.0) or 0.0
            self.timers.append(tm)
        self.counters = []
        esc = int(self.settings.number(lcls, "ESC", 0) or 0)
        old = {c.name: c for c in getattr(self, "_counters_prev", [])}
        for n in range(1, esc + 1):
            nn = f"{n:02d}"
            self.counters.append(old.get(f"SC{nn}") or _Counter(f"SC{nn}", f"SC{nn}"))
            self.vals.setdefault(f"SC{nn}", 0.0)
            self.analog_keys.add(f"SC{nn}")
        self._counters_prev = self.counters
        self.math_keys = []
        emv = int(self.settings.number(lcls, "EMV", 0) or 0)
        for n in range(1, emv + 1):
            key = f"MV{n:02d}"
            self.math_keys.append(key)
            self.vals.setdefault(key, 0.0)
            self.analog_keys.add(key)
        self.out_keys = [k for k in l if _RE_OUT.match(k)]
        for k in self.out_keys:
            self.vals.setdefault(k, 0.0)

    def _build_ser(self) -> None:
        names: list[str] = []
        for i in range(1, 5):
            raw = self.settings.get("R", f"SER{i}", "")
            names += [n.strip().upper() for n in raw.split(",") if n.strip()]
        seen = set()
        self.ser_names = [n for n in names if not (n in seen or seen.add(n))]
        self.aliases: dict[str, tuple[str, str, str]] = {}
        for key, val in self.settings.sections.get("R", {}).items():
            if key.startswith("ALIAS") and key != "EALIAS":
                parts = val.split()
                if len(parts) >= 4:
                    self.aliases[parts[0].upper()] = (parts[1], parts[2], parts[3])

    # ----------------------------------------------------------- API de entrada
    def press(self, n: int, pressed: bool) -> None:
        self.queue.append({"type": "pb", "n": n, "pressed": pressed})

    def target_reset(self) -> None:
        self.queue.append({"type": "target_reset"})

    def pulse(self, name: str) -> None:
        self.queue.append({"type": "pulse", "name": name.upper()})

    def input_raw(self, inp: "_Input") -> bool:
        """Estado físico da entrada. A entrada do 52A segue o disjuntor no modo automático."""
        if inp.name == self.bk_input and self.field.cfg.breaker_auto:
            return self.field.breaker.closed
        return inp.raw

    def set_input(self, name: str, value: bool) -> None:
        name = name.upper()
        if name == self.bk_input and self.field.cfg.breaker_auto:
            self.field.force_position(bool(value))
            return
        inp = self.inputs.get(name)
        if inp is None:
            inp = self.inputs[name] = _Input(name=name, debounce=0.01, label=self.labels.get(name, ""))
            self.vals.setdefault(name, 0.0)
        inp.raw = bool(value)

    def set_sim(self, patch: dict) -> None:
        cfg = self.field.cfg
        for key, val in patch.items():
            if key in ("fault_type",):
                cfg.fault_type = val or None
            elif hasattr(cfg, key):
                cur = getattr(cfg, key)
                setattr(cfg, key, bool(val) if isinstance(cur, bool) else float(val))
        if "fault_type" in patch and not patch["fault_type"]:
            self.field.clear_fault()
        if "breaker_auto" in patch and not cfg.breaker_auto and self.bk_input in self.inputs:
            inp = self.inputs[self.bk_input]
            inp.raw = inp.filt   # sem "salto" ao passar para o modo manual

    def apply_setting(self, cls: str, key: str, value: str) -> None:
        self.settings.set_value(cls, key, value)
        self._ex.pop((cls, key), None)
        self._rebuild()
        self._detect_coils()

    # ------------------------------------------------------------------ ciclo
    def step(self, dt: float) -> None:
        v = self.vals
        for n in self.pulses:
            v[n] = 0.0
        self.pulses.clear()
        self._consume_event()
        self._update_inputs(dt)
        self._update_meas(dt)
        for el in self.elements:
            el.update(dt)
        self._trip_stage(dt)
        self._recloser_stage(dt)
        self._close_stage(dt)
        self._logic_stage(dt)
        self._breaker_stage(dt)
        self._group_stage(dt)
        self.panel.update(dt)
        self.dnp.update()
        self._ser_stage()
        self.t += dt
        self.scan += 1
        self._first_scan = False

    # -- 1: eventos
    def _consume_event(self) -> None:
        if not self.queue:
            return
        ev = self.queue.popleft()
        v = self.vals
        if ev["type"] == "pb":
            v[f"PB{ev['n']:02d}"] = 1.0 if ev["pressed"] else 0.0
        elif ev["type"] == "pulse":
            v[ev["name"]] = 1.0
            self.pulses.add(ev["name"])
        elif ev["type"] == "target_reset":
            v["TRGTR"] = 1.0
            self.pulses.add("TRGTR")

    # -- 2: entradas e analógicos
    def _update_inputs(self, dt: float) -> None:
        v = self.vals
        sim = self.field.cfg
        v["HALARM"] = 1.0 if sim.halarm else 0.0
        v["ENABLED"] = 0.0 if sim.halarm else 1.0
        v["LINKA"], v["LINKB"] = float(sim.linka), float(sim.linkb)
        v["TSNTPP"], v["TSNTPB"] = float(sim.tsntpp), float(sim.tsntpb)
        dclo = self.settings.number("G", "DCLOP", 0.0) or 0.0
        dchi = self.settings.number("G", "DCHIP", 1e9) or 1e9
        v["DCLO"] = 1.0 if sim.vdc < dclo else 0.0
        v["DCHI"] = 1.0 if sim.vdc > dchi else 0.0
        for name, inp in self.inputs.items():
            raw = self.input_raw(inp)
            if raw != inp.filt:
                inp.pending += dt
                if inp.pending >= inp.debounce - EPS:
                    inp.filt = raw
                    inp.pending = 0.0
            else:
                inp.pending = 0.0
            v[name] = 1.0 if inp.filt else 0.0

    def _update_meas(self, dt: float) -> None:
        v = self.vals
        I, V = self.field.phasors()
        m = self.meas
        ia, ib, ic = abs(I["A"]), abs(I["B"]), abs(I["C"])
        resid = I["A"] + I["B"] + I["C"]
        i2 = I["A"] + A_OP2 * I["B"] + A_OP * I["C"]
        m["IA"], m["IB"], m["IC"] = ia / self.ctr, ib / self.ctr, ic / self.ctr
        m["IMAX"] = max(m["IA"], m["IB"], m["IC"])
        m["IN"] = m["IG"] = abs(resid) / self.ctrn
        m["I2"] = abs(i2) / self.ctr
        m["VA"], m["VB"], m["VC"] = (abs(V[p]) / self.ptr for p in "ABC")
        vab, vbc, vca = V["A"] - V["B"], V["B"] - V["C"], V["C"] - V["A"]
        m["VAB"], m["VBC"], m["VCA"] = abs(vab) / self.ptr, abs(vbc) / self.ptr, abs(vca) / self.ptr
        m["VG"] = abs(V["A"] + V["B"] + V["C"]) / self.ptr
        m["V2"] = abs(V["A"] + A_OP2 * V["B"] + A_OP * V["C"]) / self.ptr
        m["FREQ"] = self.field.cfg.freq
        a = v
        a["IA_MAG"], a["IB_MAG"], a["IC_MAG"] = ia, ib, ic
        a["IG_MAG"] = a["IN_MAG"] = abs(resid)
        a["IARMS"], a["IBRMS"], a["ICRMS"], a["INRMS"] = ia, ib, ic, abs(resid)
        for ph, c in zip("ABC", (I["A"], I["B"], I["C"])):
            a[f"I{ph}_ANG"] = math.degrees(cmath.phase(c)) if abs(c) > 1e-9 else 0.0
        a["VA_MAG"], a["VB_MAG"], a["VC_MAG"] = (abs(V[p]) for p in "ABC")
        a["VAB_MAG"], a["VBC_MAG"], a["VCA_MAG"] = abs(vab), abs(vbc), abs(vca)
        a["VS_MAG"] = 0.0
        for ph in "ABC":
            a[f"V{ph}_ANG"] = math.degrees(cmath.phase(V[ph])) if abs(V[ph]) > 1e-9 else 0.0
        for nm, c in (("VAB", vab), ("VBC", vbc), ("VCA", vca)):
            a[f"{nm}_ANG"] = math.degrees(cmath.phase(c)) if abs(c) > 1e-9 else 0.0
        a["3I2"], a["3V2"] = abs(i2), abs(V["A"] + A_OP2 * V["B"] + A_OP * V["C"])
        a["3I0"] = abs(resid)
        a["FREQ"] = m["FREQ"]
        a["VDC"] = self.field.cfg.vdc
        s = sum(V[p] * I[p].conjugate() for p in "ABC")
        p_kw, q_kvar = s.real / 1000.0, s.imag / 1000.0
        a["P"], a["Q"] = p_kw, q_kvar
        a["S"] = abs(s) / 1000.0
        a["PF"] = (p_kw / a["S"]) if a["S"] > 1e-6 else 1.0
        h = dt / 3600.0
        e = self.energy
        if p_kw >= 0:
            e["MWH3P"] += p_kw / 1000.0 * h
        else:
            e["MWH3PI"] += -p_kw / 1000.0 * h
        if q_kvar >= 0:
            e["MVARH3PO"] += q_kvar / 1000.0 * h
        else:
            e["MVARH3PI"] += -q_kvar / 1000.0 * h
        a.update(e)
        a.update(self.fault_cur)
        self.analog_keys.update(("IA_MAG", "IB_MAG", "IC_MAG", "IG_MAG", "IN_MAG", "IARMS", "IBRMS", "ICRMS", "INRMS",
                                 "IA_ANG", "IB_ANG", "IC_ANG", "VA_ANG", "VB_ANG", "VC_ANG", "VAB_ANG", "VBC_ANG", "VCA_ANG", "VA_MAG", "VB_MAG", "VC_MAG", "VAB_MAG", "VBC_MAG",
                                 "VCA_MAG", "VS_MAG", "3I2", "3V2", "3I0", "FREQ", "VDC", "P", "Q", "S", "PF",
                                 "MWH3P", "MWH3PI", "MVARH3PO", "MVARH3PI", "FIA", "FIB", "FIC", "FIG", "FIN", "FLOC"))

    # -- 4: disparo, religamento, fechamento
    def _trip_stage(self, dt: float) -> None:
        v, g = self.vals, self.group_cls
        a52 = bool(self.ev(g, "52A")) if self.group_has("52A") else bool(v.get("IN101"))
        v["52A"] = 1.0 if a52 else 0.0
        v["52B"] = (1.0 if self.ev(g, "52B") else 0.0) if self.group_has("52B") else (0.0 if a52 else 1.0)
        tr = bool(self.ev(g, "TR"))
        rem = bool(self.ev(g, "REMTRIP"))
        ul = bool(self.ev(g, "ULTRIP"))
        v["TR"] = 1.0 if tr else 0.0
        v["ULTRIP"] = 1.0 if ul else 0.0
        v["FAULT"] = 1.0 if self.ev("G", "FAULT") else 0.0
        v["ER"] = 1.0 if self.ev("R", "ER") else 0.0
        cond = tr or rem
        trip = v["TRIP"] != 0
        tdurd = self.settings.number(g, "TDURD", 0.5) or 0.5
        self.trip_rose = False
        if cond and not trip:
            trip = True
            self.trip_timer = 0.0
            self.trip_rose = True
            m = v
            self.fault_cur.update({"FIA": m["IA_MAG"], "FIB": m["IB_MAG"], "FIC": m["IC_MAG"],
                                   "FIG": m["IG_MAG"], "FIN": m["IN_MAG"]})
        elif trip:
            self.trip_timer += dt
            if self.trip_timer >= tdurd - EPS and ul and not cond:
                trip = False
        v["TRIP"] = 1.0 if trip else 0.0

    def _recloser_stage(self, dt: float) -> None:
        v, g, r = self.vals, self.group_cls, self.rc
        e79 = int(self.settings.number(g, "E79", 0) or 0)
        if e79 <= 0 or not self.group_has("79RI"):
            for b in ("79RS", "79CY", "79LO", "SH0", "SH1", "SH2", "SH3", "SH4"):
                v[b] = 0.0
            return
        a52 = v["52A"] != 0
        if not r.started:
            r.started = True
            r.state = "RS" if a52 else "LO"
        ri = bool(self.ev(g, "79RI"))
        ris = bool(self.ev(g, "79RIS"))
        dtl = bool(self.ev(g, "79DTL"))
        stl = bool(self.ev(g, "79STL"))
        brs = bool(self.ev(g, "79BRS"))
        cls = bool(self.ev(g, "79CLS")) if self.group_has("79CLS") else True
        ri_rise = ri and not self._prev_ri
        self._prev_ri = ri
        oi = [self.settings.number(g, f"79OI{i}", 0.0) or 0.0 for i in range(1, 5)]
        rsd = self.settings.number(g, "79RSD", 60.0) or 60.0
        rsld = self.settings.number(g, "79RSLD", 60.0) or 60.0

        def to_lo(reason: str) -> None:
            r.state, r.rs, r.oi = "LO", 0.0, 0.0
            r.last_event = reason

        if r.state == "RS":
            r.shot = 0
            if dtl:
                to_lo("bloqueio por 79DTL")
            elif ri_rise and ris:
                r.state, r.phase, r.oi, r.rs = "CY", "open", 0.0, 0.0
                r.last_event = "ciclo iniciado pelo disparo"
        elif r.state == "CY":
            if dtl:
                to_lo("bloqueio por 79DTL")
            elif r.phase == "open":
                if r.shot >= e79 or oi[min(r.shot, 3)] <= 0:
                    to_lo("sem mais religamentos")
                elif not a52 and not stl:
                    r.oi += dt
                    if r.oi >= oi[r.shot] - EPS and cls:
                        self._rc_request = True
                        r.shot += 1
                        r.phase, r.rs, r.oi = "reset", 0.0, 0.0
                        r.last_event = f"religamento {r.shot} emitido"
            else:
                if v["CF"] != 0:
                    to_lo("falha de fechamento")
                elif ri_rise and ris:
                    if r.shot >= e79:
                        to_lo("religamentos esgotados")
                    else:
                        r.phase, r.oi, r.rs = "open", 0.0, 0.0
                        r.last_event = "novo disparo no ciclo"
                elif a52 and not brs:
                    r.rs += dt
                    if r.rs >= rsd - EPS:
                        r.state, r.shot, r.rs = "RS", 0, 0.0
                        r.last_event = "religamento bem-sucedido (reset)"
        else:  # LO
            if a52 and not dtl:
                r.rs += dt
                if r.rs >= rsld - EPS:
                    r.state, r.shot, r.rs = "RS", 0, 0.0
                    r.last_event = "reset do bloqueio"
            else:
                r.rs = 0.0
        v["79RS"] = 1.0 if r.state == "RS" else 0.0
        v["79CY"] = 1.0 if r.state == "CY" else 0.0
        v["79LO"] = 1.0 if r.state == "LO" else 0.0
        for k in range(5):
            v[f"SH{k}"] = 1.0 if r.shot == k else 0.0

    def _close_stage(self, dt: float) -> None:
        v, g = self.vals, self.group_cls
        cl = bool(self.ev(g, "CL"))
        ulcl = bool(self.ev(g, "ULCL"))
        v["CL"] = 1.0 if cl else 0.0
        a52 = v["52A"] != 0
        cfd = self.settings.number(g, "CFD", 0.5) or 0.5
        v["CF"] = 0.0
        close = v["CLOSE"] != 0
        if (cl and not self._prev_cl) or self._rc_request:
            if not close and not a52 and not ulcl:
                close = True
                self.close_timer = 0.0
            self._rc_request = False
        self._prev_cl = cl
        if close:
            self.close_timer += dt
            if a52 or ulcl:
                close = False
            elif self.close_timer >= cfd - EPS:
                close = False
                v["CF"] = 1.0
        v["CLOSE"] = 1.0 if close else 0.0

    # -- 5: lógica do usuário
    def _logic_stage(self, dt: float) -> None:
        v, lc = self.vals, self.logic_cls
        for tm in self.timers:
            inp = bool(self.ev(lc, tm.expr_key))
            tm.inp = inp
            if inp:
                tm.do_el = 0.0
                if not tm.out:
                    tm.pu_el += dt
                    if tm.pu_el >= tm.pu - EPS:
                        tm.out = True
            else:
                tm.pu_el = 0.0
                if tm.out:
                    tm.do_el += dt
                    if tm.do_el >= tm.do - EPS:
                        tm.out = False
                        tm.do_el = 0.0
            v[tm.name] = 1.0 if inp else 0.0
            v[tm.name + "T"] = 1.0 if tm.out else 0.0
        for sc in self.counters:
            pv = self.settings.number(lc, sc.name + "PV", 1.0) or 1.0
            cu = bool(self.ev(lc, sc.name + "CU"))
            cd = bool(self.ev(lc, sc.name + "CD"))
            rst = bool(self.ev(lc, sc.name + "R"))
            ld = bool(self.ev(lc, sc.name + "LD"))
            cnt = v[sc.name]
            if rst:
                cnt = 0.0
            elif ld:
                cnt = pv
            else:
                if cu and not sc.prev_cu:
                    cnt = min(cnt + 1, 65535.0)
                if cd and not sc.prev_cd:
                    cnt = max(cnt - 1, 0.0)
            sc.prev_cu, sc.prev_cd = cu, cd
            v[sc.name] = cnt
            v[sc.name + "Q"] = 1.0 if cnt >= pv else 0.0
        for key in self.math_keys:
            v[key] = float(self.ev(lc, key))
        for lt in self.latches:
            s = bool(self.ev(lc, lt.set_key))
            r = bool(self.ev(lc, lt.rst_key))
            lt.last_set, lt.last_rst = s, r
            if r:
                v[lt.name] = 0.0
            elif s:
                v[lt.name] = 1.0
        for key in self.out_keys:
            v[key] = 1.0 if self.ev(lc, key) else 0.0

    # -- 6: disjuntor
    def _breaker_stage(self, dt: float) -> None:
        v = self.vals
        trip_coil = any(v.get(k, 0.0) for k in self.trip_outs)
        close_coil = any(v.get(k, 0.0) for k in self.close_outs)
        self.field.step_breaker(dt, bool(trip_coil), bool(close_coil))

    # -- 7: grupo de ajustes
    def _group_stage(self, dt: float) -> None:
        wanted = None
        for n in range(1, 5):
            if self.ev("G", f"SS{n}"):
                wanted = n
                break
        if wanted is not None and wanted != self.group and str(wanted) in self.settings.sections:
            if self.pending_group != wanted:
                self.pending_group, self.group_timer = wanted, 0.0
            self.group_timer += dt
            tgr = self.settings.number("G", "TGR", 0.0) or 0.0
            if self.group_timer >= tgr - EPS:
                self.group = wanted
                self.pending_group = None
                self._rebuild()
        else:
            self.pending_group = None
        for n in range(1, 5):
            self.vals[f"SG{n}"] = 1.0 if n == self.group else 0.0

    # -- SER
    def _ser_stage(self) -> None:
        v = self.vals
        for name in self.ser_names:
            cur = v.get(name)
            if cur is None:
                continue
            prev = self._ser_prev.get(name)
            self._ser_prev[name] = cur
            if prev is not None and prev != cur:
                self.ser_seq += 1
                self.ser_log.append({"seq": self.ser_seq, "t": round(self.t, 3), "name": name, "value": int(cur != 0),
                                     "text": self._alias_text(name, cur != 0)})

    def _alias_text(self, name: str, value: bool) -> str:
        al = self.aliases.get(name)
        if al:
            return f"{al[0].replace('_', ' ')}: {al[1] if value else al[2]}"
        return "Asserted" if value else "Deasserted"

    # ------------------------------------------------------------- snapshots
    def b(self, name: str) -> int:
        return 1 if self.vals.get(name, 0.0) else 0

    def snapshot_state(self) -> dict:
        v = self.vals
        lc = self.logic_cls
        inputs = [
            {"name": i.name, "label": i.label, "raw": self.input_raw(i),
             "value": self.b(i.name), "debounce_ms": round(i.debounce * 1000), "pending": round(i.pending, 2),
             "breaker": i.name == self.bk_input}
            for i in self.inputs.values()
        ]
        outputs = []
        for k in self.out_keys:
            e = self.expr(lc, k)
            if e.disabled or e.text == "0":
                continue
            role = "abertura" if k in self.trip_outs else "fechamento" if k in self.close_outs else ""
            outputs.append({"name": k, "expr": e.text, "comment": e.comment, "value": self.b(k), "role": role})
        latches = []
        for lt in self.latches:
            se, re_ = self.expr(lc, lt.set_key), self.expr(lc, lt.rst_key)
            if se.disabled and re_.disabled:
                continue
            latches.append({"name": lt.name, "value": self.b(lt.name), "set_expr": se.text, "set_comment": se.comment,
                            "rst_expr": re_.text, "rst_comment": re_.comment, "set_now": lt.last_set, "rst_now": lt.last_rst})
        timers = []
        for tm in self.timers:
            e = self.expr(lc, tm.expr_key)
            if e.disabled:
                continue
            timers.append({"name": tm.name, "expr": e.text, "comment": e.comment, "input": tm.inp, "out": tm.out,
                           "pu": tm.pu, "do": tm.do, "pu_el": round(tm.pu_el, 3), "do_el": round(tm.do_el, 3)})
        counters = []
        for sc in self.counters:
            counters.append({"name": sc.name, "value": int(v[sc.name]), "preset": self.settings.number(lc, sc.name + "PV", 0),
                             "q": self.b(sc.name + "Q"), "cu": self.expr(lc, sc.name + "CU").text,
                             "comment": self.expr(lc, sc.name + "CU").comment})
        counters = [c for c in counters if c["cu"] or c["value"]]
        maths = []
        for key in self.math_keys:
            e = self.expr(lc, key)
            if not e.disabled:
                maths.append({"name": key, "expr": e.text, "comment": e.comment, "value": round(v[key], 4)})
        rc = self.rc
        e79 = int(self.settings.number(self.group_cls, "E79", 0) or 0)
        g = self.group_cls
        recloser = {
            "enabled": e79 > 0, "state": rc.state, "shot": rc.shot, "max_shots": e79, "phase": rc.phase,
            "open_interval_elapsed": round(rc.oi, 2), "reset_elapsed": round(rc.rs, 2), "last_event": rc.last_event,
            "intervals": [self.settings.number(g, f"79OI{i}", 0.0) for i in range(1, 5)],
            "reset_time": self.settings.number(g, "79RSD"), "lockout_reset_time": self.settings.number(g, "79RSLD"),
            "dtl": self.expr_text(g, "79DTL"),
        }
        words = sorted(([k, int(val != 0)] for k, val in v.items() if k not in self.analog_keys), key=lambda x: x[0])
        analog = {k: round(v[k], 4) for k in sorted(self.analog_keys) if k in v}
        return {
            "time": round(self.t, 3), "group": self.group, "pending_group": self.pending_group,
            "inputs": inputs, "outputs": outputs, "latches": latches, "timers": timers, "counters": counters,
            "math": maths,
            "protection": {"elements": [e.info() for e in self.elements], "disabled": self.n_off},
            "trip_close": {
                "TRIP": self.b("TRIP"), "TR": self.b("TR"), "TR_expr": self.expr_text(g, "TR"), "ULTRIP": self.b("ULTRIP"),
                "CLOSE": self.b("CLOSE"), "CL": self.b("CL"), "CL_expr": self.expr_text(g, "CL"), "CF": self.b("CF"),
                "52A": self.b("52A"), "52A_expr": self.expr_text(g, "52A"), "TDURD": self.settings.number(g, "TDURD"),
                "trip_outputs": self.trip_outs, "close_outputs": self.close_outs,
            },
            "recloser": recloser, "words": words, "analog": analog, "unresolved": sorted(self.unresolved),
        }

    def snapshot_outputs(self) -> list[dict]:
        out = []
        for k in self.out_keys:
            e = self.expr(self.logic_cls, k)
            if e.disabled or e.text == "0":
                continue
            role = "abertura" if k in self.trip_outs else "fechamento" if k in self.close_outs else ""
            out.append({"name": k, "label": e.comment, "value": self.b(k), "role": role})
        return out

    def snapshot_ser(self, since: int = 0) -> dict:
        events = [e for e in self.ser_log if e["seq"] > since]
        return {"events": events[-500:], "last_seq": self.ser_seq}
