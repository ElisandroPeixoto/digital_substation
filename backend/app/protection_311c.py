"""Elementos de proteção do SEL-311C (linha de transmissão).

Fontes (material fornecido pelo usuário, SEL-311C-1 Instruction Manual, Date Code 20261020):
- distância de fase mho (memória de V1 e compensador) e de terra (mho e quadrilateral): seção 3, Figuras 3.4–3.12, Tabela 3.1;
- temporizadores de zona (ZnPD/ZnGD/ZnD, em ciclos; ``OFF`` = saída sempre 0): Figura 3.23, p. 3.29;
- sobrecorrente 50/67 de fase (não direcional, só torque), terra e seq. negativa (direcionais: níveis 1–2 à frente,
  3–4 por DIR3/DIR4) e 51P/51G/51Q: Figuras 3.27–3.36;
- direcionais: 32Q (Figura 4.20), 32G com ORDER (Figuras 4.12–4.18), 32P de seq. positiva (Figura 4.21), LOP (Figura 4.1);
- carga (load-encroachment, Figura 4.10), tensão 27/59 (Tabela 3.21) e frequência 81D (Figura 3.49).

Memória de tensão (pedido do usuário: verificar como o 311C a trata):
- o mho de fase é polarizado pela tensão de sequência positiva memorizada V1mem (p. 3.4, Figura 3.1 e Equação 3.1);
- o bit VPOLV supervisiona os mho e quadrilaterais e "asserts when the memorized positive-sequence polarizing voltage is
  greater than 1 Volt" (p. 3.21, "Additional Distance Element Supervision");
- o direcional de fase F32P/R32P (Figura 4.21, p. 4.28) exige VPOLV, !ZLOAD, !ILOP e |IAB|, |IBC|, |ICA| > 0,1·INOM.
O material NÃO informa a constante de tempo da memória nem uma retenção da direção depois que a memória se esgota: numa falta
trifásica franca próxima (V = 0) a direção se mantém só enquanto |V1mem| > 1 V; depois VPOLV cai e os mho de fase, F32P e tudo
o que depende deles (ex.: 51PTC = M1P + M2P) deixam de atuar. A constante ``MEM_TAU_CYC`` abaixo é um valor ADOTADO.
"""
from __future__ import annotations

import cmath
import math
from typing import TYPE_CHECKING

from .fieldsim import A_OP, A_OP2
from .protection import QTY_LABEL, TimeOc

if TYPE_CHECKING:  # pragma: no cover
    from .engine311c import Relay311CEngine

INOM = 5.0                 # corrente nominal secundária (A) do 311C de 5 A
MEM_TAU_CYC = 16.0         # constante de tempo da memória de V1 (ciclos) – ADOTADA: não consta no material fornecido
VPOLV_MIN = 1.0            # V secundários (p. 3.21)
_EPS = 1e-9
_HYST = 0.95
_SQ3 = math.sqrt(3.0)


def _rot(deg: float) -> complex:
    return cmath.rect(1.0, math.radians(deg))


def num(eng, key: str, default: float | None = None) -> float | None:
    """Ajuste numérico do grupo ativo; ``OFF``/``NA``/vazio = ``default``."""
    raw = eng.settings.get(eng.group_cls, key, "").strip().upper()
    if raw in ("", "OFF", "NA", "N"):
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def cyc(eng, key: str, default: float | None = None) -> float | None:
    """Ajuste de tempo em ciclos convertido para segundos (``OFF`` = ``default``)."""
    v = num(eng, key, None)
    return default if v is None else v / eng.nominal_freq


def flag(eng, key: str, default: str = "N") -> str:
    return (eng.settings.get(eng.group_cls, key, default) or default).strip().upper()


def levels(eng, key: str) -> int:
    """Ajustes de habilitação do tipo ``N``/``1``–``4``/``Y`` (Y = 1 nível) e ``1C``–``4C``."""
    raw = flag(eng, key)
    if raw.startswith(("N", "OFF")) or not raw:
        return 0
    if raw[0].isdigit():
        return int(raw[0])
    return 1 if raw.startswith("Y") else 0


def _ang_in(a: float, lo: float, hi: float) -> bool:
    a = (a - lo) % 360.0
    return a <= (hi - lo) % 360.0 + _EPS


