"""Elementos 27/59 (níveis 1 a 4, VS), 3P27/3P59, 27I/59I, 25 (sincronismo), 3PWR (32) e 593SRMS com ajustes sintéticos."""
from __future__ import annotations

import pytest

from app.engine import RelayEngine
from app.settings import RelaySettings

PTR, CTR = 60.0, 100.0
BASE = {"CTR": str(CTR), "CTRN": str(CTR), "PTR": str(PTR), "PTRS": str(PTR), "VNOM": "115"}


def make(**over: str) -> RelayEngine:
    items = dict(BASE)
    items.update(over)
    body = "\n".join(f'{k},"{v}"' for k, v in items.items())
    rs = RelaySettings.from_files({
        "Relays/T/set_1.txt": f"[1]\n{body}\n",
        "Relays/T/set_G.txt": '[G]\nFNOM,"60"\n',
    })
    return RelayEngine(rs, device_name="teste")


def volts(eng: RelayEngine, ln_sec: float, **extra: float) -> None:
    """Tensões trifásicas equilibradas, `ln_sec` V secundários fase-neutro (injeção ligada)."""
    mag = ln_sec * PTR
    eng.set_sim({"va_mag": mag, "vb_mag": mag, "vc_mag": mag, "analog_on": True, **extra})


def run(eng: RelayEngine, seconds: float, dt: float = 0.01) -> None:
    for _ in range(int(round(seconds / dt))):
        eng.step(dt)


def first(eng: RelayEngine, name: str, limit: float, dt: float = 0.01) -> float:
    t = 0.0
    while t < limit:
        eng.step(dt)
        t += dt
        if eng.vals[name]:
            return t
    return float("inf")


# ---------------------------------------------------------------- 27 / 59 níveis 3 e 4, VS e 3P27/3P59
def test_undervoltage_level3_and_level4_and_vs():
    e = make(**{"27P3P": "100", "27P3D": "0.20", "27P4P": "OFF", "27P4D": "5", "27S1P": "100", "27S1D": "0.30"})
    volts(e, 120.0, vs_mag=110.0 * PTR)
    run(e, 0.5)
    assert not e.vals["27P3"] and not e.vals["27S1"] and not e.vals["27P4"]
    volts(e, 90.0, vs_mag=90.0 * PTR)
    assert first(e, "27P3", 0.1) < 0.1                           # pickup
    assert not e.vals["27P3T"]
    run(e, 0.3)
    assert e.vals["27P3T"] and e.vals["27S1T"] and not e.vals["27P4"]


def test_overvoltage_vs_and_registered_bits():
    e = make(**{"59S1P": "120", "59S1D": "0.10"})
    volts(e, 115.0, vs_mag=130.0 * PTR)
    run(e, 0.3)
    assert e.vals["59S1"] and e.vals["59S1T"]
    for b in ("3P27", "3P59", "25A1", "25A2", "SF", "59VP", "59VS", "DLDB", "3PWR1P", "593SRMS1", "27I1", "59I4T"):
        assert b in e.vals                                       # registrados mesmo sem uso


def test_three_phase_undervoltage_and_overvoltage():
    e = make(**{"27P1P": "100", "27P1D": "5", "59P1P": "110", "59P1D": "5"})
    volts(e, 90.0)
    run(e, 0.1)
    assert e.vals["3P27"] and not e.vals["3P59"]
    e.set_sim({"va_mag": 115.0 * PTR})                           # uma fase fora: 3P27 cai
    run(e, 0.1)
    assert not e.vals["3P27"]
    volts(e, 120.0)
    run(e, 0.1)
    assert e.vals["3P59"] and not e.vals["3P27"]


