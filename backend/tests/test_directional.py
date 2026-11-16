"""Controle direcional (EDIR, ORDER, DIR1..DIR4) conforme o manual do SEL-751, seção "Directional Control".

Ajustes sintéticos (não dependem do .rdb). CTR = CTRN = 100 e PTR = 60: 1 A sec. = 100 A prim., 1 V sec. = 60 V prim.
Os sinais são construídos por componentes simétricas (valores secundários) com a convenção do relé: corrente positiva
para a linha; numa falta à frente, V2 = −Z2s·I2 e V0 = −Z0s·I0 (impedâncias vistas negativas).
"""
from __future__ import annotations

import cmath
import math

from app.engine import RelayEngine
from app.settings import RelaySettings

CTR, PTR = 100.0, 60.0
A1 = cmath.rect(1.0, math.radians(120.0))
A2 = A1 * A1


def zang(mag: float, ang: float) -> complex:
    return cmath.rect(mag, math.radians(ang))


BASE = {
    "CTR": "100", "CTRN": "100", "PTR": "60", "VNOM": "115", "Z1ANG": "80", "Z0ANG": "80",
    "EDIR": "Y", "EFWDLOP": "Y", "DIR1": "F", "DIR2": "N", "DIR3": "N", "DIR4": "N", "ORDER": "OFF",
    "50QFP": "0.50", "50QRP": "0.25", "Z2F": "-0.06", "Z2R": "0.06", "a2": "0.10", "k2": "0.20",
    "50GFP": "0.50", "50GRP": "0.25", "Z0F": "-0.05", "Z0R": "0.05", "a0": "0.10", "Z0MTA": "80",
    "50PDIRP": "3.00", "EDIRIV": "1",
    "50P1P": "OFF", "50P1D": "0.00", "50P1TC": "1",
    "50N1P": "OFF", "50N1D": "0.00", "50N1TC": "1",
    "50G1P": "OFF", "50G1D": "0.00", "50G1TC": "1",
    "50Q1P": "OFF", "50Q1D": "0.00", "50Q1TC": "1",
    "51P1P": "OFF", "51P1C": "C1", "51P1TD": "1.00", "51P1RS": "N", "51P1CT": "0.00", "51P1MR": "0.00", "51P1TC": "1",
}


def make(**over: str) -> RelayEngine:
    items = dict(BASE)
    items.update(over)
    body = "\n".join(f'{k},"{v}"' for k, v in items.items())
    rs = RelaySettings.from_files({
        "Relays/T/set_1.txt": f"[1]\n{body}\n",
        "Relays/T/set_G.txt": '[G]\nFNOM,"60"\n51SAT,"Y"\n',
    })
    return RelayEngine(rs, device_name="teste")


def abc(s0: complex, s1: complex, s2: complex) -> tuple[complex, complex, complex]:
    return s0 + s1 + s2, s0 + A2 * s1 + A1 * s2, s0 + A1 * s1 + A2 * s2


def inject(eng: RelayEngine, i012, v012) -> None:
    cfg: dict = {"analog_on": True}
    for ph, c in zip("abc", abc(*i012)):
        cfg[f"i{ph}_mag"], cfg[f"i{ph}_ang"] = abs(c) * CTR, math.degrees(cmath.phase(c))
    for ph, c in zip("abc", abc(*v012)):
        cfg[f"v{ph}_mag"], cfg[f"v{ph}_ang"] = abs(c) * PTR, math.degrees(cmath.phase(c))
    eng.set_sim(cfg)


def fault_ag(eng: RelayEngine, forward: bool, i_sec: float = 10.0, z1: float = 2.0, z0: float = 3.0) -> None:
    """Falta fase-terra A: I0 = I1 = I2 = I. À frente V2 = −Z2·I2; atrás V2 = +Z2·I2 (impedância vista positiva)."""
    i = zang(i_sec, -80.0)
    sign = -1.0 if forward else 1.0
    i012 = (i, i, i) if forward else (-i, -i, -i)
    v0 = sign * zang(z0, 80.0) * i012[0]
    v2 = sign * zang(z1, 80.0) * i012[2]
    v1 = zang(66.0, 0.0) + (-zang(z1, 80.0) * i012[1] if forward else 0j)
    inject(eng, i012, (v0, v1, v2))


def three_phase(eng: RelayEngine, forward: bool, i_sec: float = 10.0) -> None:
    i1 = zang(i_sec, -80.0 if forward else 100.0)
    inject(eng, (0j, i1, 0j), (0j, zang(30.0, 0.0), 0j))