class Core311:
    """Grandezas comuns, memória de polarização e lógicas de supervisão (calculadas uma vez por ciclo, antes dos elementos)."""

    def __init__(self, eng: "Relay311CEngine") -> None:
        self.eng = eng
        self.v1mem: complex | None = None
        self.p3o_drop = 0.0
        self.p3o = False
        self.sotf_left = 0.0
        self.I: dict[str, complex] = {p: 0j for p in "ABC"}
        self.V: dict[str, complex] = {p: 0j for p in "ABC"}
        self.i0 = self.i1 = self.i2 = 0j
        self.v0 = self.v1 = self.v2 = 0j
        self.z2 = self.z0 = 0.0
        self.dir_info: dict = {}

    # ------------------------------------------------------------ utilitários
    @property
    def zang(self) -> float:
        return num(self.eng, "Z1ANG", 84.0) or 84.0

    def z0ang(self) -> float:
        return num(self.eng, "Z0ANG", self.zang) or self.zang

    def mem_phase(self, p: str) -> complex:
        """V1mem referida à fase p (A, B, C) – sequência ABC."""
        m = self.v1mem or 0j
        return m * {"A": 1.0, "B": A_OP2, "C": A_OP}[p]

    def mem_pair(self, pp: str) -> complex:
        """V1mem referida ao par de fases (AB, BC, CA): V_pp = V_p - V_q."""
        return self.mem_phase(pp[0]) - self.mem_phase(pp[1])

    def ipp(self, pp: str) -> complex:
        return self.I[pp[0]] - self.I[pp[1]]

    def vpp(self, pp: str) -> complex:
        return self.V[pp[0]] - self.V[pp[1]]

    def i2p(self, p: str) -> complex:
        """I2 referida à fase p (I2A; I2B = a·I2A; I2C = a²·I2A)."""
        return self.i2 * {"A": 1.0, "B": A_OP, "C": A_OP2}[p]

    # ------------------------------------------------------------ ciclo
    def update(self, dt: float) -> None:
        eng, v = self.eng, self.eng.vals
        I, V = eng.sec_I, eng.sec_V
        self.I, self.V = I, V
        ia, ib, ic = I["A"], I["B"], I["C"]
        va, vb, vc = V["A"], V["B"], V["C"]
        self.i0 = (ia + ib + ic) / 3.0
        self.i1 = (ia + A_OP * ib + A_OP2 * ic) / 3.0
        self.i2 = (ia + A_OP2 * ib + A_OP * ic) / 3.0
        self.v0 = (va + vb + vc) / 3.0
        self.v1 = (va + A_OP * vb + A_OP2 * vc) / 3.0
        self.v2 = (va + A_OP2 * vb + A_OP * vc) / 3.0
        # memória de V1: filtro de 1ª ordem que acompanha V1 (valor inicial = V1 do 1º ciclo)
        if self.v1mem is None:
            self.v1mem = self.v1
        else:
            tau = MEM_TAU_CYC / eng.nominal_freq
            self.v1mem += (self.v1 - self.v1mem) * (1.0 - math.exp(-dt / tau))
        v["VPOLV"] = 1.0 if abs(self.v1mem) > VPOLV_MIN else 0.0
        # perda de potencial: chave do usuário (SimConfig.lop); ILOP bloqueia elementos se ELOP = Y/Y1
        lop = bool(eng.field.cfg.lop)
        v["LOP"] = 1.0 if lop else 0.0
        elop = flag(eng, "ELOP", "N")
        v["ILOP"] = 1.0 if (lop and elop.startswith("Y")) else 0.0
        self._open_pole(dt)
        self._sotf(dt)
        self._load()
        self._fids()
        self._dir_q()
        self._dir_g()
        self._dir_p()

    def _open_pole(self, dt: float) -> None:
        eng, v = self.eng, self.eng.vals
        lp = num(eng, "50LP", 0.25) or 0.25
        low_i = all(abs(self.I[p]) < lp for p in "ABC")
        if flag(eng, "OPO", "52").startswith("27"):
            p27 = num(eng, "27PO", 40.0) or 40.0
            cond = low_i and all(abs(self.V[p]) < p27 for p in "ABC")
        else:
            cond = low_i and not v.get("52A", 0.0)
        if cond:
            self.p3o, self.p3o_drop = True, 0.0
        elif self.p3o:
            self.p3o_drop += dt
            if self.p3o_drop >= (cyc(eng, "3POD", 0.0) or 0.0) - _EPS:
                self.p3o = False
        v["3PO"] = 1.0 if self.p3o else 0.0
        for p in "ABC":
            v[f"SPO{p}"] = 0.0          # 311C-1: disparo tripolar (sem polo aberto monofásico)

    def _sotf(self, dt: float) -> None:
        eng, v = self.eng, self.eng.vals
        if flag(eng, "ESOTF") != "Y":
            v["SOTFE"] = 0.0
            return
        if self.p3o:
            self.sotf_left = cyc(eng, "SOTFD", 0.5) or 0.5
            v["SOTFE"] = 1.0
        else:
            self.sotf_left = max(0.0, self.sotf_left - dt)
            v["SOTFE"] = 1.0 if self.sotf_left > _EPS else 0.0

    def _load(self) -> None:
        eng, v = self.eng, self.eng.vals
        out = inn = False
        if flag(eng, "ELOAD") == "Y" and abs(self.i1) > 0.1 * INOM:
            z = self.v1 / self.i1
            mag, ang = abs(z), math.degrees(cmath.phase(z))
            zlf, zlr = num(eng, "ZLF", 1e9) or 1e9, num(eng, "ZLR", 1e9) or 1e9
            out = mag > zlf and _ang_in(ang, num(eng, "NLAF", -30.0) or -30.0, num(eng, "PLAF", 30.0) or 30.0)
            inn = mag > zlr and _ang_in(ang, num(eng, "PLAR", 150.0) or 150.0, num(eng, "NLAR", 210.0) or 210.0)
        v["ZLOUT"], v["ZLIN"] = float(out), float(inn)
        v["ZLOAD"] = float(out or inn)

    def _fids(self) -> None:
        """Seleção de fase em faltas à terra (FIDS): ângulo entre I2A e I0 (p. 3.22). Só com corrente de terra significativa."""
        v = self.eng.vals
        fs = {"A": False, "B": False, "C": False}
        if abs(3 * self.i0) >= 0.1 * INOM and abs(self.i0) >= 0.1 * abs(self.i1) and abs(self.i2) > 1e-6 \
                and self.eng.settings.get("G", "PTCONN", "WYE").upper() != "DELTA":
            a = math.degrees(cmath.phase(self.i2 / self.i0))
            if -60.0 <= a <= 60.0:
                fs["A"] = True
            elif -180.0 <= a < -60.0:
                fs["B"] = True
            else:
                fs["C"] = True
        for p in "ABC":
            v[f"FS{p}"] = 1.0 if fs[p] else 0.0

    def _dir_q(self) -> None:
        """32Q: elemento direcional de sequência negativa polarizado por tensão (Figura 4.20)."""
        eng, v = self.eng, self.eng.vals
        e32 = flag(eng, "E32", "N")
        i2, v2, i1, i0 = self.i2, self.v2, self.i1, self.i0
        a2 = num(eng, "a2", 0.1) or 0.1
        k2 = num(eng, "k2", 0.2) or 0.2
        en = e32 in ("Y", "AUTO") and abs(i2) > 1e-6
        f50 = abs(3 * i2) > (num(eng, "50QFP", 0.5) or 0.5)
        r50 = abs(3 * i2) > (num(eng, "50QRP", 0.25) or 0.25)
        v["50QF"], v["50QR"] = float(f50), float(r50)
        qe = en and abs(i2) > a2 * abs(i1)
        qge = qe and abs(i2) > k2 * abs(i0)
        v["32QE"], v["32QGE"] = float(qe), float(qge)
        fwd = rev = False
        z2 = 0.0
        if en:
            z2 = (v2 * (i2 * _rot(self.zang)).conjugate()).real / (abs(i2) ** 2)
            ratio = abs(v2) / abs(i2)
            z2f, z2r = num(eng, "Z2F", 0.0) or 0.0, num(eng, "Z2R", 0.0) or 0.0
            ft = (1.25 * z2f if z2f > 0 else 0.75 * z2f) - 0.25 * ratio
            rt = (0.75 * z2r if z2r >= 0 else 1.25 * z2r) + 0.25 * ratio
            fwd, rev = z2 < ft, z2 > rt
        self.z2 = z2
        ilop = bool(v.get("ILOP"))
        f32q = bool(qe and f50 and fwd and not ilop)
        r32q = bool(qe and r50 and rev and not ilop)
        v["F32Q"], v["R32Q"] = float(f32q), float(r32q)
        # LOP com ELOP = Y: o ponto "à frente" vai a 1 (elementos à frente viram não direcionais, p. 4.26)
        lop_fwd = bool(v.get("LOP")) and flag(eng, "ELOP", "N") == "Y"
        v["32QF"] = float(f32q or lop_fwd)
        v["32QR"] = float(r32q)
        self.q_ok = (qge, f32q and qge, r32q and qge)

    def _dir_g(self) -> None:
        """32G: direcional de terra pela ordem ORDER (Q = seq. negativa, V = seq. zero por tensão; I = canal IN, não simulado)."""
        eng, v = self.eng, self.eng.vals
        e32 = flag(eng, "E32", "N")
        order = flag(eng, "ORDER", "QV")
        i0, v0, i1 = self.i0, self.v0, self.i1
        gf = abs(3 * i0) > (num(eng, "50GFP", 0.5) or 0.5)
        gr = abs(3 * i0) > (num(eng, "50GRP", 0.25) or 0.25)
        v["50GF"], v["50GR"] = float(gf), float(gr)
        a0 = num(eng, "a0", 0.1) or 0.1
        ilop = bool(v.get("ILOP"))
        e32iv = bool(eng.ev(eng.logic_cls, "E32IV")) if eng.group_has("E32IV") else True
        ve = e32 in ("Y", "AUTO") and abs(i0) > a0 * abs(i1) and abs(i0) > 1e-6 and e32iv and not ilop and gf
        v["32VE"], v["32IE"] = float(ve), 0.0
        z0 = 0.0
        vfwd = vrev = False
        if ve:
            z0 = ((3 * v0) * ((3 * i0) * _rot(self.z0ang())).conjugate()).real / (abs(3 * i0) ** 2)
            ratio = abs(v0) / abs(i0)
            z0f, z0r = num(eng, "Z0F", 0.0) or 0.0, num(eng, "Z0R", 0.0) or 0.0
            ft = (1.25 * z0f if z0f > 0 else 0.75 * z0f) - 0.25 * ratio
            rt = (0.75 * z0r if z0r >= 0 else 1.25 * z0r) + 0.25 * ratio
            vfwd, vrev = z0 < ft and gf, z0 > rt and gr
        self.z0 = z0
        qge, qf, qr = self.q_ok
        fwd = rev = False
        used = ""
        for ch in order:
            if ch == "Q" and qge:
                fwd, rev, used = qf, qr, "Q"
                break
            if ch == "V" and ve:
                fwd, rev, used = vfwd, vrev, "V"
                break
        v["F32QG"], v["R32QG"] = float(used == "Q" and fwd), float(used == "Q" and rev)
        v["F32V"], v["R32V"] = float(used == "V" and fwd), float(used == "V" and rev)
        v["F32I"] = v["R32I"] = 0.0
        lop_fwd = bool(v.get("LOP")) and flag(eng, "ELOP", "N") == "Y"
        v["32GF"] = float(fwd or lop_fwd)
        v["32GR"] = float(rev)
        self.dir_info = {"order": order, "used": used, "z2": round(self.z2, 3), "z0": round(z0, 3)}

    def _dir_p(self) -> None:
        """32P: direcional de sequência positiva por memória para faltas trifásicas (Figura 4.21)."""
        v = self.eng.vals
        ok = bool(v["VPOLV"]) and not v.get("ZLOAD") and not v.get("ILOP") \
            and all(abs(self.ipp(pp)) > 0.1 * INOM for pp in ("AB", "BC", "CA"))
        f = r = False
        if ok:
            t = [(_rot(self.zang) * self.ipp(pp) * self.mem_pair(pp).conjugate()).real for pp in ("AB", "BC", "CA")]
            f, r = all(x > 0 for x in t), all(x < 0 for x in t)
        v["F32P"], v["R32P"] = float(f), float(r)


