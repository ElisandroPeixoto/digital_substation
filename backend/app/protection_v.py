"""Proteções de tensão avançadas, sincronismo e potência do SEL-751 (manual, seção 4: Group Settings).

- 27I / 59I: subtensão e sobretensão de tempo inverso (tabelas 4.51 a 4.56, equações 4.20 e 4.21);
- 3P27 / 3P59: subtensão/sobretensão trifásicas sem atraso (figuras 4.94 e 4.95);
- 25: verificação de sincronismo (figuras 4.102 a 4.105, tabela 4.57) e bits DLDB / DLLB / LLDB;
- 3PWRn: elementos de potência trifásica (figura 4.107, tabela 4.58);
- 593SRMS: sobretensão da tensão eficaz de 3 s (média de 10 min, figuras 4.96 e 4.97).

Os elementos são criados por :func:`build_extra` a partir dos ajustes do grupo ativo e entram na mesma lista de
elementos do motor (`engine.elements`); os bits do Relay Word são registrados mesmo com o elemento desabilitado.
Todas as tensões estão em volts secundários.
"""
from __future__ import annotations

import math
from collections import deque
from typing import TYPE_CHECKING

from .fieldsim import A_OP, A_OP2

if TYPE_CHECKING:  # pragma: no cover
    from .engine import RelayEngine

_EPS = 1e-9

# Constantes (CFA, CFB, CFC) das curvas predefinidas (tabelas 4.53 e 4.56)
CURVES_27I = {"CURVEA": (1.0, 0.0, 1.0), "CURVEB": (0.98, 1.28, 2.171)}
CURVES_59I = {"CURVEA": (3.88, 0.96, 2.0), "CURVEB": (5.64, 0.24, 2.0), "CURVEC": (0.14, 0.0, 0.02)}


def _wrap(a: float) -> float:
    """Ângulo em (-180, 180]."""
    a = (a + 180.0) % 360.0 - 180.0
    return 180.0 if a == -180.0 else a


def _num(eng: "RelayEngine", key: str, default: float | None = None) -> float | None:
    return eng.settings.number(eng.group_cls, key, default)


def _txt(eng: "RelayEngine", key: str, default: str = "") -> str:
    return (eng.settings.get(eng.group_cls, key, default) or default).strip()


def _logic(eng: "RelayEngine", key: str, default: bool = True) -> bool:
    """Equação SELogic do grupo (ex.: 27I1TC, BSYNCH); ausente = `default`. Avaliada uma vez por ciclo pelo elemento dono."""
    return bool(eng.ev(eng.group_cls, key)) if eng.group_has(key) else default


def voltage_quantity(eng: "RelayEngine", name: str) -> float | None:
    """Grandeza de operação de tensão (tabelas 4.51 e 4.54), em V secundários; None se desconhecida."""
    m = eng.meas
    n = name.upper()
    if n in ("VA", "VB", "VC", "VAB", "VBC", "VCA", "VS", "V1"):
        return m[n]
    if n == "MINLL":
        return min(m["VAB"], m["VBC"], m["VCA"])
    if n == "MAXLL":
        return max(m["VAB"], m["VBC"], m["VCA"])
    if n == "MINLN":
        return min(m["VA"], m["VB"], m["VC"])
    if n == "MAXLN":
        return max(m["VA"], m["VB"], m["VC"])
    if n == "VG":
        return m["VG"] / 3.0
    if n == "3V0":
        return m["VG"]
    if n == "3V2":
        return m["V2"]
    return None


class _Base:
    """Interface mínima exigida pelo motor (`update`, `info`, `kind`, `timed`)."""
    kind = ""

    def __init__(self, eng: "RelayEngine", name: str) -> None:
        self.eng = eng
        self.base = name
        self.pk = False
        self.timed = False
        self.measured = 0.0
        self.pk_bit = ""
        self.t_bit = ""
        self.progress = 0.0

    def _info(self, kind: str, quantity: str, pickup: float, setting: str, tc: str = "") -> dict:
        return {
            "name": self.base, "kind": kind, "quantity": quantity, "pickup": pickup, "setting": setting, "tc": tc,
            "measured": round(self.measured, 3), "pickup_bit": self.pk_bit, "timed_bit": self.t_bit,
            "pk": self.pk, "timed": self.timed, "progress": round(min(100.0, 100.0 * self.progress), 1),
        }


