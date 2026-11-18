"""SEL-2440 (DPAC): sem proteção; lógica SELogic (L), entradas/saídas em 3 cartões, bits VB/RB/CB e SER.

Ajuste sintético inspirado na interface com transmissoras (não depende do .rdb de exemplo).
"""
from __future__ import annotations

import pytest

from app.engine import RelayEngine
from app.settings import RelaySettings

HEADER = "[INFO]\nRELAYTYPE=SEL-2440\nFID=SEL-2440-R300-V0-Z009004-D20221110\n"


def make(logic: str, extra: dict[str, str] | None = None) -> RelayEngine:
    files = {
        "Relays/T/set_1.txt": HEADER + '[1]\nDID,"INT"\nTID,"SE"\n',
        "Relays/T/set_G.txt": HEADER + '[G]\nIN201D,"10"\nIN203D,"10"\nIN204D,"10"\nIN205D,"50"\n',
        "Relays/T/set_L.txt": HEADER + "[L]\n" + logic,
        "Relays/T/set_R.txt": HEADER + '[R]\nSER1,"IN203,SV03,OUT101,LT01"\nALIAS1,"IN201 BF_VAO_1 ATUADO NORMAL"\n',
    }
    if extra:
        files.update(extra)
    return RelayEngine(RelaySettings.from_files(files), device_name="2440 teste")


LOGIC = """ELAT,"32"
ESV,"32"
ESC,"N"
EMV,"1"
SET01,"VB001 OR VB007 # SINALIZACAO BF"
RST01,"TRGTR # TARGET RESET"
SV01,"IN201 OR IN207 # DISPARO BF"
SV03,"IN203 AND (IN204 OR IN205) # TRANSFERENCIA"
SV03PU,"0.100"
SV03DO,"0.050"
SV08,"VB002 AND NOT VB004"
OUT101,"SV01T # TRIP"
OUT111,"LT01 # SINAL BF"
OUT112,"NOT (VB003 AND VB009)"
OUT301,"RB17 OR CB017"
OUT116,"0"
"""


def run(eng: RelayEngine, seconds: float, dt: float = 0.004) -> None:
    for _ in range(int(round(seconds / dt))):
        eng.step(dt)


def bit(eng: RelayEngine, name: str) -> bool:
    return bool(eng.vals[name])


def test_model_and_logic_class():
    eng = make(LOGIC)
    assert eng.model == "2440" and eng.logic_cls == "L"
    assert len(eng.latches) == 32 and len(eng.timers) == 32
    assert eng.unresolved == set() or not eng.unresolved
    assert not eng.elements and eng.bk_input == ""          # sem proteção nem disjuntor


def test_inputs_outputs_and_default_state():
    eng = make(LOGIC)
    run(eng, 0.05)
    assert len(eng.inputs) == 48 and not bit(eng, "IN101")   # IN101 não é movida pelo modelo do 751
    assert bit(eng, "OUT112") and not bit(eng, "OUT101")      # NOT (VB003 AND VB009) = 1
    eng.set_input("IN201", True)
    run(eng, 0.005)
    assert not bit(eng, "IN201")                              # debounce de 10 ms
    run(eng, 0.02)
    assert bit(eng, "IN201") and bit(eng, "SV01T") and bit(eng, "OUT101")


def test_timer_pickup_and_dropout_and_latch_with_target_reset():
    eng = make(LOGIC)
    eng.set_input("IN203", True)
    eng.set_input("IN204", True)
    run(eng, 0.08)
    assert bit(eng, "SV03") and not bit(eng, "SV03T")         # PU 0,100 s
    run(eng, 0.1)
    assert bit(eng, "SV03T")
    eng.set_input("IN204", False)
    run(eng, 0.03)
    assert bit(eng, "SV03T")                                  # DO 0,050 s mantém
    run(eng, 0.1)
    assert not bit(eng, "SV03T")
    eng.set_bit("VB001", "set")
    run(eng, 0.02)
    assert bit(eng, "LT01") and bit(eng, "OUT111")
    eng.set_bit("VB001", "clear")
    run(eng, 0.05)
    assert bit(eng, "LT01")                                   # latch mantém
    eng.target_reset()
    run(eng, 0.05)
    assert not bit(eng, "LT01") and not bit(eng, "OUT111")