# ======================================================================== distância
class _Zone:
    """Base dos elementos de distância de uma zona n."""

    kind = "21"

    def __init__(self, eng, core: Core311, n: int) -> None:
        self.eng, self.core, self.n = eng, core, n
        d = flag(eng, f"DIR{n}", "F") if n >= 3 else "F"
        self.forward = not d.startswith("R")
        self.measured: dict[str, float] = {}
        self.pk = False

    def dir_bit(self, phase: bool) -> bool:
        v = self.eng.vals
        if phase:
            return bool(v["32QF"] or v["F32P"]) if self.forward else bool(v["32QR"] or v["R32P"])
        return bool(v["32GF"]) if self.forward else bool(v["32GR"])

    def sign(self) -> float:
        return 1.0 if self.forward else -1.0


class PhaseMho(_Zone):
    """Mho de fase polarizado por memória de V1, pares AB/BC/CA (Figuras 3.4–3.6, Tabela 3.1)."""

    def __init__(self, eng, core, n: int, reach: float, i50: float) -> None:
        super().__init__(eng, core, n)
        self.reach, self.i50 = reach, i50

    def update(self, dt: float) -> None:
        eng, c, v = self.eng, self.core, self.eng.vals
        ok = bool(v["VPOLV"]) and not v["ILOP"] and self.dir_bit(True)
        block = {"AB": v["FSA"] or v["FSB"], "BC": v["FSB"] or v["FSC"], "CA": v["FSC"] or v["FSA"]}
        any_on = False
        for pp in ("AB", "BC", "CA"):
            mem = c.mem_pair(pp)
            den = (_rot(c.zang) * c.ipp(pp) * self.sign() * mem.conjugate()).real
            m = (c.vpp(pp) * mem.conjugate()).real / den if den > _EPS else float("inf")
            self.measured[pp] = m
            on = ok and not block[pp] and abs(c.ipp(pp)) > self.i50 and m < self.reach
            v[f"M{pp}{self.n}"] = float(on)
            any_on = any_on or on
        self.pk = any_on
        v[f"M{self.n}P"] = float(any_on)

    def info(self) -> dict:
        m = min(self.measured.values(), default=float("inf"))
        return {"name": f"M{self.n}P", "kind": f"Distância de fase mho Z{self.n} ({'à frente' if self.forward else 'reversa'})",
                "quantity": "impedância fase-fase (memória V1)", "pickup": self.reach,
                "setting": f"Z{self.n}P = {self.reach:g} Ω sec., 50PP{self.n} = {self.i50:g} A",
                "measured": 0.0 if m == float("inf") else round(m, 3), "multiple": round(m / self.reach, 3) if m != float("inf") and self.reach else 0.0,
                "pickup_bit": f"M{self.n}P", "timed_bit": f"M{self.n}PT", "pk": self.pk, "timed": bool(self.eng.vals.get(f"M{self.n}PT")),
                "tc": "", "dir_bit": "32QF/F32P" if self.forward else "32QR/R32P", "dir_ok": self.dir_bit(True), "progress": 100.0 if self.pk else 0.0}


