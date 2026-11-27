"""API FastAPI do simulador SEL-751."""
from __future__ import annotations

import asyncio
import cmath
import math
import contextlib
import re
import signal
import sys
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .fieldsim import A_OP, A_OP2, FAULT_TYPES, PRESETS
from .rdb import RdbArchive, parse_rdb
from .scl import parse_scl
from .version import __version__
from .selogic import split_comment
from .sessions import SPEEDS, Session, SessionManager

MAX_UPLOAD = 100 * 1024 * 1024
# Empacotado (PyInstaller) o frontend vem junto, em <pacote>/frontend/dist; em desenvolvimento fica na raiz do repositório.
_BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
FRONTEND_DIST = (_BASE / "frontend" / "dist").resolve()

uploads: dict[str, RdbArchive] = {}
manager = SessionManager()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(manager.run())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="Eclipse", version=__version__, lifespan=lifespan)


@app.get("/api/version")
async def api_version() -> dict:
    """Versão do Eclipse servida por este backend (o Sobre compara com a do frontend)."""
    return {"version": __version__}


# Encerramento pedido pela janela do inicializador (launcher.py). O cabeçalho próprio obriga o navegador a fazer preflight CORS,
# então páginas de outras origens não conseguem chamar a rota. Com o servidor dentro do executável, o launcher registra
# `shutdown_hook`; no uvicorn de linha de comando (run.ps1) o SIGINT faz o mesmo que Ctrl+C.
SHUTDOWN_HEADER = "x-eclipse-launcher"
shutdown_hook = None


def _do_shutdown() -> None:
    if shutdown_hook is not None:
        shutdown_hook()
    else:
        signal.raise_signal(signal.SIGINT)


@app.post("/api/shutdown")
async def api_shutdown(request: Request) -> dict:
    """Encerra o servidor local (usado pelo botão Encerrar do inicializador)."""
    if request.headers.get(SHUTDOWN_HEADER) != "1":
        raise HTTPException(403, "Encerramento permitido só pelo inicializador do Eclipse.")
    asyncio.get_running_loop().call_later(0.2, _do_shutdown)
    return {"ok": True}
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


class BitBody(BaseModel):
    name: str
    mode: str = "toggle"


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


@app.post("/api/scada/map/{sid}")
async def scada_map(sid: str, file: UploadFile = File(...)) -> dict:
    """App SCADA: lê a planilha de mapa do relé (.xlsx/.csv) e cruza com o mapa DNP3 ativo (tipo + wordbit)."""
    from .scada import MAX_BYTES, MapError, match_map, parse_map

    s = _session(sid)
    data = await file.read(MAX_BYTES + 1)
    try:
        rows = await run_in_threadpool(parse_map, data, file.filename or "mapa.xlsx")
    except MapError as exc:
        raise HTTPException(400, str(exc)) from exc
    res = match_map(rows, s.engine.dnp)
    return {"relay_id": s.relay.id, "device": s.engine.device_name, "map": s.engine.dnp.map_id, "filename": file.filename, **res}


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


@app.get("/api/sessions")
async def list_sessions() -> list:
    """Sessões ativas (relés instanciados) e o IED do módulo IEC61850 associado a cada uma."""
    return [{"id": s.id, "model": s.engine.model, "relay_id": s.relay.id, "device": s.engine.device_name, "filename": s.filename,
             "running": s.running, "ied": manager.net.bindings.get(s.id),
             "breaker_closed": None if s.engine.model == "2440" else bool(s.engine.field.breaker.closed)} for s in manager.sessions.values()]


@app.get("/api/sessions/{sid}")
async def get_session(sid: str) -> dict:
    s = _session(sid)
    info = s.info()
    info["ied"] = manager.net.bindings.get(sid)
    info["presets"] = {k: v["label"] for k, v in PRESETS.items()}
    info["fault_types"] = list(FAULT_TYPES)
    return info


EXPORT_FORMAT = "eclipse-digitalrelay"


