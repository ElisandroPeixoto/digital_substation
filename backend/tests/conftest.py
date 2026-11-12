from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

RDB_PATH = ROOT / "Padrões SEL-751.rdb"
FEEDER_NAME = "SEL751 - Alimentador v1.24"

needs_rdb = pytest.mark.skipif(not RDB_PATH.exists(), reason="arquivo .rdb de exemplo ausente")


@pytest.fixture(scope="session")
def archive():
    from app.rdb import parse_rdb
    return parse_rdb(RDB_PATH.read_bytes(), RDB_PATH.name)


@pytest.fixture()
def feeder(archive):
    """Engine do relé 'Alimentador v1.24' com pickups de teste."""
    from app.sessions import create_engine
    relay = next(r for r in archive.relays.values() if r.name == FEEDER_NAME)
    eng = create_engine(relay)
    return eng


def run(eng, seconds: float, dt: float = 0.01) -> None:
    for _ in range(int(round(seconds / dt))):
        eng.step(dt)


def tap(eng, n: int, hold: float = 0.05) -> None:
    """Pressiona e solta o botão n do painel."""
    eng.press(n, True)
    run(eng, hold)
    eng.press(n, False)
    run(eng, hold)
