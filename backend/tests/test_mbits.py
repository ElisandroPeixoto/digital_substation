"""Links Mirrored Bits (MBitConfig): TMB de um relé -> RMB do outro, com ajustes casando (TXID x RXID), debounce e RXDFLT."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.engine import RelayEngine
from app.mbits import MbNetwork, check_pair, port_config
from app.settings import RelaySettings

HDR = "[INFO]\nRELAYTYPE=SEL-2440\nFID=SEL-2440-R300-V0-Z009004-D20221110\n"


def make(tmb: str = "0", p3: str = "", p2: str = "") -> RelayEngine:
    files = {
        "Relays/T/set_1.txt": HDR + '[1]\nDID,"X"\n',
        "Relays/T/set_G.txt": HDR + '[G]\nIN201D,"10"\n',
        "Relays/T/set_L.txt": HDR + "[L]\nELAT,\"32\"\nESV,\"32\"\n" + f'TMB1A,"{tmb}"\nTMB2A,"0"\nSV01,"RMB1A"\nSV01PU,"0"\nSV01DO,"0"\nOUT101,"RMB1A"\n',
        "Relays/T/set_P2.txt": HDR + "[P2]\n" + p2,
        "Relays/T/set_P3.txt": HDR + "[P3]\n" + p3,
    }
    return RelayEngine(RelaySettings.from_files(files), device_name="t")


def cfg(proto="MB8A", tx=2, rx=1, speed=9600, extra=""):
    return f'PROTO,"{proto}"\nTXID,"{tx}"\nRXID,"{rx}"\nSPEED,"{speed}"\n{extra}'


class Rig:
    def __init__(self, a_cfg=None, b_cfg=None, tmb="IN201", **kw):
        self.a = make(tmb, p3=a_cfg or cfg("MB8A", 2, 1))
        self.b = make("0", p3=b_cfg or cfg("MB8A", 1, 2, extra=kw.get("b_extra", "")))
        self.sess = {"a": SimpleNamespace(engine=self.a, running=True, relay=SimpleNamespace(id="A")),
                     "b": SimpleNamespace(engine=self.b, running=True, relay=SimpleNamespace(id="B"))}
        self.mb = MbNetwork(seed=1)
        self.lk = self.mb.add_link("a", 3, "b", 3)
        self.now = 0.0

    def run(self, seconds, dt=0.004):
        for _ in range(int(round(seconds / dt))):
            self.a.step(dt)
            self.b.step(dt)
            self.now += dt
            self.mb.tick(self.now, self.sess)


def test_port_config_and_eligibility():
    e = make(p3=cfg("MB8B", 3, 4), p2='PROTO,"SEL"\n')
    c3, c2 = port_config(e, 3), port_config(e, 2)
    assert c3["eligible"] and c3["channel"] == "B" and c3["family"] == "MB8" and (c3["txid"], c3["rxid"]) == (3, 4)
    assert not c2["eligible"]
    assert any("não está em MB8A/MB8B" in i for i in check_pair(c2, c3))


def test_pair_checks():
    a, b = port_config(make(p3=cfg("MB8A", 2, 1)), 3), port_config(make(p3=cfg("MB8B", 1, 2)), 3)
    assert check_pair(a, b) == []                              # canais A e B não precisam coincidir
    bad = port_config(make(p3=cfg("MB8A", 2, 1)), 3)
    assert any("TXID de A" in i for i in check_pair(a, bad))
    assert any("Taxas" in i for i in check_pair(a, port_config(make(p3=cfg("MB8A", 1, 2, 19200)), 3)))
    assert any("MB e MB8" in i for i in check_pair(a, port_config(make(p3=cfg("MBA", 1, 2)), 3)))
    assert any("não podem ser iguais" in i for i in check_pair(port_config(make(p3=cfg("MB8A", 1, 1)), 3), b))


def test_tmb_reaches_rmb_when_closed():
    r = Rig()
    r.run(0.1)
    assert r.b.vals["RMB1A"] == 0.0 and r.b.vals["ROKA"] == 1.0
    r.a.set_input("IN201", True)
    r.run(0.15)                                                # debounce de 10 ms da entrada + mensagens
    assert r.a.vals["TMB1A"] == 1.0 and r.b.vals["RMB1A"] == 1.0 and r.b.vals["OUT101"] == 1.0
    assert r.b.vals["RMB2A"] == 0.0
    r.a.set_input("IN201", False)
    r.run(0.15)
    assert r.b.vals["RMB1A"] == 0.0
    assert next(l for l in r.mb.status(r.sess)["links"])["closed"]


def test_mismatched_ids_keep_link_open():
    r = Rig(b_cfg=cfg("MB8A", 2, 1))                           # TXID de B igual ao de A
    r.a.set_input("IN201", True)
    r.run(0.3)
    assert r.b.vals["RMB1A"] == 0.0 and r.b.vals["ROKA"] == 0.0
    st = r.mb.status(r.sess)["links"][0]
    assert not st["closed"] and any("TXID" in i for i in st["issues"])


def test_debounce_pickup_and_dropout():
    r = Rig(b_extra='RMB1PU,"5"\nRMB1DO,"3"\n')
    r.a.set_input("IN201", True)
    r.run(0.012)
    assert r.b.vals["RMB1A"] == 0.0                            # ainda sem 5 mensagens consecutivas
    r.run(0.15)
    assert r.b.vals["RMB1A"] == 1.0


def test_cut_cable_applies_rxdflt_and_rbad():
    r = Rig(b_extra='RXDFLT,"XXXXXX1X"\nRBADPU,"1"\n')
    r.a.set_input("IN201", True)
    r.run(0.2)
    assert r.b.vals["RMB1A"] == 1.0 and r.b.vals["RMB2A"] == 0.0
    r.mb.links[r.lk.id].cut = True
    r.run(0.1)
    assert r.b.vals["ROKA"] == 0.0 and r.b.vals["RMB1A"] == 1.0 and r.b.vals["RMB2A"] == 1.0     # RMB2 forçado a 1; RMB1 mantém
    assert r.b.vals["RBADA"] == 0.0
    r.run(1.2)
    assert r.b.vals["RBADA"] == 1.0
    r.mb.links[r.lk.id].cut = False
    r.run(0.2)
    assert r.b.vals["ROKA"] == 1.0 and r.b.vals["RBADA"] == 0.0


def test_paused_relay_drops_channel_and_link_rules():
    r = Rig()
    r.run(0.1)
    r.sess["a"].running = False
    r.run(0.1)
    assert r.b.vals["ROKA"] == 0.0
    with pytest.raises(ValueError):
        r.mb.add_link("a", 3, "b", 2)                          # porta 3 do relé A já em uso
    with pytest.raises(ValueError):
        r.mb.add_link("a", 1, "b", 2)                          # só portas 2 e 3
