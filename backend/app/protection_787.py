"""Proteções do SEL-787 (relé de proteção de transformador; manual, seção 4: Protection and Logic Functions).

- **87** diferencial percentual de dupla inclinação (figuras 4.1 a 4.6, tabela 4.4): TAPn, compensação de conexão WnCTC (tabela 4.5),
  elementos restritos 87R1..3, não restrito 87U1..3, restrição por harmônicas (2ª e 4ª somadas à característica, HRSTR), bloqueio por
  harmônicas cruzado (2ª/4ª) e individual (5ª) (HBLK), modo de alta segurança por energização (INRn) e alarmes 87AP/87AT e TH5P/TH5T;
- **REF1** falta à terra restrita (figuras 4.9 a 4.13, tabela 4.6): elemento direcional de sequência zero, bypass com o disjuntor
  aberto, REF1F / REF1R e REF1P (curva U4);
- **50/51 por enrolamento** (tabelas 4.7 a 4.15): fase máxima 50Pnx / 51Pn, fases A, B e C (50Pn1A.. / 51PnA..), residual 50Gnx / 51Gn,
  sequência negativa 50Qnx / 51Qn e neutro (canal IN1) 50N1x / 51N1.

Correntes em A secundários por enrolamento: ``meas["Wn_IA|IB|IC|IMAX|IG|I2"]`` e ``meas["IN1"]`` (preenchidas por ``Relay787Engine``).
"""
from __future__ import annotations

import cmath
import math
import re
from typing import TYPE_CHECKING

from . import curves
from .protection import TimeOc, _Element

if TYPE_CHECKING:  # pragma: no cover
    from .engine import RelayEngine

_EPS = 1e-9
_HYST = 0.95
S3 = math.sqrt(3.0)

# Matrizes de compensação CTC(0..12) (tabela 4.5)
_CTC = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[1 / S3 * x for x in r] for r in ([1, -1, 0], [0, 1, -1], [-1, 0, 1])],
    [[x / 3 for x in r] for r in ([1, -2, 1], [1, 1, -2], [-2, 1, 1])],
    [[1 / S3 * x for x in r] for r in ([0, -1, 1], [1, 0, -1], [-1, 1, 0])],
    [[x / 3 for x in r] for r in ([-1, -1, 2], [2, -1, -1], [-1, 2, -1])],
    [[1 / S3 * x for x in r] for r in ([-1, 0, 1], [1, -1, 0], [0, 1, -1])],
    [[x / 3 for x in r] for r in ([-2, 1, 1], [1, -2, 1], [1, 1, -2])],
    [[1 / S3 * x for x in r] for r in ([-1, 1, 0], [0, -1, 1], [1, 0, -1])],
    [[x / 3 for x in r] for r in ([-1, 2, -1], [-1, -1, 2], [2, -1, -1])],
    [[1 / S3 * x for x in r] for r in ([0, 1, -1], [-1, 0, 1], [1, -1, 0])],
    [[x / 3 for x in r] for r in ([1, 1, -2], [-2, 1, 1], [1, -2, 1])],
    [[1 / S3 * x for x in r] for r in ([1, 0, -1], [-1, 1, 0], [0, -1, 1])],
    [[x / 3 for x in r] for r in ([2, -1, -1], [-1, 2, -1], [-1, -1, 2])],
]


def ctc_apply(m: int, i: list[complex]) -> list[complex]:
    mat = _CTC[max(0, min(12, int(m)))]
    return [sum(mat[r][c] * i[c] for c in range(3)) for r in range(3)]


def enabled_windings(eng: "RelayEngine") -> list[int]:
    """Enrolamentos no diferencial: E87Wn = Y (787-4) ou, no 787 de dois enrolamentos, E87 = Y (W1 e W2)."""
    st, g = eng.settings, eng.group_cls
    if any(f"E87W{n}" in st.sections[g] for n in range(1, 5)):
        return [n for n in range(1, 5) if st.get(g, f"E87W{n}", "N").strip().upper() == "Y"]
    return [1, 2] if st.get(g, "E87", "N").strip().upper() == "Y" else []


def winding_taps(eng: "RelayEngine") -> dict[int, float]:
    """TAPn (A secundários): do ajuste MVA (se não OFF) ou do ajuste TAPn digitado."""
    st, g = eng.settings, eng.group_cls
    mva = st.number(g, "MVA", None)
    out: dict[int, float] = {}
    for n in range(1, 5):
        tap = st.number(g, f"TAP{n}", 1.0) or 1.0
        vw = st.number(g, f"VWDG{n}", None)
        ctr = st.number(g, f"CTR{n}", 1.0) or 1.0
        if mva and vw:
            c = S3 if st.get(g, f"W{n}CT", "WYE").strip().upper().startswith("D") else 1.0
            tap = mva * 1000.0 / (S3 * vw * ctr) * c
        out[n] = tap
    return out


