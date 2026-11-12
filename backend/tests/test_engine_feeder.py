"""Cenários de comportamento do padrão 'SEL751 - Alimentador v1.24'."""
from __future__ import annotations

from conftest import needs_rdb, run, tap

pytestmark = needs_rdb


def enable_protection(eng):
    eng.apply_setting("1", "50P1P", "10")      # 10 A sec. = 1200 A primários
    eng.apply_setting("1", "51P1P", "2")
    run(eng, 0.5)


def test_idle_state(feeder):
    run(feeder, 1)
    v = feeder.vals
    assert v["LT06"] == 1 and v["LT13"] == 1 and v["79RS"] == 1 and v["SH0"] == 1
    assert v["52A"] == 1 and v["TRIP"] == 0
    assert feeder.group == 1


def test_phase_fault_trips_opens_and_recloses(feeder):
    enable_protection(feeder)
    feeder.field.apply_fault("ABC", 3000, persistent=False)   # falta transitória
    run(feeder, 0.5)
    assert feeder.vals["50P1T"] == 0 or feeder.vals["TRIP"] == 1
    assert feeder.vals["TRIP"] == 1 and feeder.vals["OUT101"] == 1
    assert feeder.field.breaker.closed is False
    assert feeder.vals["52A"] == 0 and feeder.vals["79CY"] == 1
    assert feeder.panel.trip_led is True
    assert feeder.vals["FIA"] > 2900
    run(feeder, 1.5)
    assert feeder.vals["TRIP"] == 0            # TDURD = 1 s
    run(feeder, 10.5)                          # tempo morto 1 = 10 s
    assert feeder.field.breaker.closed is True and feeder.vals["SH1"] == 1
    run(feeder, 121)                           # reset do 79 (120 s)
    assert feeder.vals["79RS"] == 1 and feeder.vals["SH0"] == 1


def test_permanent_fault_ends_in_lockout_after_three_shots(feeder):
    enable_protection(feeder)
    feeder.field.apply_fault("AG", 2400, persistent=True)
    closes = []
    last = 1
    for _ in range(int(130 / 0.01)):
        feeder.step(0.01)
        if feeder.vals["CLOSE"] and not last:
            closes.append(round(feeder.t, 1))
        last = feeder.vals["CLOSE"]
        if feeder.vals["79LO"]:
            break
    assert feeder.vals["79LO"] == 1
    assert len(closes) == 3
    run(feeder, 0.3)                                   # o 4º disparo termina de abrir o disjuntor
    assert feeder.field.breaker.closed is False
    assert closes[1] - closes[0] > 20 and closes[2] - closes[1] > 60   # 20 s e 60 s + tempos de TRIP


def test_two_touch_open_command(feeder):
    run(feeder, 0.5)
    tap(feeder, 4)
    assert feeder.vals["LT04"] == 1 and feeder.field.breaker.closed is True     # 1º toque só arma
    tap(feeder, 4)
    run(feeder, 0.3)
    assert feeder.field.breaker.closed is False                                 # 2º toque abre
    assert feeder.vals["79LO"] == 1                                             # abertura por comando bloqueia o 79


def test_two_touch_times_out(feeder):
    run(feeder, 0.5)
    tap(feeder, 4)
    run(feeder, 5.3)
    assert feeder.vals["LT04"] == 0 and feeder.field.breaker.closed is True


def test_local_close_requires_local_mode_and_two_touches(feeder):
    run(feeder, 0.5)
    feeder.pulse("OC")
    run(feeder, 0.5)
    assert feeder.field.breaker.closed is False
    run(feeder, 2)
    tap(feeder, 4)
    tap(feeder, 4)
    run(feeder, 0.5)
    assert feeder.field.breaker.closed is False          # em Remoto o botão não fecha
    feeder.pulse("RB05")                                 # modo Local
    run(feeder, 0.2)
    assert feeder.vals["LT03"] == 1
    tap(feeder, 4)
    assert feeder.vals["LT05"] == 1
    tap(feeder, 4)
    run(feeder, 0.5)
    assert feeder.field.breaker.closed is True


def test_dnp_close_only_in_remote_mode(feeder):
    run(feeder, 0.5)
    feeder.pulse("OC")
    run(feeder, 2)
    feeder.pulse("RB05")                                 # Local
    run(feeder, 0.2)
    r = feeder.dnp.command(1, "PULSE_ON", "direct")      # BO_01 = CC
    assert r["status"] == "SUCCESS"
    run(feeder, 0.6)
    assert feeder.field.breaker.closed is False          # CC ignorado em Local
    feeder.pulse("RB06")                                 # Remoto
    run(feeder, 0.2)
    feeder.dnp.command(1, "PULSE_ON", "direct")
    run(feeder, 0.6)
    assert feeder.field.breaker.closed is True


