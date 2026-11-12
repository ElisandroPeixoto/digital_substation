from __future__ import annotations

import pytest

from app.describe import format_dp, parse_dp
from app.rdb import parse_rdb
from app.settings import RelaySettings, parse_set_text

from conftest import FEEDER_NAME, needs_rdb


def test_invalid_file_is_rejected():
    with pytest.raises(ValueError):
        parse_rdb(b"isto nao e um rdb")


def test_parse_set_text_quotes_and_header():
    text = '[INFO]\r\nRELAYTYPE=SEL-751\r\nFID=X\r\n[L1]\r\nSET01,"A AND B # c"\r\nDP01,"RID,""{16}"""\r\n'
    section, header, items = parse_set_text(text)
    assert section == "L1"
    assert header["RELAYTYPE"] == "SEL-751"
    assert items["SET01"] == "A AND B # c"
    assert items["DP01"] == 'RID,"{16}"'


def test_parse_dp_variants():
    assert parse_dp('IN403,,,"FALHA"') == {"name": "IN403", "kind": "bool", "text1": "", "text0": "FALHA"}
    assert parse_dp('IN402,,"ATUADO"')["text1"] == "ATUADO"
    num = parse_dp('IA_MAG,"IA FASE {5.2,1} A"')
    assert num["kind"] == "numeric"
    assert format_dp(num["fmt"], 100.0) == "IA FASE 100.00 A"
    assert format_dp("{16}", "XXXX") == "XXXX".ljust(16)


@needs_rdb
def test_rdb_extracts_every_relay(archive):
    assert len(archive.relays) == 20
    assert FEEDER_NAME in {r.name for r in archive.relays.values()}
    feeder = next(r for r in archive.relays.values() if r.name == FEEDER_NAME)
    assert {"set_1.txt", "set_L1.txt", "set_G.txt", "set_F.txt", "set_R.txt", "set_D1.txt"} <= set(feeder.files)
    assert feeder.fid.startswith("SEL-751")
    assert len(feeder.to_zip()) > 1000


@needs_rdb
def test_every_relay_loads_and_runs(archive):
    from app.sessions import create_engine
    for relay in archive.relays.values():
        eng = create_engine(relay)
        for _ in range(200):
            eng.step(0.01)
        assert eng.vals["LT06"] == 1.0, relay.name          # relé "normal"
        assert eng.vals["TRIP"] == 0.0, relay.name


@needs_rdb
def test_feeder_settings_loaded(archive):
    relay = next(r for r in archive.relays.values() if r.name == FEEDER_NAME)
    st = RelaySettings.from_files(relay.files)
    assert st.number("1", "CTR") == 120
    assert st.get("L1", "OUT101").startswith("TRIP")
    assert st.get("D1", "BO_00") == "OC"
