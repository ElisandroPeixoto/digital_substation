"""Elementos direcionais do SEL-751 (controle direcional de sobrecorrente), seção "Directional Control" do manual.

Implementa, a partir das grandezas secundárias do ciclo atual:

* **Q** – elemento polarizado por tensão de sequência negativa (figuras 4.29, 4.32 e 4.57): controla os elementos de
  neutro, residual, sequência negativa e (com prioridade) de fase;
* **V** – polarizado por tensão de sequência zero (figuras 4.30 e 4.33), com ``3V0`` calculado das tensões de fase;
* **S** – sequência zero para sistemas aterrados com baixa impedância (4.31/4.35), usando o canal IN;
* **U** – sequência zero para sistemas isolados/alta impedância (4.37), com ângulo fixo de −90°;
* **P** – wattmétrico para bobina de Petersen (4.36), sem o elemento de condutância incremental;
* elemento **PHI** de sequência zero (4.43 a 4.49) e detecção de falta estável (``DIRSTAB``, figura 4.50);
* elemento de fase polarizado por tensão de sequência positiva com memória (4.58) e *load-encroachment* (``ELOAD``);
* roteamento (4.39/4.40/4.59), lógica de sentido por nível (4.41/4.42/4.60/4.61) e ``EDIR = Y/AUTO/AUTO2/N``.

Não implementados (ver ``docs/logica-simulada.md``): canal IN polarizado por corrente (``I``; a simulação não tem um
TC de polarização independente), condutância incremental, falta intermitente direcional (IGF, depende das amostras
brutas) e as figuras 4.74 e 4.110 (região de carga e perda de potencial), que não constam do material usado — a
perda de potencial (``LOP``) é acionada pelo usuário e a região de carga segue a convenção padrão da SEL.
"""
from __future__ import annotations

import cmath
import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from .engine import RelayEngine

_HYST = 0.95
_A1 = cmath.rect(1.0, math.radians(120.0))
_A2 = _A1 * _A1

# valores de fábrica (tabela 4.28) para TC de 5 A; correntes ÷ 5 e impedâncias × 5 para 1 A
_DEF_I = {"50QFP": 0.50, "50QRP": 0.25, "50GFP": 0.50, "50GRP": 0.25, "50PDIRP": 3.00}
_DEF_Z = {"Z2F": -0.06, "Z2R": 0.06, "Z0F": 3.2, "Z0R": 3.4}
_DEF_N = {"a2": 0.10, "k2": 0.20, "a0": 0.10, "a0N": 0.001, "Z0MTA": 72.47, "INMTA": 0.0,
          "50NFP": 0.010, "50NRP": 0.005, "59RES": 22.0, "DIRWFP": 0.5, "DIRWRP": 0.5, "DIRWD": 0.5}

LEVEL_KINDS = ("P", "N", "G", "Q")

BITS = (
    ["LOP", "DIRQE", "DIRQGE", "DIRVE", "DIRIE", "DIRNE", "50QF", "50QR", "50GF", "50GR", "50NF", "50NR",
     "FDIRQ", "RDIRQ", "FDIRP", "RDIRP", "FDIRQG", "RDIRQG", "FDIRV", "RDIRV", "FDIRI", "RDIRI",
     "FDIRN", "RDIRN", "LZFWD", "LZREV", "UGFWD", "UGREV", "FDIRW", "RDIRW", "FDIRWI", "RDIRWI", "FDIRC", "RDIRC",
     "DIRQF", "DIRQR", "DIRPF", "DIRPR", "DIRGF", "DIRGR", "DIRNF", "DIRNR", "50PDIR", "ZLOAD", "ZLOUT", "ZLIN", "VPOLV",
     "GNDSW", "DIRSTAB", "EPHI1", "EPHI2", "PHIFWD1", "PHIFWD2", "PHIREV1", "PHIREV2"]
    + [f"{k}{n}DIR" for k in LEVEL_KINDS for n in range(1, 5)]
)


def _deg(x: complex) -> float:
    return math.degrees(cmath.phase(x)) if abs(x) > 1e-12 else 0.0


def _norm180(a: float) -> float:
    a = (a + 180.0) % 360.0 - 180.0
    return 180.0 if a == -180.0 else a


