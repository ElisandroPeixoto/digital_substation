"""Motor do SEL-311C (proteção de linha de transmissão), construído sobre o motor do SEL-751.

Diferenças em relação ao 751:
- classes de ajuste: grupos ``1``–``6`` só com ajustes numéricos/enables; toda a SELogic (TR, ULTR, CL, 52A, 79RI…, torques
  ``67xnTC``/``51xTC``, SVn, SETn/RSTn, OUTxxx, LEDn, DPn, SS1–SS6) fica na classe de lógica ``L1``–``L6`` do grupo ativo;
  textos do display e dos bits locais na classe ``T``;
- **tempos em ciclos** (TDURD, CFD, 79OIn, 79RSD, 79RSLD, SVnPU/DO, ZnPD, 67xnD, TGR…), convertidos por NFREQ;
- SELogic clássica (``+`` OU, ``*`` E, ``!`` NÃO, ``/X`` e ``\\X`` bordas): ver ``selogic.py``;
- nomes sem zeros à esquerda: SV1–SV16, LT1–LT16, LV1–LV32 (variáveis sem temporizador, avaliadas antes das SV),
  PB1–PB10 e PB1PUL–PB10PUL, LB1–LB16 (bits locais, menu CNTRL), RB1–RB32;
- proteção: distância 21 (mho de fase por memória ou compensador, mho e quadrilateral de terra), 50/67 P/G/Q, 51P/G/Q,
  direcionais 32Q/32G/32P, FIDS, LOP, 3PO, SOTF, load-encroachment, 27/59 e 81D (``protection_311c.py``);
- disparo tripolar (TPA = TPB = TPC = 3PT = TRIP), religamento 79 com tempos em ciclos.
Fora do escopo (lidos e ignorados): esquemas de teleproteção (ECOMM: POTT/DCB/DCUB – TRCOMM não dispara), extensão de
zona 1, CCVT, out-of-step, 50BF, 25, 79SKP/79SEQ/79DLS/79CLSD, demanda, monitor de disjuntor, PMU, Modbus/portas.
"""
from __future__ import annotations

import cmath
import math
import re

from .engine import EPS, RelayEngine, _Latch, _Timer, _base_names
from .panel311c import TARGET_BITS, Panel311C
from .protection_311c import Core311, build_elements, cyc, levels, num, protection_bits
from .selogic import split_comment

_RE_OUT = re.compile(r"^(OUT\d{3}|ALRMOUT)$")
_RE_IN = re.compile(r"\bIN\d{3}\b")
_RE_BIT = re.compile(r"^(VB\d{3}|RB\d{1,2}|LB\d{1,2})$")


def _names_311c() -> list[str]:
    n = ["TRIP", "CLOSE", "CF", "52A", "52B", "79RS", "79CY", "79LO", "SH0", "SH1", "SH2", "SH3", "SH4", "OC", "CC", "TRGTR",
         "HALARM", "SALARM", "LINK5A", "LINK5B", "LINKA", "LINKB", "TSNTPP", "TSNTPB", "DCLO", "DCHI", "ENABLED", "TPA", "TPB",
         "TPC", "3PT", "BADPASS", "CHGPASS", "SETCHG", "GRPSW", "ACCESSP", "PASNVAL", "FAULT", "ER"]
    n += [f"SG{i}" for i in range(1, 7)]
    n += [f"IN10{i}" for i in range(1, 7)] + [f"IN2{i:02d}" for i in range(1, 17)]
    n += [f"OUT10{i}" for i in range(1, 8)] + [f"OUT2{i:02d}" for i in range(1, 13)] + ["ALRMOUT"]
    n += [f"PB{i}" for i in range(1, 11)] + [f"PB{i}PUL" for i in range(1, 11)]
    n += [f"LB{i}" for i in range(1, 17)] + [f"RB{i}" for i in range(1, 33)] + [f"LT{i}" for i in range(1, 17)]
    n += [f"SV{i}" for i in range(1, 17)] + [f"SV{i}T" for i in range(1, 17)] + [f"LV{i}" for i in range(1, 33)]
    n += [x for x in _base_names() if re.match(r"^(TMB|RMB|ROK|RBAD|CBAD|LBOK)", x)]
    n += TARGET_BITS + protection_bits()
    return n