class Differential(_Element):
    """Elemento diferencial 87 (três fases: 87-1 = A, 87-2 = B, 87-3 = C)."""
    kind = "87"
    pk_bit, t_bit = "87R", "87U"

    def __init__(self, eng: "RelayEngine") -> None:
        super().__init__(eng, "87", None)
        st, g = eng.settings, eng.group_cls
        self.windings = enabled_windings(eng)
        self.ctc = {n: int(st.number(g, f"W{n}CTC", 0) or 0) for n in range(1, 5)}
        self.tap = winding_taps(eng)
        self.o87p = st.number(g, "O87P", 0.3) or 0.3
        self.slp1 = (st.number(g, "SLP1", 25) or 25) / 100.0
        self.slp2 = (st.number(g, "SLP2", 70) or 70) / 100.0
        self.irs1 = st.number(g, "IRS1", 6.0) or 6.0
        self.u87p = st.number(g, "U87P", 10.0) or 10.0
        self.pct2 = st.number(g, "PCT2", None)
        self.pct4 = st.number(g, "PCT4", None)
        self.pct5 = st.number(g, "PCT5", None)
        self.hrstr = st.get(g, "HRSTR", "N").strip().upper() == "Y"
        self.hblk = st.get(g, "HBLK", "N").strip().upper() == "Y"
        self.ap87 = st.number(g, "87AP", None)
        self.ad87 = st.number(g, "87AD", 5.0) or 5.0
        self.th5p = st.number(g, "TH5P", None)
        self.th5d = st.number(g, "TH5D", 1.0) or 0.0
        self.iop = [0.0] * 3
        self.irt = [0.0] * 3
        self.h = {"2": [0.0] * 3, "4": [0.0] * 3, "5": [0.0] * 3}
        self.inr_low = [0.0] * 3          # tempo com IRT < 0,05 (alta segurança após desenergização)
        self.inr_hold = [0.0] * 3         # tempo restante do modo de alta segurança após a energização
        self.inr = [False] * 3
        self.r = [False] * 3
        self.hr = [False] * 3
        self.u = [False] * 3
        self.bl = [False] * 3
        self.alarm_t = 0.0
        self.th5_t = 0.0
        self.alarm = self.alarm_timed = self.th5 = self.th5_timed = False
        self.out_r = self.out_u = self.out_hb = self.out_hr = False
        for b in self._bits():
            eng.vals.setdefault(b, 0.0)

    @staticmethod
    def _bits() -> list[str]:
        b = ["87R", "87U", "87HR", "87HB", "87AP", "87AT", "TH5P", "TH5T", "87BL", "2_4HBL"]
        for k in "123":
            b += [f"87R{k}", f"87U{k}", f"87HR{k}", f"87BL{k}", f"INR{k}", f"5HB{k}", f"2_4HB{k}"]
        return b

    def _compensated(self, k: int) -> list[complex]:
        """Corrente compensada e em pu de TAP de cada enrolamento habilitado, para a fase k (0 = A)."""
        out = []
        for n in self.windings:
            ph = self.eng.wph.get(n)
            if not ph:
                continue
            comp = ctc_apply(self.ctc[n], ph)
            out.append(comp[k] / self.tap[n])
        return out

    def update(self, dt: float) -> None:
        eng = self.eng
        cyc = 1.0 / eng.nominal_freq
        cfg = eng.field.cfg
        any_alarm = any_th5 = False
        for k in range(3):
            cur = self._compensated(k)
            iop = abs(sum(cur)) if cur else 0.0
            irt = sum(abs(c) for c in cur)
            self.iop[k], self.irt[k] = iop, irt
            ih2, ih4, ih5 = iop * cfg.h2_pct / 100.0, iop * cfg.h4_pct / 100.0, iop * cfg.h5_pct / 100.0
            self.h["2"][k], self.h["4"][k], self.h["5"][k] = ih2, ih4, ih5
            # INRn: alta segurança (SLP2 no lugar de SLP1) com o transformador desenergizado (IRT < 0,05, 2 ciclos) e por 10 ciclos após energizar
            if irt < 0.05:
                self.inr_low[k] += dt
                if self.inr_low[k] >= 2 * cyc - _EPS:
                    self.inr[k] = True
                    self.inr_hold[k] = 10 * cyc
            else:
                self.inr_low[k] = 0.0
                if self.inr[k]:
                    self.inr_hold[k] -= dt
                    if self.inr_hold[k] <= _EPS:
                        self.inr[k] = False
            slope1 = self.slp2 if self.inr[k] else self.slp1
            if irt <= self.irs1:
                f = slope1 * irt
            else:
                f = slope1 * self.irs1 + self.slp2 * (irt - self.irs1)
            on = iop > self.o87p                                         # 87On
            self.u[k] = bool(iop > self.u87p)
            self.r[k] = bool(on and iop > f)
            hb5 = bool(self.pct5 and iop > _EPS and ih5 / iop * 100.0 > self.pct5)
            self.hr[k] = bool(on and iop > f + ih2 + ih4 and not hb5)
            b24 = bool(iop > _EPS and ((self.pct2 and ih2 / iop * 100.0 > self.pct2) or (self.pct4 and ih4 / iop * 100.0 > self.pct4)))
            eng.vals[f"2_4HB{k + 1}"] = 1.0 if b24 else 0.0
            eng.vals[f"5HB{k + 1}"] = 1.0 if hb5 else 0.0
            any_alarm = any_alarm or bool(self.ap87 and iop > self.ap87)
            any_th5 = any_th5 or bool(self.th5p and ih5 > self.th5p)
        vals = eng.vals
        b24_any = any(vals[f"2_4HB{k}"] for k in "123")                   # bloqueio comum (cruzado) por 2ª / 4ª
        for k in range(3):
            self.bl[k] = bool(b24_any or vals[f"5HB{k + 1}"])             # 87BLn
        hb = any(self.r[k] and not self.bl[k] for k in range(3))          # 87HB (bloqueio por harmônicas, HBLK = Y)
        self.out_hb = bool(self.hblk and hb)
        self.out_hr = any(self.hr)
        self.out_u = any(self.u)
        self.out_r = bool((self.hrstr and self.out_hr) or self.out_hb)
        self.pk, self.timed = self.out_r, self.out_u
        # alarme de corrente diferencial (87AP / 87AD) e de 5ª harmônica (TH5P / TH5D)
        self.alarm = any_alarm
        self.alarm_t = self.alarm_t + dt if any_alarm else 0.0
        self.alarm_timed = self.alarm_t >= self.ad87 - _EPS and any_alarm
        self.th5 = any_th5
        self.th5_t = self.th5_t + dt if any_th5 else 0.0
        self.th5_timed = any_th5 and self.th5_t >= self.th5d - _EPS
        vals["87R"], vals["87U"], vals["87HR"], vals["87HB"] = float(self.out_r), float(self.out_u), float(self.out_hr), float(self.out_hb)
        vals["87AP"], vals["87AT"], vals["TH5P"], vals["TH5T"] = float(self.alarm), float(self.alarm_timed), float(self.th5), float(self.th5_timed)
        vals["87BL"] = float(any(self.bl))
        vals["2_4HBL"] = float(b24_any)
        for k in range(3):
            n = k + 1
            vals[f"87R{n}"], vals[f"87U{n}"], vals[f"87HR{n}"] = float(self.r[k]), float(self.u[k]), float(self.hr[k])
            vals[f"87BL{n}"], vals[f"INR{n}"] = float(self.bl[k]), float(self.inr[k])

    def curve_point(self, irt: float) -> float:
        return self.slp1 * irt if irt <= self.irs1 else self.slp1 * self.irs1 + self.slp2 * (irt - self.irs1)

    def info(self) -> dict:
        phases = []
        for k, nm in enumerate("ABC"):
            phases.append({"phase": nm, "iop": round(self.iop[k], 3), "irt": round(self.irt[k], 3),
                           "threshold": round(self.curve_point(self.irt[k]), 3), "h2": round(self.h["2"][k], 3),
                           "h4": round(self.h["4"][k], 3), "h5": round(self.h["5"][k], 3), "inr": self.inr[k],
                           "r": self.r[k], "hr": self.hr[k], "u": self.u[k], "bl": self.bl[k]})
        return {
            "name": "87", "kind": "Diferencial percentual (87)", "quantity": "corrente diferencial IOP / restrição IRT (pu de TAP)",
            "pickup": self.o87p,
            "setting": (f"O87P {self.o87p:g} · SLP1 {self.slp1 * 100:g}% · SLP2 {self.slp2 * 100:g}% · IRS1 {self.irs1:g} · U87P {self.u87p:g} · "
                        f"HRSTR {'Y' if self.hrstr else 'N'} · HBLK {'Y' if self.hblk else 'N'} · enrolamentos "
                        + ", ".join(f"W{n} (TAP {self.tap[n]:.2f}, CTC {self.ctc[n]})" for n in self.windings)),
            "multiple": round(max(self.iop) / self.o87p, 3) if self.o87p else 0.0,
            "tc": "", "measured": round(max(self.iop), 3), "pickup_bit": "87R", "timed_bit": "87U",
            "pk": self.out_r, "timed": self.out_u, "progress": 100.0 if self.out_r or self.out_u else 0.0,
            "diff": {"phases": phases, "alarm": self.alarm, "alarm_t": self.alarm_timed, "th5": self.th5, "th5_t": self.th5_timed,
                     "slp1": self.slp1, "slp2": self.slp2, "irs1": self.irs1, "o87p": self.o87p, "u87p": self.u87p},
        }