@app.get("/api/sessions/{sid}/export")
async def export_session(sid: str) -> dict:
    """IED simulado em JSON: todos os ajustes do .rdb com as edições feitas no simulador, os arquivos originais do ajuste,
    a injeção e o estado configurado pelo usuário. Os textos do frontal (só do navegador) são acrescentados pelo frontend."""
    s = _session(sid)
    eng = s.engine
    st = eng.settings
    files = {k: (v.decode("latin-1") if isinstance(v, bytes) else v) for k, v in s.relay.files.items()}
    return {
        "format": EXPORT_FORMAT, "version": 1,
        "model": eng.model, "device": eng.device_name, "relay_id": s.relay.id, "relay_name": s.relay.name, "filename": s.filename,
        "header": st.header, "class_names": st.class_names,
        "settings": {cls: dict(items) for cls, items in st.sections.items()},          # valores atuais (com as edições)
        "modified": sorted([cls, key] for cls, key in st.modified),                     # ajustes alterados no simulador
        "original_files": files,                                                         # arquivos do ajuste como vieram do .rdb
        "simulation": {
            "time": round(eng.t, 3), "running": s.running, "speed": s.speed, "group": eng.group,
            "injection": eng.field.cfg.to_dict(),
            "breaker": {"closed": eng.field.breaker.closed, "operations": eng.field.breaker.open_count},
            "inputs": {i.name: bool(i.raw) for i in eng.inputs.values()},
            "forced": dict(eng.forced), "held_bits": dict(eng.fixed),
            "iec61850_ied": manager.net.bindings.get(sid),
        },
    }


MAX_IMPORT_FILES = 200


@app.post("/api/sessions/import")
async def import_session(body: dict) -> dict:
    """Recria um IED a partir do JSON exportado (``/export``): arquivos originais do ajuste, edições feitas no simulador e o estado
    da simulação (injeção, disjuntor, entradas, forçados, bits mantidos, velocidade e IED IEC 61850, se existir no projeto atual).
    Os textos do frontal ficam no navegador e são restaurados pelo frontend."""
    from .rdb import RdbRelay

    if body.get("format") != EXPORT_FORMAT:
        raise HTTPException(400, "O arquivo não é uma exportação de IED do DigitalRelay (formato desconhecido).")
    files = body.get("original_files")
    if not isinstance(files, dict) or not files or len(files) > MAX_IMPORT_FILES \
            or not all(isinstance(k, str) and isinstance(v, str) for k, v in files.items()):
        raise HTTPException(400, "JSON inválido: faltam os arquivos do ajuste (original_files).")
    relay_id = str(body.get("relay_id") or "IED importado")[:64]
    relay = RdbRelay(id=relay_id, name=str(body.get("relay_name") or body.get("device") or relay_id)[:120], files=dict(files))
    alias = str(body.get("device") or "").strip()[:80]
    try:
        sess = manager.create(relay, str(body.get("filename") or "importado.json")[:200])
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, f"Ajustes inválidos: {exc}") from exc
    eng = sess.engine
    if alias and alias != relay.name:                 # IED renomeado antes de exportar
        sess.alias = alias
        eng.device_name = alias
    warnings: list[str] = []
    # 1) ajustes alterados no simulador (valores atuais do JSON para os pares listados em "modified")
    settings = body.get("settings") if isinstance(body.get("settings"), dict) else {}
    for pair in body.get("modified") or []:
        try:
            cls, key = str(pair[0]), str(pair[1])
            value = settings[cls][key]
            eng.apply_setting(cls, key, str(value))
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            warnings.append(f"ajuste {pair} ignorado ({exc})")
    # 2) estado da simulação
    sim = body.get("simulation") if isinstance(body.get("simulation"), dict) else {}
    inj = sim.get("injection")
    if isinstance(inj, dict):
        cfg_keys = set(eng.field.cfg.to_dict())
        try:
            eng.set_sim({k: v for k, v in inj.items() if k in cfg_keys and (isinstance(v, (int, float, bool, str, list)) or v is None)})
        except (TypeError, ValueError) as exc:
            warnings.append(f"injeção parcialmente ignorada ({exc})")
    bk = sim.get("breaker")
    if isinstance(bk, dict) and isinstance(bk.get("closed"), bool) and eng.model != "2440":
        eng.local_breaker(bk["closed"])
    for name, raw in (sim.get("inputs") or {}).items() if isinstance(sim.get("inputs"), dict) else []:
        if isinstance(raw, bool) and name in eng.inputs and name != eng.bk_input:
            eng.inputs[name].raw = raw
    for name, value in (sim.get("forced") or {}).items() if isinstance(sim.get("forced"), dict) else []:
        try:
            eng.force(str(name), float(value))
        except (TypeError, ValueError) as exc:
            warnings.append(f"forçado {name} ignorado ({exc})")
    for name, on in (sim.get("held_bits") or {}).items() if isinstance(sim.get("held_bits"), dict) else []:
        try:
            eng.set_bit(str(name), "set" if on else "clear")
        except ValueError as exc:
            warnings.append(f"bit {name} ignorado ({exc})")
    if isinstance(sim.get("running"), bool):
        sess.running = sim["running"]
    if sim.get("speed") in SPEEDS:
        sess.speed = float(sim["speed"])
    ied = sim.get("iec61850_ied")
    if isinstance(ied, str) and ied:
        try:
            manager.net.bind(sess.id, ied)
            manager.net.reset()
        except ValueError:
            warnings.append(f"IED IEC 61850 \"{ied}\" não está no projeto atual: associação não restaurada")
    info = sess.info()
    info["presets"] = {k: v["label"] for k, v in PRESETS.items()}
    info["fault_types"] = list(FAULT_TYPES)
    info["ied"] = manager.net.bindings.get(sess.id)
    info["warnings"] = warnings
    return info


