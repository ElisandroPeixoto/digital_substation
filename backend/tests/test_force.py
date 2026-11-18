"""Forçamento de variáveis lógicas (SV, SVT, LT, SCQ, MV, OUT) pelo usuário."""
from __future__ import annotations

import pytest

from app.engine import RelayEngine
from app.settings import RelaySettings

HDR = "[INFO]\nRELAYTYPE=SEL-2440\nFID=SEL-2440-R300-V0-Z009004-D20221110\n"
LOGIC = ('ELAT,"32"\nESV,"32"\nESC,"N"\nSV01,"IN201"\nSV01PU,"0"\nSV01DO,"0"\n'
         'SET01,"SV01T"\nRST01,"0"\nOUT101,"LT01"\nOUT102,"SV02T"\nSV02,"0"\nSV02PU,"0"\nSV02DO,"0"\n')


def make() -> RelayEngine:
    files = {"Relays/T/set_1.txt": HDR + '[1]\nDID,"X"\n', "Relays/T/set_G.txt": HDR + '[G]\nIN201D,"10"\n',
             "Relays/T/set_L.txt": HDR + "[L]\n" + LOGIC}
    return RelayEngine(RelaySettings.from_files(files), device_name="t")


def run(e: RelayEngine, n: int = 10) -> None:
    for _ in range(n):
        e.step(0.004)


def test_force_sv_output_and_downstream():
    e = make()
    run(e)
    assert e.vals["OUT102"] == 0.0
    e.force("SV02T", 1)
    run(e)
    assert e.vals["SV02T"] == 1.0 and e.vals["OUT102"] == 1.0            # a lógica a jusante enxerga o valor forçado
    e.force("SV02T", None)
    run(e)
    assert e.vals["OUT102"] == 0.0


def test_force_latch_holds_and_releases():
    e = make()
    run(e)
    e.force("LT01", 1)
    run(e)
    assert e.vals["LT01"] == 1.0 and e.vals["OUT101"] == 1.0              # RST01 = 0 não derruba o forçado
    e.force("LT01", 0)
    run(e)
    assert e.vals["OUT101"] == 0.0 and e.snapshot_state()["forced"] == {"LT01": 0.0}
    e.force("LT01", None)
    assert e.forced == {}


def test_force_output_and_validation():
    e = make()
    run(e)
    e.force("OUT101", 1)
    run(e)
    assert e.vals["OUT101"] == 1.0
    with pytest.raises(ValueError):
        e.force("NAO_EXISTE", 1)
    with pytest.raises(ValueError):
        e.force("a b", 1)


def test_pushbutton_pulse_bits_exist_and_pulse_one_scan():
    e = make()
    e.model = "751"  # só para o mapa de eventos; o bit é do Relay Word comum
    run(e)
    assert "PB03_PUL" in e.vals and e.vals["PB03_PUL"] == 0.0
    e.queue.append({"type": "pb", "n": 3, "pressed": True})
    e.step(0.004)
    assert e.vals["PB03_PUL"] == 1.0 and e.vals["PB03"] == 1.0
    e.step(0.004)
    assert e.vals["PB03_PUL"] == 0.0 and e.vals["PB03"] == 1.0