class Relay311CEngine(RelayEngine):
    PB_COUNT = 10

    def __init__(self, settings, device_name: str = "") -> None:
        self.core: Core311 | None = None
        self.lv_keys: list[str] = []
        self._trcomm = self._trsotf = False
        super().__init__(settings, device_name)
        self._load_defaults()

    # ------------------------------------------------------------ utilitários
    def _names(self) -> list[str]:
        return _names_311c()

    @property
    def nominal_freq(self) -> float:
        return self.settings.number("G", "NFREQ", 60.0) or 60.0

    def expr(self, cls: str, key: str):
        """Na falta do ajuste no grupo, procura a equação na classe de lógica do grupo (TR, CL, 52A, 79RI… ficam em Ln)."""
        if cls == getattr(self, "group_cls", None) and key not in self.settings.sections.get(cls, {}):
            cls = self.logic_cls
        return super().expr(cls, key)

    def group_has(self, key: str) -> bool:
        return key in self.g or key in self.l

    def tsec(self, cls: str, key: str, default: float = 0.0) -> float:
        """Ajuste de tempo em ciclos → segundos."""
        v = self.settings.number(cls, key, None)
        return default if v is None else v / self.nominal_freq

    def delay_of(self, ident: str) -> float | None:
        """Atraso (s) do elemento que gera o bit ``ident`` (None = instantâneo/desconhecido); usado no alvo TIME."""
        if ident in ("51PT", "51GT", "51QT"):
            return 1.0
        m = re.fullmatch(r"M([1-4])PT|Z([1-4])GT|Z([1-4])T", ident)
        if m:
            n = next(x for x in m.groups() if x)
            key = f"Z{n}PD" if ident.startswith("M") else f"Z{n}GD" if ident.endswith("GT") else f"Z{n}D"
            return cyc(self, key)
        m = re.fullmatch(r"67([PGQ])([1-4])T", ident)
        if m:
            return cyc(self, f"67{m.group(1)}{m.group(2)}D", 0.0)
        return None

    def _load_defaults(self) -> None:
        """Injeção inicial coerente com o ajuste: tensão nominal (VNOM fase-neutro × PTR) e 1 A sec. de carga."""
        st, g, cfg = self.settings, self.group_cls, self.field.cfg
        vn = (st.number(g, "VNOM", 66.4) or 66.4) * self.ptr
        cfg.va_mag = cfg.vb_mag = cfg.vc_mag = cfg.vs_mag = vn
        self.field.set_balanced_load(1.0 * self.ctr, -18.0)

    # ------------------------------------------------------------ configuração
    def _rebuild(self) -> None:
        st = self.settings
        self.group_cls = str(self.group) if str(self.group) in st.sections else "1"
        self.g = st.sections[self.group_cls]
        lcls = f"L{self.group}"
        self.logic_cls = lcls if lcls in st.sections else "L1"
        self.l = st.sections.get(self.logic_cls, {})
        g = self.group_cls
        self.ctr = st.number(g, "CTR", 1.0) or 1.0
        self.ctrn = st.number(g, "CTRN", self.ctr) or self.ctr
        self.ptr = st.number(g, "PTR", 1.0) or 1.0
        self.ptrs = st.number(g, "PTRS", self.ptr) or self.ptr
        self.vnom = (st.number(g, "VNOM", 66.4) or 66.4) * math.sqrt(3.0)     # VNOM do 311C é fase-neutro: guarda o fase-fase
        if not isinstance(self.panel, Panel311C):
            self.panel = Panel311C(self)
        if self.core is None:
            self.core = Core311(self)
        self.elements, self.n_off = build_elements(self, self.core)
        self._build_logic()
        self.panel.rebuild()
        self.dnp.rebuild()
        self._build_ser()

    def _setup_inputs(self) -> None:
        g = self.settings.sections.get("G", {})
        names = {f"IN10{i}" for i in range(1, 7)}
        names |= {k[:-1] for k in g if re.fullmatch(r"IN\d{3}D", k)}
        for cls, items in self.settings.sections.items():
            if cls in ("M",) or cls.startswith("P") or cls.startswith("D"):
                continue
            for val in items.values():
                names.update(_RE_INPUT_ALL(val))
        from .engine import _Input
        for name in sorted(names):
            deb = self.settings.number("G", f"{name}D", 2.0) if f"{name}D" in g else 2.0
            default = self._default_input(name)
            self.inputs[name] = _Input(name=name, raw=default, filt=default, debounce=(deb or 0.0) / self.nominal_freq,
                                       label=self.labels.get(name, ""))
            self.vals[name] = 1.0 if default else 0.0
        text, _ = split_comment(self.settings.get("L1", "52A", "IN101"))
        self.auto_bk_input = text.upper() if re.fullmatch(r"IN\d{3}", text.upper() or "") else ""
        self._apply_bk_status(initial=True)

    def _default_input(self, name: str) -> bool:
        from .describe import normal_state

        ns = normal_state(self.settings, name)
        if ns is not None:
            return ns
        # SVn = INxxx → estado "normal" da SVnT (pontos de display)
        for key, val in self.settings.sections.get("L1", {}).items():
            if re.fullmatch(r"SV\d{1,2}", key) and split_comment(val)[0].upper() == name:
                ns = normal_state(self.settings, key + "T")
                if ns is not None:
                    return ns
        return False

    def _build_logic(self) -> None:
        st, l, lc, g = self.settings, self.l, self.logic_cls, self.group_cls
        self.latches = [_Latch(f"LT{n}", f"SET{n}", f"RST{n}") for n in range(1, 17) if f"SET{n}" in l or f"RST{n}" in l]
        self.timers = []
        esv = int(st.number(g, "ESV", 0) or 0)
        for n in range(1, min(esv, 16) + 1):
            name = f"SV{n}"
            tm = self.sv_state.setdefault(name, _Timer(name))
            tm.expr_key = name
            tm.pu = self.tsec(g, f"{name}PU")
            tm.do = self.tsec(g, f"{name}DO")
            self.timers.append(tm)
        self.counters, self.math_keys = [], []
        self.lv_keys = [f"LV{n}" for n in range(1, 33) if f"LV{n}" in l]
        self.out_keys = [k for k in l if _RE_OUT.match(k)]
        for k in self.out_keys:
            self.vals.setdefault(k, 0.0)

    def _auto_coils(self) -> tuple[list[str], list[str]]:
        trips, closes = [], []
        for key in self.out_keys:
            e = self.expr(self.logic_cls, key)
            ids = set(e.idents)
            if "CLOSE" in ids:
                closes.append(key)
            elif "TRIP" in ids or ids & {"TPA", "TPB", "TPC", "3PT"}:
                trips.append(key)
        return trips, closes

    # ----------------------------------------------------------- API de entrada
    def set_bit(self, name: str, mode: str) -> None:
        """VB (GOOSE), RB (remotos) e LB (bits locais, menu CNTRL): set | clear | toggle | pulse | watch."""
        name = name.upper()
        if not _RE_BIT.fullmatch(name):
            raise ValueError(f"bit inválido: {name}")
        self.vals.setdefault(name, 0.0)
        self.watched.add(name)
        if mode == "watch":
            return
        if mode == "pulse":
            self.fixed.pop(name, None)
            self.pulse(name)
        elif mode == "toggle":
            self.fixed[name] = not bool(self.vals.get(name, 0.0))
        elif mode in ("set", "clear"):
            self.fixed[name] = mode == "set"
        else:
            raise ValueError(f"modo inválido: {mode}")

    def snapshot_bits(self) -> dict:
        d = super().snapshot_bits()
        names = sorted(set(self.used_bits) | self.watched, key=lambda x: (x[:2], int(re.sub(r"\D", "", x) or 0)))
        d["rb"] = [b for b in ({"name": n, "on": bool(self.b(n)), "held": self.fixed.get(n), "label": self.labels.get(n, ""),
                                "used": n in self.used_bits} for n in names if n.startswith("RB"))]
        return d

    def _scan_bits(self) -> list[str]:
        bits: set[str] = set()
        for cls, items in self.settings.sections.items():
            if cls in ("M",) or cls.startswith("P"):
                continue
            for val in items.values():
                bits.update(re.findall(r"\b(VB\d{3}|RB\d{1,2})\b", val))
        return sorted(bits)

    # ------------------------------------------------------------------ ciclo
    def step(self, dt: float) -> None:
        v = self.vals
        for n in self.pulses:
            v[n] = 0.0
        self.pulses.clear()
        self._consume_event()
        self._update_inputs(dt)
        v["LINK5A"], v["LINK5B"] = v["LINKA"], v["LINKB"]
        v["ENABLED"] = 0.0 if v["HALARM"] else 1.0
        for n, on in self.fixed.items():
            v[n] = 1.0 if on else 0.0
        for n, on in self.ext_bits.items():
            v[n] = 1.0 if on else 0.0
        v.update(self.mb_bits)
        self._update_meas(dt)
        self._meter_311c()
        self.core.update(dt)
        for el in self.elements:
            el.update(dt)
        for p in "ABC":
            v[f"50{p}"] = 1.0 if any(v.get(f"50{p}{n}") for n in range(1, 5)) else 0.0
        self._trip_stage(dt)
        self._recloser_stage(dt)
        self._close_stage(dt)
        v.update(self.forced)
        self._logic_stage(dt)
        self._breaker_stage(dt)
        self._group_stage(dt)
        self.panel.update(dt)
        self.dnp.update()
        self._ser_stage()
        self.t += dt
        self.scan += 1
        self._first_scan = False

    def _consume_event(self) -> None:
        if not self.queue:
            return
        ev = self.queue.popleft()
        v = self.vals
        if ev["type"] == "pb":
            n = ev["n"]
            v[f"PB{n}"] = 1.0 if ev["pressed"] else 0.0
            if ev["pressed"]:
                v[f"PB{n}PUL"] = 1.0
                self.pulses.add(f"PB{n}PUL")
        elif ev["type"] == "pulse":
            v[ev["name"]] = 1.0
            self.pulses.add(ev["name"])
        elif ev["type"] == "target_reset":
            v["TRGTR"] = 1.0
            self.pulses.add("TRGTR")

    def _meter_311c(self) -> None:
        """Grandezas com os nomes do 311C (pontos AI do DNP): primárias, tensões em kV, potências em MW/MVAr."""
        v, m = self.vals, self.meas
        a = {
            "IA": v["IA_MAG"], "IB": v["IB_MAG"], "IC": v["IC_MAG"], "IN": v["IN_MAG"], "IG": v["IG_MAG"],
            "VA": v["VA_MAG"] / 1000.0, "VB": v["VB_MAG"] / 1000.0, "VC": v["VC_MAG"] / 1000.0,
            "VAB": v["VAB_MAG"] / 1000.0, "VBC": v["VBC_MAG"] / 1000.0, "VCA": v["VCA_MAG"] / 1000.0, "VS": v["VS_MAG"] / 1000.0,
            "MW3": v["P"] / 1000.0, "MVAR3": v["Q"] / 1000.0, "PF3": v["PF"],
            "MWH3O": v["MWH3P"], "MWH3I": v["MWH3PI"], "MVRH3O": v["MVARH3PO"], "MVRH3I": v["MVARH3PI"],
            "FI": max(self.fault_cur["FIA"], self.fault_cur["FIB"], self.fault_cur["FIC"]),
            "51PP": num(self, "51PP", 0.0) or 0.0, "51GP": num(self, "51GP", 0.0) or 0.0, "51QP": num(self, "51QP", 0.0) or 0.0,
        }
        v.update(a)
        self.analog_keys.update(a)

    # -- disparo
    def _trip_stage(self, dt: float) -> None:
        v, lc, g = self.vals, self.logic_cls, self.group_cls
        a52 = bool(self.ev(lc, "52A")) if "52A" in self.l else bool(v.get(self.bk_input or "IN101"))
        v["52A"] = 1.0 if a52 else 0.0
        v["52B"] = 0.0 if a52 else 1.0
        tr = bool(self.ev(lc, "TR"))
        sotf = bool(self.ev(lc, "TRSOTF")) and bool(v.get("SOTFE"))
        comm = bool(self.ev(lc, "TRCOMM"))                    # avaliada (bordas), mas sem esquema de teleproteção simulado
        dtt = bool(self.ev(lc, "DTT"))
        ul = bool(self.ev(lc, "ULTR")) if "ULTR" in self.l else True
        v["FAULT"] = 1.0 if self.ev(lc, "FAULT") else 0.0
        v["ER"] = 1.0 if self.ev(lc, "ER") else 0.0
        cond = tr or sotf or dtt
        trip = v["TRIP"] != 0
        tdurd = self.tsec(g, "TDURD", 0.15)
        self.trip_rose = False
        if cond and not trip:
            trip, self.trip_timer, self.trip_rose = True, 0.0, True
            self.fault_cur.update({"FIA": v["IA_MAG"], "FIB": v["IB_MAG"], "FIC": v["IC_MAG"], "FIG": v["IG_MAG"], "FIN": v["IN_MAG"]})
            self.fault_cur["FLOC"] = self._fault_location()
            self.panel.capture(False, sotf)
        elif trip:
            self.trip_timer += dt
            if self.trip_timer >= tdurd - EPS and not cond and (ul or v["TRGTR"]):
                trip = False
        v["TRIP"] = 1.0 if trip else 0.0
        for k in ("TPA", "TPB", "TPC", "3PT"):
            v[k] = v["TRIP"]

    def _fault_location(self) -> float:
        """Localização da falta (EFLOC = Y): reatância do laço de menor impedância ÷ reatância da linha × LL."""
        if (self.settings.get(self.group_cls, "EFLOC", "N").strip().upper() != "Y") or self.core is None:
            return 0.0
        c = self.core
        zl = cmath.rect(num(self, "Z1MAG", 1.0) or 1.0, math.radians(c.zang))
        k0 = cmath.rect(num(self, "k0M1", 0.0) or 0.0, math.radians(num(self, "k0A1", 0.0) or 0.0))
        ig = c.I["A"] + c.I["B"] + c.I["C"]
        loops = []
        for pp in ("AB", "BC", "CA"):
            if abs(c.ipp(pp)) > 0.5:
                loops.append(c.vpp(pp) / c.ipp(pp))
        for p in "ABC":
            ires = c.I[p] + k0 * ig
            if abs(ires) > 0.5 and abs(ig) > 0.5:
                loops.append(c.V[p] / ires)
        if not loops or zl.imag <= 0:
            return 0.0
        z = min(loops, key=abs)
        return round(max(0.0, z.imag / zl.imag) * (num(self, "LL", 100.0) or 100.0), 2)

    # -- religamento (mesma máquina de estados do 751, tempos em ciclos e equações na lógica)
    def _recloser_stage(self, dt: float) -> None:
        v, g, lc, r = self.vals, self.group_cls, self.logic_cls, self.rc
        e79 = levels(self, "E79")
        if e79 <= 0 or "79RI" not in self.l:
            for b in ("79RS", "79CY", "79LO", "SH0", "SH1", "SH2", "SH3", "SH4"):
                v[b] = 0.0
            return
        a52 = v["52A"] != 0
        if not r.started:
            r.started = True
            r.state = "RS" if a52 else "LO"
        ri = bool(self.ev(lc, "79RI"))
        ris = bool(self.ev(lc, "79RIS")) if "79RIS" in self.l else True
        dtl = bool(self.ev(lc, "79DTL"))
        stl = bool(self.ev(lc, "79STL"))
        brs = bool(self.ev(lc, "79BRS"))
        cls = bool(self.ev(lc, "79CLS")) if "79CLS" in self.l else True
        ri_rise = ri and not self._prev_ri
        self._prev_ri = ri
        oi = [self.tsec(g, f"79OI{i}") for i in range(1, 5)]
        rsd, rsld = self.tsec(g, "79RSD", 30.0), self.tsec(g, "79RSLD", 5.0)

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
        else:
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
        v, lc = self.vals, self.logic_cls
        cl = bool(self.ev(lc, "CL"))
        ulcl = bool(self.ev(lc, "ULCL"))
        v["CL"] = 1.0 if cl else 0.0
        a52 = v["52A"] != 0
        cfd = self.tsec(self.group_cls, "CFD", 1.0)
        v["CF"] = 0.0
        close = v["CLOSE"] != 0
        if (cl and not self._prev_cl) or self._rc_request:
            if not close and not a52 and not ulcl:
                close, self.close_timer = True, 0.0
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

    def _logic_stage(self, dt: float) -> None:
        v, lc = self.vals, self.logic_cls
        for key in self.lv_keys:                          # LVn: variáveis sem temporizador (antes das SV)
            v[key] = self.fv(key, 1.0 if self.ev(lc, key) else 0.0)
        super()._logic_stage(dt)

    def _group_stage(self, dt: float) -> None:
        lc = self.logic_cls
        wanted = None
        for n in range(1, 7):
            if f"SS{n}" in self.l and self.ev(lc, f"SS{n}"):
                wanted = n
                break
        if wanted is not None and wanted != self.group and str(wanted) in self.settings.sections:
            if self.pending_group != wanted:
                self.pending_group, self.group_timer = wanted, 0.0
            self.group_timer += dt
            if self.group_timer >= self.tsec("G", "TGR") - EPS:
                self.group = wanted
                self.pending_group = None
                self._rebuild()
                self._detect_coils()
        else:
            self.pending_group = None
        for n in range(1, 7):
            self.vals[f"SG{n}"] = 1.0 if n == self.group else 0.0

    # ------------------------------------------------------------- snapshots
    def snapshot_state(self) -> dict:
        real = self.directional
        self.directional = _NoDir()
        try:
            d = super().snapshot_state()
        finally:
            self.directional = real
        g = self.group_cls
        d["recloser"].update({"enabled": levels(self, "E79") > 0, "max_shots": levels(self, "E79"),
                              "intervals": [round(self.tsec(g, f"79OI{i}"), 3) for i in range(1, 5)],
                              "reset_time": round(self.tsec(g, "79RSD"), 3), "lockout_reset_time": round(self.tsec(g, "79RSLD"), 3),
                              "dtl": self.expr_text(self.logic_cls, "79DTL")})
        tc = d["trip_close"]
        tc.update({"ULTRIP": self.b("ULTR") if "ULTR" in self.vals else 0, "TDURD": round(self.tsec(g, "TDURD"), 3),
                   "TR_expr": self.expr_text(self.logic_cls, "TR"), "CL_expr": self.expr_text(self.logic_cls, "CL"),
                   "52A_expr": self.expr_text(self.logic_cls, "52A")})
        v = self.vals
        c = self.core
        d["line311"] = {
            "bits": {k: bool(v.get(k)) for k in ("VPOLV", "LOP", "ILOP", "3PO", "SOTFE", "ZLOAD", "FSA", "FSB", "FSC", "32QF", "32QR",
                                                  "F32P", "R32P", "32GF", "32GR", "32QE", "32QGE", "32VE", "50QF", "50QR", "50GF", "50GR")},
            "v1mem": round(abs(c.v1mem or 0j), 3), "v1": round(abs(c.v1), 3), "i1": round(abs(c.i1), 3), "i2": round(abs(c.i2), 3),
            "i0": round(abs(c.i0), 3), **c.dir_info,
        }
        return d


class _NoDir:
    def info(self) -> dict:
        return {"enabled": False}


def _RE_INPUT_ALL(text: str) -> list[str]:
    return _RE_IN.findall(text.upper())
