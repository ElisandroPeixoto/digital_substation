"""SEL-311C (linha de transmissão): distância, sobrecorrente, direcionais, disparo/religamento, painel e DNP.

Ajuste sintético (não depende do .rdb) e, quando existe, o arquivo de referência ``Padrões SEL-311C.rdb`` da raiz.
"""
from __future__ import annotations

import cmath
import math
from pathlib import Path

import pytest

from app.engine311c import Relay311CEngine
from app.selogic import Expr
from app.settings import RelaySettings

ROOT = Path(__file__).resolve().parents[2]
RDB_311C = ROOT / "Padrões SEL-311C.rdb"
needs_rdb = pytest.mark.skipif(not RDB_311C.exists(), reason="Padrões SEL-311C.rdb ausente")

HEADER = "[INFO]\nRELAYTYPE=SEL-311C-1\nFID=SEL-311C-1-R000\n"

G1 = {
    "CTR": "120", "CTRN": "120", "PTR": "600", "PTRS": "600", "VNOM": "66.40", "Z1MAG": "7.80", "Z1ANG": "84.00",
    "Z0MAG": "24.80", "Z0ANG": "81.50", "LL": "100.00", "E21P": "3", "E21MG": "N", "E21XG": "3", "E50P": "1", "E50G": "1",
    "E50Q": "N", "E51P": "Y", "E51G": "Y", "E51Q": "N", "E32": "AUTO", "ELOAD": "N", "ESOTF": "N", "EVOLT": "N", "EFLOC": "Y",
    "E79": "1", "ESV": "4", "TDURD": "9.00", "CFD": "60.00", "3POD": "0.50", "OPO": "52", "50LP": "0.25",
    "Z1P": "6.24", "Z2P": "9.36", "Z3P": "1.87", "50PP1": "0.50", "50PP2": "0.50", "50PP3": "0.50",
    "RG1": "2.50", "RG2": "5.00", "RG3": "6.00", "TANG": "-3.0", "XG1": "6.24", "XG2": "9.36", "XG3": "1.87", "XGPOL": "I2",
    "50L1": "0.50", "50L2": "0.50", "50L3": "0.50", "50GZ1": "0.50", "50GZ2": "0.50", "50GZ3": "0.50",
    "k0M1": "0.726", "k0A1": "-3.69", "Z1PD": "0.00", "Z2PD": "20.00", "Z3PD": "OFF", "Z1GD": "0.00", "Z2GD": "20.00", "Z3GD": "OFF",
    "Z1D": "OFF", "Z2D": "OFF", "Z3D": "OFF", "50P1P": "OFF", "67P1D": "0.00", "50G1P": "OFF", "67G1D": "0.00",
    "51PC": "C1", "51PP": "OFF", "51PRS": "N", "51PTD": "0.05", "51GC": "C1", "51GP": "OFF", "51GRS": "N", "51GTD": "0.50",
    "50GFP": "0.50", "50GRP": "0.25", "50QFP": "0.50", "50QRP": "0.25", "a0": "0.10", "a2": "0.10", "k2": "0.20",
    "DIR3": "R", "DIR4": "F", "ELOP": "Y", "ORDER": "QV", "Z0F": "12.40", "Z0R": "12.60", "Z2F": "3.90", "Z2R": "4.10",
    "79OI1": "60.00", "79RSD": "600.00", "79RSLD": "300.00",
    "SV1PU": "0.00", "SV1DO": "60.00", "SV2PU": "30.00", "SV2DO": "0.00", "SV3PU": "0.00", "SV3DO": "0.00", "SV4PU": "0.00", "SV4DO": "0.00",
}