# --------------------------------------------------------------------------- 27I / 59I
class InverseVolt(_Base):
    """Elemento de tensão de tempo inverso. 27I: opera abaixo de P (TTT = TD·(B + A/(1 − OQ/P)^C)), só integra abaixo de 0,975·P;
    59I: opera acima de P (TTT = TD·(B + A/((OQ/P)^C − 1))), só integra acima de 1,025·P. O integrador zera se a grandeza ficar do lado
    "normal" do pickup por mais que o tempo de reset (nTTR)."""

    def __init__(self, eng: "RelayEngine", fam: str, n: int) -> None:
        super().__init__(eng, f"{fam}{n}")
        self.fam, self.n = fam, n
        self.under = fam == "27I"
        self.kind = fam
        self.pk_bit, self.t_bit, self.rs_bit = self.base, self.base + "T", self.base + "RS"
        self.oq = _txt(eng, f"{self.base}OQ", "VAB").upper()
        self.pickup = _num(eng, f"{self.base}P", 120.0) or 0.0
        crv = _txt(eng, f"{self.base}CRV", "CURVEA").upper()
        table = CURVES_27I if self.under else CURVES_59I
        if crv in table:
            self.coef = table[crv]
        else:                                           # COEF: coeficientes do usuário
            self.coef = (_num(eng, f"{self.base}CFA", table["CURVEA"][0]) or 0.0,
                         _num(eng, f"{self.base}CFB", table["CURVEA"][1]) or 0.0,
                         _num(eng, f"{self.base}CFC", table["CURVEA"][2]) or 1.0)
        self.crv = crv
        self.td = _num(eng, f"{self.base}TD", 1.0) or 0.0
        self.ttr = _num(eng, f"{self.base}TTR", 0.01) or 0.0
        self.tc_key = f"{self.base}TC"
        self.idle = 0.0
        self.reset = True

    def ttt(self, oq: float) -> float:
        """Tempo total de operação (s) para a grandeza `oq` (equações 4.20 e 4.21)."""
        a, b, c = self.coef
        p = self.pickup
        if p <= 0:
            return float("inf")
        if self.under:
            x = 1.0 - oq / p
            if x <= 0:
                return float("inf")
            return self.td * (b + a / (x ** c))
        x = (oq / p) ** c - 1.0
        if x <= 0:
            return float("inf")
        return self.td * (b + a / x)

    def update(self, dt: float) -> None:
        eng = self.eng
        oq = voltage_quantity(eng, self.oq)
        enabled = _txt(eng, f"E{self.base}", "N").upper() == "Y" and oq is not None and self.pickup > 0
        enabled = enabled and _logic(eng, self.tc_key)
        self.measured = oq or 0.0
        if not enabled:
            self.pk, self.timed, self.progress, self.idle, self.reset = False, False, 0.0, 0.0, True
            self._publish()
            return
        p = self.pickup
        self.pk = bool(oq < p) if self.under else bool(oq > p)
        integ = oq < 0.975 * p if self.under else oq > 1.025 * p
        if self.pk:
            self.idle = 0.0
            if integ:
                t = self.ttt(oq)
                self.progress = min(1.0, self.progress + (dt / t if t > _EPS else 1.0))
        else:
            self.idle += dt
            if self.idle >= self.ttr - _EPS:
                self.progress = 0.0
        self.timed = self.pk and self.progress >= 1.0 - _EPS
        self.reset = self.progress <= 0.0
        self._publish()

    def _publish(self) -> None:
        v = self.eng.vals
        v[self.pk_bit] = 1.0 if self.pk else 0.0
        v[self.t_bit] = 1.0 if self.timed else 0.0
        v[self.rs_bit] = 1.0 if self.reset else 0.0

    def info(self) -> dict:
        d = self._info(f"Tempo inverso ({self.fam[:2]}I)", f"{self.oq}", self.pickup,
                       f"{self.crv}, pickup {self.pickup:g} V sec., DT {self.td:g}",
                       self.eng.expr_text(self.eng.group_cls, self.tc_key) if self.eng.group_has(self.tc_key) else "")
        d["reset_bit"], d["reset"] = self.rs_bit, self.reset
        return d


