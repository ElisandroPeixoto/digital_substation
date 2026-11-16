"""API FastAPI do simulador SEL-751."""
from __future__ import annotations

import asyncio
import contextlib
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .fieldsim import FAULT_TYPES, PRESETS
from .rdb import RdbArchive, parse_rdb
from .selogic import split_comment
from .sessions import SPEEDS, Session, SessionManager

MAX_UPLOAD = 100 * 1024 * 1024
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

uploads: dict[str, RdbArchive] = {}
manager = SessionManager()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(manager.run())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Simulador SEL-751", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ modelos
class SessionCreate(BaseModel):
    upload_id: str
    relay_id: str


class ButtonBody(BaseModel):
    button: str               # "PB1".."PB8" | "TARGET_RESET"
    pressed: bool = True


class InputBody(BaseModel):
    name: str
    value: bool


class SimBody(BaseModel):
    patch: dict


class FaultBody(BaseModel):
    type: str
    current: float | None = None
    persistent: bool | None = None


class BreakerBody(BaseModel):
    closed: bool


class PresetBody(BaseModel):
    name: str


class DnpCommand(BaseModel):
    index: int
    code: str = "PULSE_ON"
    mode: str = "direct"      # select | operate | direct


class DnpMapBody(BaseModel):
    map: int


class SettingPatch(BaseModel):
    cls: str
    key: str
    value: str


class ControlBody(BaseModel):
    running: bool | None = None
    speed: float | None = None


# ------------------------------------------------------------------ helpers
def _session(sid: str) -> Session:
    s = manager.get(sid)
    if s is None:
        raise HTTPException(404, "Sessão não encontrada (reinicie o simulador).")
    return s


def _archive(uid: str) -> RdbArchive:
    a = uploads.get(uid)
    if a is None:
        raise HTTPException(404, "Upload não encontrado.")
    return a


