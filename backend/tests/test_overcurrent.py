"""Elementos 50 (instantâneo/tempo definido) e 51 (tempo inverso) conforme o manual do SEL-751.

Usa um ajuste sintético (não depende do .rdb de exemplo). CTR = 100, então 1 A sec. = 100 A prim.
"""
from __future__ import annotations

import pytest

from conftest import run

from app import curves
from app.engine import RelayEngine
from app.settings import RelaySettings

BASE = {
    "CTR": "100", "CTRN": "100", "PTR": "60", "VNOM": "115",
    "50P1P": "OFF", "50P1D": "0.00", "50P1TC": "1",
    "50P2P": "OFF", "50P2D": "0.10", "50P2TC": "1",
    "50N1P": "OFF", "50N1D": "0.50", "50N1TC": "1",
    "50G1P": "OFF", "50G1D": "0.50", "50G1TC": "1",
    "50Q1P": "OFF", "50Q1D": "0.20", "50Q1TC": "1",
    "51AP": "OFF", "51AC": "U3", "51ATD": "3.00", "51ARS": "N", "51ACT": "0.00", "51AMR": "0.00", "51ATC": "1",
    "51P1P": "OFF", "51P1C": "C1", "51P1TD": "1.00", "51P1RS": "N", "51P1CT": "0.00", "51P1MR": "0.00", "51P1TC": "1",
    "51QP": "OFF", "51QC": "U3", "51QTD": "3.00", "51QRS": "N", "51QCT": "0.00", "51QMR": "0.00", "51QTC": "1",
    "51N1P": "OFF", "51N1C": "C1", "51N1TD": "1.00", "51N1RS": "N", "51N1CT": "0.00", "51N1MR": "0.00", "51N1TC": "1",
    "51G1P": "OFF", "51G1C": "C1", "51G1TD": "1.00", "51G1RS": "N", "51G1CT": "0.00", "51G1MR": "0.00", "51G1TC": "1",
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


def load(eng: RelayEngine, ia: float, ib: float | None = None, ic: float | None = None) -> None:
    """Corrente de fase em ampères primários (ângulos balanceados)."""
    ib = ia if ib is None else ib
    ic = ia if ic is None else ic
    eng.set_sim({"ia_mag": ia, "ib_mag": ib, "ic_mag": ic, "analog_on": True})


def bit(eng: RelayEngine, name: str) -> bool:
    return bool(eng.vals[name])


def timeout(eng: RelayEngine, name: str, limit: float = 60.0, dt: float = 0.01) -> float:
    """Tempo simulado até o bit subir (inf se não subir em ``limit``)."""
    t = 0.0
    while t < limit:
        eng.step(dt)
        t += dt
        if eng.vals[name]:
            return t
    return float("inf")


# ------------------------------------------------------------------ curvas
@pytest.mark.parametrize("curve,m,expected", [
    ("U1", 2.0, 0.0226 + 0.0104 / (2 ** 0.02 - 1)),
    ("U3", 5.0, 0.0963 + 3.88 / 24),
    ("C1", 10.0, 0.14 / (10 ** 0.02 - 1)),
    ("C2", 3.0, 13.5 / 2),
    ("C4", 3.0, 120 / 2),
    ("E1", 4.0, 0.1140 + 0.0515 / (4 ** 0.02 - 1)),
    ("E3", 2.0, 0.1217 + 28.2 / 3),
])
def test_operate_time_equations(curve, m, expected):
    assert curves.operate_time(curve, m, 1.0) == pytest.approx(expected)
    assert curves.operate_time(curve, m, 2.5) == pytest.approx(2.5 * expected)


def test_operate_time_is_inf_at_or_below_pickup():
    assert curves.operate_time("U3", 1.0, 1.0) == float("inf")
    assert curves.operate_time("U3", 0.5, 1.0) == float("inf")


def test_saturation_above_30_times_pickup():
    assert curves.operate_time("C1", 100.0, 1.0, saturate=True) == pytest.approx(curves.operate_time("C1", 30.0, 1.0))
    assert curves.operate_time("C1", 100.0, 1.0, saturate=False) < curves.operate_time("C1", 30.0, 1.0)


@pytest.mark.parametrize("curve,m,expected", [
    ("U2", 0.0, 5.95), ("U3", 0.5, 3.88 / 0.75), ("C2", 0.0, 47.3), ("C4", 0.5, 120 / 0.5), ("E2", 0.0, 21.6),
])
def test_reset_time_equations(curve, m, expected):
    assert curves.reset_time(curve, 1.0, m) == pytest.approx(expected)


# ------------------------------------------------------------------ 50
def test_instantaneous_pickup_and_trip_bits():
    eng = make(**{"50P1P": "5.00"})   # 500 A primários
    load(eng, 400.0)
    run(eng, 0.1)
    assert not bit(eng, "50P1P") and not bit(eng, "50P1T")
    load(eng, 600.0, 0.0, 0.0)
    run(eng, 0.05)
    assert bit(eng, "50P1P") and bit(eng, "50P1T")      # atraso 0
    assert bit(eng, "50A1P") and not bit(eng, "50B1P") and not bit(eng, "50C1P")
    assert bit(eng, "ORED50T")


def test_instantaneous_definite_time_delay():
    eng = make(**{"50P2P": "5.00"})    # 50P2D = 0,10 s
    load(eng, 600.0)
    run(eng, 0.05)
    assert bit(eng, "50P2P") and not bit(eng, "50P2T")
    assert all(bit(eng, f"50{p}2P") for p in "ABC")
    run(eng, 0.1)
    assert bit(eng, "50P2T") and bit(eng, "ORED50T")


def test_instantaneous_drops_below_95_percent():
    eng = make(**{"50P1P": "5.00"})
    load(eng, 600.0, 0.0, 0.0)
    run(eng, 0.05)
    load(eng, 490.0, 0.0, 0.0)          # entre 95 % e 100 %: mantém
    run(eng, 0.05)
    assert bit(eng, "50P1P")
    load(eng, 400.0, 0.0, 0.0)
    run(eng, 0.05)
    assert not bit(eng, "50P1P") and not bit(eng, "50A1P") and not bit(eng, "ORED50T")


def test_instantaneous_delay_off_disables_element():
    eng = make(**{"50P1P": "5.00", "50P1D": "OFF"})
    load(eng, 900.0)
    run(eng, 1.0)
    assert not bit(eng, "50P1P") and not bit(eng, "50P1T")


def test_instantaneous_torque_control():
    eng = make(**{"50P1P": "5.00", "50P1TC": "0"})
    load(eng, 900.0)
    run(eng, 0.2)
    assert not bit(eng, "50P1P") and not bit(eng, "50A1P")


def test_ground_neutral_and_negative_sequence_instantaneous():
    eng = make(**{"50N1P": "2.00", "50G1P": "2.00", "50Q1P": "2.00"})
    eng.set_sim({"ia_mag": 500.0, "ib_mag": 0.0, "ic_mag": 0.0, "analog_on": True})    # só fase A: 5 A sec. em IN, IG e 3I2
    run(eng, 0.1)
    assert bit(eng, "50N1P") and bit(eng, "50G1P") and bit(eng, "50Q1P")
    assert not bit(eng, "50N1T") and not bit(eng, "50Q1T")
    run(eng, 0.6)
    assert bit(eng, "50N1T") and bit(eng, "50G1T") and bit(eng, "50Q1T")


def test_balanced_load_has_no_neutral_or_negative_sequence():
    eng = make(**{"50N1P": "0.25", "50G1P": "0.25", "50Q1P": "0.25"})
    eng.field.set_balanced_load(500.0)
    eng.set_sim({"analog_on": True})
    run(eng, 0.5)
    assert not bit(eng, "50N1P") and not bit(eng, "50G1P") and not bit(eng, "50Q1P")


# ------------------------------------------------------------------ 51
def test_time_overcurrent_times_out_per_curve():
    eng = make(**{"51P1P": "2.00"})            # 200 A prim., curva C1, TD 1
    load(eng, 600.0, 0.0, 0.0)                 # M = 3
    expected = curves.operate_time("C1", 3.0, 1.0)
    t = timeout(eng, "51P1T")
    assert bit(eng, "51P1P") and bit(eng, "ORED51T")
    assert t == pytest.approx(expected, abs=0.03)


def test_time_overcurrent_no_pickup_at_or_below_setting():
    eng = make(**{"51P1P": "2.00"})
    load(eng, 190.0, 0.0, 0.0)
    run(eng, 5.0)
    assert not bit(eng, "51P1P") and not bit(eng, "51P1T")


def test_phase_elements_follow_their_phase():
    eng = make(**{"51AP": "2.00"})             # curva U3, TD 3
    load(eng, 0.0, 900.0, 900.0)               # B e C carregadas, A zerada
    run(eng, 2.0)
    assert not bit(eng, "51AP") and not bit(eng, "51AT")
    load(eng, 600.0, 0.0, 0.0)
    expected = curves.operate_time("U3", 3.0, 3.0)
    t = timeout(eng, "51AT")
    assert bit(eng, "51AP")
    assert t == pytest.approx(expected, abs=0.03)


def test_higher_current_trips_faster():
    slow = make(**{"51P1P": "2.00"})
    fast = make(**{"51P1P": "2.00"})
    load(slow, 400.0, 0.0, 0.0)
    load(fast, 1600.0, 0.0, 0.0)
    assert timeout(fast, "51P1T") < timeout(slow, "51P1T")


def test_constant_time_adder_and_minimum_response():
    eng = make(**{"51P1P": "2.00", "51P1CT": "0.50"})
    load(eng, 600.0, 0.0, 0.0)
    assert timeout(eng, "51P1T") == pytest.approx(curves.operate_time("C1", 3.0, 1.0) + 0.5, abs=0.03)
    eng = make(**{"51P1P": "2.00", "51P1MR": "5.00"})   # piso de 5 s (curva dá ~7 s a M = 3, 4,8 s a M = 5)
    load(eng, 1000.0, 0.0, 0.0)
    assert timeout(eng, "51P1T") == pytest.approx(5.0, abs=0.03)


def test_reset_after_one_cycle_when_em_reset_is_n():
    eng = make(**{"51P1P": "2.00"})
    load(eng, 600.0, 0.0, 0.0)
    run(eng, 3.0)                                  # ~ metade do disco
    assert not bit(eng, "51P1T") and not bit(eng, "51P1R")
    load(eng, 0.0, 0.0, 0.0)
    run(eng, 0.1)
    assert not bit(eng, "51P1P") and bit(eng, "51P1R")   # rearmou (1 ciclo)
    load(eng, 600.0, 0.0, 0.0)
    assert timeout(eng, "51P1T") == pytest.approx(curves.operate_time("C1", 3.0, 1.0), abs=0.03)


def test_electromechanical_reset_keeps_integration():
    eng = make(**{"51P1P": "2.00", "51P1RS": "Y"})
    full = curves.operate_time("C1", 3.0, 1.0)
    load(eng, 600.0, 0.0, 0.0)
    run(eng, full / 2)
    load(eng, 0.0, 0.0, 0.0)
    run(eng, 0.5)                                  # reset total levaria 13,5 s
    assert not bit(eng, "51P1R")
    load(eng, 600.0, 0.0, 0.0)
    assert timeout(eng, "51P1T") < full * 0.55     # retoma de onde parou, não do zero


def test_torque_control_blocks_51():
    eng = make(**{"51P1P": "2.00", "51P1TC": "0"})
    load(eng, 3000.0)
    run(eng, 3.0)
    assert not bit(eng, "51P1P") and not bit(eng, "51P1T")


def test_negative_sequence_neutral_and_residual_time_elements():
    eng = make(**{"51QP": "1.00", "51N1P": "1.00", "51G1P": "1.00"})
    eng.set_sim({"ia_mag": 500.0, "ib_mag": 0.0, "ic_mag": 0.0, "analog_on": True})
    run(eng, 0.1)
    assert bit(eng, "51QP") and bit(eng, "51N1P") and bit(eng, "51G1P")
    t = 0.1 + timeout(eng, "51N1T")     # 0,1 s já simulados antes
    assert t == pytest.approx(curves.operate_time("C1", 5.0, 1.0), abs=0.03)


def test_breaker_open_means_no_overcurrent():
    eng = make(**{"50P1P": "5.00", "51P1P": "2.00"})
    load(eng, 900.0)
    eng.field.force_position(False)
    run(eng, 0.3)
    assert not bit(eng, "50P1P") and not bit(eng, "51P1P")


def test_analog_switch_off_stops_elements():
    eng = make(**{"50P1P": "5.00"})
    load(eng, 900.0)
    run(eng, 0.1)
    assert bit(eng, "50P1P")
    eng.set_sim({"analog_on": False})
    run(eng, 0.1)
    assert not bit(eng, "50P1P")


def test_ored_bits_and_snapshot():
    eng = make(**{"50P1P": "5.00", "51P1P": "2.00"})
    load(eng, 600.0, 0.0, 0.0)
    run(eng, 0.1)
    assert bit(eng, "ORED50T") and not bit(eng, "ORED51T")
    els = {e["name"]: e for e in eng.snapshot_state()["protection"]["elements"]}
    assert els["50P1"]["pk"] and els["51P1"]["multiple"] == pytest.approx(3.0, abs=0.01)
    assert els["51P1"]["t_op"] == pytest.approx(curves.operate_time("C1", 3.0, 1.0), abs=0.01)
    assert eng.snapshot_state()["unresolved"] == []


def test_analog_off_when_digital_output_operates():
    items = dict(BASE, **{"50P1P": "5.00"})
    body = "\n".join(f'{k},"{v}"' for k, v in items.items())
    rs = RelaySettings.from_files({
        "Relays/T/set_1.txt": f"[1]\n{body}\n",
        "Relays/T/set_G.txt": '[G]\nFNOM,"60"\n51SAT,"Y"\n',
        "Relays/T/set_L1.txt": '[L1]\nOUT102,"50P1T"\n',
    })
    eng = RelayEngine(rs, device_name="teste")
    eng.set_sim({"analog_off_on_output": True})
    load(eng, 900.0)
    run(eng, 0.2)
    assert not eng.field.cfg.analog_on     # a saída atuou e desligou a injeção
    assert not bit(eng, "50P1P") and not bit(eng, "OUT102")   # sem corrente, a saída volta a cair
    eng.set_sim({"analog_on": True})        # o usuário religa; a saída atua de novo e desliga outra vez
    run(eng, 0.3)
    assert not eng.field.cfg.analog_on

    off = RelayEngine(rs, device_name="teste")   # opção desligada (padrão): nada muda
    load(off, 900.0)
    run(off, 0.3)
    assert bit(off, "OUT102") and off.field.cfg.analog_on


def test_analog_off_only_for_selected_outputs():
    items = dict(BASE, **{"50P1P": "5.00", "50P1D": "0.30"})
    body = "\n".join(f'{k},"{v}"' for k, v in items.items())
    rs = RelaySettings.from_files({
        "Relays/T/set_1.txt": f"[1]\n{body}\n",
        "Relays/T/set_G.txt": '[G]\nFNOM,"60"\n',
        "Relays/T/set_L1.txt": '[L1]\nOUT101,"50P1P"\nOUT102,"50P1T"\n',
    })
    eng = RelayEngine(rs, device_name="teste")
    eng.set_sim({"analog_off_on_output": True, "analog_off_outputs": ["out102", "XYZ"]})
    assert eng.field.cfg.analog_off_outputs == ["OUT102"]
    load(eng, 900.0)
    run(eng, 0.2)
    assert bit(eng, "OUT101") and eng.field.cfg.analog_on        # OUT101 atuou, mas não está na lista
    run(eng, 0.2)
    assert not eng.field.cfg.analog_on                           # OUT102 atuou e desligou a injeção


def test_analog_off_waits_for_breaker_to_open_on_trip_coil():
    """Com a opção ligada, a corrente persiste durante o tempo de abertura (supervisão de tempo de abertura)."""
    items = dict(BASE, **{"50P1P": "5.00", "TR": "50P1T"})
    body = "\n".join(f'{k},"{v}"' for k, v in items.items())
    rs = RelaySettings.from_files({
        "Relays/T/set_1.txt": f"[1]\n{body}\n",
        "Relays/T/set_G.txt": '[G]\nFNOM,"60"\nTR,"50P1T"\n',
        "Relays/T/set_L1.txt": '[L1]\nOUT101,"TRIP"\n',
    })
    eng = RelayEngine(rs, device_name="teste")
    assert "OUT101" in eng.trip_outs
    eng.field.cfg.open_ms = 120.0
    eng.set_sim({"analog_off_on_output": True})
    load(eng, 900.0)
    t = 0.0
    while not bit(eng, "OUT101") and t < 1.0:
        eng.step(0.004); t += 0.004
    assert bit(eng, "OUT101")
    for _ in range(int(0.08 / 0.004)):            # 80 ms depois do TRIP: disjuntor ainda fechado
        eng.step(0.004)
    assert eng.field.breaker.closed and eng.field.cfg.analog_on and bit(eng, "50P1P")
    for _ in range(int(0.1 / 0.004)):             # o disjuntor abre e só então a injeção é cortada
        eng.step(0.004)
    assert not eng.field.breaker.closed and not eng.field.cfg.analog_on
