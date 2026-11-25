"""SEL-787 (proteção de transformador): diferencial 87, REF1 e 50/51 por enrolamento, com ajuste sintético."""
from __future__ import annotations

import math

from app.engine787 import Relay787Engine
from app.settings import RelaySettings

HEADER = "[INFO]\nRELAYTYPE=SEL-787-4\nFID=SEL-787-4-R000\n"

G1 = {
    "E87W1": "Y", "E87W2": "Y", "E87W3": "N", "E87W4": "N", "CTR1": "100", "CTR2": "400", "INOM1": "5", "INOM2": "5",
    "MVA": "OFF", "W1CTC": "0", "W2CTC": "0", "TAP1": "3", "TAP2": "3", "VWDG1": "69", "VWDG2": "13.8", "CTRN1": "100", "INOMN1": "5",
    "O87P": "0.3", "87AP": "0.15", "87AD": "0.1", "SLP1": "25", "SLP2": "60", "IRS1": "6", "U87P": "10", "PCT2": "15", "PCT4": "15",
    "PCT5": "35", "TH5P": "0.5", "TH5D": "0.05", "HRSTR": "N", "HBLK": "Y",
    "REF1POL": "OFF", "REF1TC": "1", "50REF1P": "0.25", "REF1BYP": "N",
    "50P11P": "OFF", "50P11D": "0", "50P11TC": "1", "50G11P": "OFF", "50G11D": "0", "50G11TC": "1",
    "50Q11P": "OFF", "50Q11D": "0.1", "50Q11TC": "1", "50N11P": "OFF", "50N11D": "0", "50N11TC": "1",
    "51P1P": "OFF", "51P1C": "U3", "51P1TD": "1", "51P1RS": "N", "51P1CT": "0", "51P1MR": "0", "51P1TC": "1",
    "TR1": "50P11T OR 51P1T OR 50G11T", "TR2": "0", "TR3": "0", "TR4": "0", "TRXFMR": "87R OR 87U OR REF1F",
    "ULTRIP1": "1", "ULTRIP2": "1", "ULTRIP3": "1", "ULTRIP4": "1", "ULTRXFMR": "1", "TDURD": "0.5", "REMTRIP": "0",
    "52A1": "0", "52A2": "0", "52A3": "0", "52A4": "0", "CL1": "0", "CL2": "0", "ULCL1": "0", "ULCL2": "0",
}


def make(g1: dict | None = None) -> Relay787Engine:
    g = dict(G1)
    g.update(g1 or {})
    one = "".join(f'{k},"{v}"\n' for k, v in g.items())
    logic = 'ELAT,"0"\nESV,"0"\nESC,"N"\nEMV,"0"\nOUT401,"TRIP1 OR TRIPXFMR"\nOUT402,"TRIP2 OR TRIPXFMR"\nOUT103,"87R OR 87U"\n'
    files = {
        "Relays/T/set_1.txt": HEADER + "[1]\n" + one,
        "Relays/T/set_G.txt": HEADER + '[G]\nFNOM,"60"\nTGR,"3"\nSS1,"1"\nSS2,"0"\nSS3,"0"\nSS4,"0"\nFAULT,"TRIPXFMR"\n',
        "Relays/T/set_L1.txt": HEADER + "[L1]\n" + logic,
        "Relays/T/set_R.txt": HEADER + '[R]\nSER1,"87R,87U,TRIPXFMR"\nER,"0"\n',
    }
    eng = Relay787Engine(RelaySettings.from_files(files), device_name="787 teste")
    eng.set_sim({"analog_on": True})
    return eng


def run(eng, s: float, dt: float = 0.004) -> None:
    for _ in range(int(round(s / dt))):
        eng.step(dt)


def scale(eng, w1: float = 1.0, w2: float = 1.0) -> None:
    c = eng.field.cfg
    for p in "abc":
        setattr(c, f"i{p}_mag", getattr(c, f"i{p}_mag") * w1)
        setattr(c, f"w2i{p}_mag", getattr(c, f"w2i{p}_mag") * w2)


def diff(eng):
    return next(e for e in eng.elements if e.kind == "87")


def test_model_and_through_load():
    eng = make()
    assert eng.model == "787"
    run(eng, 1.0)
    d = diff(eng)
    assert all(x < 1e-6 for x in d.iop)                     # carga passante: diferencial nulo
    assert all(abs(x - 2.0) < 1e-6 for x in d.irt)          # restrição = soma dos módulos = 2 pu
    assert eng.vals["87R"] == 0 and eng.vals["TRIPXFMR"] == 0