# --------------------------------------------------------------------------- 3P27 / 3P59
class ThreePhaseVolt(_Base):
    """3P27: as três tensões abaixo do pickup do nível 1 (Wye: 27P1P com |VPmax|; Delta: 27PP1P com |VPPmax|).
    3P59: as três acima do pickup do nível 1 (Wye: 59P1P com |VPmin|; Delta: 59PP1P com |VPPmin|). Sem atraso."""
    kind = "3P"

    def __init__(self, eng: "RelayEngine", bit: str) -> None:
        super().__init__(eng, bit)
        self.under = bit == "3P27"
        self.pk_bit = self.t_bit = bit
        delta = _txt(eng, "DELTA_Y", "WYE").upper() == "DELTA"
        fam = ("27" if self.under else "59") + ("PP" if delta else "P")
        self.pickup = _num(eng, f"{fam}1P")
        self.delta = delta
        self.key = f"{fam}1P"

    def update(self, dt: float) -> None:
        m = self.eng.meas
        if self.pickup is None:
            self.pk = self.timed = False
        else:
            vals = (m["VAB"], m["VBC"], m["VCA"]) if self.delta else (m["VA"], m["VB"], m["VC"])
            meas = max(vals) if self.under else min(vals)
            self.measured = meas
            self.pk = bool(meas < self.pickup) if self.under else bool(meas > self.pickup)
            self.timed = self.pk
        self.eng.vals[self.base] = 1.0 if self.pk else 0.0

    def info(self) -> dict:
        return self._info("Trifásico (" + self.base + ")", "|VPmax|" if self.under else "|VPmin|", self.pickup or 0.0,
                          f"{self.key} = {self.pickup:g} V sec." if self.pickup is not None else "OFF")


# --------------------------------------------------------------------------- 32
class PowerElement(_Base):
    """Elemento de potência trifásica n (figura 4.107). A potência (P ou Q, média de 2 ciclos) em VA secundários é comparada com 3PWRnP;
    +WATTS/+VARS: valor positivo (convenção de carga), −WATTS/−VARS: valor negativo (inverte o sinal). Supervisão: |VAB| e |VBC| > 20 V
    (SINGLEV = Y: VBC = VAB). Atraso PWRnD."""
    kind = "32"
    TYPES = ("+WATTS", "-WATTS", "+VARS", "-VARS")

    def __init__(self, eng: "RelayEngine", n: int) -> None:
        super().__init__(eng, f"3PWR{n}")
        self.n = n
        self.pk_bit, self.t_bit = f"3PWR{n}P", f"3PWR{n}T"
        self.pickup = _num(eng, f"3PWR{n}P")
        t = _txt(eng, f"PWR{n}T", "+VARS").upper().replace("–", "-").replace(" ", "")
        self.type = t if t in self.TYPES else "+VARS"
        self.delay = _num(eng, f"PWR{n}D", 0.0) or 0.0
        self.single = _txt(eng, "SINGLEV", "N").upper() == "Y"
        self.buf: deque[tuple[float, float]] = deque()
        self.total = 0.0
        self.elapsed = 0.0

    def _average(self, dt: float, x: float) -> float:
        window = 2.0 / max(self.eng.meas["FREQ"], 1.0)
        self.buf.append((dt, x))
        self.total += dt
        while len(self.buf) > 1 and self.total - self.buf[0][0] >= window:
            self.total -= self.buf[0][0]
            self.buf.popleft()
        return sum(d * v for d, v in self.buf) / self.total if self.total > 0 else x

    def update(self, dt: float) -> None:
        eng = self.eng
        scale = 1000.0 / (eng.ctr * eng.ptr)            # kW/kvar primários -> VA secundários (trifásico)
        p_va, q_va = eng.vals.get("P", 0.0) * scale, eng.vals.get("Q", 0.0) * scale
        quantity = p_va if "WATTS" in self.type else q_va
        avg = self._average(dt, quantity)
        sig = avg if self.type.startswith("+") else -avg
        self.measured = avg
        m = eng.meas
        vab, vbc = m["VAB"], (m["VAB"] if self.single else m["VBC"])
        enabled = self.pickup is not None and _enabled_pwr(eng, self.n) and vab > 20.0 and vbc > 20.0
        self.pk = bool(enabled and sig > self.pickup)
        if self.pk:
            self.elapsed += dt
            self.timed = self.elapsed >= self.delay - _EPS
        else:
            self.elapsed = 0.0
            self.timed = False
        self.progress = min(1.0, self.elapsed / self.delay) if self.delay > 0 and self.pk else (1.0 if self.timed else 0.0)
        eng.vals[self.pk_bit] = 1.0 if self.pk else 0.0
        eng.vals[self.t_bit] = 1.0 if self.timed else 0.0

    def info(self) -> dict:
        return self._info(f"Potência ({self.type})", "P" if "WATTS" in self.type else "Q", self.pickup or 0.0,
                          f"{self.type} {self.pickup:g} VA sec., atraso {self.delay:g} s" if self.pickup is not None else "OFF")