L1 = {
    "TR": "M1PT+M2PT+Z1GT+Z2GT+67P1T+67G1T+51PT+51GT", "TRCOMM": "0", "TRSOTF": "0", "DTT": "0",
    "ULTR": "!(M1P+M2P+Z1G+Z2G+50P1+50G1+51P+51G)", "52A": "IN101", "CL": "CC+/PB9PUL", "ULCL": "TRIP",
    "79RI": "TRIP", "79RIS": "52A+79CY", "79DTL": "LT1", "79STL": "TRIP", "79BRS": "0", "79CLS": "1",
    "SET1": "PB1PUL+LB3", "RST1": "PB2PUL+LB4", "SET2": "RB1", "RST2": "RB2",
    "67P1TC": "1", "67G1TC": "32GF", "51PTC": "(M1P+M2P)*!LOP", "51GTC": "32GF",
    "LV1": "50P1+50G1", "SV1": "OC+LB7", "SV2": "IN102", "SV3": "LV1", "SV4": "0",
    "OUT101": "TRIP", "OUT102": "SV1T", "OUT103": "CLOSE", "ALRMOUT": "!LV3", "LV3": "!HALARM",
    "LED1": "LT1", "LED2": "!LT1", "LED9": "52A", "LED10": "!52A", "LED12": "LTRIP", "LED13": "LTIME", "LED18": "L51",
    "LED23": "LZONE1", "LED24": "LZONE2", "SS1": "1", "SS2": "0", "ER": "/TRIP", "FAULT": "M1P+Z1G", "E32IV": "1",
    "DP1": "1", "DP2": "IN102",
}

G = {"NFREQ": "60", "PTCONN": "WYE", "TGR": "180.00", "DCLOP": "100.00", "DCHIP": "140.00", "RSTLED": "Y", "IN101D": "2.00",
     "IN102D": "2.00", "LED12A": "TRIP", "LED12L": "Y", "LED13A": "TIME", "LED13L": "Y", "LED18A": "51", "LED18L": "Y",
     "LED23A": "ZONE1", "LED23L": "Y", "LED24A": "ZONE2", "LED24L": "Y"}

T = {"NLB3": "BLOQ 79", "CLB3": "VOLTAR", "SLB3": "", "PLB3": "BLOQ", "NLB7": "ABRIR DJ", "CLB7": "VOLTAR", "PLB7": "ABRIR",
     "DP1_1": "LINHA 1", "DP1_0": "", "DP2_1": "", "DP2_0": "MOLA DESCARREG."}

D1 = {"BI_000": "TRIP", "BI_001": "52A", "BI_002": "Z1G", "BO_000": "OC", "BO_001": "RB1", "AI_000": "IA:10.000:5", "AI_001": "VA:100.000:10"}


def _sec(name: str, d: dict) -> str:
    return HEADER + f"[{name}]\n" + "".join(f'{k},"{v}"\n' for k, v in d.items())


def make(g1: dict | None = None, l1: dict | None = None) -> Relay311CEngine:
    g, l = dict(G1), dict(L1)
    g.update(g1 or {})
    l.update(l1 or {})
    files = {"Relays/X/SET_1.TXT": _sec("1", g), "Relays/X/SET_L1.TXT": _sec("L1", l), "Relays/X/SET_G.TXT": _sec("G", G),
             "Relays/X/SET_T.TXT": _sec("T", T), "Relays/X/SET_D1.TXT": _sec("D1", D1),
             "Relays/X/SET_R.TXT": _sec("R", {"SER1": "TRIP,CLOSE,52A,Z1G,M1P,79CY,79LO"})}
    eng = Relay311CEngine(RelaySettings.from_files(files), device_name="311C teste")
    eng.set_sim({"analog_on": True})
    run(eng, 0.2)
    return eng


def run(eng, s: float, dt: float = 0.004) -> None:
    for _ in range(int(round(s / dt))):
        eng.step(dt)


def inject(eng, I: dict, V: dict) -> None:
    """Fasores SECUNDÁRIOS (A, V) por fase como (módulo, ângulo°)."""
    c = eng.field.cfg
    for p, (m, a) in I.items():
        setattr(c, f"i{p}_mag", m * eng.ctr)
        setattr(c, f"i{p}_ang", a)
    for p, (m, a) in V.items():
        setattr(c, f"v{p}_mag", m * eng.ptr)
        setattr(c, f"v{p}_ang", a)


def three_phase(eng, i: float, i_ang: float, v: float) -> None:
    inject(eng, {p: (i, i_ang + d) for p, d in zip("abc", (0, -120, 120))}, {p: (v, d) for p, d in zip("abc", (0, -120, 120))})