def test_tap_from_mva_and_ctc_shift():
    eng = make({"MVA": "30", "VWDG1": "138", "VWDG2": "13.8", "CTR1": "40", "CTR2": "400", "W1CTC": "11", "W2CTC": "0"})
    taps = diff(eng).tap
    assert abs(taps[1] - 3.14) < 0.01 and abs(taps[2] - 3.14) < 0.01     # exemplo do manual (30 MVA, 138/13,8 kV)
    run(eng, 1.0)
    assert max(diff(eng).iop) < 1e-3                       # corrente de W2 inicial já compensada (CTC 11 × 0)


def test_internal_fault_trips_87r_and_opens_both_breakers():
    eng = make()
    run(eng, 0.5)
    scale(eng, w1=4.0, w2=0.0)                              # falta interna: só entra corrente por W1
    run(eng, 0.05)
    assert eng.vals["87R"] == 1 and eng.vals["TRIPXFMR"] == 1
    assert eng.vals["OUT401"] == 1 and eng.vals["OUT402"] == 1 and eng.vals["OUT103"] == 1
    run(eng, 0.3)
    assert not eng.field.breaker.closed and not eng.wfield(2).breaker.closed
    assert eng.field.breaker.open_count == 1


def test_external_fault_restrained_and_unrestrained_87u():
    eng = make()
    run(eng, 0.5)
    scale(eng, w1=8.0, w2=6.8)                              # falta passante com erro de TC (saturação): IOP 1,2 < característica
    run(eng, 0.05)
    d = diff(eng)
    assert d.iop[0] > 1.0 and eng.vals["87R"] == 0
    scale(eng, w1=3.0, w2=0.0)                              # sobe muito: IOP > U87P (10 pu) → 87U sem restrição
    run(eng, 0.03)
    assert eng.vals["87U"] == 1


def test_second_harmonic_blocks_and_fifth_alarm():
    eng = make()
    run(eng, 0.5)
    scale(eng, w1=3.0, w2=0.0)
    eng.set_sim({"h2_pct": 30.0})
    run(eng, 0.05)
    assert eng.vals["2_4HB1"] == 1 and eng.vals["87BL1"] == 1
    assert eng.vals["87R"] == 0 and eng.vals["TRIPXFMR"] == 0     # bloqueio comum (HBLK = Y)
    eng.set_sim({"h2_pct": 0.0, "h5_pct": 40.0})
    run(eng, 0.05)
    assert eng.vals["5HB1"] == 1 and eng.vals["87R"] == 0 and eng.vals["TH5P"] == 1
    run(eng, 0.1)
    assert eng.vals["TH5T"] == 1                                   # alarme de 5ª harmônica após TH5D


def test_differential_alarm_87at():
    eng = make()
    run(eng, 0.5)
    scale(eng, w1=1.0, w2=0.8)                              # IOP = 0,2 pu: abaixo de O87P (0,3) e acima de 87AP (0,15)
    run(eng, 0.05)
    assert eng.vals["87AP"] == 1 and eng.vals["87R"] == 0
    run(eng, 0.15)
    assert eng.vals["87AT"] == 1


def test_inrush_high_security_uses_slope2():
    eng = make({"HBLK": "N", "HRSTR": "Y", "O87P": "0.3"})
    scale(eng, w1=0.0, w2=0.0)                              # transformador desenergizado
    run(eng, 0.5)
    d = diff(eng)
    assert all(d.inr)                                       # INRn: alta segurança
    c = eng.field.cfg
    for p in "abc":
        setattr(c, f"i{p}_mag", 3.0 * 100)                  # energização por W1: IOP = IRT = 3 pu → característica com SLP2 (60 %) = 1,8
    run(eng, 0.05)
    assert all(d.inr) and abs(d.curve_point(3.0) - 0.75) < 1e-6   # SLP1 = 25 % (sem INR); com INR o limiar é 0,6 × 3
    assert eng.vals["INR1"] == 1


def test_overcurrent_per_winding():
    eng = make({"50P11P": "6", "50P11D": "0.1", "50G11P": "OFF", "50Q11P": "OFF", "50P21P": "8", "50P21D": "0", "50P21TC": "1",
                "E87W1": "N", "E87W2": "N", "TRXFMR": "0"})
    run(eng, 0.5)
    assert eng.vals["50P11P"] == 0
    eng.set_sim({"ia_mag": 800.0, "ib_mag": 800.0, "ic_mag": 800.0})   # 8 A sec. em W1 (CTR 100)
    run(eng, 0.05)
    assert eng.vals["50P11P"] == 1 and eng.vals["50P11T"] == 0 and eng.vals["50P11AP"] == 1
    run(eng, 0.1)
    assert eng.vals["50P11T"] == 1 and eng.vals["TRIP1"] == 1