class PhaseComp(_Zone):
    """Compensador de distância: fase-fase (MPPn) e trifásico (MABCn) – Tabela 3.1, Figuras 3.2 e 3.3."""

    def __init__(self, eng, core, n: int, reach: float, i50: float) -> None:
        super().__init__(eng, core, n)
        self.reach, self.i50 = reach, i50

    def update(self, dt: float) -> None:
        eng, c, v = self.eng, self.core, self.eng.vals
        z = cmath.rect(self.reach, math.radians(c.zang)) * self.sign()
        ilop = bool(v["ILOP"])
        nxt = {"AB": "BC", "BC": "CA", "CA": "AB"}
        pp_on = False
        for pp in ("AB", "BC", "CA"):
            a = c.vpp(pp) - z * c.ipp(pp)
            b = c.vpp(nxt[pp]) - z * c.ipp(nxt[pp])
            torque = (a * b.conjugate()).imag
            pp_on = pp_on or (torque < 0 and abs(c.ipp(pp)) > self.i50)
        pp_on = pp_on and not ilop and (bool(v["32QF"]) if self.forward else bool(v["32QR"]))
        vcm = c.mem_phase("C")
        pol = -1j * c.vpp("AB") - 0.25 * vcm
        t3 = ((c.vpp("AB") - z * c.ipp("AB")) * pol.conjugate()).imag
        abc_on = (t3 < 0 and all(abs(c.ipp(x)) > self.i50 for x in ("AB", "BC", "CA")) and bool(v["VPOLV"]) and not ilop
                  and (bool(v["F32P"]) if self.forward else bool(v["R32P"])))
        v[f"MPP{self.n}"], v[f"MABC{self.n}"] = float(pp_on), float(abc_on)
        self.pk = pp_on or abc_on
        v[f"M{self.n}P"] = float(self.pk)

    def info(self) -> dict:
        return {"name": f"M{self.n}P", "kind": f"Distância de fase compensador Z{self.n}", "quantity": "torque do compensador",
                "pickup": self.reach, "setting": f"Z{self.n}P = {self.reach:g} Ω sec., 50PP{self.n} = {self.i50:g} A",
                "measured": 0.0, "multiple": 0.0, "pickup_bit": f"M{self.n}P", "timed_bit": f"M{self.n}PT", "pk": self.pk,
                "timed": bool(self.eng.vals.get(f"M{self.n}PT")), "tc": "", "dir_bit": "32QF" if self.forward else "32QR",
                "dir_ok": True, "progress": 100.0 if self.pk else 0.0}