# ---------------------------------------------------------------------- SELogic clássica
def test_classic_selogic_operators():
    st = {"A": 0.0, "B": 1.0}
    e = Expr("!A*B+/A")
    assert e.idents == ["A", "B", "A"] and e.eval(st.get) == 1.0
    r, f = Expr("/A"), Expr("\\A")
    seq = []
    for x in (0, 1, 1, 0):
        st["A"] = x
        seq.append((r.eval(st.get), f.eval(st.get)))
    assert seq == [(0, 0), (1, 0), (0, 0), (0, 1)]


# ---------------------------------------------------------------------- modelo e carga
def test_model_defaults_and_load():
    eng = make()
    assert eng.model == "311C"
    assert eng.unresolved == set()
    assert abs(eng.meas["VA"] - 66.4) < 0.01 and abs(eng.meas["IA"] - 1.0) < 1e-6     # tensão nominal e 1 A sec. de carga
    assert eng.vals["VPOLV"] == 1 and eng.vals["TRIP"] == 0 and eng.vals["M1P"] == 0 and eng.vals["Z1G"] == 0
    assert eng.vals["79RS"] == 1 and eng.vals["52A"] == 1
    assert eng.trip_outs == ["OUT101"] and eng.close_outs == ["OUT103"]
    assert abs(eng.vals["VA"] - 66.4 * 600 / 1000) < 0.01                                 # nome do 311C (DNP AI) em kV


def test_times_are_cycles():
    eng = make()
    assert abs(eng.tsec("1", "TDURD") - 0.15) < 1e-9          # 9 ciclos a 60 Hz
    assert abs(next(t for t in eng.timers if t.name == "SV2").pu - 0.5) < 1e-9


# ---------------------------------------------------------------------- distância
def test_ground_quad_zone1_trips_ag_fault_and_targets():
    eng = make()
    inject(eng, {"a": (20.0, -80.0)}, {"a": (6.0, 0.0)})        # AG: ~0,3 Ω de laço, bem dentro de XG1
    run(eng, 0.008)
    assert eng.vals["FSA"] == 1 and eng.vals["32GF"] == 1 and eng.vals["XAG1"] == 1 and eng.vals["Z1G"] == 1
    assert eng.vals["TRIP"] == 1 and eng.vals["LZONE1"] == 1 and eng.vals["LTIME"] == 0
    run(eng, 0.1)
    assert not eng.field.breaker.closed
    assert eng.panel.fault["A"] and eng.panel.fault["G"] and not eng.panel.fault["B"]
    assert 0 < eng.fault_cur["FLOC"] < 30
    eng.target_reset()
    run(eng, 0.05)
    assert eng.vals["LTRIP"] == 0 and not eng.panel.fault["A"]


def test_reverse_ground_fault_does_not_trip():
    eng = make()
    # falta atrás do relé: corrente invertida e z2 = V2/I2 > Z2R (o 32Q vê a impedância da linha + fonte remota)
    inject(eng, {"a": (3.0, 100.0)}, {"a": (40.0, 0.0)})
    run(eng, 0.1)
    assert eng.vals["32GR"] == 1 and eng.vals["32GF"] == 0 and eng.vals["Z1G"] == 0 and eng.vals["TRIP"] == 0


def test_phase_mho_bc_fault_and_zone2_time():
    eng = make()
    # BC: corrente de laço 20 A, tensão BC reduzida → impedância ~ 7 Ω (fora da Z1 = 6,24, dentro da Z2 = 9,36)
    ib = cmath.rect(10.0, math.radians(-90 - 84))
    vbc = cmath.rect(7.0, math.radians(84.0)) * 2 * ib         # V_BC = Z·I_BC com I_BC = 2·IB, Z no ângulo da linha
    vb = cmath.rect(66.4, math.radians(-120))
    vc = vb - vbc
    inject(eng, {"b": (abs(ib), math.degrees(cmath.phase(ib))), "c": (abs(ib), math.degrees(cmath.phase(-ib)))},
           {"c": (abs(vc), math.degrees(cmath.phase(vc)))})
    run(eng, 0.02)
    assert eng.vals["32QF"] == 1 and eng.vals["MBC2"] == 1 and eng.vals["MBC1"] == 0 and eng.vals["TRIP"] == 0
    run(eng, 0.33)                                              # Z2PD = 20 ciclos = 0,333 s
    assert eng.vals["M2PT"] == 1 and eng.vals["TRIP"] == 1 and eng.vals["LTIME"] == 1 and eng.vals["LZONE2"] == 1