def test_time_overcurrent_51_and_neutral():
    eng = make({"E87W1": "N", "E87W2": "N", "TRXFMR": "0", "51P1P": "2", "51P1C": "C1", "51P1TD": "0.5"})
    run(eng, 0.5)
    scale(eng, w1=0.0, w2=0.0)
    run(eng, 0.2)                                                      # a carga inicial já excedia o pickup: deixa o elemento resetar
    eng.set_sim({"ia_mag": 600.0, "ib_mag": 600.0, "ic_mag": 600.0})   # 6 A sec. = 3 × pickup
    run(eng, 0.05)
    el = next(e for e in eng.elements if e.base == "51P1")
    assert eng.vals["51P1P"] == 1 and abs(el.multiple - 3.0) < 1e-6
    t_expected = 0.5 * 0.14 / (3.0 ** 0.02 - 1.0)
    run(eng, t_expected - 0.2)
    assert eng.vals["51P1T"] == 0 and eng.vals["TRIP1"] == 0
    run(eng, 0.3)
    assert eng.vals["TRIP1"] == 1 and eng.vals["OUT401"] == 1       # a partir do disparo o disjuntor abre e a corrente cai


def test_ref1_internal_and_external():
    eng = make({"E87W1": "N", "E87W2": "N", "TRXFMR": "0", "REF1POL": "2", "50REF1P": "0.25", "REF1BYP": "N"})
    run(eng, 0.5)
    c = eng.field.cfg
    for p in "abc":
        setattr(c, f"i{p}_mag", 0.0)
        setattr(c, f"w2i{p}_mag", 0.0)
    # falta à terra interna: corrente residual em W2 (3I0 = 400 A prim.) e neutro em fase (IN1: 400 A / CTRN1 100 = 4 A sec.)
    c.w2ia_mag, c.w2ia_ang = 400.0, 0.0
    c.in1_mag, c.in1_ang = 400.0, 0.0
    run(eng, 0.1)
    assert eng.vals["REF1F"] == 1 and eng.vals["REF1R"] == 0 and eng.vals["REFTQ1"] > 0
    run(eng, 1.0)
    assert eng.vals["REF1P"] == 1                                  # tempo inverso U4 após o REF1F
    c.in1_ang = 180.0                                              # falta externa: neutro oposto à polarização
    run(eng, 0.1)
    assert eng.vals["REF1F"] == 0 and eng.vals["REF1R"] == 1


def test_local_default_inputs_and_unresolved_clean():
    eng = make()
    run(eng, 0.2)
    assert not eng.unresolved - {"DRDOPT"}
    assert math.isclose(eng.meas["W1_IMAX"], 3.0, rel_tol=1e-6)


def test_export_json_includes_edits():
    """Exportação do IED: ajustes atuais (com edições), lista de alterados, arquivos originais e estado da simulação."""
    from fastapi.testclient import TestClient

    from app.main import app, manager
    from app.rdb import RdbRelay

    one = "".join(f'{k},"{v}"\n' for k, v in G1.items())
    files = {"set_1.txt": HEADER + "[1]\n" + one, "set_L1.txt": HEADER + '[L1]\nELAT,"0"\nESV,"0"\nOUT401,"TRIP1 OR TRIPXFMR"\n',
             "Misc/Device.txt": "787 exportacao"}
    sess = manager.create(RdbRelay(id="787X", name="787 exportacao", files=files), "teste.rdb")
    try:
        c = TestClient(app)
        assert c.patch(f"/api/sessions/{sess.id}/settings", json={"cls": "1", "key": "O87P", "value": "0.5"}).status_code == 200
        j = c.get(f"/api/sessions/{sess.id}/export").json()
        assert j["format"] == "eclipse-digitalrelay" and j["model"] == "787"
        assert j["settings"]["1"]["O87P"] == "0.5" and ["1", "O87P"] in j["modified"]
        assert '"0.3"' in j["original_files"]["set_1.txt"]                  # arquivo original preservado
        assert "injection" in j["simulation"] and j["simulation"]["group"] == 1
        # importação: recria o IED com a edição e o estado
        j["simulation"]["injection"]["in1_mag"] = 123.0
        j["simulation"]["forced"] = {"OUT401": 1.0}
        r = c.post("/api/sessions/import", json=j)
        assert r.status_code == 200, r.text
        info = r.json()
        try:
            eng2 = manager.get(info["id"]).engine
            assert info["model"] == "787" and info["warnings"] == []
            assert eng2.settings.get("1", "O87P") == "0.5" and ("1", "O87P") in eng2.settings.modified
            assert eng2.field.cfg.in1_mag == 123.0 and eng2.forced == {"OUT401": 1.0}
        finally:
            manager.delete(info["id"])
        assert c.post("/api/sessions/import", json={"format": "outro"}).status_code == 400
    finally:
        manager.delete(sess.id)
