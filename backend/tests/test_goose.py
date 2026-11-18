"""Módulo IEC61850: leitura de SCL e rede GOOSE entre relés simulados (SCL e ajustes sintéticos, sem arquivos da empresa)."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.engine import RelayEngine
from app.goose import GooseNetwork
from app.scl import SclProject, parse_scl
from app.settings import RelaySettings

SCL = """<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" xmlns:sel="http://www.selinc.com/2006/61850" version="2007" revision="B">
 <Communication><SubNetwork name="W1" type="8-MMS">
  <ConnectedAP iedName="PUB" apName="S1"><Address><P type="IP">10.0.0.1</P></Address>
   <GSE ldInst="CFG" cbName="GCB1"><Address><P type="MAC-Address">01-0C-CD-01-00-01</P><P type="APPID">0001</P>
    <P type="VLAN-ID">001</P><P type="VLAN-PRIORITY">4</P></Address><MinTime unit="s" multiplier="m">4</MinTime><MaxTime unit="s" multiplier="m">500</MaxTime></GSE>
  </ConnectedAP>
  <ConnectedAP iedName="SUB" apName="S1"><Address><P type="IP">10.0.0.2</P></Address></ConnectedAP>
 </SubNetwork></Communication>
 <IED name="PUB" type="SEL-2440" manufacturer="SEL" configVersion="1">
  <AccessPoint name="S1"><Server><LDevice inst="CFG"><LN0 lnClass="LLN0" inst="">
   <DataSet name="DS1"><FCDA ldInst="CFG" prefix="SVT" lnClass="GGIO" lnInst="1" doName="Ind01" daName="stVal" fc="ST"/>
    <FCDA ldInst="CFG" prefix="LT" lnClass="GGIO" lnInst="1" doName="Ind02" daName="stVal" fc="ST"/></DataSet>
   <GSEControl name="GCB1" datSet="DS1" confRev="3" appID="GO1" type="GOOSE"/>
  </LN0></LDevice></Server></AccessPoint>
 </IED>
 <IED name="SUB" type="SEL-2440" manufacturer="SEL" configVersion="1">
  <Private type="SEL_GooseSubscription"><sel:GooseSubscription iedName="PUB" cbName="GCB1" ldInst="CFG" datSet="DS1" appId="GO1" confRev="3"
     mAddr="01-0C-CD-01-00-01" APPID="0001" VLAN-ID="001" VLAN-PRIORITY="4" pubRxStatus="VB009">
     <sel:GooseRxEntry tdlString="(VB001)Bool"/><sel:GooseRxEntry tdlString="Bool"/></sel:GooseSubscription></Private>
  <AccessPoint name="S1"><Server><LDevice inst="CFG"><LN0 lnClass="LLN0" inst=""/></LDevice></Server></AccessPoint>
 </IED>
