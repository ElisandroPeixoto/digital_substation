"""Disjuntor (campo): variáveis de abertura/fechamento e entrada de estado escolhidas pelo usuário; simulação ligada/desligada.

Usa o ajuste sintético do SEL-311C (OUT101 = TRIP, OUT102 = SV1T com SV1 = OC + LB7, OUT103 = CLOSE, 52A = IN101).
"""
from __future__ import annotations

import pytest

from test_sel311c import make, run


def test_padrao_deduzido_dos_ajustes():
    eng = make()
    assert eng.trip_outs == ["OUT101"] and eng.close_outs == ["OUT103"]
    assert eng.auto_trip_outs == ["OUT101"] and eng.bk_input == "IN101" == eng.auto_bk_input


def test_variavel_de_abertura_escolhida_abre_o_disjuntor():
    eng = make()
    eng.set_sim({"bk_trip": "out102"})                         # minúsculas e espaços são aceitos
    assert eng.trip_outs == ["OUT102"] and eng.auto_trip_outs == ["OUT101"]
    assert eng.field.cfg.bk_trip == "OUT102"
    assert eng.field.breaker.closed
    eng.set_bit("LB7", "pulse")                                 # SV1T → OUT102 (não é TRIP): agora abre o disjuntor
    run(eng, 0.3)
    assert not eng.field.breaker.closed and eng.vals["IN101"] == 0 and eng.vals["52A"] == 0
    eng.set_sim({"bk_trip": ""})                                # vazio volta ao automático
    assert eng.trip_outs == ["OUT101"]


def test_variavel_desconhecida_e_estado_invalido_sao_recusados():
    eng = make()
    with pytest.raises(ValueError):
        eng.set_sim({"bk_close": "OUT103, NAOEXISTE"})
    with pytest.raises(ValueError):
        eng.set_sim({"bk_status": "OUT101"})
    assert eng.close_outs == ["OUT103"] and eng.bk_input == "IN101"


def test_entrada_de_estado_escolhida_acompanha_o_disjuntor():
    eng = make()
    eng.set_sim({"bk_status": "IN102"})
    assert eng.bk_input == "IN102"
    eng.local_breaker(False)
    run(eng, 0.1)
    assert eng.vals["IN102"] == 0                               # a nova entrada segue a posição
    eng.local_breaker(True)
    run(eng, 0.1)
    assert eng.vals["IN102"] == 1
    eng.set_input("IN101", False)                               # a antiga ficou livre: não move o disjuntor
    run(eng, 0.1)
    assert eng.field.breaker.closed and eng.vals["IN101"] == 0


def test_sem_simulacao_as_bobinas_nao_movem_o_disjuntor():
    eng = make()
    eng.set_sim({"breaker_auto": False, "bk_trip": "OUT102"})
    eng.set_bit("LB7", "pulse")
    run(eng, 0.3)
    assert eng.vals["OUT102"] == 1 and eng.field.breaker.closed  # saída atuou, mas não há disjuntor simulado