class Ref(_Element):
    """Falta à terra restrita REF1 (neutro IN1 × corrente residual dos enrolamentos escolhidos em REF1POL)."""
    kind = "REF"
    pk_bit, t_bit = "REF1F", "REF1P"

    def __init__(self, eng: "RelayEngine", pol: str, pickup: float) -> None:
        super().__init__(eng, "REF1", "REF1TC")
        st, g = eng.settings, eng.group_cls
        self.pol = [int(c) for c in pol if c in "1234"]
        self.pickup = pickup
        self.byp_key = "REF1BYP" if eng.group_has("REF1BYP") else "REF52BYP"
        self.inomn = st.number(g, "INOMN1", 1.0) or 1.0
        self.ctrn = st.number(g, "CTRN1", 1.0) or 1.0
        self.fwd = self.rev = False
        self.f_t = self.r_t = 0.0
        self.p_el = 0.0
        self.torque = self.in_pu = self.ig_pu = 0.0
        self.enable = self.bypass = False
        self.f = self.r = self.p = False
        for b in ("REF1F", "REF1R", "REF1P", "REF1E", "REF1BY", "REFTQ1", "50NREF1", "50GREF1"):
            eng.vals.setdefault(b, 0.0)

    def update(self, dt: float) -> None:
        eng = self.eng
        cyc = 1.0 / eng.nominal_freq
        # polarização: soma vetorial das correntes residuais (primárias) dos enrolamentos escolhidos, na base do TC de neutro
        pol = 0j
        for n in self.pol:
            ph = eng.wph.get(n)
            if ph:
                pol += (ph[0] + ph[1] + ph[2]) * eng.ctr_of(n)
        igw = pol / (self.ctrn * self.inomn)
        inw = eng.in1_ph / self.inomn
        self.in_pu, self.ig_pu = abs(inw), abs(igw)
        c1 = self.in_pu >= self.pickup                                    # 50NREF1
        c2 = self.ig_pu >= 0.8 * self.pickup                              # 50GREF1
        tc = self.tc_only()
        self.enable = bool(c1 and c2 and tc)                              # REF1E
        self.torque = (igw * inw.conjugate()).real if self.enable else 0.0   # REFTQ1
        thres = 0.1 * 0.8 * self.pickup * self.pickup                     # THRES1P = -THRES1N (aprox.: ±10 % do máximo sem polarização fraca)
        byp_on = bool(eng.ev(eng.group_cls, self.byp_key)) if eng.group_has(self.byp_key) else True
        brk_open = all(not eng.vals.get(f"52A{n}", 0.0) for n in self.pol if n in (1, 2)) if self.pol else False
        self.bypass = bool(c1 and not c2 and tc and (brk_open or not byp_on))      # REF1BY: corrente de neutro sem polarização
        fp = self.enable and self.torque > thres
        rp = self.enable and self.torque < -thres
        self.f_t = self.f_t + dt if (fp or self.bypass) else 0.0
        self.r_t = self.r_t + dt if rp else 0.0
        self.f = self.f_t >= 1.5 * cyc - _EPS
        self.r = self.r_t >= 1.5 * cyc - _EPS
        # REF1P: tempo inverso U4 (TD 0,5), comandado pelo torque REF1F, pickup 50REF1P em |IN1|
        if self.f and self.in_pu >= self.pickup:
            mult = self.in_pu / self.pickup
            top = curves.operate_time("U4", mult, 0.5)
            if top != float("inf"):
                self.p_el = min(1.0, self.p_el + dt / top)
        else:
            self.p_el = 0.0                                                # reset em 1 ciclo
        self.p = self.p_el >= 1.0 - _EPS
        self.pk, self.timed = self.f, self.p
        v = eng.vals
        v["REF1E"], v["REF1BY"], v["REF1F"], v["REF1R"], v["REF1P"] = (float(x) for x in (self.enable, self.bypass, self.f, self.r, self.p))
        v["REFTQ1"] = self.torque
        v["50NREF1"], v["50GREF1"] = float(c1), float(c2)
        eng.analog_keys.add("REFTQ1")

    def info(self) -> dict:
        return {
            "name": "REF1", "kind": "Falta à terra restrita (REF)", "quantity": "IN1 × residual dos enrolamentos " + ("+".join(map(str, self.pol)) or "-"),
            "pickup": self.pickup, "setting": f"50REF1P {self.pickup:g} pu · REF1POL {''.join(map(str, self.pol))}",
            "multiple": round(self.in_pu / self.pickup, 3) if self.pickup else 0.0, "tc": "", "measured": round(self.in_pu, 3),
            "pickup_bit": "REF1F", "timed_bit": "REF1P", "pk": self.f, "timed": self.p,
            "progress": round(100.0 * self.p_el, 1), "ref": {"in": round(self.in_pu, 3), "ig": round(self.ig_pu, 3), "torque": round(self.torque, 4),
                                                              "enable": self.enable, "bypass": self.bypass, "fwd": self.f, "rev": self.r},
        }