def test_three_phase_close_in_fault_memory_and_vpolv():
    """Falta trifásica franca próxima (V = 0): o mho de fase opera pela memória de V1 enquanto |V1mem| > 1 V (p. 3.21);
    depois VPOLV cai e o 51P supervisionado por M1P+M2P volta ao repouso."""
    eng = make({"Z1PD": "OFF", "Z2PD": "OFF", "Z1P": "6.24", "51PP": "2.00", "51PTD": "1.00"})
    three_phase(eng, 20.0, -84.0, 0.0)
    run(eng, 0.02)
    assert eng.vals["F32P"] == 1 and eng.vals["M1P"] == 1 and eng.vals["51P"] == 1 and eng.vals["VPOLV"] == 1
    run(eng, 1.5)                                               # memória (16 ciclos de constante, adotada) se esgota
    assert eng.vals["VPOLV"] == 0 and eng.vals["M1P"] == 0 and eng.vals["F32P"] == 0
    assert eng.vals["51P"] == 0 and eng.vals["51PT"] == 0 and eng.vals["TRIP"] == 0


def test_lop_blocks_distance_and_makes_32qf_forward():
    eng = make()
    eng.set_sim({"lop": True})
    inject(eng, {"a": (20.0, -80.0)}, {"a": (6.0, 0.0)})
    run(eng, 0.05)
    assert eng.vals["ILOP"] == 1 and eng.vals["Z1G"] == 0 and eng.vals["32QF"] == 1 and eng.vals["TRIP"] == 0


# ---------------------------------------------------------------------- sobrecorrente
def test_phase_50_nondirectional_and_ground_67_directional():
    eng = make({"50P1P": "5.00", "67P1D": "6.00", "E21P": "N", "E21XG": "N"})
    inject(eng, {"a": (8.0, 100.0)}, {})                       # reversa: 67P1 de fase é não direcional (p. 3.38)
    run(eng, 0.05)
    assert eng.vals["50A1"] == 1 and eng.vals["50P1"] == 1 and eng.vals["67P1"] == 1 and eng.vals["67P1T"] == 0
    run(eng, 0.08)
    assert eng.vals["67P1T"] == 1 and eng.vals["TRIP"] == 1
    eng2 = make({"50G1P": "2.00", "E21P": "N", "E21XG": "N"})
    inject(eng2, {"a": (3.0, 100.0)}, {"a": (40.0, 0.0)})     # terra reversa: 67G1 fixo à frente não opera
    run(eng2, 0.05)
    assert eng2.vals["50G1"] == 1 and eng2.vals["67G1"] == 0 and eng2.vals["TRIP"] == 0


def test_51g_curve_and_torque():
    eng = make({"51GP": "1.00", "51GC": "U3", "51GTD": "1.00", "E21XG": "N"})
    inject(eng, {"a": (5.0, -80.0)}, {"a": (55.0, 0.0)})
    run(eng, 0.05)
    assert eng.vals["51G"] == 1 and eng.vals["51GT"] == 0 and eng.vals["32GF"] == 1
    run(eng, 0.2)
    assert eng.vals["51GT"] == 0
    run(eng, 0.2)                                              # U3, M ≈ 4,6, TD 1: ≈ 0,29 s
    assert eng.vals["L51"] == 1 and eng.vals["LTIME"] == 1 and not eng.field.breaker.closed     # TRIP já caiu (TDURD)