def _proj(v: complex, i: complex, ang_deg: float) -> float:
    """Re[V·(I∠ang)*] / |I|²  (impedância projetada, em Ω)."""
    d = abs(i) ** 2
    if d < 1e-18:
        return 0.0
    rot = i * cmath.rect(1.0, math.radians(ang_deg))
    return (v * rot.conjugate()).real / d


def _fwd_thr(zf: float, zmag: float) -> float:
    return 0.75 * zf - 0.25 * zmag if zf <= 0 else 1.25 * zf - 0.25 * zmag


def _rev_thr(zr: float, zmag: float) -> float:
    return 0.75 * zr + 0.25 * zmag if zr >= 0 else 1.25 * zr + 0.25 * zmag


class Directional:
    def __init__(self, eng: "RelayEngine") -> None:
        self.eng = eng
        self.enabled = False
        self.cfg: dict = {}
        self.state: dict[str, bool] = {}       # histerese dos detectores
        self.timers: dict[str, float] = {}
        self.prev_52a: bool | None = None       # estado anterior do 52A (None = primeira varredura)
        self.block_52a = 0.0
        self.v1_mem: complex = 0j
        self.v1_mem_age = 0.0
        self.prev_v0 = 0.0
        self.q: dict = {}                       # grandezas para exibição
        self.selected = "–"
        for b in BITS:
            eng.vals.setdefault(b, 0.0)

    # ------------------------------------------------------------ ajustes
    def rebuild(self) -> None:
        eng, st, g = self.eng, self.eng.settings, self.eng.group_cls
        txt = lambda k, d="": st.get(g, k, d).strip().upper()   # noqa: E731
        num = lambda k, d=None: st.number(g, k, d)               # noqa: E731
        inom = st.number(g, "INOM", None) or st.number("G", "INOM", None) or 5.0
        c: dict = {"inom": inom}
        edir = txt("EDIR", "N")
        c["edir"] = edir if edir in ("Y", "AUTO", "AUTO2") else "N"
        c["vnom_off"] = txt("VNOM") == "OFF"
        order = txt("ORDER", "OFF")
        c["order"] = "" if order in ("OFF", "") else "".join(ch for ch in order if ch in "QVISPU")
        c["efwdlop"] = txt("EFWDLOP", "Y") == "Y"
        c["dir"] = {n: (txt(f"DIR{n}", "N") if txt(f"DIR{n}", "N") in ("F", "R", "N") else "N") for n in range(1, 5)}
        c["vsconn"] = txt("VSCONN", "VS")
        c["delta_y"] = txt("DELTA_Y", "WYE")
        c["eload"] = txt("ELOAD", "N") == "Y"
        c["z1ang"] = num("Z1ANG", 80.0)
        c["z0ang"] = num("Z0ANG", 80.0)
        c["z1mag"] = num("Z1MAG", 0.0)
        c["z0mag"] = num("Z0MAG", 0.0)

        scale_i = 5.0 / inom if inom else 1.0   # fator de 5 A para a corrente nominal real
        d: dict[str, float] = {}
        for k, v in _DEF_I.items():
            d[k] = v / scale_i
        for k, v in _DEF_Z.items():
            d[k] = v * scale_i
        d.update(_DEF_N)
        edir_mode = c["edir"]
        if edir_mode == "AUTO":
            d.update({"50QFP": 0.10 * inom, "50QRP": 0.05 * inom, "Z2F": 0.5 * c["z1mag"], "a2": 0.10, "k2": 0.20,
                      "50GFP": 0.10 * inom, "50GRP": 0.05 * inom, "Z0F": 0.5 * c["z0mag"], "a0": 0.10, "Z0MTA": c["z0ang"]})
            d["Z2R"] = d["Z2F"] + 1.0 / inom
            d["Z0R"] = d["Z0F"] + 1.0 / inom
        elif edir_mode == "AUTO2":
            d.update({"50QFP": 0.10 * inom, "50QRP": 0.05 * inom, "Z2F": -1.5 / inom, "Z2R": 1.5 / inom, "a2": 0.10, "k2": 0.20,
                      "50GFP": 0.10 * inom, "50GRP": 0.05 * inom, "Z0F": -1.5 / inom, "Z0R": 1.5 / inom, "a0": 0.10,
                      "Z0MTA": c["z0ang"]})
        else:  # Y: ajustes do usuário (ou valores de fábrica)
            for k in list(d):
                if k != "KGN":
                    v = num(k)
                    if v is not None:
                        d[k] = v
        if c["order"] == "U":
            d["Z0F"], d["Z0R"] = -0.10, 0.10   # ajuste interno e oculto (figura 4.37)
        d["KGN"] = num("KGN") if edir_mode == "Y" else None
        c["s"] = d
        # PHI
        phi = {}
        for n in (1, 2):
            phi[n] = {
                "en": txt(f"EPHI{n}", "N") == "Y",
                "v": num(f"PHI59GP{n}", 22.0), "in": num(f"PHI50NP{n}", 0.15 / scale_i),
                "fwdp": num(f"PHIFWDP{n}"), "revp": num(f"PHIREVP{n}"),
                "f1": num(f"FWD1ANG{n}", 94.0), "f2": num(f"FWD2ANG{n}", 266.0), "fmta": num(f"FWDMTA{n}", 180.0),
                "r1": num(f"REV1ANG{n}", 274.0), "r2": num(f"REV2ANG{n}", 86.0), "rmta": num(f"REVMTA{n}", 0.0),
                "dly": num(f"PHIDLY{n}", 0.10) or 0.0,
            }
        c["phi"] = phi
        c["phirout"] = txt("PHIROUT", "N") == "Y" and ("P" in c["order"] or "U" in c["order"])
        c["load"] = {"zlf": num("ZLF", 6.5), "plaf": num("PLAF", 30.0), "nlaf": num("NLAF", -30.0),
                     "zlr": num("ZLR", 6.5), "plar": num("PLAR", 150.0), "nlar": num("NLAR", 210.0)}
        # há controle direcional ativo?
        c["active"] = c["edir"] != "N"
        self.cfg = c
        self.enabled = c["active"]
        for b in BITS:
            eng.vals.setdefault(b, 0.0)
        self._clear_outputs()
        self._levels(False, False, False, False, init=True)

    # ------------------------------------------------------------ utilitários
    def _clear_outputs(self) -> None:
        v = self.eng.vals
        for b in BITS:
            if b != "LOP" and not b.endswith("DIR"):
                v[b] = 0.0

    def _hyst(self, key: str, value: float, pickup: float) -> bool:
        cur = value >= pickup or (self.state.get(key, False) and value >= _HYST * pickup)
        self.state[key] = cur
        return cur

    def _timer(self, key: str, active: bool, delay: float, dt: float) -> bool:
        if not active:
            self.timers[key] = 0.0
            return False
        self.timers[key] = self.timers.get(key, 0.0) + dt
        return self.timers[key] >= delay - 1e-9

    def _levels(self, f_p: bool, r_p: bool, f_q: bool, r_q: bool, *, init: bool = False,
                f_g: bool = False, r_g: bool = False, f_n: bool = False, r_n: bool = False) -> None:
        """Figuras 4.41, 4.42, 4.60 e 4.61: sentido por nível (DIR1..DIR4)."""
        v = self.eng.vals
        c = self.cfg
        order = c.get("order", "")
        active = c.get("active", False)
        for n in range(1, 5):
            d = c.get("dir", {}).get(n, "N") if active else "N"
            for kind, fwd, rev in (("P", f_p, r_p), ("Q", f_q, r_q), ("G", f_g, r_g), ("N", f_n, r_n)):
                force = (c.get("vnom_off", False) and kind in "PQ") or \
                        (kind == "G" and order in ("", "P")) or (kind == "N" and order == "")
                out = force or init or d == "N" or (d == "F" and fwd) or (d == "R" and rev)
                v[f"{kind}{n}DIR"] = 1.0 if out else 0.0

    # ------------------------------------------------------------ ciclo
    def update(self, dt: float) -> None:
        eng = self.eng
        v = eng.vals
        c = self.cfg
        if not c.get("active"):
            self._clear_outputs()
            self._levels(False, False, False, False, init=True)
            self.q = {}
            self.selected = "–"
            return
        s = c["s"]
        ctr, ctrn, ptr = eng.ctr, eng.ctrn, eng.ptr
        I, V = eng.sec_I, eng.sec_V
        ia, ib, ic = I["A"], I["B"], I["C"]
        va, vb, vc = V["A"], V["B"], V["C"]
        i0 = (ia + ib + ic) / 3.0
        i1 = (ia + _A1 * ib + _A2 * ic) / 3.0
        i2 = (ia + _A2 * ib + _A1 * ic) / 3.0
        v0x3 = va + vb + vc                     # 3V0 (calculado das tensões de fase)
        v1 = (va + _A1 * vb + _A2 * vc) / 3.0
        v2 = (va + _A2 * vb + _A1 * vc) / 3.0
        ig = 3.0 * i0                           # corrente residual (3I0), base dos TCs de fase
        inn = (ia + ib + ic) * (ctr / ctrn)     # canal IN (3I0 no TC de neutro/balanceamento), em A secundários
        lop = bool(v.get("LOP", 0.0))
        order = c["order"]
        vsconn3 = c["vsconn"] == "3V0"
        no_v0 = (c["delta_y"] == "DELTA" and c["vsconn"] == "VS")   # sem fonte de 3V0 (TPs em delta aberto)
        edir_iv = bool(eng.ev(eng.group_cls, "EDIRIV")) if eng.group_has("EDIRIV") else True
        lop_blocks = lop and not vsconn3        # a perda de potencial desabilita os elementos de tensão
        vnom_off = c["vnom_off"]
        # ---- sequência negativa (Q): figuras 4.29 e 4.32/4.57
        i3q = abs(3.0 * i2)
        f50qf = self._hyst("50QF", i3q, s["50QFP"])
        f50qr = self._hyst("50QR", i3q, s["50QRP"])
        dirqe = (f50qf or f50qr) and not lop and not vnom_off and abs(i2) > s["a2"] * abs(i1)
        # ---- sequência zero (V) e canal IN (I): figura 4.30
        igm = abs(ig)
        f50gf = self._hyst("50GF", igm, s["50GFP"])
        f50gr = self._hyst("50GR", igm, s["50GRP"])
        dirve = ("V" in order) and (f50gf or f50gr) and abs(i0) > s["a0"] * abs(i1) and edir_iv \
            and not lop_blocks and not no_v0
        dirie = False   # canal IN polarizado por corrente: não disponível na simulação
        dirqge = ("Q" in order) and dirqe and (abs(i2) > s["k2"] * abs(i0) or (not dirve and not dirie))
        # ---- sequência zero com canal IN (S, P, U): figura 4.31
        inm = abs(inn)
        f50nf = self._hyst("50NF", inm, s["50NFP"])
        f50nr = self._hyst("50NR", inm, s["50NRP"])
        last = order[-1:] if order else ""
        dirne = False
        if last in ("S", "P", "U") and not no_v0:
            gate = True if last == "U" else (not dirqge and not dirve)
            dirne = gate and (f50nf or f50nr) and inm > s["a0N"] * abs(i1) and edir_iv and not lop_blocks
        # ---- melhor escolha (tabela 4.24)
        sel = ""
        for ch in order:
            if (ch == "Q" and dirqge) or (ch == "V" and dirve) or (ch == "I" and dirie) or (ch in "SPU" and dirne):
                sel = ch
                break
        self.selected = sel or "–"
        z1ang, z0mta = c["z1ang"], s["Z0MTA"]
        fq = rq = fv = rv = fn = rn = False
        z2 = z0 = zw = None
        if sel == "Q" and abs(i2) > 1e-9:
            z2 = _proj(v2, i2, z1ang)
            zm = abs(v2) / abs(i2)
            fq = f50qf and z2 < _fwd_thr(s["Z2F"], zm)
            rq = f50qr and z2 > _rev_thr(s["Z2R"], zm)
        if sel == "V" and igm > 1e-9:
            z0 = _proj(v0x3, ig, z0mta)
            zm = abs(v0x3) / igm
            fv = f50gf and z0 < _fwd_thr(s["Z0F"], zm)
            rv = f50gr and z0 > _rev_thr(s["Z0R"], zm)
        lzf = lzr = ugf = ugr = False
        if sel == "S" and inm > 1e-9:
            z0 = _proj(v0x3, inn, z0mta)                    # Ω na base do canal IN
            zm = abs(v0x3) / inm
            k = ctrn / ctr                                 # Z0F/Z0R (base dos TCs de fase) ajustados à base IN
            lzf = f50nf and z0 < _fwd_thr(s["Z0F"] * k, zm)
            lzr = f50nr and z0 > _rev_thr(s["Z0R"] * k, zm)
        if sel == "U" and inm > 1e-9:
            z0 = _proj(v0x3, inn, -90.0)
            zm = abs(v0x3) / inm
            ugf = f50nf and z0 < _fwd_thr(-0.10, zm)
            ugr = f50nr and z0 > _rev_thr(0.10, zm)
        # wattmétrico (P): figura 4.36 (sem a condutância incremental)
        a52 = bool(v.get("52A", 1.0))
        if eng.scan < 3:                                  # estado inicial do 52A (ainda sem lógica avaliada)
            self.prev_52a = a52
        if self.prev_52a is not None and a52 != self.prev_52a:
            self.block_52a = 30.0 / eng.nominal_freq      # 30 ciclos de bloqueio após abrir/fechar o disjuntor
        self.prev_52a = a52
        self.block_52a = max(0.0, self.block_52a - dt)
        fwi = rwi = False
        if sel == "P":
            p0 = (v0x3 * inn.conjugate()).real
            mag = abs(v0x3) * inm
            en = abs(v0x3) > s["59RES"] and inm > 0.005 and self.block_52a <= 0.0
            fwi = en and p0 < -(0.9375 * s["DIRWFP"] + 0.0625 * mag)
            rwi = en and p0 > (0.9375 * s["DIRWRP"] + 0.0625 * mag)
            zw = p0
        fw = self._timer("DIRWF", fwi, s["DIRWD"], dt)
        rw = self._timer("DIRWR", rwi, s["DIRWD"], dt)
        # ---- 3V0 estável (figura 4.50) e elemento PHI
        dv0 = abs(abs(v0x3) - self.prev_v0)
        self.prev_v0 = abs(v0x3)
        stab = self._timer("STAB", dv0 < 1.0 and abs(v0x3) > 5.0 and not (lop and c["vsconn"] == "VS"), 1.0 / eng.nominal_freq, dt)
        phi_bits = self._phi(inn, v0x3, lop, vsconn3, dt)
        # ---- roteamento: figuras 4.38 a 4.40
        phi_sel = 2 if (eng.ev(eng.group_cls, "PHI2SEL") if eng.group_has("PHI2SEL") else 0) else 1
        fdirn, rdirn = (lzf or ugf or fw), (lzr or ugr or rw)
        if c["phirout"]:
            fdirn, rdirn = phi_bits[f"PHIFWD{phi_sel}"], phi_bits[f"PHIREV{phi_sel}"]
        ephi_any = phi_bits["EPHI1"] or phi_bits["EPHI2"]
        efwd = c["efwdlop"] and lop
        # forçado a "frente" na perda de potencial (não afeta quando o elemento depende só de 3V0 medido)
        forced_g = efwd and not dirie and not (vsconn3 and (dirve or dirne))
        forced_n = efwd and not dirie and not (vsconn3 and (dirve or (ephi_any and c["phirout"]) or (dirne and not c["phirout"])))
        dirgf = forced_g or fq or fv or (fdirn and order != "P")
        dirgr = rq or rv or (rdirn and order != "P")
        dirnf = forced_n or fq or fv or fdirn
        dirnr = rq or rv or rdirn
        # ---- fase e sequência negativa (figuras 4.57 a 4.59)
        fp = rp = False
        vpolv = self._vpol(v1, dt)
        zload = self._load(v1, i1)
        p50 = (3.0 ** 0.5) * (0.1 * c["inom"] if c["eload"] else s["50PDIRP"])
        pdir = min(abs(ia - ib), abs(ib - ic), abs(ic - ia)) >= p50
        v["50PDIR"] = 1.0 if pdir else 0.0
        rq_ph = fdirq_ph = False
        z2p = None
        if dirqe and abs(i2) > 1e-9:
            z2p = _proj(v2, i2, z1ang)
            zm = abs(v2) / abs(i2)
            fdirq_ph = f50qf and z2p < _fwd_thr(s["Z2F"], zm)
            rq_ph = f50qr and z2p > _rev_thr(s["Z2R"], zm)
        rdirq = rq_ph
        if pdir and vpolv and not zload and not lop and not vnom_off and abs(i1) > 1e-9:
            # sequência positiva: 'frente' quando ∠(V1/I1) está a ±90° de Z1ANG (figura 4.58); a sequência negativa tem prioridade
            fwd_c = (self.v1_mem * (i1 * cmath.rect(1.0, math.radians(z1ang))).conjugate()).real
            fp = fwd_c > 0 and not rdirq
            rp = fwd_c < 0 and not fdirq_ph
        dirqf = fdirq_ph or efwd
        dirqr = rdirq
        dirpf = dirqf or fp
        dirpr = rdirq or rp
        if dirpf and dirpr:                       # nunca os dois ao mesmo tempo (anti-oscilação)
            dirpf = dirpr = False
        # ---- níveis
        self._levels(dirpf, dirpr, dirqf, dirqr, f_g=dirgf, r_g=dirgr, f_n=dirnf, r_n=dirnr)
        # ---- publica os bits
        def b(name: str, val: bool) -> None:
            v[name] = 1.0 if val else 0.0
        b("DIRQE", dirqe); b("DIRQGE", dirqge); b("DIRVE", dirve); b("DIRIE", dirie); b("DIRNE", dirne)
        b("50QF", f50qf); b("50QR", f50qr); b("50GF", f50gf); b("50GR", f50gr); b("50NF", f50nf); b("50NR", f50nr)
        b("FDIRQ", fdirq_ph); b("RDIRQ", rdirq); b("FDIRP", fp); b("RDIRP", rp)
        b("FDIRQG", sel == "Q" and fq); b("RDIRQG", sel == "Q" and rq)
        b("FDIRV", fv); b("RDIRV", rv); b("FDIRI", False); b("RDIRI", False)
        b("FDIRN", fdirn); b("RDIRN", rdirn); b("LZFWD", lzf); b("LZREV", lzr); b("UGFWD", ugf); b("UGREV", ugr)
        b("FDIRW", fw); b("RDIRW", rw); b("FDIRWI", fwi); b("RDIRWI", rwi); b("FDIRC", False); b("RDIRC", False)
        b("DIRQF", dirqf); b("DIRQR", dirqr); b("DIRPF", dirpf); b("DIRPR", dirpr)
        b("DIRGF", dirgf); b("DIRGR", dirgr); b("DIRNF", dirnf); b("DIRNR", dirnr)
        b("ZLOAD", zload); b("VPOLV", vpolv); b("GNDSW", False); b("DIRSTAB", stab)
        for k, val in phi_bits.items():
            b(k, val)
        self.q = {
            "I1": abs(i1), "I2": abs(i2), "3I0": abs(ig), "3I2": i3q, "IN": inm, "3V0": abs(v0x3), "V1": abs(v1), "V2": abs(v2),
            "Z2": z2 if z2 is not None else z2p, "Z0": z0, "W0": zw, "z1ang": z1ang,
        }

    # ------------------------------------------------------------ PHI (figuras 4.43 a 4.45)
    def _phi(self, inn: complex, v0x3: complex, lop: bool, vsconn3: bool, dt: float) -> dict[str, bool]:
        c, v = self.cfg, self.eng.vals
        out: dict[str, bool] = {}
        inm = abs(inn)
        phi_deg = (_deg(inn) - _deg(v0x3)) % 360.0
        raw: dict[int, tuple[bool, bool]] = {}
        for n, p in c["phi"].items():
            tc = bool(self.eng.ev(self.eng.group_cls, f"PHITC{n}")) if self.eng.group_has(f"PHITC{n}") else True
            en = p["en"] and not (lop and not vsconn3) and abs(v0x3) > p["v"] and tc and inm > p["in"]
            out[f"EPHI{n}"] = en

            def sector(a1: float, a2: float, ang: float) -> bool:
                return (a1 <= ang <= a2) if a2 > a1 else (ang >= a1 or ang <= a2)

            fang = sector(p["f1"], p["f2"], phi_deg)
            rang = sector(p["r1"], p["r2"], phi_deg)
            fmag = p["fwdp"] is None or abs(inm * math.cos(math.radians(phi_deg - p["fmta"]))) >= p["fwdp"]
            rmag = p["revp"] is None or abs(inm * math.cos(math.radians(phi_deg - p["rmta"]))) >= p["revp"]
            raw[n] = (en and fang and fmag, en and rang and rmag)
        for n in (1, 2):
            fi, ri = raw[n]
            fwd = self._timer(f"PHIF{n}", fi and not self.state.get(f"PHIREV{n}", False), c["phi"][n]["dly"], dt)
            rev = self._timer(f"PHIR{n}", ri and not self.state.get(f"PHIFWD{n}", False), c["phi"][n]["dly"], dt)
            out[f"PHIFWD{n}"], out[f"PHIREV{n}"] = fwd, rev
            self.state[f"PHIFWD{n}"], self.state[f"PHIREV{n}"] = fwd, rev
        return out

    # ------------------------------------------------------------ fase: polarização e carga
    def _vpol(self, v1: complex, dt: float) -> bool:
        """Tensão de polarização de sequência positiva com memória (≈0,1 s)."""
        if abs(v1) >= 1.0:
            self.v1_mem, self.v1_mem_age = v1, 0.0
            return True
        self.v1_mem_age += dt
        return self.v1_mem_age <= 0.1 and abs(self.v1_mem) > 0.0

    def _load(self, v1: complex, i1: complex) -> bool:
        """Região de carga (ZLOAD = ZLOUT OU ZLIN), com a convenção padrão: |Z1| ≥ ZLF/ZLR dentro dos ângulos."""
        c = self.cfg
        v = self.eng.vals
        zout = zin = False
        if c["eload"] and abs(i1) > 0.1 * c["inom"]:
            z = v1 / i1
            za, ang = abs(z), _deg(z) % 360.0
            ld = c["load"]
            zout = za >= ld["zlf"] and _norm180(ang) <= ld["plaf"] and _norm180(ang) >= ld["nlaf"]
            zin = za >= ld["zlr"] and ld["plar"] <= ang <= ld["nlar"]
        v["ZLOUT"], v["ZLIN"] = (1.0 if zout else 0.0), (1.0 if zin else 0.0)
        return zout or zin

    # ------------------------------------------------------------ exibição
    def info(self) -> dict:
        c = self.cfg
        v = self.eng.vals
        if not c:
            return {"enabled": False}
        s = c["s"]
        lv = {k: [bool(v.get(f"{k}{n}DIR", 1.0)) for n in range(1, 5)] for k in LEVEL_KINDS}
        keys = ["DIRQE", "DIRQGE", "DIRVE", "DIRNE", "FDIRQ", "RDIRQ", "FDIRP", "RDIRP", "FDIRQG", "RDIRQG", "FDIRV", "RDIRV",
                "FDIRN", "RDIRN", "DIRQF", "DIRQR", "DIRPF", "DIRPR", "DIRGF", "DIRGR", "DIRNF", "DIRNR", "50QF", "50QR", "50GF", "50GR",
                "50NF", "50NR", "50PDIR", "ZLOAD", "DIRSTAB", "EPHI1", "EPHI2", "PHIFWD1", "PHIREV1", "PHIFWD2", "PHIREV2", "LOP"]
        return {
            "enabled": self.enabled, "edir": c["edir"], "order": c["order"] or "OFF", "selected": self.selected,
            "vnom_off": c["vnom_off"], "efwdlop": c["efwdlop"], "dir": [c["dir"][n] for n in range(1, 5)],
            "levels": lv, "bits": {k: bool(v.get(k, 0.0)) for k in keys},
            "settings": {k: (round(x, 4) if isinstance(x, float) else x) for k, x in s.items() if x is not None},
            "quantities": {k: (None if x is None else round(float(x), 4)) for k, x in self.q.items()},
        }