class RenameBody(BaseModel):
    name: str


@app.patch("/api/sessions/{sid}")
async def rename_session(sid: str, body: RenameBody) -> dict:
    """Renomeia o IED (nome exibido no DigitalRelay, SCADA, SystemLab, IEC61850…). Nome vazio volta ao nome do ajuste no .rdb."""
    s = _session(sid)
    name = re.sub(r"[\x00-\x1f\x7f]", "", body.name).strip()[:80]
    s.alias = name or None
    s.engine.device_name = name or s.relay.name
    return {"device": s.engine.device_name}


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
def _configured_meter(eng, base: dict) -> dict:
    """Injeção desligada: o relé enxerga zero, mas a tela mostra os valores ajustados (só exibição; a lógica não os usa)."""
    I, V = eng.field.phasors(ignore_switch=True)
    m = dict(base)
    resid = I["A"] + I["B"] + I["C"]
    ang = lambda c: math.degrees(cmath.phase(c)) if abs(c) > 1e-9 else 0.0
    for p in "ABC":
        m[f"I{p}_MAG"], m[f"I{p}_ANG"] = abs(I[p]), ang(I[p])
        m[f"V{p}_MAG"], m[f"V{p}_ANG"] = abs(V[p]), ang(V[p])
    m["IG_MAG"] = abs(resid)
    for nm, c in (("VAB", V["A"] - V["B"]), ("VBC", V["B"] - V["C"]), ("VCA", V["C"] - V["A"])):
        m[f"{nm}_MAG"], m[f"{nm}_ANG"] = abs(c), ang(c)
    m["3I2"] = abs(I["A"] + A_OP2 * I["B"] + A_OP * I["C"])
    s = sum(V[p] * I[p].conjugate() for p in "ABC")
    m["P"], m["Q"], m["S"] = s.real / 1000.0, s.imag / 1000.0, abs(s) / 1000.0
    m["PF"] = m["P"] / m["S"] if m["S"] > 1e-6 else 1.0
    return {k: round(x, 3) for k, x in m.items()}


def _winding_meter(eng) -> dict:
    """SEL-787: correntes primárias dos enrolamentos 2 a 4 e do neutro IN1 (com a injeção desligada, os valores ajustados)."""
    cfg = eng.field.cfg
    out: dict[str, float] = {}
    for n in (2, 3, 4):
        for p in "abc":
            mag, ang = getattr(cfg, f"w{n}i{p}_mag"), getattr(cfg, f"w{n}i{p}_ang")
            if cfg.analog_on:
                mag = eng.vals.get(f"I{p.upper()}W{n}_MAG", 0.0)
            out[f"I{p.upper()}W{n}_MAG"], out[f"I{p.upper()}W{n}_ANG"] = round(mag, 3), round(ang, 3)
    out["IN1_MAG"] = round(cfg.in1_mag if not cfg.analog_on else eng.vals.get("IN1_MAG", 0.0), 3)
    out["IN1_ANG"] = round(cfg.in1_ang, 3)
    return out


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
    if not eng.field.cfg.analog_on:
        meter = _configured_meter(eng, meter)
    if eng.model == "787":
        meter.update(_winding_meter(eng))
    return {
        "model": eng.model, "io": eng.snapshot_io() if eng.model == "2440" else None,
        "bits": eng.snapshot_bits(),
        "time": round(eng.t, 3), "running": s.running, "speed": s.speed,
        "panel": eng.panel.snapshot(),
        "breaker": {"state": bk.state(), "closed": bk.closed, "operations": bk.open_count},
        "status": {
            "group": eng.group, "trip": eng.b("TRIP"), "close": eng.b("CLOSE"), "cf": eng.b("CF"),
            "recloser": eng.rc.state if eng.vals.get("79RS", 0) + eng.vals.get("79CY", 0) + eng.vals.get("79LO", 0) else "-",
            "shot": eng.rc.shot, "unresolved": len(eng.unresolved),
        },
        "sim": eng.field.cfg.to_dict(),
        "systemlab": {"linked": eng.sl_linked(), "isolated": eng.field.cfg.sl_isolated},
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


def _check_vb_free(sid: str, name: str) -> None:
    """VBs de um relé associado a um IED do app IEC61850 pertencem ao GOOSE: não podem ser acionados/forçados à mão."""
    ied = manager.net.bindings.get(sid)
    if ied and re.fullmatch(r"VB\d{3}", name.strip().upper()):
        raise HTTPException(409, f"Não é possível forçar {name.strip().upper()}: o relé está associado ao IED {ied} e seus bits virtuais são usados no app IEC61850 do simulador.")


@app.post("/api/sessions/{sid}/bits")
async def set_bit(sid: str, body: BitBody) -> dict:
    """SEL-2440: aciona bits virtuais (VB), de controle (CB) ou remotos (RB): set, clear, toggle ou pulse."""
    _check_vb_free(sid, body.name)
    try:
        _session(sid).engine.set_bit(body.name, body.mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}


class ForceBody(BaseModel):
    name: str
    value: float | None = None      # None = libera


@app.post("/api/sessions/{sid}/force")
async def force_var(sid: str, body: ForceBody) -> dict:
    eng = _session(sid).engine
    if body.value is not None:
        _check_vb_free(sid, body.name)
    try:
        eng.force(body.name, body.value)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"forced": dict(eng.forced)}


