"""Coluna "Ajuste (primário)" da aba Variáveis internas: A, V e Ω do texto do ajuste convertidos com TC/TP."""
from __future__ import annotations

from test_overcurrent import make as make751
from test_sel311c import make as make311
from test_sel787 import make as make787


def pri(eng, name: str) -> str:
    els = {e.info()["name"]: e for e in eng.elements}
    return eng._with_primary(els[name])["setting_pri"]


def test_751_fase_e_neutro():
    eng = make751(**{"50P1P": "10", "50N1P": "0.5", "51P1P": "2"})   # CTR = CTRN = 100
    assert pri(eng, "50P1").startswith("1000 A")
    assert pri(eng, "50N1").startswith("50 A")
    assert pri(eng, "51P1").startswith("200 A, curva C1")


def test_787_usa_o_tc_de_cada_enrolamento():
    eng = make787({"50P11P": "6", "50P11D": "0.1", "50P21P": "8", "50P21D": "0", "50P21TC": "1"})   # CTR1 = 100, CTR2 = 400
    assert pri(eng, "50P11").startswith("600 A")
    assert pri(eng, "50P21").startswith("3200 A")


def test_311c_distancia_e_correntes():
    eng = make311()                                                 # CTR = 120, PTR = 600
    assert pri(eng, "M1P") == "Z1P = 31.2 Ω, 50PP1 = 60 A"
    assert pri(eng, "Zn T") == "–"                                  # só tempos: nada a converter
