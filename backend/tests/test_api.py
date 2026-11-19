from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from conftest import FEEDER_NAME, RDB_PATH, needs_rdb

pytestmark = needs_rdb


@pytest.fixture(scope="module")
def client():
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def session(client):
    with RDB_PATH.open("rb") as fh:
        up = client.post("/api/uploads", files={"file": (RDB_PATH.name, fh, "application/octet-stream")})
    assert up.status_code == 200, up.text
    data = up.json()
    relay = next(r for r in data["relays"] if r["name"] == FEEDER_NAME)
    sess = client.post("/api/sessions", json={"upload_id": data["upload_id"], "relay_id": relay["id"]})
    assert sess.status_code == 200, sess.text
    return {"upload": data, "relay": relay, "info": sess.json()}


def test_upload_lists_relays(session):
    assert len(session["upload"]["relays"]) == 20
    assert session["relay"]["file_count"] >= 20


def test_bad_upload(client):
    r = client.post("/api/uploads", files={"file": ("x.rdb", b"lixo", "application/octet-stream")})
    assert r.status_code == 400


def test_relay_file_and_zip(client, session):
    uid, rid = session["upload"]["upload_id"], session["relay"]["id"]
    r = client.get(f"/api/uploads/{uid}/relays/{rid}/files/set_L1.txt")
    assert r.status_code == 200 and "[L1]" in r.text
    z = client.get(f"/api/uploads/{uid}/relays/{rid}/zip")
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"


def test_panel_and_button_flow(client, session):
    sid = session["info"]["id"]
    assert session["info"]["static"]["targets"][0]["id"] == "T01"
    time.sleep(0.4)
    p = client.get(f"/api/sessions/{sid}/panel").json()
    assert p["breaker"]["closed"] is True and p["panel"]["enabled"]["on"] is True
    assert p["panel"]["lcd"][0].startswith("XXXX")
    # PB1 (Local/Remoto) -> LED do PB1 passa a indicar Local
    for pressed in (True, False):
        assert client.post(f"/api/sessions/{sid}/button", json={"button": "PB1", "pressed": pressed}).status_code == 200
    time.sleep(0.4)
    p = client.get(f"/api/sessions/{sid}/panel").json()
    assert p["panel"]["pb"][0]["a"]["on"] is True
    assert client.post(f"/api/sessions/{sid}/button", json={"button": "PB9", "pressed": True}).status_code == 400


def test_state_dnp_and_settings_endpoints(client, session):
    sid = session["info"]["id"]
    state = client.get(f"/api/sessions/{sid}/state").json()
    assert state["unresolved"] == [] and state["latches"]
    dnp = client.get(f"/api/sessions/{sid}/dnp").json()
    assert len(dnp["bo"]) >= 12 and any(p["name"] == "52A" for p in dnp["bi"])
    cmd = client.post(f"/api/sessions/{sid}/dnp/command", json={"index": 2, "code": "PULSE_ON", "mode": "direct"})
    assert cmd.json()["status"] == "SUCCESS"
    st = client.get(f"/api/sessions/{sid}/settings/1").json()
    assert any(i["key"] == "CTR" for i in st["items"])
    r = client.patch(f"/api/sessions/{sid}/settings", json={"cls": "1", "key": "50P1P", "value": "12"})
    assert r.status_code == 200
    st = client.get(f"/api/sessions/{sid}/settings/1").json()
    assert next(i for i in st["items"] if i["key"] == "50P1P")["modified"] is True
    assert client.patch(f"/api/sessions/{sid}/settings", json={"cls": "1", "key": "NAOEXISTE", "value": "1"}).status_code == 404


def test_fault_through_api_trips_breaker(client, session):
    sid = session["info"]["id"]
    client.post(f"/api/sessions/{sid}/restart")
    client.patch(f"/api/sessions/{sid}/settings", json={"cls": "1", "key": "50P1P", "value": "10"})
    client.post(f"/api/sessions/{sid}/fault", json={"type": "ABC", "current": 3000, "persistent": False})
    time.sleep(0.6)
    p = client.get(f"/api/sessions/{sid}/panel").json()
    assert p["breaker"]["closed"] is False and p["status"]["trip"] == 1
    ser = client.get(f"/api/sessions/{sid}/ser").json()
    assert any(e["name"] == "TRIP" and e["value"] == 1 for e in ser["events"])
    assert client.post(f"/api/sessions/{sid}/fault", json={"type": "XX"}).status_code == 400


def test_unknown_session(client):
    assert client.get("/api/sessions/naoexiste/panel").status_code == 404


def test_vb_locked_when_relay_bound_to_iec_ied(client, session):
    sid = session["info"]["id"]
    from app.main import manager
    assert client.post(f"/api/sessions/{sid}/bits", json={"name": "VB001", "mode": "set"}).status_code in (200, 400)
    manager.net.bindings[sid] = "IED_X"
    try:
        r = client.post(f"/api/sessions/{sid}/bits", json={"name": "VB001", "mode": "set"})
        assert r.status_code == 409 and "IEC61850" in r.json()["detail"]
        assert client.post(f"/api/sessions/{sid}/force", json={"name": "VB001", "value": 1}).status_code == 409
    finally:
        manager.net.bindings.pop(sid, None)