@app.delete("/api/sessions/{sid}/force")
async def clear_forces(sid: str) -> dict:
    _session(sid).engine.forced.clear()
    return {"forced": {}}


@app.post("/api/sessions/{sid}/breaker")
async def force_breaker(sid: str, body: BreakerBody) -> dict:
    """Move o disjuntor "no campo" (posição física), independente do modo da entrada 52A."""
    eng = _session(sid).engine
    eng.local_breaker(body.closed)
    return {"closed": eng.field.breaker.closed}


@app.post("/api/sessions/{sid}/sim")
async def set_sim(sid: str, body: SimBody) -> dict:
    """Simulação/injeção manual. Com o relé associado ao SystemLab (e não isolado), as grandezas analógicas vêm do SystemLab."""
    eng = _session(sid).engine
    patch = dict(body.patch)
    if "sl_isolated" in patch:
        eng.set_isolated(bool(patch.pop("sl_isolated")))
    if eng.sl_linked() and not eng.field.cfg.sl_isolated:
        blocked = [k for k in patch if k in set(eng._analog_keys())]
        for k in blocked:
            patch.pop(k)
        if blocked and not patch:
            raise HTTPException(409, "A injeção analógica deste relé vem do SystemLab. Para injetar direto no DigitalRelay, "
                                     "ligue \"Isolar do SystemLab\" no Painel frontal (cartão Medição).")
    try:
        eng.set_sim(patch)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return eng.field.cfg.to_dict()


@app.post("/api/sessions/{sid}/systemlab")
async def set_systemlab(sid: str, body: SimBody) -> dict:
    """Grandezas calculadas pelo SystemLab para o relé associado a um IED (prevalecem sobre a injeção manual, salvo se isolado)."""
    eng = _session(sid).engine
    try:
        eng.apply_systemlab(body.patch)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"isolated": eng.field.cfg.sl_isolated}


@app.delete("/api/sessions/{sid}/settings/{cls}/{key}")
async def revert_setting(sid: str, cls: str, key: str) -> dict:
    """Desfaz a edição de um ajuste: volta ao valor original do arquivo .rdb."""
    eng = _session(sid).engine
    try:
        value = eng.revert_setting(cls, key)
    except KeyError as exc:
        raise HTTPException(404, f"Ajuste inexistente: {exc}") from exc
    return {"value": value}


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
    _session(sid).engine.clear_ser()
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
        mod = (cls, key) in st.modified
        out.append({"key": key, "value": val, "comment": comment, "modified": mod, "original": st.original(cls, key) if mod else None})
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


# ---------------------------------------------------------------- IEC 61850
class BindBody(BaseModel):
    sid: str
    ied: str | None = None


class NetBody(BaseModel):
    vlan_aware: bool | None = None
    latency_ms: float | None = None
    loss_pct: float | None = None
    status_on_loss: bool | None = None
    cut: list[str] | None = None