# ------------------------------------------------------------------- rdb
@app.post("/api/uploads")
async def upload_rdb(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Arquivo maior que 100 MB.")
    try:
        archive = await run_in_threadpool(parse_rdb, data, file.filename or "arquivo.rdb")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    uid = uuid.uuid4().hex[:12]
    uploads[uid] = archive
    while len(uploads) > 5:
        uploads.pop(next(iter(uploads)))
    return {"upload_id": uid, **archive.summary()}


@app.get("/api/uploads/{uid}")
async def get_upload(uid: str) -> dict:
    return {"upload_id": uid, **_archive(uid).summary()}


@app.get("/api/uploads/{uid}/relays/{rid}/files/{path:path}")
async def relay_file(uid: str, rid: str, path: str) -> PlainTextResponse:
    relay = _archive(uid).relays.get(rid)
    if relay is None or path not in relay.files:
        raise HTTPException(404, "Arquivo não encontrado.")
    return PlainTextResponse(relay.files[path])


@app.get("/api/uploads/{uid}/relays/{rid}/zip")
async def relay_zip(uid: str, rid: str) -> Response:
    relay = _archive(uid).relays.get(rid)
    if relay is None:
        raise HTTPException(404, "Relé não encontrado.")
    name = quote(f"{relay.name}.zip")
    return Response(relay.to_zip(), media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{name}"})


# --------------------------------------------------------------- sessões
@app.post("/api/sessions")
async def create_session(body: SessionCreate) -> dict:
    archive = _archive(body.upload_id)
    relay = archive.relays.get(body.relay_id)
    if relay is None:
        raise HTTPException(404, "Relé não encontrado no arquivo.")
    try:
        sess = manager.create(relay, archive.filename)
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, f"Ajustes inválidos: {exc}") from exc
    info = sess.info()
    info["presets"] = {k: v["label"] for k, v in PRESETS.items()}
    info["fault_types"] = list(FAULT_TYPES)
    return info


@app.get("/api/sessions/{sid}")
async def get_session(sid: str) -> dict:
    s = _session(sid)
    info = s.info()
    info["presets"] = {k: v["label"] for k, v in PRESETS.items()}
    info["fault_types"] = list(FAULT_TYPES)
    return info


@app.delete("/api/sessions/{sid}")
async def delete_session(sid: str) -> dict:
    manager.delete(sid)
    return {"ok": True}


@app.post("/api/sessions/{sid}/restart")
async def restart_session(sid: str) -> dict:
    manager.restart(_session(sid))
    return {"ok": True}


@app.post("/api/sessions/{sid}/control")
async def control(sid: str, body: ControlBody) -> dict:
    s = _session(sid)
    if body.running is not None:
        s.running = body.running
    if body.speed is not None:
        if body.speed not in SPEEDS:
            raise HTTPException(400, f"Velocidade inválida. Use: {SPEEDS}")
        s.speed = body.speed
    return {"running": s.running, "speed": s.speed}


# ----------------------------------------------------------------- painel
@app.get("/api/sessions/{sid}/panel")
async def get_panel(sid: str) -> dict:
    s = _session(sid)
    eng = s.engine
    v = eng.vals
    bk = eng.field.breaker
    meter = {k: round(v.get(k, 0.0), 3) for k in (
        "IA_MAG", "IB_MAG", "IC_MAG", "IG_MAG", "IA_ANG", "IB_ANG", "IC_ANG",
        "VA_MAG", "VB_MAG", "VC_MAG", "VA_ANG", "VB_ANG", "VC_ANG",
        "VAB_MAG", "VBC_MAG", "VCA_MAG", "VAB_ANG", "VBC_ANG", "VCA_ANG",
        "FREQ", "P", "Q", "S", "PF", "3I2", "VDC")}
    return {
        "time": round(eng.t, 3), "running": s.running, "speed": s.speed,
        "panel": eng.panel.snapshot(),
        "breaker": {"state": bk.state(), "closed": bk.closed, "operations": bk.open_count},
        "status": {
            "group": eng.group, "trip": eng.b("TRIP"), "close": eng.b("CLOSE"), "cf": eng.b("CF"),
            "recloser": eng.rc.state if eng.vals.get("79RS", 0) + eng.vals.get("79CY", 0) + eng.vals.get("79LO", 0) else "-",
            "shot": eng.rc.shot, "unresolved": len(eng.unresolved),
        },
        "sim": eng.field.cfg.to_dict(),
        "inputs": [{"name": i.name, "label": i.label, "raw": eng.input_raw(i),
                    "value": eng.b(i.name), "breaker": i.name == eng.bk_input} for i in eng.inputs.values()],
        "outputs": eng.snapshot_outputs(),
        "meter": meter,
    }


@app.post("/api/sessions/{sid}/button")
async def press_button(sid: str, body: ButtonBody) -> dict:
    eng = _session(sid).engine
    name = body.button.upper()
    if name == "TARGET_RESET":
        eng.target_reset()
    elif name.startswith("PB") and name[2:].isdigit() and 1 <= int(name[2:]) <= 8:
        eng.press(int(name[2:]), body.pressed)
    else:
        raise HTTPException(400, "Botão inválido.")
    return {"ok": True}


# -------------------------------------------------------- mesa de teste
@app.post("/api/sessions/{sid}/inputs")
async def set_input(sid: str, body: InputBody) -> dict:
    _session(sid).engine.set_input(body.name, body.value)
    return {"ok": True}


@app.post("/api/sessions/{sid}/breaker")
async def force_breaker(sid: str, body: BreakerBody) -> dict:
    """Move o disjuntor "no campo" (posição física), independente do modo da entrada 52A."""
    eng = _session(sid).engine
    eng.field.force_position(body.closed)
    return {"closed": eng.field.breaker.closed}


@app.post("/api/sessions/{sid}/sim")
async def set_sim(sid: str, body: SimBody) -> dict:
    eng = _session(sid).engine
    try:
        eng.set_sim(body.patch)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return eng.field.cfg.to_dict()


@app.post("/api/sessions/{sid}/fault")
async def apply_fault(sid: str, body: FaultBody) -> dict:
    eng = _session(sid).engine
    try:
        eng.field.apply_fault(body.type, body.current, body.persistent)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return eng.field.cfg.to_dict()


@app.delete("/api/sessions/{sid}/fault")
async def clear_fault(sid: str) -> dict:
    eng = _session(sid).engine
    eng.field.clear_fault()
    return eng.field.cfg.to_dict()


@app.post("/api/sessions/{sid}/preset")
async def preset(sid: str, body: PresetBody) -> dict:
    eng = _session(sid).engine
    p = PRESETS.get(body.name)
    if p is None:
        raise HTTPException(400, "Preset inválido.")
    cfg = eng.field.cfg
    if "load" in p:
        eng.field.set_balanced_load(p["load"])
    if p.get("fault"):
        eng.field.apply_fault(p["fault"], p.get("current"))
    else:
        eng.field.clear_fault()
    return cfg.to_dict()


# ------------------------------------------------------------ estado interno
@app.get("/api/sessions/{sid}/state")
async def get_state(sid: str) -> dict:
    return _session(sid).engine.snapshot_state()


@app.get("/api/sessions/{sid}/ser")
async def get_ser(sid: str, since: int = 0) -> dict:
    return _session(sid).engine.snapshot_ser(since)


@app.delete("/api/sessions/{sid}/ser")
async def clear_ser(sid: str) -> dict:
    _session(sid).engine.ser_log.clear()
    return {"ok": True}


# ------------------------------------------------------------------- DNP3
@app.get("/api/sessions/{sid}/dnp")
async def get_dnp(sid: str, since: int = 0) -> dict:
    return _session(sid).engine.dnp.snapshot(since)


@app.delete("/api/sessions/{sid}/dnp/events")
async def clear_dnp_events(sid: str) -> dict:
    """Limpa a fila de eventos DNP3 (a numeração continua, para não reenviar eventos antigos)."""
    _session(sid).engine.dnp.events.clear()
    return {"ok": True}


@app.post("/api/sessions/{sid}/dnp/command")
async def dnp_command(sid: str, body: DnpCommand) -> dict:
    if body.mode.lower() not in ("select", "operate", "direct"):
        raise HTTPException(400, "Modo inválido (select | operate | direct).")
    return _session(sid).engine.dnp.command(body.index, body.code, body.mode)


@app.post("/api/sessions/{sid}/dnp/map")
async def dnp_map(sid: str, body: DnpMapBody) -> dict:
    d = _session(sid).engine.dnp
    if body.map not in d.available_maps():
        raise HTTPException(400, "Mapa DNP inexistente neste ajuste.")
    d.set_map(body.map)
    return {"map": d.map_id}


# ----------------------------------------------------------------- ajustes
@app.get("/api/sessions/{sid}/settings/{cls}")
async def get_settings(sid: str, cls: str) -> dict:
    st = _session(sid).engine.settings
    items = st.sections.get(cls)
    if items is None:
        raise HTTPException(404, "Classe de ajuste inexistente.")
    out = []
    for key, val in items.items():
        expr, comment = split_comment(val)
        out.append({"key": key, "value": val, "comment": comment, "modified": (cls, key) in st.modified})
    return {"cls": cls, "name": st.class_names.get(cls, cls), "items": out}


@app.get("/api/sessions/{sid}/settings/{cls}/raw")
async def get_settings_raw(sid: str, cls: str) -> PlainTextResponse:
    raw = _session(sid).engine.settings.raw.get(cls)
    if raw is None:
        raise HTTPException(404, "Classe de ajuste inexistente.")
    return PlainTextResponse(raw)


@app.patch("/api/sessions/{sid}/settings")
async def patch_setting(sid: str, body: SettingPatch) -> dict:
    eng = _session(sid).engine
    try:
        eng.apply_setting(body.cls, body.key, body.value)
    except KeyError as exc:
        raise HTTPException(404, f"Ajuste inexistente: {exc}") from exc
    return {"ok": True}


# ---------------------------------------------------------------- frontend
if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_file() and FRONTEND_DIST in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