</SCL>
""".encode()


def make(logic: str, e61850: str = "Y", egse: str = "Y") -> RelayEngine:
    hdr = "[INFO]\nRELAYTYPE=SEL-2440\nFID=SEL-2440-R300-V0-Z009004-D20221110\n"
    files = {
        "Relays/T/set_1.txt": hdr + '[1]\nDID,"X"\n',
        "Relays/T/set_G.txt": hdr + '[G]\nIN201D,"10"\n',
        "Relays/T/set_L.txt": hdr + "[L]\nELAT,\"32\"\nESV,\"32\"\n" + logic,
        "Relays/T/set_P1.txt": hdr + f'[P1]\nE61850,"{e61850}"\nEGSE,"{egse}"\n',
    }
    return RelayEngine(RelaySettings.from_files(files), device_name="t")


class Rig:
    """Dois relés 2440 ligados por GOOSE: PUB (SV01 = IN201) -> SUB (OUT101 = VB001)."""

    def __init__(self, **kw) -> None:
        self.pub = make('SV01,"IN201"\nSV01PU,"0"\nSV01DO,"0"\n', **kw.get("pub", {}))
        self.sub = make('OUT101,"VB001"\nOUT102,"VB009"\n', **kw.get("sub", {}))
        self.sess = {"p": SimpleNamespace(engine=self.pub, running=True), "s": SimpleNamespace(engine=self.sub, running=True)}
        self.net = GooseNetwork(seed=1)
        self.net.project.add(parse_scl(SCL, "t.scd"), "t.scd")
        self.net.bind("p", "PUB")
        self.net.bind("s", "SUB")
        self.now = 0.0

    def run(self, seconds: float, dt: float = 0.004) -> None:
        for _ in range(int(round(seconds / dt))):
            self.pub.step(dt)
            self.sub.step(dt)
            self.now += dt
            self.net.tick(self.now, self.sess)


def test_parse_scl_structure():
    p = SclProject()
    p.add(parse_scl(SCL, "t.scd"), "t.scd")
    d = p.to_dict()
    pub = next(i for i in d["ieds"] if i["name"] == "PUB")
    g = pub["gcbs"][0]
    assert (g["name"], g["dataset"], g["conf_rev"], g["mac"], g["appid"], g["min_ms"], g["max_ms"]) == ("GCB1", "DS1", 3, "01-0C-CD-01-00-01", "0001", 4.0, 500.0)
    assert [e["bit"] for e in g["entries"]] == ["SV01T", "LT02"]
    assert g["subscribers"] == [{"ied": "SUB", "status_vb": "VB009", "vbs": ["VB001"]}]
    sub = next(i for i in d["ieds"] if i["name"] == "SUB")["subs"][0]
    assert sub["status_vb"] == "VB009" and [e["vb"] for e in sub["entries"]] == ["VB001", ""] and sub["issues"] == []
    assert sub["entries"][0]["fcda"]["bit"] == "SV01T"


def test_parse_rejects_invalid():
    with pytest.raises(ValueError):
        parse_scl(b"<x/>")
    with pytest.raises(ValueError):
        parse_scl(b"nao e xml")
    with pytest.raises(ValueError):
        parse_scl(b'<!DOCTYPE a [<!ENTITY x "y">]><SCL xmlns="http://www.iec.ch/61850/2003/SCL"/>')


def test_goose_propagates_bit_and_status():
    r = Rig()
    r.run(0.008)
    assert r.sub.vals["VB009"] == 1.0                                  # nada recebido ainda: status de falha
    r.run(0.3)
    assert r.sub.vals["VB009"] == 0.0 and r.sub.vals["OUT101"] == 0.0     # mensagens chegando: status normal
    r.pub.set_input("IN201", True)
    r.run(0.1)                                                            # debounce 10 ms + latência
    assert r.sub.vals["VB001"] == 1.0 and r.sub.vals["OUT101"] == 1.0
    r.pub.set_input("IN201", False)
    r.run(0.1)
    assert r.sub.vals["VB001"] == 0.0


def test_stnum_increments_and_retransmission_backs_off():
    r = Rig()
    r.run(1.0)
    st0 = r.net.status(r.sess)["ieds"][0]["pubs"][0]
    r.pub.set_input("IN201", True)
    r.run(0.1)
    st1 = r.net.status(r.sess)["ieds"][0]["pubs"][0]
    assert st1["st_num"] == st0["st_num"] + 1
    sent = st1["sent"]
    r.run(2.0)
    assert r.net.status(r.sess)["ieds"][0]["pubs"][0]["sent"] - sent <= 8     # intervalo cresce até 500 ms


@pytest.mark.parametrize("what", ["cut", "paused", "e61850", "egse", "unbound"])
def test_comm_loss_conditions_drop_vbs(what):
    kw = {"pub": {"e61850": "N"}} if what == "e61850" else {"pub": {"egse": "N"}} if what == "egse" else {}
    r = Rig(**kw)
    if what != "e61850" and what != "egse":
        r.pub.set_input("IN201", True)
    r.run(1.0)
    if what in ("e61850", "egse"):
        assert r.sub.vals["VB009"] == 1.0 and r.sub.vals["VB001"] == 0.0   # publicador mudo
        return
    assert r.sub.vals["VB001"] == 1.0 and r.sub.vals["VB009"] == 0.0
    if what == "cut":
        r.net.cut.add("PUB")
    elif what == "paused":
        r.sess["p"].running = False
    else:
        r.net.unbind("p")
    r.run(1.2)                                                             # > TAL (2 × 500 ms)
    assert r.sub.vals["VB001"] == 0.0 and r.sub.vals["VB009"] == 1.0
    st = next(i for i in r.net.status(r.sess)["ieds"] if i["name"] == "SUB")["subs"][0]
    assert not st["valid"]


def test_subscriber_disabled_and_halarm():
    r = Rig(sub={"e61850": "N"})
    r.pub.set_input("IN201", True)
    r.run(1.0)
    assert r.sub.vals["VB001"] == 0.0
    r2 = Rig()
    r2.pub.set_input("IN201", True)
    r2.run(0.5)
    assert r2.sub.vals["VB001"] == 1.0
    r2.sub.field.cfg.halarm = True
    r2.run(0.1)
    assert r2.sub.vals["VB001"] == 0.0


def test_confrev_mismatch_blocks_subscription():
    r = Rig()
    r.net.project.ieds["PUB"].gcbs[0].conf_rev = 4
    r.pub.set_input("IN201", True)
    r.run(1.0)
    assert r.sub.vals["VB001"] == 0.0 and r.sub.vals["VB009"] == 1.0
    d = r.net.project.to_dict()
    sub = next(i for i in d["ieds"] if i["name"] == "SUB")["subs"][0]
    assert any("confRev" in i["text"] for i in sub["issues"])


def test_loss_and_latency():
    r = Rig()
    r.net.latency_ms = 200.0
    r.pub.set_input("IN201", True)
    r.run(0.15)
    assert r.sub.vals["VB001"] == 0.0
    r.run(0.2)
    assert r.sub.vals["VB001"] == 1.0
    r.net.loss_pct = 100.0
    r.run(1.5)
    assert r.sub.vals["VB001"] == 0.0 and r.net.lost_total > 0


def test_edit_gcb_params_and_reset():
    r = Rig()
    r.pub.set_input("IN201", True)
    r.run(0.6)
    assert r.sub.vals["VB001"] == 1.0
    r.net.project.edit_gcb("PUB", "GCB1", {"mac": "01-0C-CD-01-00-99"})
    r.run(1.5)
    assert r.sub.vals["VB001"] == 0.0 and r.sub.vals["VB009"] == 1.0         # MAC diferente: assinatura recusada
    d = r.net.project.to_dict()
    assert next(i for i in d["ieds"] if i["name"] == "PUB")["gcbs"][0]["modified"] == ["mac"]
    r.net.project.reset("PUB")
    r.run(0.6)
    assert r.sub.vals["VB001"] == 1.0
    r.net.project.edit_sub("SUB", "PUB", "GCB1", {}, {"1": "VB020"})
    r.run(0.6)
    assert r.sub.vals.get("VB020") == 1.0
    r.net.project.edit_sub("SUB", "PUB", "GCB1", {"enabled": False})
    r.run(0.1)
    assert r.sub.vals["VB020"] == 0.0 and r.sub.vals["VB009"] == 1.0


def test_edit_validation():
    r = Rig()
    for bad in ({"mac": "xx"}, {"appid": "ZZZZ"}, {"vlan_prio": "9"}, {"max_ms": -1}):
        with pytest.raises(ValueError):
            r.net.project.edit_gcb("PUB", "GCB1", bad)
    with pytest.raises(ValueError):
        r.net.project.edit_sub("SUB", "PUB", "GCB1", {"status_vb": "X1"})


def test_vlan_aware_flag():
    r = Rig()
    r.net.project.edit_gcb("PUB", "GCB1", {"vlan_id": "5"})
    r.pub.set_input("IN201", True)
    r.run(1.0)
    assert r.sub.vals["VB001"] == 0.0                                       # VLAN diferente: recusa
    r.net.vlan_aware = False
    d = r.net.project.to_dict()
    assert next(i for i in d["ieds"] if i["name"] == "SUB")["subs"][0]["issues"] == []
    r.run(1.0)
    assert r.sub.vals["VB001"] == 1.0                                       # VLAN desconsiderada


def test_topology_networks_isolate_relays():
    r = Rig()
    r.pub.set_input("IN201", True)
    r.net.networks = [{"id": "R1", "name": "Rede 1", "sids": ["p", "s"]}]
    r.run(0.6)
    assert r.sub.vals["VB001"] == 1.0                                       # mesma rede
    r.net.networks = [{"id": "R1", "name": "A", "sids": ["p"]}, {"id": "R2", "name": "B", "sids": ["s"]}]
    r.run(1.5)
    assert r.sub.vals["VB001"] == 0.0 and r.sub.vals["VB009"] == 1.0         # redes diferentes
    st = next(i for i in r.net.status(r.sess)["ieds"] if i["name"] == "SUB")["subs"][0]
    assert "outra rede" in st["reason"]
    r.net.networks = [{"id": "R1", "name": "A", "sids": ["p"]}]             # assinante fora de qualquer rede
    r.run(0.2)
    assert not r.net.ied_state(r.net.project.ieds["SUB"], r.sess)[0]
    r.net.networks = None                                                  # sem topologia: tudo interligado
    r.run(0.6)
    assert r.sub.vals["VB001"] == 1.0