# ---------------------------------------------------------------- 27I / 59I
def test_inverse_time_undervoltage_curve_a():
    e = make(**{"E27I1": "Y", "27I1OQ": "VAB", "27I1P": "120", "27I1CRV": "CURVEA", "27I1TD": "1.00", "27I1TTR": "0.01", "27I1TC": "1"})
    volts(e, 60.0 / 1.7320508)                                   # VAB = 60 V sec: OQ/P = 0,5 -> TTT = 1/(1-0,5) = 2 s
    t = first(e, "27I1T", 5.0)
    assert t == pytest.approx(2.0, abs=0.06)
    assert e.vals["27I1"] and not e.vals["27I1RS"]
    volts(e, 120.0)                                              # tensão normal: reseta
    run(e, 0.1)
    assert not e.vals["27I1"] and not e.vals["27I1T"] and e.vals["27I1RS"]


def test_inverse_time_overvoltage_curve_a_and_disabled():
    e = make(**{"E59I1": "Y", "59I1OQ": "VAB", "59I1P": "120", "59I1CRV": "CURVEA", "59I1TD": "1.00", "59I1TTR": "0.01", "59I1TC": "1"})
    volts(e, 180.0 / 1.7320508)                                  # VAB = 180 V: 1,5 pu -> 0,96 + 3,88/(1,5^2 - 1) = 4,064 s
    assert first(e, "59I1T", 10.0) == pytest.approx(4.064, abs=0.08)
    d = make(**{"E59I1": "N", "59I1OQ": "VAB", "59I1P": "120", "59I1TD": "1.00"})
    volts(d, 180.0 / 1.7320508)
    run(d, 6.0)
    assert not d.vals["59I1"]


def test_inverse_time_torque_control_blocks():
    e = make(**{"E27I1": "Y", "27I1OQ": "VAB", "27I1P": "120", "27I1TD": "1.00", "27I1TC": "0"})
    volts(e, 50.0)
    run(e, 3.0)
    assert not e.vals["27I1"] and not e.vals["27I1T"]


# ---------------------------------------------------------------- 25
SYNC = {"E25": "Y", "VSCONN": "VS", "25VLO": "105", "25VHI": "130", "25RCF": "1.00", "25SF": "0.20", "25ANG1": "25", "25ANG2": "40",
        "SYNCPH": "VA", "TCLOSD": "OFF", "BSYNCH": "0"}


def test_sync_check_static_angles_and_window():
    e = make(**SYNC)
    volts(e, 115.0, vs_mag=115.0 * PTR, vs_ang=10.0)
    run(e, 0.2)
    assert e.vals["59VP"] and e.vals["59VS"] and e.vals["SF"] and e.vals["25A1"] and e.vals["25A2"]
    e.set_sim({"vs_ang": 30.0})
    run(e, 0.1)
    assert not e.vals["25A1"] and e.vals["25A2"]
    e.set_sim({"vs_ang": 60.0})
    run(e, 0.1)
    assert not e.vals["25A1"] and not e.vals["25A2"]
    e.set_sim({"vs_ang": 5.0, "vs_mag": 80.0 * PTR})             # VS fora da janela: 59VS e SF caem
    run(e, 0.1)
    assert not e.vals["59VS"] and not e.vals["SF"] and not e.vals["25A1"]


def test_sync_check_syncph_angle_and_block():
    e = make(**{**SYNC, "SYNCPH": "90"})                         # VS atrasa VA em 90°
    volts(e, 115.0, vs_mag=115.0 * PTR, vs_ang=-90.0)
    run(e, 0.2)
    assert e.vals["25A1"]
    b = make(**{**SYNC, "BSYNCH": "1"})                          # bloqueio ligado
    volts(b, 115.0, vs_mag=115.0 * PTR, vs_ang=0.0)
    run(b, 0.2)
    assert b.vals["59VP"] and not b.vals["SF"] and not b.vals["25A1"]


def test_sync_check_voltage_difference_and_dead_live():
    e = make(**{**SYNC, "25VDIF": "5"})
    volts(e, 115.0, vs_mag=125.0 * PTR, vs_ang=0.0)              # 8,7 % de diferença > 5 %
    run(e, 0.2)
    assert e.vals["59VP"] and e.vals["59VS"] and not e.vals["59VDIF"] and not e.vals["SF"]
    d = make(**SYNC)
    volts(d, 115.0, vs_mag=10.0 * PTR)                           # barra morta, linha viva
    run(d, 0.1)
    assert d.vals["LLDB"] and not d.vals["DLLB"] and not d.vals["DLDB"]