def test_virtual_remote_and_control_bits():
    eng = make(LOGIC)
    eng.set_bit("VB002", "set")
    run(eng, 0.02)
    assert bit(eng, "VB002") and bit(eng, "SV08")
    eng.set_bit("VB004", "toggle")
    run(eng, 0.02)
    assert bit(eng, "VB004") and not bit(eng, "SV08")
    eng.set_bit("RB17", "pulse")
    eng.step(0.004)
    assert bit(eng, "RB17") and bit(eng, "OUT301")
    eng.step(0.004)
    eng.step(0.004)
    assert not bit(eng, "RB17") and not bit(eng, "OUT301")   # RB é pulso de 1 ciclo
    eng.set_bit("RB17", "set")
    run(eng, 0.02)
    assert bit(eng, "OUT301")                                 # set mantém
    eng.set_bit("CB017", "set")
    eng.set_bit("RB17", "clear")
    run(eng, 0.02)
    assert bit(eng, "OUT301")                                 # CB017 mantém a saída
    with pytest.raises(ValueError):
        eng.set_bit("XX001", "set")
    with pytest.raises(ValueError):
        eng.set_bit("VB001", "voar")


def test_ser_and_alias_text():
    eng = make(LOGIC)
    run(eng, 0.05)
    eng.set_input("IN203", True)
    run(eng, 0.05)
    ev = [e for e in eng.ser_log if e["name"] == "IN203"]
    assert ev and ev[-1]["value"] == 1
    eng.set_input("IN201", True)
    run(eng, 0.05)
    assert "ATUADO" not in "".join(e["text"] for e in eng.ser_log if e["name"] == "IN203")


def test_snapshot_io_slots_and_bits():
    eng = make(LOGIC)
    run(eng, 0.05)
    io = eng.snapshot_io()
    kinds = {s["slot"]: s["kind"] for s in io["slots"]}
    assert kinds[1] == "out" and kinds[2] == "in" and kinds[3] == "out"      # OUT101/111/112; IN201…; OUT301
    mixed = make(LOGIC + 'SV05,"IN301"\n').snapshot_io()                       # cartão com entrada e saída usadas
    assert {s["slot"]: s["kind"] for s in mixed["slots"]}[3] == "mixed"
    assert [b["name"] for b in io["bits"]["vb"]][:3] == ["VB001", "VB002", "VB003"]
    assert [b["name"] for b in io["bits"]["rb"]] == ["RB17"] and [b["name"] for b in io["bits"]["cb"]] == ["CB017"]
    assert io["status"]["enabled"] and not io["status"]["alarm"]
    st = eng.snapshot_state()
    assert st["unresolved"] == [] and all(i["name"] in eng.used_inputs for i in st["inputs"])


def test_virtual_bits_in_sel751():
    """Bits virtuais (VB) e remotos (RB) também são simulados no SEL-751."""
    hdr = "[INFO]\nRELAYTYPE=SEL-751\n"
    files = {
        "Relays/T/set_1.txt": hdr + '[1]\nCTR,"100"\nCTRN,"100"\nPTR,"60"\n',
        "Relays/T/set_G.txt": hdr + '[G]\nFNOM,"60"\n',
        "Relays/T/set_L1.txt": hdr + '[L1]\nELAT,"1"\nESV,"1"\nSET01,"VB001 AND NOT VB002"\nRST01,"RB05"\nSV01,"VB003"\nOUT102,"LT01 OR SV01T"\n',
    }
    eng = RelayEngine(RelaySettings.from_files(files), device_name="751 teste")
    assert eng.model == "751" and eng.used_bits == ["RB05", "VB001", "VB002", "VB003"]
    run(eng, 0.05)
    eng.set_bit("VB001", "set")
    run(eng, 0.02)
    assert bit(eng, "LT01") and bit(eng, "OUT102")
    eng.set_bit("VB001", "clear")
    eng.set_bit("RB05", "pulse")
    run(eng, 0.03)
    assert not bit(eng, "LT01")                                # RB05 resetou o latch
    eng.set_bit("VB003", "toggle")
    run(eng, 0.02)
    assert bit(eng, "SV01") and bit(eng, "OUT102")
    names = [b["name"] for b in eng.snapshot_bits()["vb"]]
    assert names == ["VB001", "VB002", "VB003"]
    eng.set_bit("VB040", "watch")                              # bit extra passa a ser exibido, sem mudar de estado
    assert "VB040" in [b["name"] for b in eng.snapshot_bits()["vb"]] and not bit(eng, "VB040")
