from __future__ import annotations

from app.selogic import Expr, split_comment


def ev(text: str, **vals) -> float:
    e = Expr(text)
    return e.eval(lambda n: float(vals.get(n, 0.0)))


def test_precedence_and_over_or():
    assert ev("A OR B AND C", A=1, B=0, C=0) == 1
    assert ev("A OR B AND C", A=0, B=1, C=0) == 0
    assert ev("(A OR B) AND C", A=1, B=0, C=0) == 0


def test_not_and_comments():
    e = Expr("NOT LT03 AND 52A # exemplo")
    assert e.comment == "exemplo"
    assert e.eval(lambda n: {"LT03": 0, "52A": 1}.get(n, 0)) == 1


def test_identifiers_starting_with_digits():
    assert ev("50P1T OR 51AP", **{"50P1T": 0, "51AP": 1}) == 1


def test_math_and_numbers():
    assert ev("VAB_MAG / 1000.00", VAB_MAG=13800) == 13.8
    assert ev("1") == 1 and ev("0") == 0
    assert ev("A / 0", A=5) == 0.0
    assert ev("IA > 100 AND IA <= 200", IA=150) == 1


def test_disabled_expressions():
    for src in ("NA", "OFF", "", "  "):
        assert Expr(src).disabled
        assert Expr(src).eval(lambda n: 1.0) == 0.0


def test_invalid_expression_does_not_raise():
    e = Expr("A AND (B")
    assert e.error
    assert e.eval(lambda n: 1.0) == 0.0


def test_edges_use_each_evaluation_once_per_scan():
    e = Expr("R_TRIG PB OR 0")        # sem curto-circuito: a borda é sempre rastreada
    state = {"PB": 0.0}
    r = lambda n: state[n]
    assert e.eval(r) == 0          # primeira avaliação nunca gera borda
    state["PB"] = 1.0
    assert e.eval(r) == 1          # borda de subida
    assert e.eval(r) == 0          # mantido -> sem borda
    f = Expr("F_TRIG PB")
    state["PB"] = 1.0
    f.eval(r)
    state["PB"] = 0.0
    assert f.eval(r) == 1          # borda de descida


def test_edge_inside_short_circuited_branch_still_tracks():
    e = Expr("A AND R_TRIG PB")
    s = {"A": 0.0, "PB": 0.0}
    r = lambda n: s[n]
    e.eval(r)
    s["PB"] = 1.0
    e.eval(r)                      # A=0, mas o R_TRIG registra PB=1
    s["A"] = 1.0
    assert e.eval(r) == 0          # PB já estava em 1: não há borda agora


def test_split_comment():
    assert split_comment("X AND Y # texto # mais") == ("X AND Y", "texto # mais")
    assert split_comment("X") == ("X", "")