def test_sync_check_slipping_pulses_near_zero_angle():
    e = make(**{**SYNC, "TCLOSD": "100"})
    volts(e, 115.0, vs_mag=115.0 * PTR, vs_ang=170.0, vs_freq=60.10)
    pulses, angles = 0, []
    prev = False
    for _ in range(int(12.0 / 0.004)):
        e.step(0.004)
        on = bool(e.vals["25A1"])
        if on and not prev:
            pulses += 1
        if on:
            angles.append(next(x for x in e.elements if x.kind == "25").angle)
        prev = on
    assert e.vals["SF"] and pulses >= 1
    assert min(angles) < 2.0                                      # sincroniza perto de 0° (compensado pelo tempo do disjuntor)


# ---------------------------------------------------------------- 32
def pwr(**over: str) -> RelayEngine:
    return make(**{"EPWR": "3P1", "3PWR1P": "200", "PWR1T": "+WATTS", "PWR1D": "0.10", **over})


def inject(e: RelayEngine, i_sec: float, ang: float) -> None:
    mag = i_sec * CTR
    e.set_sim({"ia_mag": mag, "ib_mag": mag, "ic_mag": mag, "ia_ang": ang, "ib_ang": ang - 120, "ic_ang": ang + 120})


def test_power_element_forward_and_reverse_watts():
    e = pwr()
    volts(e, 115.0)
    inject(e, 2.0, 0.0)                                           # P = 3·115·2 = 690 VA > 200
    run(e, 0.05)
    assert e.vals["3PWR1P"] and not e.vals["3PWR1T"]
    run(e, 0.2)
    assert e.vals["3PWR1T"]
    r = pwr(PWR1T="-WATTS")
    volts(r, 115.0)
    inject(r, 2.0, 0.0)
    run(r, 0.5)
    assert not r.vals["3PWR1P"]
    inject(r, 2.0, 180.0)                                         # potência reversa
    run(r, 0.5)
    assert r.vals["3PWR1P"] and r.vals["3PWR1T"]


def test_power_element_vars_undervoltage_block_and_disabled():
    v = pwr(PWR1T="+VARS")
    volts(v, 115.0)
    inject(v, 2.0, -90.0)                                         # corrente atrasada: Q positivo
    run(v, 0.5)
    assert v.vals["3PWR1T"]
    low = pwr()
    volts(low, 5.0)                                               # |VAB| < 20 V: supervisão bloqueia
    inject(low, 20.0, 0.0)
    run(low, 0.5)
    assert not low.vals["3PWR1P"]
    off = pwr(EPWR="N")
    volts(off, 115.0)
    inject(off, 2.0, 0.0)
    run(off, 0.5)
    assert not off.vals["3PWR1P"]
    two = make(**{"EPWR": "3P2", "3PWR2P": "100", "PWR2T": "-WATTS", "PWR2D": "0.0", "3PWR1P": "OFF"})
    volts(two, 115.0)
    inject(two, 2.0, 180.0)
    run(two, 0.3)
    assert two.vals["3PWR2P"] and two.vals["3PWR2T"] and not two.vals["3PWR1P"]


# ---------------------------------------------------------------- 593SRMS
def test_593srms_after_three_seconds():
    e = make(**{"E593SRMS": "Y", "593SRMSP": "100"})
    volts(e, 120.0)                                               # VAB ≈ 207,8 V
    run(e, 2.5)
    assert not e.vals["593SRMS1"]                                 # a média de 10 min só é atualizada a cada 3 s
    run(e, 0.7)
    assert e.vals["593SRMS1"] and e.vals["593SRMS2"] and e.vals["593SRMS3"]