class GroundZone(_Zone):
    """Distância de terra mho (MxGn, Figuras 3.7–3.9) e quadrilateral (XxGn, Figuras 3.10–3.12); ZnG = OU dos dois."""

    def __init__(self, eng, core, n: int, mho: float | None, xg: float | None, rg: float | None, il: float, ig: float) -> None:
        super().__init__(eng, core, n)
        self.mho, self.xg, self.rg, self.il, self.ig = mho, xg, rg, il, ig
        k0m = num(eng, "k0M1" if n == 1 else "k0M", None)
        k0a = num(eng, "k0A1" if n == 1 else "k0A", 0.0) or 0.0
        if k0m is None:                                  # k0M ausente: igual ao da zona 1 (EADVS = N)
            k0m, k0a = num(eng, "k0M1", 0.0) or 0.0, num(eng, "k0A1", 0.0) or 0.0
        self.k0 = cmath.rect(k0m, math.radians(k0a))
        self.xgpol = flag(eng, "XGPOL", "I2")
        self.tang = num(eng, "TANG", -3.0) or 0.0
        self.mx: dict[str, float] = {}

    def update(self, dt: float) -> None:
        eng, c, v = self.eng, self.core, self.eng.vals
        ig = c.I["A"] + c.I["B"] + c.I["C"]
        base = bool(v["VPOLV"]) and not v["ILOP"] and self.dir_bit(False) and abs(ig) > self.ig
        if self.n == 1:
            base = base and not v["3PO"]
        fs_any = v["FSA"] or v["FSB"] or v["FSC"]
        zl = _rot(c.zang)
        any_on = False
        for p in "ABC":
            ires = c.I[p] + self.k0 * ig
            sel = (not fs_any) or bool(v[f"FS{p}"])
            ok = base and sel and abs(c.I[p]) > self.il
            mho_on = quad_on = False
            if self.mho is not None:
                mem = c.mem_phase(p)
                den = (zl * ires * self.sign() * mem.conjugate()).real
                m = (c.V[p] * mem.conjugate()).real / den if den > _EPS else float("inf")
                self.mx[f"M{p}"] = m
                mho_on = ok and m < self.mho
            if self.xg is not None and self.rg is not None:
                pol = (c.i2p(p) if self.xgpol != "IG" else ig) * _rot(self.tang)
                den = (zl * ires * self.sign() * pol.conjugate()).imag
                x = (c.V[p] * pol.conjugate()).imag / den if abs(den) > _EPS else float("inf")
                zi = zl * ires * self.sign()
                rden = (1.5 * (c.i2p(p) + c.i0) * zi.conjugate()).imag
                r = (c.V[p] * zi.conjugate()).imag / rden if abs(rden) > _EPS else float("inf")
                self.mx[f"X{p}"], self.mx[f"R{p}"] = x, r
                quad_on = ok and den > _EPS and x < self.xg and abs(r) <= self.rg
            v[f"M{p}G{self.n}"] = float(mho_on)
            v[f"X{p}G{self.n}"] = float(quad_on)
            any_on = any_on or mho_on or quad_on
        self.pk = any_on
        v[f"Z{self.n}G"] = float(any_on)

    def info(self) -> dict:
        parts = []
        if self.mho is not None:
            parts.append(f"Z{self.n}MG = {self.mho:g} Ω")
        if self.xg is not None:
            parts.append(f"XG{self.n} = {self.xg:g} Ω, RG{self.n} = {self.rg:g} Ω")
        meas = [x for k, x in self.mx.items() if k[0] in "MX" and x != float("inf")]
        m = min(meas) if meas else None
        ref = self.mho if self.mho is not None else self.xg
        return {"name": f"Z{self.n}G", "kind": f"Distância de terra Z{self.n} ({'à frente' if self.forward else 'reversa'})",
                "quantity": "impedância fase-terra (k0)", "pickup": ref or 0.0,
                "setting": ", ".join(parts) + f"; 50L{self.n} = {self.il:g} A, 50GZ{self.n} = {self.ig:g} A",
                "measured": 0.0 if m is None else round(m, 3), "multiple": round(m / ref, 3) if m is not None and ref else 0.0,
                "pickup_bit": f"Z{self.n}G", "timed_bit": f"Z{self.n}GT", "pk": self.pk, "timed": bool(self.eng.vals.get(f"Z{self.n}GT")),
                "tc": "", "dir_bit": "32GF" if self.forward else "32GR", "dir_ok": self.dir_bit(False), "progress": 100.0 if self.pk else 0.0}