def _enabled_pwr(eng: "RelayEngine", n: int) -> bool:
    e = _txt(eng, "EPWR", "N").upper()
    return e == "3P2" or (e == "3P1" and n == 1)


# --------------------------------------------------------------------------- 25
class SyncCheck(_Base):
    """Verificação de sincronismo (E25 = Y e VSCONN = VS).

    - Janela de tensão (25VLO / 25VHI): bits 59VP e 59VS; 59VDIF (diferença percentual ≤ 25VDIF, OFF = sempre 1; 2 ciclos de pickup);
    - frequência de escorregamento (fP − fS), bit SF (|escorregamento| < 25SF) quando as tensões são sadias, a frequência está em FNOM ± 5 Hz
      e BSYNCH está desligada;
    - diferença angular |(∠VP − ∠VS) + (fP − fS)·TCLOSD/1000·360| (compensada pelo tempo de fechamento quando há escorregamento > 0,005 Hz
      e TCLOSD ≠ OFF): 25A1 e 25A2 (ângulos máximos 25ANG1/25ANG2), com a regra da figura 4.103 (ângulo decrescente → aguarda 0°);
    - DLDB / DLLB / LLDB (figura 4.105) com 27LP, 59LP, 27BP e 59BP.
    VP = 25RCF · tensão da fase escolhida por SYNCPH (VA/VB/VC ou VAB/VBC/VCA; um ângulo usa VA, ou VAB em delta); VS = entrada de sincronismo."""
    kind = "25"
    _PHASES = ("VA", "VB", "VC", "VAB", "VBC", "VCA")

    def __init__(self, eng: "RelayEngine") -> None:
        super().__init__(eng, "25")
        self.pk_bit, self.t_bit = "25A1", "25A2"
        self.delta = _txt(eng, "DELTA_Y", "WYE").upper() == "DELTA"
        self.vlo = _num(eng, "25VLO", 105.0) or 0.0
        self.vhi = _num(eng, "25VHI", 130.0) or 0.0
        self.vdif = _num(eng, "25VDIF")                  # None = OFF
        self.rcf = _num(eng, "25RCF", 1.0) or 1.0
        self.sf_max = _num(eng, "25SF", 0.2) or 0.0
        self.ang1 = _num(eng, "25ANG1", 25.0) or 0.0
        self.ang2 = _num(eng, "25ANG2", 40.0) or 0.0
        self.tclosd = _num(eng, "TCLOSD")                # None = OFF
        ph = _txt(eng, "SYNCPH", "VAB" if self.delta else "VA").upper()
        self.phase, self.offset = "VAB" if self.delta else "VA", 0.0
        if ph in self._PHASES:
            self.phase = ph
        else:
            try:
                self.offset = float(ph)
            except ValueError:
                pass
        self.dead_line = _num(eng, "27LP", 25.0) or 0.0
        self.live_line = _num(eng, "59LP", 90.0) or 0.0
        self.dead_bus = _num(eng, "27BP", 25.0) or 0.0
        self.live_bus = _num(eng, "59BP", 90.0) or 0.0
        self.vdif_timer = 0.0
        self.prev_diff: float | None = None
        self.prev_signed: float | None = None
        self.angle = 0.0
        self.slip = 0.0
        self.pulse = 0.0
        self.prev_a: tuple[bool, bool] = (False, False)

    def _vp(self) -> complex:
        sv = self.eng.sec_V
        a, b, c = sv["A"], sv["B"], sv["C"]
        return {"VA": a, "VB": b, "VC": c, "VAB": a - b, "VBC": b - c, "VCA": c - a}[self.phase] * self.rcf

    def update(self, dt: float) -> None:
        eng = self.eng
        v = eng.vals
        vp_c = self._vp()
        vp = abs(vp_c)
        vs = eng.meas["VS"]
        f_p = eng.meas["FREQ"]
        f_s = eng.field.cfg.vs_freq
        vp_ok = self.vlo <= vp <= self.vhi
        vs_ok = self.vlo <= vs <= self.vhi
        # diferença de tensão
        if self.vdif is None:
            vdif_ok = True
        else:
            vdif_ok = vs > _EPS and abs(1.0 - vp / vs) * 100.0 <= self.vdif
        # pickup de 2 ciclos do caminho de supervisão de tensão
        ok_v = vp_ok and vs_ok and vdif_ok
        self.vdif_timer = self.vdif_timer + dt if ok_v else 0.0
        v_enable = ok_v and self.vdif_timer >= 2.0 / max(f_p, 1.0) - _EPS
        fnom = eng.nominal_freq
        in_window = (fnom - 5.0) < f_p < (fnom + 5.0)
        block = _logic(eng, "BSYNCH", False)
        enable = bool(v_enable and in_window and not block)
        self.slip = (f_p - f_s) if enable else 0.0
        sf = bool(enable and abs(f_p - f_s) < self.sf_max)
        # diferença angular
        ang_vp = math.degrees(math.atan2(vp_c.imag, vp_c.real)) if vp > _EPS else 0.0
        ang_vs = (eng.vs_ang + eng.sync_rot + self.offset) if vs > _EPS else 0.0
        raw = _wrap(ang_vp - ang_vs)
        slipping = self.tclosd is not None and abs(f_p - f_s) > 0.005
        signed = _wrap(raw + (f_p - f_s) * (self.tclosd or 0.0) / 1000.0 * 360.0) if slipping else raw
        diff = abs(signed)
        self.angle = diff
        a1 = a2 = False
        if sf:
            if not slipping:
                a1, a2 = diff < self.ang1, diff < self.ang2
            else:
                increasing = self.prev_diff is not None and diff > self.prev_diff + 1e-9
                decreasing = self.prev_diff is not None and diff < self.prev_diff - 1e-9
                crossed = (self.prev_signed is not None and decreasing and
                           (signed == 0.0 or (self.prev_signed > 0) != (signed > 0)) and abs(signed - self.prev_signed) < 180.0)
                if crossed:
                    self.pulse = max(1.0 / (4.0 * max(f_p, 1.0)), dt)      # 1/4 de ciclo (no mínimo 1 ciclo de varredura)
                zero = self.pulse > 0.0
                a1 = zero or (diff < self.ang1 and increasing)
                a2 = zero or (diff < self.ang2 and increasing)
        else:
            self.pulse = 0.0
        if self.pulse > 0.0:
            self.pulse = max(0.0, self.pulse - dt)
        self.prev_diff = diff if sf and slipping else None
        self.prev_signed = signed if sf and slipping else None
        self.pk, self.timed = a1, a2
        self.measured = diff
        self.progress = 1.0 if (a1 or a2) else 0.0
        # tensões de linha / barra (figura 4.105)
        dead_line, live_line = vp < self.dead_line, vp > self.live_line
        dead_bus, live_bus = vs < self.dead_bus, vs > self.live_bus
        v.update({
            "59VP": 1.0 if vp_ok else 0.0, "59VS": 1.0 if vs_ok else 0.0, "59VDIF": 1.0 if vdif_ok else 0.0,
            "SF": 1.0 if sf else 0.0, "25A1": 1.0 if a1 else 0.0, "25A2": 1.0 if a2 else 0.0,
            "DLDB": 1.0 if dead_line and dead_bus else 0.0, "DLLB": 1.0 if dead_line and live_bus else 0.0,
            "LLDB": 1.0 if live_line and dead_bus else 0.0,
        })

    def info(self) -> dict:
        d = self._info("Sincronismo (25)", "diferença angular VP–VS (°)", self.ang1,
                       f"25ANG1 {self.ang1:g}°, 25ANG2 {self.ang2:g}°, SF {self.sf_max:g} Hz, TCLOSD "
                       + ("OFF" if self.tclosd is None else f"{self.tclosd:g} ms"))
        d["slip"] = round(self.slip, 4)
        v = self.eng.vals
        d["bits"] = {k: bool(v.get(k, 0.0)) for k in ("59VP", "59VS", "59VDIF", "SF", "25A1", "25A2", "DLDB", "DLLB", "LLDB")}
        return d


