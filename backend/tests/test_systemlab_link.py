"""Injeção vinda do SystemLab × injeção manual do DigitalRelay e reversão de ajustes alterados."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app, manager
from app.rdb import RdbRelay

HDR = "[INFO]\nRELAYTYPE=SEL-751\nFID=SEL-751-R000\n"


def _session():
    files = {"set_1.txt": HDR + '[1]\nCTR,"100"\nPTR,"120"\n50P1P,"OFF"\nTR,"50P1T"\n', "set_L1.txt": HDR + '[L1]\nELAT,"0"\nESV,"0"\nOUT101,"TRIP"\n'}
    return manager.create(RdbRelay(id="T", name="t", files=files), "t.rdb")


def test_systemlab_priority_and_isolation():
    s = _session()
    c = TestClient(app)
    try:
        base = f"/api/sessions/{s.id}"
        assert c.post(base + "/sim", json={"patch": {"ia_mag": 50.0}}).status_code == 200      # sem SystemLab: injeção manual livre
        assert c.post(base + "/systemlab", json={"patch": {"ia_mag": 300.0, "analog_on": True}}).status_code == 200
        cfg = s.engine.field.cfg
        assert cfg.ia_mag == 300.0 and cfg.analog_on
        r = c.post(base + "/sim", json={"patch": {"ia_mag": 10.0}})                               # SystemLab comanda: manual bloqueada
        assert r.status_code == 409 and cfg.ia_mag == 300.0
        assert c.get(base + "/panel").json()["systemlab"] == {"linked": True, "isolated": False}
        c.post(base + "/sim", json={"patch": {"sl_isolated": True}})                              # isola: volta a injeção manual
        assert cfg.sl_isolated and cfg.ia_mag == 50.0
        c.post(base + "/systemlab", json={"patch": {"ia_mag": 400.0}})                            # isolado: SystemLab não altera
        assert cfg.ia_mag == 50.0
        assert c.post(base + "/sim", json={"patch": {"ia_mag": 70.0}}).status_code == 200
        c.post(base + "/sim", json={"patch": {"sl_isolated": False}})                             # religa: volta o SystemLab
        assert not cfg.sl_isolated and cfg.ia_mag == 400.0
    finally:
        manager.delete(s.id)


def test_revert_modified_setting():
    s = _session()
    c = TestClient(app)
    try:
        base = f"/api/sessions/{s.id}"
        c.patch(base + "/settings", json={"cls": "1", "key": "50P1P", "value": "5"})
        item = next(i for i in c.get(base + "/settings/1").json()["items"] if i["key"] == "50P1P")
        assert item["modified"] and item["value"] == "5" and item["original"] == "OFF"
        assert c.delete(base + "/settings/1/50P1P").json()["value"] == "OFF"
        item = next(i for i in c.get(base + "/settings/1").json()["items"] if i["key"] == "50P1P")
        assert not item["modified"] and item["value"] == "OFF"
        assert not any(e.base == "50P1" for e in s.engine.elements)                                # elemento voltou a OFF
    finally:
        manager.delete(s.id)