class ZoneTimers:
    """Temporizadores de zona (Figura 3.23): MnPT (ZnPD), ZnGT (ZnGD) e comum ZnT (ZnD). ``OFF`` = saída sempre 0.
    O comum suspende a contagem por 1 ciclo quando a entrada cai durante a temporização."""

    kind = "timer"

    def __init__(self, eng) -> None:
        self.eng = eng
        self.el: dict[str, float] = {}
        self.susp: dict[str, float] = {}
        self.delays = {}
        for n in range(1, 5):
            self.delays[f"M{n}PT"] = (f"M{n}P", cyc(eng, f"Z{n}PD"))
            self.delays[f"Z{n}GT"] = (f"Z{n}G", cyc(eng, f"Z{n}GD"))
            self.delays[f"Z{n}T"] = (None, cyc(eng, f"Z{n}D"))

    def update(self, dt: float) -> None:
        v = self.eng.vals
        cyc1 = 1.0 / self.eng.nominal_freq
        for out, (src, d) in self.delays.items():
            n = out[1]
            inp = bool(v.get(src, 0.0)) if src else bool(v.get(f"M{n}P") or v.get(f"Z{n}G"))
            if d is None:
                v[out] = 0.0
                self.el[out] = 0.0
                continue
            if inp:
                self.el[out] = self.el.get(out, 0.0) + dt
                self.susp[out] = 0.0
            elif src is None and 0.0 < self.el.get(out, 0.0) < d and self.susp.get(out, 0.0) < cyc1 - _EPS:
                self.susp[out] = self.susp.get(out, 0.0) + dt        # suspensão de 1 ciclo (só temporizadores comuns)
            else:
                self.el[out] = 0.0
            v[out] = 1.0 if inp and self.el[out] >= d - _EPS else 0.0
        for b in ("M2PSEQT", "Z2GSEQT", "Z2SEQT"):
            v[b] = 0.0                                                 # sequenciais: só com 4 zonas (não simulados)

    def info(self) -> dict:
        v = self.eng.vals
        on = [k for k in self.delays if v.get(k)]
        return {"name": "Zn T", "kind": "Temporizadores de zona", "quantity": "MnP / ZnG",
                "pickup": 0.0, "setting": ", ".join(f"{k}: {'OFF' if d is None else f'{d * self.eng.nominal_freq:g} c'}"
                                                       for k, (_, d) in self.delays.items() if d is not None) or "todos OFF",
                "measured": 0.0, "multiple": 0.0, "pickup_bit": "", "timed_bit": ",".join(on), "pk": bool(on), "timed": bool(on),
                "tc": "", "dir_bit": "", "dir_ok": True, "progress": 0.0}


# ======================================================================== sobrecorrente
class Level50:
    """Níveis 50/67 de fase (P), terra residual (G) e seq. negativa (Q): pickup → 50xn; torque 67xnTC → 67xn; atraso 67xnD → 67xnT.
    Fase: não direcional (p. 3.38). Terra e Q: níveis 1–2 à frente, 3–4 por DIR3/DIR4 (Figuras 3.32 e 3.33)."""

    kind = "50"

    def __init__(self, eng, kind: str, n: int, pickup: float, delay: float) -> None:
        self.eng, self.k, self.n, self.pickup, self.delay = eng, kind, n, pickup, delay
        self.qty = {"P": "IMAX", "G": "IG", "Q": "I2"}[kind]
        self.tc_key = f"67{kind}{n}TC"
        d = flag(eng, f"DIR{n}", "F") if n >= 3 else "F"
        self.dir_key = "" if kind == "P" else (("32QF" if kind == "Q" else "32GF") if not d.startswith("R") else ("32QR" if kind == "Q" else "32GR"))
        self.el = 0.0
        self.pk = self.tq = self.timed = False
        self.measured = 0.0

    def update(self, dt: float) -> None:
        eng, v = self.eng, self.eng.vals
        m = eng.meas[self.qty]
        self.measured = m
        thr = self.pickup
        self.pk = m > thr or (self.pk and m >= _HYST * thr)
        if self.k == "P":
            for p in "ABC":
                mp = eng.meas["I" + p]
                v[f"50{p}{self.n}"] = 1.0 if mp > thr or (v.get(f"50{p}{self.n}") and mp >= _HYST * thr) else 0.0
        v[f"50{self.k}{self.n}"] = float(self.pk)
        tc = bool(eng.ev(eng.logic_cls, self.tc_key)) if eng.group_has(self.tc_key) else True
        dir_ok = bool(v.get(self.dir_key, 0.0)) if self.dir_key else True
        self.tq = self.pk and tc and dir_ok
        if self.tq:
            self.el += dt
        else:
            self.el = 0.0
        self.timed = self.tq and self.el >= self.delay - _EPS
        v[f"67{self.k}{self.n}"] = float(self.tq)
        v[f"67{self.k}{self.n}T"] = float(self.timed)

    def info(self) -> dict:
        return {"name": f"67{self.k}{self.n}", "kind": f"Instantâneo/tempo definido ({'67' if self.dir_key else '50'})",
                "quantity": QTY_LABEL[self.qty], "pickup": self.pickup,
                "setting": f"50{self.k}{self.n}P = {self.pickup:g} A sec., 67{self.k}{self.n}D = {self.delay * self.eng.nominal_freq:g} c",
                "multiple": round(self.measured / self.pickup, 3) if self.pickup else 0.0,
                "tc": self.eng.expr_text(self.eng.logic_cls, self.tc_key), "measured": round(self.measured, 3),
                "pickup_bit": f"50{self.k}{self.n}", "timed_bit": f"67{self.k}{self.n}T", "pk": self.pk, "timed": self.timed,
                "dir_bit": self.dir_key, "dir_ok": bool(self.eng.vals.get(self.dir_key, 0.0)) if self.dir_key else True,
                "progress": min(100.0, 100.0 * self.el / self.delay) if self.delay > 0 and self.tq else (100.0 if self.timed else 0.0)}