# --------------------------------------------------------------------------- 593SRMS
class Rms3s(_Base):
    """Sobretensão da tensão eficaz de 3 s (CEI 0-16): RMS de 0,2 s (atualizado a cada 0,2 s) e RMS de 10 min dessas médias
    (atualizado a cada 3 s) para cada tensão fase-fase; bits 593SRMS1 (AB), 593SRMS2 (BC) e 593SRMS3 (CA). Com SINGLEV = Y só a fase AB."""
    kind = "593SRMS"
    _SRC = ("VAB", "VBC", "VCA")

    def __init__(self, eng: "RelayEngine") -> None:
        super().__init__(eng, "593SRMS")
        self.pickup = _num(eng, "593SRMSP")
        self.pk_bit, self.t_bit = "593SRMS1", "593SRMS1"
        self.single = _txt(eng, "SINGLEV", "N").upper() == "Y"
        self.acc = [0.0, 0.0, 0.0]
        self.t02 = 0.0
        self.n02 = 0
        self.hist: list[deque[float]] = [deque(maxlen=3000) for _ in range(3)]   # 600 s / 0,2 s
        self.rms10 = [0.0, 0.0, 0.0]
        self.t3 = 0.0

    def update(self, dt: float) -> None:
        eng = self.eng
        m = eng.meas
        n = 1 if self.single else 3
        for i in range(n):
            self.acc[i] += (m[self._SRC[i]] ** 2) * dt
        self.t02 += dt
        if self.t02 >= 0.2 - _EPS:
            for i in range(n):
                self.hist[i].append(math.sqrt(self.acc[i] / self.t02))
                self.acc[i] = 0.0
            self.t02 = 0.0
        self.t3 += dt
        if self.t3 >= 3.0 - _EPS:
            self.t3 = 0.0
            for i in range(n):
                h = self.hist[i]
                self.rms10[i] = math.sqrt(sum(x * x for x in h) / len(h)) if h else 0.0
        bits = []
        for i in range(3):
            on = bool(self.pickup is not None and i < n and self.rms10[i] > self.pickup)
            eng.vals[f"593SRMS{i + 1}"] = 1.0 if on else 0.0
            bits.append(on)
        self.pk = self.timed = any(bits)
        self.measured = max(self.rms10)

    def info(self) -> dict:
        return self._info("Sobretensão RMS 3 s (593SRMS)", "VABRMS10 (média de 10 min)", self.pickup or 0.0,
                          f"{self.pickup:g} V sec." if self.pickup is not None else "OFF")