def run(eng: RelayEngine, seconds: float, dt: float = 0.004) -> None:
    for _ in range(int(round(seconds / dt))):
        eng.step(dt)


def bit(eng: RelayEngine, name: str) -> bool:
    return bool(eng.vals[name])


# ------------------------------------------------------------------ EDIR = N / geral
def test_edir_n_keeps_everything_nondirectional():
    eng = make(EDIR="N", DIR1="F", **{"50N1P": "1.0"})
    fault_ag(eng, forward=False)
    run(eng, 0.1)
    assert bit(eng, "50N1P") and bit(eng, "67N1P")        # reverso, mas o controle direcional está desligado
    assert all(bit(eng, f"{k}{n}DIR") for k in "PNGQ" for n in range(1, 5))
    assert not eng.directional.enabled


def test_bits_registered_and_no_unresolved_identifiers():
    eng = make(**{"50P1P": "3.0"})
    for name in ("DIRPF", "DIRNR", "FDIRQ", "FDIRV", "67P1T", "P1DIR", "N4DIR", "LOP", "DIRSTAB", "PHIFWD1"):
        assert name in eng.vals


# ------------------------------------------------------------------ Q: sequência negativa
def test_neg_seq_element_controls_neutral_overcurrent():
    eng = make(ORDER="Q", DIR1="F", **{"50N1P": "5.0"})
    fault_ag(eng, forward=True)
    run(eng, 0.1)
    assert bit(eng, "DIRQE") and bit(eng, "DIRQGE") and bit(eng, "FDIRQG") and not bit(eng, "RDIRQG")
    assert bit(eng, "DIRNF") and not bit(eng, "DIRNR") and bit(eng, "N1DIR")
    assert bit(eng, "50N1P")                              # IN = 30 A sec. > 5 A e sentido à frente
    fault_ag(eng, forward=False)
    run(eng, 0.1)
    assert bit(eng, "RDIRQG") and not bit(eng, "FDIRQG") and bit(eng, "DIRNR")
    assert not bit(eng, "N1DIR") and not bit(eng, "50N1P")  # DIR1 = F bloqueia a falta reversa


def test_reverse_level_setting_passes_only_reverse_faults():
    eng = make(ORDER="Q", DIR1="R", **{"50G1P": "5.0"})
    fault_ag(eng, forward=True)
    run(eng, 0.1)
    assert not bit(eng, "G1DIR") and not bit(eng, "50G1P")
    fault_ag(eng, forward=False)
    run(eng, 0.1)
    assert bit(eng, "G1DIR") and bit(eng, "50G1P")


def test_negative_sequence_element_requires_min_current_and_a2_restraint():
    eng = make(ORDER="Q", DIR1="F", **{"50N1P": "5.0"})
    fault_ag(eng, forward=True, i_sec=0.05)              # 3I2 = 0,15 A < 50QRP (0,25 A)
    run(eng, 0.1)
    assert not bit(eng, "DIRQE") and not bit(eng, "50QF")
    # carga trifásica equilibrada: I2 = 0 (< a2·I1) → sem habilitação
    three_phase(eng, forward=True)
    run(eng, 0.1)
    assert not bit(eng, "DIRQE")


# ------------------------------------------------------------------ V: sequência zero
def test_zero_seq_voltage_polarized_forward_and_reverse():
    eng = make(ORDER="V", DIR1="F", **{"50G1P": "5.0"})
    fault_ag(eng, forward=True)
    run(eng, 0.1)
    assert bit(eng, "DIRVE") and bit(eng, "FDIRV") and bit(eng, "DIRGF") and bit(eng, "G1DIR") and bit(eng, "50G1P")
    fault_ag(eng, forward=False)
    run(eng, 0.1)
    assert bit(eng, "RDIRV") and bit(eng, "DIRGR") and not bit(eng, "G1DIR") and not bit(eng, "50G1P")


def test_best_choice_order_prefers_first_enabled_element():
    # ORDER = QV: com sequência negativa disponível, o elemento Q é o escolhido; V fica inativo
    eng = make(ORDER="QV", DIR1="F", **{"50G1P": "5.0"})
    fault_ag(eng, forward=True)
    run(eng, 0.1)
    assert eng.directional.selected == "Q" and bit(eng, "FDIRQG") and not bit(eng, "FDIRV")
    eng2 = make(ORDER="VQ", DIR1="F", **{"50G1P": "5.0"})
    fault_ag(eng2, forward=True)
    run(eng2, 0.1)
    assert eng2.directional.selected == "V" and bit(eng2, "FDIRV") and not bit(eng2, "FDIRQG")