# ---------------------------------------------------------------------- disparo, religamento e lógica
def test_reclose_cycle_and_close_failure_counter():
    eng = make()
    eng.field.cfg.fault_persistent = False
    inject(eng, {"a": (20.0, -80.0)}, {"a": (6.0, 0.0)})
    run(eng, 0.1)
    assert eng.vals["TRIP"] == 1 and eng.vals["79CY"] == 1
    inject(eng, {"a": (1.0, -18.0)}, {"a": (66.4, 0.0)})     # falta extinta
    run(eng, 1.2)                                             # 79OI1 = 60 ciclos = 1 s
    assert eng.field.breaker.closed and eng.vals["52A"] == 1
    run(eng, 10.5)                                            # 79RSD = 600 ciclos = 10 s
    assert eng.vals["79RS"] == 1


def test_latches_lv_sv_and_local_bits():
    eng = make()
    eng.press(1, True)
    run(eng, 0.02)
    eng.press(1, False)
    run(eng, 0.02)
    assert eng.vals["LT1"] == 1 and eng.vals["PB1"] == 0
    eng.set_bit("LB4", "pulse")
    run(eng, 0.02)
    assert eng.vals["LT1"] == 0
    eng.set_bit("LB7", "pulse")                                 # SV1 = OC + LB7 → SV1T (queda 60 ciclos) → OUT102
    run(eng, 0.02)
    assert eng.vals["SV1T"] == 1 and eng.vals["OUT102"] == 1
    assert eng.vals["LV3"] == 1 and eng.vals["ALRMOUT"] == 0
    snap = eng.panel.snapshot()
    assert any(lb["name"] == "ABRIR DJ" and lb["pulse"] == "ABRIR" for lb in snap["local_bits"])
    assert snap["lcd"][0] == "LINHA 1"


def test_dnp_map_and_commands():
    eng = make()
    d = eng.dnp.snapshot()
    assert [b["name"] for b in d["bi"]] == ["TRIP", "52A", "Z1G"]
    assert d["ai"][1]["raw"] == round(66.4 * 600 / 1000 * 100)
    res = eng.dnp.command(1, "PULSE_ON", "direct")
    run(eng, 0.02)
    assert res["status"] == "SUCCESS" and eng.vals["LT2"] == 1


def test_group_switch_by_ss():
    eng = make()
    files = dict(eng.settings.sections)
    assert "2" not in files
    eng.apply_setting("L1", "SS1", "0")
    run(eng, 0.1)
    assert eng.group == 1                                      # sem grupo 2 no ajuste: permanece no 1


# ---------------------------------------------------------------------- arquivo de referência
@needs_rdb
def test_reference_rdb_loads_without_unresolved():
    from app.rdb import parse_rdb
    from app.sessions import create_engine

    arc = parse_rdb(RDB_311C.read_bytes(), RDB_311C.name)
    assert len(arc.relays) >= 1
    for relay in arc.relays.values():
        eng = create_engine(relay)
        assert eng.model == "311C"
        eng.set_sim({"analog_on": True})
        run(eng, 0.5)
        assert eng.unresolved == set(), relay.name
        assert eng.vals["TRIP"] == 0 and eng.vals["52A"] == 1
        assert "OUT101" in eng.trip_outs and "OUT103" in eng.close_outs
        assert eng.dnp.snapshot()["bi"][0]["name"] == "LV3"


@needs_rdb
def test_reference_rdb_ground_zone2_trip():
    """Padrão "Entrada de Linha 21": só Z2GT tem atraso definido (Z1GD = OFF ⇒ Z1GT nunca atua, Figura 3.23)."""
    from app.rdb import parse_rdb
    from app.sessions import create_engine

    arc = parse_rdb(RDB_311C.read_bytes(), RDB_311C.name)
    relay = next(r for r in arc.relays.values() if "Entrada de Linha 21 v" in r.name)
    eng = create_engine(relay)
    eng.set_sim({"analog_on": True})
    run(eng, 0.3)
    inject(eng, {"a": (20.0, -80.0)}, {"a": (6.0, 0.0)})
    run(eng, 0.1)
    assert eng.vals["Z1G"] == 1 and eng.vals["Z1GT"] == 0 and eng.vals["TRIP"] == 0
    run(eng, 0.3)                                              # Z2GD = 20 ciclos
    assert eng.vals["TRIP"] == 1 and eng.vals["LZONE2"] == 1 and eng.vals["LTIME"] == 1
