"""App SCADA: planilha de mapa (.xlsx/.csv) cruzada com o mapa DNP3 ativo do relé."""
from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.main import app, manager
from app.rdb import RdbRelay
from app.scada import MapError, parse_map

HDR = "[INFO]\nRELAYTYPE=SEL-751\nFID=SEL-751-R000\n"
D1 = HDR + '[D1]\nBI_00,"IN101"\nBI_01,"TRIP"\nBI_02,"NA"\nAI_00,"IA_MAG:1:10"\nBO_00,"RB01"\nBO_01,"RB02"\n'
R = HDR + '[R]\nSER1,"IN101"\nALIAS1,"IN101 DISJ FECHADO ABERTO"\n'


def xlsx(rows: list[list[object]]) -> bytes:
    """Gera um .xlsx mínimo (strings inline e números) como o Excel salvaria."""
    def cell(ref: str, v: object) -> str:
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        return f'<c r="{ref}" t="inlineStr"><is><t>{v}</t></is></c>'
    body = "".join(
        f'<row r="{i + 1}">' + "".join(cell(f"{chr(65 + j)}{i + 1}", v) for j, v in enumerate(r) if v != "") + "</row>"
        for i, r in enumerate(rows))
    sheet = f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{body}</sheetData></worksheet>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


HEAD = ["Tipo", "Posição", "Wordbit", "Descrição", "Valor 0", "Valor 1"]
ROWS = [
    HEAD,
    ["BI", 0, "IN101", "Disjuntor 52", "Aberto", "Fechado"],
    ["BI", 1, "TRIP", "", "", "Atuado"],                 # descrição e Valor 0 faltando: prevalecem os do relé
    ["BI", 7, "XYZ", "Inexistente", "a", "b"],            # wordbit fora do mapa: rejeitado
    ["AI", 0, "IA_MAG", "Corrente fase A", "x", "y"],    # AI ignora Valor 0/1
    ["BO", 5, "RB02", "Fechar disjuntor", "", ""],       # posição diferente: aceita com a posição do relé
    ["XX", 1, "RB01", "Tipo errado", "", ""],
]


@pytest.fixture()
def sess():
    files = {"set_1.txt": HDR + '[1]\nCTR,"100"\n', "set_L1.txt": HDR + '[L1]\nELAT,"0"\nESV,"0"\n', "set_D1.txt": D1, "set_R.txt": R}
    s = manager.create(RdbRelay(id="S", name="scada", files=files), "s.rdb")
    yield s
    manager.delete(s.id)


def test_parse_xlsx_and_match(sess):
    c = TestClient(app)
    r = c.post(f"/api/scada/map/{sess.id}", files={"file": ("mapa.xlsx", xlsx(ROWS))})
    assert r.status_code == 200, r.text
    d = r.json()
    acc = {(a["tipo"], a["wordbit"]): a for a in d["accepted"]}
    assert set(acc) == {("BI", "IN101"), ("BI", "TRIP"), ("AI", "IA_MAG"), ("BO", "RB02")}
    assert acc[("BI", "IN101")] == {"line": 2, "tipo": "BI", "index": 0, "wordbit": "IN101", "desc": "Disjuntor 52", "v0": "Aberto", "v1": "Fechado"}
    assert "desc" not in acc[("BI", "TRIP")] and "v0" not in acc[("BI", "TRIP")] and acc[("BI", "TRIP")]["v1"] == "Atuado"
    assert "v0" not in acc[("AI", "IA_MAG")] and "v1" not in acc[("AI", "IA_MAG")]
    assert acc[("BO", "RB02")]["index"] == 1 and "note" in acc[("BO", "RB02")]
    reasons = {x["wordbit"]: x["reason"] for x in d["rejected"]}
    assert "XYZ" in reasons and "RB01" in reasons and "Tipo inválido" in reasons["RB01"]


def test_csv_and_dnp_state_texts(sess):
    c = TestClient(app)
    csv = "Tipo;Posição;Wordbit;Descrição;Valor 0;Valor 1\nBI;0;IN101;Disj;Aberto;Fechado\n".encode()
    d = c.post(f"/api/scada/map/{sess.id}", files={"file": ("mapa.csv", csv)}).json()
    assert [a["wordbit"] for a in d["accepted"]] == ["IN101"]
    bi = c.get(f"/api/sessions/{sess.id}/dnp").json()["bi"]
    assert bi[0]["t1"] == "FECHADO" and bi[0]["t0"] == "ABERTO"          # textos do ALIAS do relé (padrão sem planilha)


def test_invalid_files():
    with pytest.raises(MapError):
        parse_map(b"nao e zip", "x.xlsx")
    with pytest.raises(MapError):
        parse_map(xlsx([["A", "B"], ["1", "2"]]), "x.xlsx")              # sem a coluna Wordbit
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", '<!DOCTYPE x [<!ENTITY a "b">]><worksheet/>')
    with pytest.raises(MapError):
        parse_map(bomb.getvalue(), "x.xlsx")