def test_dnp_select_before_operate(feeder):
    run(feeder, 0.2)
    assert feeder.dnp.command(2, "PULSE_ON", "operate")["status"] == "NO_SELECT"
    assert feeder.dnp.command(2, "PULSE_ON", "select")["status"] == "SUCCESS"
    assert feeder.dnp.command(2, "PULSE_ON", "operate")["status"] == "SUCCESS"      # RB01
    run(feeder, 0.3)
    assert feeder.vals["LT01"] == 1                      # religamento bloqueado
    assert feeder.dnp.command(12, "PULSE_ON", "direct")["status"] == "NOT_SUPPORTED"
    assert feeder.dnp.command(99, "PULSE_ON", "direct")["status"] == "FORMAT_ERROR"
    assert feeder.dnp.command(2, "LATCH_OFF", "direct")["status"] == "NOT_SUPPORTED"


def test_dnp_point_descriptions(feeder):
    run(feeder, 0.2)
    snap = feeder.dnp.snapshot()
    bo = {p["name"]: p["desc"] for p in snap["bo"]}
    assert bo["OC"] == "COMANDO ABRIR" and bo["CC"] == "COMANDO FECHAR"
    assert bo["RB01"] == "BLOQUEIO 79" and bo["RB08"] == "GRUPO 2"
    ai = {p["name"]: p["desc"] for p in snap["ai"]}
    assert "Corrente fase A" in ai["IA_MAG"]


def test_dnp_binary_input_events_and_scaling(feeder):
    run(feeder, 0.5)
    snap = feeder.dnp.snapshot()
    ia = next(p for p in snap["ai"] if p["name"] == "IA_MAG")
    assert ia["raw"] == 1000 and ia["scale"] == 10.0                   # 100 A * 10
    seq = snap["last_seq"]
    feeder.pulse("RB03")                                               # bloqueio de neutro
    run(feeder, 0.5)
    snap = feeder.dnp.snapshot(seq)
    assert any(e["kind"] == "BI" and e["name"] == "LT02" and e["value"] == 1 for e in snap["events"])
    bi_lt02 = next(p for p in snap["bi"] if p["name"] == "LT02")
    assert bi_lt02["value"] == 1


def test_neutral_block_disables_neutral_elements(feeder):
    feeder.apply_setting("1", "51N1P", "1")
    feeder.apply_setting("1", "51N1TD", "0.1")
    cfg = feeder.field.cfg
    cfg.ia_mag = cfg.ib_mag = cfg.ic_mag = 0.0
    feeder.field.apply_fault("AG", 240, persistent=True)               # 2 A sec. residuais
    run(feeder, 0.2)
    assert feeder.vals["51N1P"] == 1
    feeder.field.clear_fault()
    run(feeder, 0.2)
    assert feeder.vals["51N1P"] == 0
    feeder.pulse("RB03")                                               # bloqueio de neutro
    run(feeder, 0.3)
    assert feeder.vals["LT02"] == 1
    feeder.field.apply_fault("AG", 240, persistent=True)
    run(feeder, 0.5)
    assert feeder.vals["51N1P"] == 0                                    # TC = NOT LT02


def test_group_change_after_tgr(feeder):
    run(feeder, 0.5)
    feeder.pulse("RB08")                                               # Grupo 2
    run(feeder, 1.0)
    assert feeder.vals["LT07"] == 1 and feeder.group == 1              # TGR = 3 s
    run(feeder, 3.0)
    assert feeder.group == 2 and feeder.vals["SG2"] == 1
    assert feeder.panel.snapshot()["pb"][4]["a"]["on"] is True         # LED do PB5 = Grupo 2


def test_breaker_opening_time_alarms(feeder):
    enable_protection(feeder)
    feeder.field.cfg.open_ms = 130.0
    feeder.field.apply_fault("ABC", 3000, persistent=False)
    run(feeder, 2.0)
    assert feeder.vals["LT19"] == 1 and feeder.vals["LT18"] == 0 and feeder.vals["LT20"] == 0