class WInst(_Element):
    """Sobrecorrente instantânea / tempo definido do enrolamento n (50Pnx, 50Gnx, 50Qnx) ou do neutro (50N1x), figura 4.16."""
    kind = "50"

    def __init__(self, eng, base: str, qty: str, pickup: float, delay: float, tc_key: str | None, phases: bool = False) -> None:
        super().__init__(eng, base, tc_key)
        self.qty, self.pickup, self.delay = qty, pickup, delay
        self.pk_bit, self.t_bit = base + "P", base + "T"
        self.elapsed = 0.0
        self.phases = {}
        if phases:                                   # 50Pn1: bits por fase 50Pn1AP/AT, 50Pn1BP/BT, 50Pn1CP/CT
            wn = base[3]
            self.phases = {ph: {"qty": f"W{wn}_I{ph}", "pk": False, "el": 0.0, "bit": f"{base}{ph}"} for ph in "ABC"}
            for d in self.phases.values():
                eng.vals.setdefault(d["bit"] + "P", 0.0)
                eng.vals.setdefault(d["bit"] + "T", 0.0)

    def update(self, dt: float) -> None:
        meas = self.eng.meas[self.qty]
        self.measured = meas
        en = self.tc()
        for d in self.phases.values():
            mph = self.eng.meas[d["qty"]]
            d["pk"] = bool(en and (mph >= self.pickup or (d["pk"] and mph >= _HYST * self.pickup)))
            d["el"] = d["el"] + dt if d["pk"] else 0.0
            self.eng.vals[d["bit"] + "P"] = float(d["pk"])
            self.eng.vals[d["bit"] + "T"] = float(d["pk"] and d["el"] >= self.delay - _EPS)
        self.pk = bool(en and (meas >= self.pickup or (self.pk and meas >= _HYST * self.pickup)))
        if self.pk:
            self.elapsed += dt
            self.timed = self.elapsed >= self.delay - _EPS
        else:
            self.elapsed, self.timed = 0.0, False
        self.publish()

    def info(self) -> dict:
        return {
            "name": self.base, "kind": "Instantâneo (50)", "quantity": QTY[self.qty.split("_")[-1] if "_" in self.qty else self.qty],
            "pickup": self.pickup, "setting": f"{self.pickup:g} A sec., atraso {self.delay:g} s",
            "multiple": round(self.measured / self.pickup, 3) if self.pickup else 0.0,
            "tc": self.tc_key and self.eng.expr_text(self.eng.group_cls, self.tc_key) or "",
            "measured": round(self.measured, 3), "pickup_bit": self.pk_bit, "timed_bit": self.t_bit, "pk": self.pk, "timed": self.timed,
            "dir_bit": "", "dir_ok": True,
            "progress": min(100.0, 100.0 * self.elapsed / self.delay) if self.delay > 0 and self.pk else (100.0 if self.timed else 0.0),
        }