# --------------------------------------------------------------------------- criação
REG_BITS = (
    "3P27", "3P59", "25A1", "25A2", "SF", "59VP", "59VS", "59VDIF", "DLDB", "DLLB", "LLDB",
    "3PWR1P", "3PWR1T", "3PWR2P", "3PWR2T", "593SRMS1", "593SRMS2", "593SRMS3",
)


SYNC_BITS = ("25A1", "25A2", "SF", "59VP", "59VS", "59VDIF", "DLDB", "DLLB", "LLDB")


def build_extra(eng: "RelayEngine") -> list:
    """Cria os elementos adicionais habilitados e registra os bits (mesmo desabilitados) para as equações SELogic."""
    v = eng.vals
    for b in REG_BITS:
        v.setdefault(b, 0.0)
    for n in (1, 2):
        for fam in ("27I", "59I"):
            for s in ("", "T", "RS"):
                v.setdefault(f"{fam}{n}{s}", 0.0)
    for n in (3, 4):
        for s in ("", "T", "RS"):
            v.setdefault(f"59I{n}{s}", 0.0)
    out: list = []
    for fam, nmax in (("27I", 2), ("59I", 4)):
        for n in range(1, nmax + 1):
            if eng.group_has(f"{fam}{n}P") and _txt(eng, f"E{fam}{n}", "N").upper() == "Y":
                out.append(InverseVolt(eng, fam, n))
    out += [e for e in (ThreePhaseVolt(eng, "3P27"), ThreePhaseVolt(eng, "3P59")) if e.pickup is not None]
    if _txt(eng, "E25", "N").upper() == "Y" and _txt(eng, "VSCONN", "VS").upper() == "VS":
        out.append(SyncCheck(eng))
    else:
        # 25 desabilitado (E25 = N, ex.: troca para um grupo sem sincronismo): os bits da função vão a zero,
        # em vez de manter o último valor do grupo anterior
        for b in SYNC_BITS:
            v[b] = 0.0
    for n in (1, 2):
        if eng.group_has(f"3PWR{n}P") and _num(eng, f"3PWR{n}P") is not None and _enabled_pwr(eng, n):
            out.append(PowerElement(eng, n))
    if _txt(eng, "E593SRMS", "N").upper() == "Y" and _num(eng, "593SRMSP") is not None:
        out.append(Rms3s(eng))
    return out