def test_breaker_too_slow_signals_breaker_failure(feeder):
    enable_protection(feeder)
    feeder.field.cfg.open_ms = 200.0
    feeder.field.apply_fault("ABC", 3000, persistent=False)
    run(feeder, 2.0)
    assert feeder.vals["SV16T"] == 1 or feeder.vals["LT15"] == 1
    assert feeder.vals["LT15"] == 1 and feeder.vals["LT20"] == 1


def test_coil_supervision_debounce(feeder):
    run(feeder, 0.5)
    feeder.set_input("IN302", False)
    run(feeder, 5)
    assert feeder.vals["IN302"] == 1                    # filtro de 10 s
    run(feeder, 5.5)
    assert feeder.vals["IN302"] == 0
    assert "FALHA BOBINA DE ABERTURA 1" in feeder.panel.lcd_points()


def test_front_panel_leds_and_target_reset(feeder):
    enable_protection(feeder)
    feeder.field.apply_fault("ABC", 3000, persistent=False)
    run(feeder, 1.0)
    snap = feeder.panel.snapshot()
    t1 = next(t for t in snap["targets"] if t["id"] == "T01")
    assert t1["on"] and snap["trip"]["on"]
    run(feeder, 12)                                       # falta já eliminada, LEDs retidos
    assert next(t for t in feeder.panel.snapshot()["targets"] if t["id"] == "T01")["on"]
    feeder.target_reset()
    run(feeder, 0.1)
    snap = feeder.panel.snapshot()
    assert not next(t for t in snap["targets"] if t["id"] == "T01")["on"] and not snap["trip"]["on"]


def test_state_snapshot_has_all_sections(feeder):
    run(feeder, 0.5)
    s = feeder.snapshot_state()
    for key in ("inputs", "outputs", "latches", "timers", "counters", "math", "protection", "recloser", "words",
                "analog", "unresolved"):
        assert key in s
    assert s["unresolved"] == []
    assert any(o["name"] == "OUT101" and o["role"] == "abertura" for o in s["outputs"])


def test_injected_phasors_drive_measurements(feeder):
    cfg = feeder.field.cfg
    cfg.ia_mag, cfg.ia_ang = 240.0, 30.0
    cfg.ib_mag, cfg.ib_ang = 120.0, -90.0
    cfg.ic_mag, cfg.ic_ang = 60.0, 150.0
    cfg.va_mag, cfg.va_ang = 4000.0, 10.0
    cfg.freq = 59.5
    run(feeder, 0.2)
    v = feeder.vals
    assert round(v["IA_MAG"]) == 240 and round(v["IA_ANG"]) == 30
    assert round(v["VA_MAG"]) == 4000 and round(v["VA_ANG"]) == 10
    assert v["FREQ"] == 59.5
    assert abs(feeder.meas["IA"] - 2.0) < 1e-6          # 240 A / CTR 120
    assert v["S"] > 0 and abs(v["P"]) > 0 and abs(v["Q"]) > 0


def test_breaker_input_manual_mode(feeder):
    run(feeder, 0.2)
    feeder.set_sim({"breaker_auto": False})
    feeder.set_input("IN101", False)                    # 52A "aberto" com o disjuntor fisicamente fechado
    run(feeder, 0.2)
    assert feeder.vals["IN101"] == 0 and feeder.field.breaker.closed is True
    assert feeder.vals["IA_MAG"] > 50                   # a corrente continua circulando
    feeder.set_sim({"breaker_auto": True})
    run(feeder, 0.2)
    assert feeder.vals["IN101"] == 1                    # volta a seguir o disjuntor


def test_outputs_snapshot(feeder):
    run(feeder, 0.2)
    outs = {o["name"]: o for o in feeder.snapshot_outputs()}
    assert outs["OUT302"]["value"] == 1                 # watchdog energizado
    assert outs["OUT101"]["role"] == "abertura" and outs["OUT103"]["role"] == "fechamento"


def test_analog_injection_switch(feeder):
    run(feeder, 0.2)
    assert feeder.vals["IA_MAG"] > 50 and feeder.vals["VA_MAG"] > 1000
    feeder.set_sim({"analog_on": False})
    run(feeder, 0.2)
    v = feeder.vals
    assert v["IA_MAG"] == 0 and v["VA_MAG"] == 0 and v["P"] == 0 and v["S"] == 0
    assert feeder.field.breaker.closed is True           # só as grandezas analógicas são desligadas
    feeder.set_sim({"analog_on": True})
    run(feeder, 0.2)
    assert feeder.vals["IA_MAG"] > 50 and feeder.vals["VA_MAG"] > 1000
