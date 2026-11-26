"""App SCADA: leitura da planilha de mapa (Tipo | Posição | Wordbit | Descrição | Valor 0 | Valor 1) e cruzamento com o mapa
DNP3 ativo do relé.

A planilha é um dado NÃO confiável: só é lida (``.xlsx`` = zip de XML, sem macros; ``.csv``), com limites de tamanho e de
linhas, e XML com DOCTYPE/entidades é recusado. Não usa bibliotecas externas.
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 5000
MAX_XML = 40 * 1024 * 1024          # soma descompactada dos XML lidos (proteção contra zip-bomb)
_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
       "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
       "pr": "http://schemas.openxmlformats.org/package/2006/relationships"}
TYPES = ("BI", "AI", "BO")


class MapError(ValueError):
    pass


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


# cabeçalho normalizado -> campo
_HEAD = {"tipo": "tipo", "type": "tipo", "posicao": "pos", "pos": "pos", "indice": "pos", "index": "pos",
         "wordbit": "wordbit", "relayword": "wordbit", "bit": "wordbit", "descricao": "desc", "description": "desc",
         "valor0": "v0", "value0": "v0", "estado0": "v0", "valor1": "v1", "value1": "v1", "estado1": "v1"}


def _xml(z: zipfile.ZipFile, name: str, budget: list[int]) -> ET.Element:
    info = z.getinfo(name)
    budget[0] -= info.file_size
    if budget[0] < 0:
        raise MapError("Planilha grande demais depois de descompactada.")
    data = z.read(name)
    if b"<!DOCTYPE" in data[:4096].upper() or b"<!ENTITY" in data.upper():
        raise MapError("Planilha com XML não suportado (DOCTYPE/ENTITY).")
    return ET.fromstring(data)


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _rows_xlsx(data: bytes) -> list[list[str]]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise MapError("Arquivo .xlsx inválido (o formato .xls antigo não é suportado: salve como .xlsx ou .csv).") from exc
    budget = [MAX_XML]
    names = set(z.namelist())
    shared: list[str] = []
    if "xl/sharedStrings.xml" in names:
        for si in _xml(z, "xl/sharedStrings.xml", budget).findall("m:si", _NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t")))
    # primeira planilha do workbook
    sheet = "xl/worksheets/sheet1.xml"
    if "xl/workbook.xml" in names and "xl/_rels/workbook.xml.rels" in names:
        wb = _xml(z, "xl/workbook.xml", budget)
        first = wb.find("m:sheets/m:sheet", _NS)
        rels = _xml(z, "xl/_rels/workbook.xml.rels", budget)
        if first is not None:
            rid = first.get(f"{{{_NS['r']}}}id")
            for rel in rels.findall("pr:Relationship", _NS):
                if rel.get("Id") == rid:
                    t = rel.get("Target", "").lstrip("/")
                    sheet = t if t.startswith("xl/") else "xl/" + t
    if sheet not in names:
        raise MapError("Planilha sem a primeira aba (sheet1).")
    out: list[list[str]] = []
    for row in _xml(z, sheet, budget).iter(f"{{{_NS['m']}}}row"):
        cells: dict[int, str] = {}
        for c in row.findall("m:c", _NS):
            ref = c.get("r", "")
            idx = _col(ref) if ref else len(cells)
            t = c.get("t", "")
            if t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{_NS['m']}}}t"))
            else:
                v = c.find("m:v", _NS)
                val = v.text if v is not None and v.text is not None else ""
                if t == "s" and val.strip().isdigit() and int(val) < len(shared):
                    val = shared[int(val)]
                elif t in ("", "n") and re.fullmatch(r"-?\d+\.0+", val or ""):
                    val = val.split(".")[0]                   # 3.0 → 3 (posição)
            cells[idx] = val
        if cells:
            width = max(cells) + 1
            out.append([cells.get(i, "") for i in range(width)])
        if len(out) > MAX_ROWS + 1:
            raise MapError(f"Planilha com mais de {MAX_ROWS} linhas.")
    return out


def _rows_csv(data: bytes) -> list[list[str]]:
    text = data.decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    delim = ";" if sample.count(";") >= sample.count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if len(rows) > MAX_ROWS + 1:
        raise MapError(f"Planilha com mais de {MAX_ROWS} linhas.")
    return rows


def parse_map(data: bytes, filename: str) -> list[dict]:
    """Linhas da planilha como dicionários {line, tipo, pos, wordbit, desc, v0, v1} (texto cru)."""
    if len(data) > MAX_BYTES:
        raise MapError("Planilha maior que 10 MB.")
    low = filename.lower()
    rows = _rows_csv(data) if low.endswith((".csv", ".txt")) else _rows_xlsx(data)
    # cabeçalho: primeira linha que tenha a coluna Wordbit
    head_i, cols = -1, {}
    for i, r in enumerate(rows[:20]):
        m = {_HEAD[_norm(c)]: j for j, c in enumerate(r) if _norm(c) in _HEAD}
        if "wordbit" in m:
            head_i, cols = i, m
            break
    if head_i < 0:
        raise MapError("Cabeçalho não encontrado: a planilha precisa das colunas Tipo | Posição | Wordbit | Descrição | Valor 0 | Valor 1.")
    out = []
    for n, r in enumerate(rows[head_i + 1:], start=head_i + 2):
        get = lambda k: (r[cols[k]] if k in cols and cols[k] < len(r) else "").strip()   # noqa: E731
        if not any(x.strip() for x in r):
            continue
        out.append({"line": n, "tipo": get("tipo").upper(), "pos": get("pos"), "wordbit": get("wordbit").upper(),
                    "desc": get("desc"), "v0": get("v0"), "v1": get("v1")})
    return out


def match_map(rows: list[dict], dnp) -> dict:
    """Cruza as linhas com o mapa DNP ativo do relé (``DnpMap``): aceita o que coincide (tipo + wordbit), rejeita o resto.
    Campos vazios ficam de fora (prevalece o texto da wordbit do relé). AI e BO ignoram Valor 0 / Valor 1."""
    by_type = {"BI": dnp.bi, "AI": {i: v[0] for i, v in dnp.ai.items()}, "BO": dnp.bo}
    accepted, rejected = [], []
    for r in rows:
        tipo, wb = r["tipo"], r["wordbit"]
        if tipo not in TYPES:
            rejected.append({**r, "reason": f"Tipo inválido ({tipo or 'vazio'}): use BI, AI ou BO"})
            continue
        if not wb:
            rejected.append({**r, "reason": "Wordbit vazia"})
            continue
        points = {name: idx for idx, name in by_type[tipo].items() if name and name != "NA"}
        if wb not in points:
            rejected.append({**r, "reason": f"{wb} não está no mapa DNP ({tipo}) do relé"})
            continue
        idx = points[wb]
        item = {"line": r["line"], "tipo": tipo, "index": idx, "wordbit": wb}
        if r["desc"]:
            item["desc"] = r["desc"]
        if tipo == "BI":
            if r["v0"]:
                item["v0"] = r["v0"]
            if r["v1"]:
                item["v1"] = r["v1"]
        note = ""
        if r["pos"] and r["pos"].lstrip("-").isdigit() and int(r["pos"]) != idx:
            note = f"posição da planilha ({r['pos']}) difere da do relé ({idx}); usada a do relé"
        if note:
            item["note"] = note
        accepted.append(item)
    return {"accepted": accepted, "rejected": rejected}
