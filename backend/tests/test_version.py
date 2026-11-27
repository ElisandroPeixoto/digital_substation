import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.version import __version__

ROOT = Path(__file__).resolve().parents[2]


def test_versao_igual_no_frontend_e_backend():
    pkg = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf8"))
    assert pkg["version"] == __version__
    assert re.fullmatch(r"\d+\.\d+\.\d+", __version__)
    assert f"## {__version__}" in (ROOT / "CHANGELOG.md").read_text(encoding="utf8")
    assert f"## {__version__}" in (ROOT / "docs" / "historico-versoes.md").read_text(encoding="utf8")


def test_endpoint_versao():
    with TestClient(app) as c:
        assert c.get("/api/version").json() == {"version": __version__}


def test_encerramento_pelo_inicializador(monkeypatch):
    import time

    from app import main

    called = []
    monkeypatch.setattr(main, "shutdown_hook", lambda: called.append(True))
    with TestClient(app) as c:
        assert c.post("/api/shutdown").status_code == 403          # sem o cabeçalho do inicializador
        assert c.post("/api/shutdown", headers={"X-Eclipse-Launcher": "1"}).json() == {"ok": True}
        t0 = time.time()
        while not called and time.time() - t0 < 2:
            c.get("/api/version")                                  # mantém o laço do servidor girando até o call_later
            time.sleep(0.05)
    assert called