class Time51(TimeOc):
    """51P/51G/51Q do 311C: bits 51x, 51xT e 51xR (Tabela 3.17); torque 51xTC (lógica), reset 51xRS (Y = eletromecânico)."""

    def __init__(self, eng, kind: str, pickup: float, curve: str, td: float, reset_em: bool) -> None:
        qty = {"P": "IMAX", "G": "IG", "Q": "I2"}[kind]
        super().__init__(eng, f"51{kind}", qty, pickup, curve, td, reset_em, 0.0, 0.0, f"51{kind}TC")
        self.pk_bit, self.t_bit, self.r_bit = f"51{kind}", f"51{kind}T", f"51{kind}R"

    def tc_only(self) -> bool:
        e = self.eng
        return bool(e.ev(e.logic_cls, self.tc_key)) if e.group_has(self.tc_key) else True

    def info(self) -> dict:
        d = super().info()
        d["tc"] = self.eng.expr_text(self.eng.logic_cls, self.tc_key)
        return d


# ======================================================================== tensão e frequência
class Voltage311:
    """27/59 de fase, fase-fase, seq. (59N1/59N2/59Q/59V1) e canal VS (Tabela 3.21); só com EVOLT = Y."""

    kind = "27/59"

    def __init__(self, eng, core: Core311) -> None:
        self.eng, self.core = eng, core
        self.on = flag(eng, "EVOLT") == "Y"
        self.p = {k: num(eng, k) for k in ("27P", "59P", "27PP", "59PP", "59N1P", "59N2P", "59QP", "59V1P", "27SP", "59SP")}

    def update(self, dt: float) -> None:
        v, c, p = self.eng.vals, self.core, self.p
        on = self.on

        def cmp(name: str, x: float, pick: float | None, under: bool) -> bool:
            r = bool(on and pick is not None and ((x < pick) if under else (x > pick)))
            v[name] = float(r)
            return r

        u = [cmp(f"27{ph}", abs(c.V[ph]), p["27P"], True) for ph in "ABC"]
        o = [cmp(f"59{ph}", abs(c.V[ph]), p["59P"], False) for ph in "ABC"]
        v["3P27"], v["3P59"] = float(all(u)), float(all(o))
        for pp in ("AB", "BC", "CA"):
            cmp(f"27{pp}", abs(c.vpp(pp)), p["27PP"], True)
            cmp(f"59{pp}", abs(c.vpp(pp)), p["59PP"], False)
        cmp("59N1", abs(3 * c.v0), p["59N1P"], False)
        cmp("59N2", abs(3 * c.v0), p["59N2P"], False)
        cmp("59Q", abs(c.v2), p["59QP"], False)
        cmp("59V1", abs(c.v1), p["59V1P"], False)
        vs = self.eng.meas.get("VS", 0.0)
        cmp("27S", vs, p["27SP"], True)
        cmp("59S", vs, p["59SP"], False)

    def info(self) -> dict:
        v = self.eng.vals
        act = [k for k in ("27A", "27B", "27C", "59A", "59B", "59C", "59N1", "59Q", "59V1") if v.get(k)]
        return {"name": "27/59", "kind": "Tensão", "quantity": "VA/VB/VC, 3V0, V2, V1", "pickup": 0.0,
                "setting": ", ".join(f"{k} = {x:g} V" for k, x in self.p.items() if x is not None) or "todos OFF",
                "measured": round(self.eng.meas.get("V1", 0.0), 3), "multiple": 0.0, "pickup_bit": ",".join(act), "timed_bit": "",
                "pk": bool(act), "timed": False, "tc": "", "dir_bit": "", "dir_ok": True, "progress": 0.0}


