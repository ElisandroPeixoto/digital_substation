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


def test_endpoint_versao():
    with TestClient(app) as c:
        assert c.get("/api/version").json() == {"version": __version__}