def test_order_off_and_p_alone_make_residual_nondirectional():
    for order in ("OFF", "P"):
        eng = make(ORDER=order, DIR1="F", **{"50G1P": "5.0"})
        fault_ag(eng, forward=False)
        run(eng, 0.1)
        assert bit(eng, "G1DIR") and bit(eng, "50G1P")


# ------------------------------------------------------------------ AUTO / AUTO2
def test_auto_settings_use_line_impedances():
    eng = make(EDIR="AUTO", Z1MAG="4.0", Z0MAG="12.0", ORDER="QV", DIR1="F")
    s = eng.directional.cfg["s"]
    assert s["Z2F"] == 2.0 and abs(s["Z2R"] - 2.2) < 1e-9          # Z1MAG/2 e Z2F + 1/INOM (INOM = 5)
    assert s["Z0F"] == 6.0 and abs(s["Z0R"] - 6.2) < 1e-9
    assert abs(s["50QFP"] - 0.5) < 1e-9 and abs(s["50QRP"] - 0.25) < 1e-9 and s["Z0MTA"] == 80.0


def test_auto2_settings():
    eng = make(EDIR="AUTO2", ORDER="Q")
    s = eng.directional.cfg["s"]
    assert abs(s["Z2F"] + 0.3) < 1e-9 and abs(s["Z2R"] - 0.3) < 1e-9 and abs(s["Z0F"] + 0.3) < 1e-9


# ------------------------------------------------------------------ fase (sequência positiva e negativa)
def test_phase_directional_three_phase_fault_positive_sequence():
    eng = make(DIR1="F", **{"50P1P": "3.0"})
    three_phase(eng, forward=True)
    run(eng, 0.1)
    assert bit(eng, "50PDIR") and bit(eng, "FDIRP") and bit(eng, "DIRPF") and bit(eng, "P1DIR")
    assert bit(eng, "50P1P") and bit(eng, "67P1P")
    three_phase(eng, forward=False)
    run(eng, 0.1)
    assert bit(eng, "RDIRP") and bit(eng, "DIRPR") and not bit(eng, "P1DIR")
    assert not bit(eng, "50P1P") and not bit(eng, "67P1P")


def test_phase_unbalanced_fault_uses_negative_sequence_priority():
    eng = make(DIR1="F", **{"50P1P": "3.0"})
    fault_ag(eng, forward=True)
    run(eng, 0.1)
    assert bit(eng, "FDIRQ") and bit(eng, "DIRQF") and bit(eng, "DIRPF") and bit(eng, "50P1P")
    fault_ag(eng, forward=False)
    run(eng, 0.1)
    assert bit(eng, "RDIRQ") and bit(eng, "DIRPR") and not bit(eng, "50P1P")


def test_time_overcurrent_is_controlled_by_dir1():
    eng = make(DIR1="R", **{"51P1P": "3.0"})
    three_phase(eng, forward=True)
    run(eng, 0.2)
    assert not bit(eng, "51P1P")
    three_phase(eng, forward=False)
    run(eng, 0.2)
    assert bit(eng, "51P1P")


def test_vnom_off_makes_phase_and_negative_sequence_nondirectional():
    eng = make(VNOM="OFF", DIR1="F", **{"50P1P": "3.0"})
    three_phase(eng, forward=False)
    run(eng, 0.1)
    assert bit(eng, "P1DIR") and bit(eng, "Q1DIR") and bit(eng, "50P1P")


# ------------------------------------------------------------------ perda de potencial
def test_loss_of_potential_forces_forward_when_efwdlop():
    eng = make(DIR1="F", **{"50P1P": "3.0"})
    three_phase(eng, forward=False)
    eng.set_sim({"lop": True})
    run(eng, 0.1)
    assert bit(eng, "LOP") and bit(eng, "DIRPF") and bit(eng, "P1DIR") and bit(eng, "50P1P")   # vira não direcional
    eng2 = make(EFWDLOP="N", DIR1="F", **{"50P1P": "3.0"})
    three_phase(eng2, forward=False)
    eng2.set_sim({"lop": True})
    run(eng2, 0.1)
    assert not bit(eng2, "DIRPF") and not bit(eng2, "50P1P")


# ------------------------------------------------------------------ S, U, P e PHI (canal IN)
def zero_seq_setup(eng: RelayEngine, v0: complex, i_in: complex) -> None:
    """3V0 = v0 (V sec.) e IN = i_in (A sec. do canal IN): Ia = IN/3 nas três fases (3I0 = IN)."""
    i = i_in / 3.0
    inject(eng, (i, 0j, 0j), (v0 / 3.0, zang(66.0, 0.0), 0j))