class Freq311:
    """81D1–81D6 com bloqueio por subtensão 27B81 (Figuras 3.48 e 3.49); só com E81 = 1–6."""

    kind = "81"

    def __init__(self, eng, core: Core311) -> None:
        self.eng, self.core = eng, core
        nf = eng.nominal_freq
        self.n = levels(eng, "E81")
        self.lv = [(i, num(eng, f"81D{i}P"), cyc(eng, f"81D{i}D", 0.0) or 0.0) for i in range(1, 7)]
        self.nf = nf
        self.el = [0.0] * 7

    def update(self, dt: float) -> None:
        v = self.eng.vals
        f = self.eng.meas["FREQ"]
        blk = abs(self.core.v1) < (num(self.eng, "27B81P", 20.0) or 20.0)
        v["27B81"] = float(blk)
        for i, pick, d in self.lv:
            on = bool(i <= self.n and pick is not None and not blk and ((f < pick) if pick < self.nf else (f > pick)))
            self.el[i] = self.el[i] + dt if on else 0.0
            v[f"81D{i}"] = float(on)
            v[f"81D{i}T"] = float(on and self.el[i] >= d - _EPS)

    def info(self) -> dict:
        return {"name": "81D", "kind": "Frequência", "quantity": "frequência", "pickup": 0.0,
                "setting": ", ".join(f"81D{i}P = {p:g} Hz" for i, p, _ in self.lv if p is not None and i <= self.n) or "OFF",
                "measured": round(self.eng.meas["FREQ"], 3), "multiple": 0.0, "pickup_bit": "", "timed_bit": "",
                "pk": False, "timed": False, "tc": "", "dir_bit": "", "dir_ok": True, "progress": 0.0}


# ======================================================================== construção
def build_elements(eng: "Relay311CEngine", core: Core311) -> tuple[list, int]:
    """Elementos do grupo ativo. Retorna (elementos, nº de níveis desabilitados por OFF)."""
    els: list = []
    off = 0
    e21p = flag(eng, "E21P", "N")
    comp = e21p.endswith("C")
    np_ = int(e21p[0]) if e21p[:1].isdigit() else 0
    for n in range(1, np_ + 1):
        reach = num(eng, f"Z{n}P")
        if reach is None:
            off += 1
            continue
        i50 = num(eng, f"50PP{n}", 0.5) or 0.5
        els.append((PhaseComp if comp else PhaseMho)(eng, core, n, reach, i50))
    nmg, nxg = levels(eng, "E21MG"), levels(eng, "E21XG")
    for n in range(1, max(nmg, nxg) + 1):
        mho = num(eng, f"Z{n}MG") if n <= nmg else None
        xg = num(eng, f"XG{n}") if n <= nxg else None
        rg = num(eng, f"RG{n}") if n <= nxg else None
        if mho is None and (xg is None or rg is None):
            off += 1
            continue
        els.append(GroundZone(eng, core, n, mho, xg if rg is not None else None, rg if xg is not None else None,
                              num(eng, f"50L{n}", 0.5) or 0.5, num(eng, f"50GZ{n}", 0.5) or 0.5))
    if np_ or nmg or nxg:
        els.append(ZoneTimers(eng))
    for k in ("P", "G", "Q"):
        for n in range(1, levels(eng, f"E50{k}") + 1):
            pk = num(eng, f"50{k}{n}P")
            if pk is None:
                off += 1
                continue
            els.append(Level50(eng, k, n, pk, cyc(eng, f"67{k}{n}D", 0.0) or 0.0))
        if flag(eng, f"E51{k}") == "Y":
            pk = num(eng, f"51{k}P")
            if pk is None:
                off += 1
            else:
                els.append(Time51(eng, k, pk, flag(eng, f"51{k}C", "U3"), num(eng, f"51{k}TD", 1.0) or 1.0,
                                  flag(eng, f"51{k}RS") == "Y"))
    els.append(Voltage311(eng, core))
    if flag(eng, "E81") not in ("N", ""):
        els.append(Freq311(eng, core))
    return els, off


def protection_bits() -> list[str]:
    """Bits de proteção do Relay Word do 311C (criados com 0; os elementos desabilitados permanecem em 0)."""
    b = ["VPOLV", "LOP", "ILOP", "3PO", "SPOA", "SPOB", "SPOC", "SOTFE", "ZLOAD", "ZLIN", "ZLOUT", "FSA", "FSB", "FSC",
         "32QF", "32QR", "F32Q", "R32Q", "32QE", "32QGE", "32VE", "32IE", "32GF", "32GR", "F32P", "R32P", "F32QG", "R32QG",
         "F32V", "R32V", "F32I", "R32I", "50QF", "50QR", "50GF", "50GR", "CVTBL", "67QUBF", "M2PSEQT", "Z2GSEQT", "Z2SEQT",
         "3P27", "3P59", "59N1", "59N2", "59Q", "59V1", "27S", "59S", "27B81", "51P", "51PT", "51PR", "51G", "51GT", "51GR",
         "51Q", "51QT", "51QR", "50A", "50B", "50C"]
    for n in range(1, 5):
        b += [f"M{pp}{n}" for pp in ("AB", "BC", "CA")] + [f"MPP{n}", f"MABC{n}", f"M{n}P", f"M{n}PT", f"Z{n}G", f"Z{n}GT", f"Z{n}T"]
        b += [f"{t}{p}G{n}" for t in "MX" for p in "ABC"] + [f"OSB{n}", f"50L{n}", f"50GZ{n}"]
        b += [f"50{p}{n}" for p in "ABC"] + [f"{x}{k}{n}{s}" for x in ("50", "67") for k in "PGQ" for s in ("", "T") if not (x == "50" and s)]
    b += [f"27{p}" for p in ("A", "B", "C", "AB", "BC", "CA")] + [f"59{p}" for p in ("A", "B", "C", "AB", "BC", "CA")]
    b += [f"81D{i}{s}" for i in range(1, 7) for s in ("", "T")]
    return b