QTY = {"IMAX": "máx. corrente de fase", "IA": "corrente fase A", "IB": "corrente fase B", "IC": "corrente fase C",
       "IG": "corrente residual (IG)", "I2": "3I2 (seq. negativa)", "IN1": "corrente de neutro (IN1)"}

_RE_50 = re.compile(r"^50([PGQ])([1-4])([1-4])P$")        # 50P11P: tipo, enrolamento, nível
_RE_50N = re.compile(r"^50N1([12])P$")
_RE_51 = re.compile(r"^51([PGQ])([1-4])P$")               # 51P1P, 51G2P, 51Q1P
_RE_51PH = re.compile(r"^51P([1-4])([ABC])P$")          # 51P1AP: fase A do enrolamento 1
_RE_51N = re.compile(r"^51N1P$")
_RE_50PH_BITS = re.compile(r"^50P(\d)1([ABC])P$")


def _w_qty(letter: str, n: int) -> str:
    return f"W{n}_" + {"P": "IMAX", "G": "IG", "Q": "I2"}[letter]


def build_787(eng: "RelayEngine") -> tuple[list[_Element], int]:
    """Elementos 87, REF1 e 50/51 por enrolamento do grupo ativo."""
    st, g = eng.settings, eng.group_cls
    els: list[_Element] = []
    off = 0
    v = eng.vals

    def num(k: str, d: float | None = None) -> float | None:
        return st.number(g, k, d)

    def tcof(base: str) -> str | None:
        return base + "TC" if eng.group_has(base + "TC") else None

    for b in Differential._bits():
        v.setdefault(b, 0.0)
    for n in range(1, 5):                                                     # bits por fase 50Pnx[A|B|C]P/T
        for x in (1, 2):
            for ph in "ABC":
                v.setdefault(f"50P{n}{x}{ph}P", 0.0)
                v.setdefault(f"50P{n}{x}{ph}T", 0.0)
    if len(enabled_windings(eng)) >= 2:
        els.append(Differential(eng))
    else:
        off += 1
    for k in list(st.sections[g]):
        m = _RE_50.match(k)
        if m:
            base = k[:-1]
            for suffix in ("P", "T"):
                v.setdefault(base + suffix, 0.0)
            pk = num(k)
            if pk is None or pk <= 0:
                off += 1
                continue
            letter, n, lv = m.group(1), int(m.group(2)), m.group(3)
            delay = num(base + "D", 0.0) or 0.0
            els.append(WInst(eng, base, _w_qty(letter, n), pk, delay, tcof(base), phases=(letter == "P" and lv == "1")))
            continue
        m = _RE_50N.match(k)
        if m:
            base = k[:-1]
            v.setdefault(base + "P", 0.0)
            v.setdefault(base + "T", 0.0)
            pk = num(k)
            if pk is None or pk <= 0:
                off += 1
                continue
            els.append(WInst(eng, base, "IN1", pk, num(base + "D", 0.0) or 0.0, tcof(base)))
            continue
        m = _RE_51.match(k) or _RE_51PH.match(k) or _RE_51N.match(k)
        if m:
            base = k[:-1]
            for suffix in ("P", "T", "R"):
                v.setdefault(base + suffix, 0.0)
            pk = num(k)
            if pk is None or pk <= 0:
                off += 1
                continue
            if _RE_51N.match(k):
                qty = "IN1"
            elif _RE_51PH.match(k):
                qty = f"W{m.group(1)}_I{m.group(2)}"
            else:
                qty = _w_qty(m.group(1), int(m.group(2)))
            els.append(TimeOc(eng, base, qty, pk, st.get(g, base + "C", "U3").strip() or "U3", num(base + "TD", 1.0) or 1.0,
                              st.get(g, base + "RS", "N").strip().upper() == "Y", num(base + "CT", 0.0) or 0.0, num(base + "MR", 0.0) or 0.0, tcof(base)))
    pol = st.get(g, "REF1POL", "OFF").strip().upper()
    ref_pk = num("50REF1P", 0.25) or 0.25
    for b in ("REF1F", "REF1R", "REF1P", "REF1E", "REF1BY", "50NREF1", "50GREF1"):
        v.setdefault(b, 0.0)
    if pol not in ("OFF", "") and any(c in "1234" for c in pol):
        els.append(Ref(eng, pol, ref_pk))
    else:
        off += 1
    for b in ("ORED50T", "ORED51T"):
        v.setdefault(b, 0.0)
    return els, off


def ref_trip_bits() -> list[str]:  # pragma: no cover - documentação
    return ["REF1F", "REF1R", "REF1P"]