def test_low_impedance_element_s():
    eng = make(ORDER="S", DIR1="F", **{"50NFP": "0.01", "50NRP": "0.005", "a0N": "0.001", "Z0F": "-0.05", "Z0R": "0.05",
                                       "50N1P": "0.05"})
    zero_seq_setup(eng, 30.0 * zang(1.0, 0.0), zang(0.2, 100.0))               # I0 = −V0/Z0s (Z0s ∠80°): à frente
    run(eng, 0.1)
    assert bit(eng, "DIRNE") and bit(eng, "LZFWD") and bit(eng, "FDIRN") and bit(eng, "DIRNF") and bit(eng, "50N1P")
    zero_seq_setup(eng, 30.0 * zang(1.0, 0.0), zang(0.2, -80.0))
    run(eng, 0.1)
    assert bit(eng, "LZREV") and bit(eng, "DIRNR") and not bit(eng, "N1DIR")


def test_ungrounded_element_u_uses_fixed_angle():
    eng = make(ORDER="U", DIR1="F", **{"50NFP": "0.01", "50NRP": "0.005", "50N1P": "0.05"})
    # Z0 = Re[3V0·(IN∠−90°)*]/|IN|²: corrente adiantada 90° da tensão → à frente
    zero_seq_setup(eng, 30.0 * zang(1.0, 0.0), zang(0.2, 90.0 + 180.0))
    run(eng, 0.1)
    assert eng.directional.selected == "U"
    assert bit(eng, "UGFWD") or bit(eng, "UGREV")


def test_wattmetric_element_p_with_delay():
    eng = make(ORDER="P", DIR1="F", **{"59RES": "22", "DIRWFP": "0.5", "DIRWRP": "0.5", "DIRWD": "0.5", "50N1P": "0.01"})
    zero_seq_setup(eng, 30.0 * zang(1.0, 0.0), zang(0.05, 180.0))              # potência ativa saindo: à frente
    run(eng, 0.3)
    assert not bit(eng, "FDIRW")                                               # ainda dentro do atraso DIRWD
    run(eng, 0.4)
    assert bit(eng, "FDIRW") and bit(eng, "FDIRN") and bit(eng, "DIRNF") and bit(eng, "N1DIR")
    zero_seq_setup(eng, 30.0 * zang(1.0, 0.0), zang(0.05, 0.0))
    run(eng, 0.7)
    assert bit(eng, "RDIRW") and not bit(eng, "FDIRW") and not bit(eng, "N1DIR")


def test_phi_element_sector_and_delay():
    eng = make(ORDER="U", DIR1="F", PHIROUT="Y", EPHI1="Y", PHIDLY1="0.1", PHI59GP1="22", PHI50NP1="0.05",
               PHIFWDP1="OFF", PHIREVP1="OFF", **{"50N1P": "0.01"})
    zero_seq_setup(eng, 30.0 * zang(1.0, 0.0), zang(0.2, 180.0))               # φ = 180° (setor à frente 94°–266°)
    run(eng, 0.05)
    assert bit(eng, "EPHI1") and not bit(eng, "PHIFWD1")
    run(eng, 0.2)
    assert bit(eng, "PHIFWD1") and bit(eng, "FDIRN")
    zero_seq_setup(eng, 30.0 * zang(1.0, 0.0), zang(0.2, 0.0))                 # φ = 0° (setor reverso 274°–86°)
    run(eng, 0.3)
    assert bit(eng, "PHIREV1") and not bit(eng, "PHIFWD1") and bit(eng, "RDIRN")


def test_stable_ground_fault_detection():
    eng = make(ORDER="V")
    fault_ag(eng, forward=True)
    run(eng, 0.1)
    assert bit(eng, "DIRSTAB")
    eng.set_sim({"analog_on": False})
    run(eng, 0.1)
    assert not bit(eng, "DIRSTAB")


def test_load_encroachment_disables_positive_sequence_element():
    eng = make(DIR1="F", ELOAD="Y", ZLF="5", PLAF="30", NLAF="-30", ZLR="5", PLAR="150", NLAR="210", **{"50P1P": "3.0"})
    # Z1 = V1/I1 = 30/4 = 7,5 Ω ∠ +10° (dentro da região de carga à frente) → bloqueia o elemento de sequência positiva
    inject(eng, (0j, zang(4.0, -10.0), 0j), (0j, zang(30.0, 0.0), 0j))
    run(eng, 0.1)
    assert bit(eng, "ZLOAD") and bit(eng, "ZLOUT") and not bit(eng, "FDIRP")