@app.post("/api/iec61850/files")
async def iec_upload(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, "Arquivo SCL maior que 50 MB.")
    name = file.filename or "arquivo.scd"
    try:
        ieds = await run_in_threadpool(parse_scl, data, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    manager.net.project.add(ieds, name)
    return manager.net.project.to_dict()


@app.get("/api/iec61850")
async def iec_project() -> dict:
    return manager.net.project.to_dict()


@app.delete("/api/iec61850")
async def iec_clear() -> dict:
    net = manager.net
    for s in manager.sessions.values():
        s.engine.ext_bits = {}
    net.project.clear()
    net.bindings.clear()
    net.cut.clear()
    net.reset()
    return {"ok": True}


@app.delete("/api/iec61850/ieds/{name}")
async def iec_remove(name: str) -> dict:
    net = manager.net
    sid = net.sid_of(name)
    if sid and sid in manager.sessions:
        manager.sessions[sid].engine.ext_bits = {}
    net.unbind(sid or "")
    net.cut.discard(name)
    net.project.remove(name)
    return {"ok": True}


class GcbEdit(BaseModel):
    ied: str
    cb: str
    fields: dict


class SubEdit(BaseModel):
    ied: str
    pub: str
    cb: str
    fields: dict = {}
    vbs: dict | None = None


class ResetBody(BaseModel):
    ied: str | None = None


@app.post("/api/iec61850/gcb")
async def iec_edit_gcb(body: GcbEdit) -> dict:
    try:
        manager.net.project.edit_gcb(body.ied, body.cb, body.fields)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return manager.net.project.to_dict()


@app.post("/api/iec61850/sub")
async def iec_edit_sub(body: SubEdit) -> dict:
    try:
        manager.net.project.edit_sub(body.ied, body.pub, body.cb, body.fields, body.vbs)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return manager.net.project.to_dict()


@app.post("/api/iec61850/reset")
async def iec_reset(body: ResetBody) -> dict:
    manager.net.project.reset(body.ied)
    return manager.net.project.to_dict()


@app.get("/api/iec61850/status")
async def iec_status() -> dict:
    return manager.net.status(manager.sessions)


@app.post("/api/iec61850/bind")
async def iec_bind(body: BindBody) -> dict:
    net = manager.net
    _session(body.sid)
    if body.ied is None:
        net.unbind(body.sid)
        manager.sessions[body.sid].engine.ext_bits = {}
    else:
        try:
            net.bind(body.sid, body.ied)
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
    net.reset()
    return {"bindings": dict(net.bindings)}


@app.post("/api/iec61850/network")
async def iec_network(body: NetBody) -> dict:
    net = manager.net
    if body.latency_ms is not None:
        net.latency_ms = max(0.0, min(5000.0, body.latency_ms))
    if body.loss_pct is not None:
        net.loss_pct = max(0.0, min(100.0, body.loss_pct))
    if body.status_on_loss is not None:
        net.status_on_loss = body.status_on_loss
    if body.vlan_aware is not None:
        net.vlan_aware = body.vlan_aware
    if body.cut is not None:
        net.cut = {n for n in body.cut if n in net.project.ieds}
    return {"latency_ms": net.latency_ms, "loss_pct": net.loss_pct, "status_on_loss": net.status_on_loss, "vlan_aware": net.vlan_aware, "cut": sorted(net.cut)}


# ---------------------------------------------------------------- Mirrored Bits (MBitConfig)
class MbEnd(BaseModel):
    sid: str
    port: int


class MbLinkBody(BaseModel):
    a: MbEnd
    b: MbEnd


class MbLinkPatch(BaseModel):
    cut: bool | None = None
    loss_pct: float | None = None


@app.get("/api/mbits")
async def mb_status() -> dict:
    return manager.mb.status(manager.sessions)


@app.post("/api/mbits/links")
async def mb_add(body: MbLinkBody) -> dict:
    _session(body.a.sid)
    _session(body.b.sid)
    try:
        lk = manager.mb.add_link(body.a.sid, body.a.port, body.b.sid, body.b.port)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"id": lk.id}


@app.patch("/api/mbits/links/{lid}")
async def mb_patch(lid: str, body: MbLinkPatch) -> dict:
    lk = manager.mb.links.get(lid)
    if lk is None:
        raise HTTPException(404, "Link não encontrado.")
    if body.cut is not None:
        lk.cut = body.cut
    if body.loss_pct is not None:
        lk.loss_pct = max(0.0, min(100.0, body.loss_pct))
    return {"ok": True}


@app.delete("/api/mbits/links/{lid}")
async def mb_delete(lid: str) -> dict:
    manager.mb.remove_link(lid)
    return {"ok": True}


@app.post("/api/mbits/clear")
async def mb_clear() -> dict:
    manager.mb.reset_stats()
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
