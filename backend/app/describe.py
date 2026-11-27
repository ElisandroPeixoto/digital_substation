"""Rótulos e descrições legíveis dos bits, extraídos dos próprios ajustes.

Fontes: comentários (``# ...``) das equações, ALIAS do relatório SER e pontos de
display (DP). Nada aqui afeta a simulação – só a apresentação.
"""
from __future__ import annotations

import csv
import re

from .selogic import split_comment
from .settings import RelaySettings

_NORMAL_WORDS = {"NORMAL", "FECHADO", "CARREGADA", "OK", "PRESENTE", "LIGADO", "ENERGIZADO",
                 "DESBLOQUEADA", "DESBLOQUEADO"}
_FMT_RE = re.compile(r"\{(\d+)(?:\.(\d+))?(?:,\s*(-?\d+(?:\.\d+)?))?\}")
_RE_CMD = re.compile(r"^(RB\d{1,2}|OC|CC)$")
_RE_OC = re.compile(r"^(50|51)([ABCPNGQ]\d?)([PT])$")
_ELEM = {"A": "fase A", "B": "fase B", "C": "fase C", "P": "fase", "N": "neutro", "G": "terra", "Q": "seq. negativa"}
_STANDARD = {
    "IA_MAG": "Corrente fase A (A prim.)", "IB_MAG": "Corrente fase B (A prim.)", "IC_MAG": "Corrente fase C (A prim.)",
    "IG_MAG": "Corrente residual IG (A prim.)", "IN_MAG": "Corrente de neutro IN (A prim.)",
    "VA_MAG": "Tensão fase A (V prim.)", "VB_MAG": "Tensão fase B (V prim.)", "VC_MAG": "Tensão fase C (V prim.)",
    "VAB_MAG": "Tensão AB (V prim.)", "VBC_MAG": "Tensão BC (V prim.)", "VCA_MAG": "Tensão CA (V prim.)",
    "P": "Potência ativa trifásica (kW)", "Q": "Potência reativa trifásica (kVAr)", "PF": "Fator de potência",
    "MWH3P": "Energia ativa (MWh)", "MWH3PI": "Energia ativa recebida (MWh)",
    "MVARH3PO": "Energia reativa fornecida (MVArh)", "MVARH3PI": "Energia reativa recebida (MVArh)",
    "FIA": "Corrente de falta fase A", "FIB": "Corrente de falta fase B", "FIC": "Corrente de falta fase C",
    "FIG": "Corrente de falta residual", "FIN": "Corrente de falta de neutro", "FLOC": "Localização da falta",
    "VDC": "Tensão CC do relé (V)", "3I2": "Corrente de sequência negativa 3I2", "3V2": "Tensão de sequência negativa 3V2",
    "TRIP": "Disparo (TRIP)", "CLOSE": "Comando de fechamento", "79RS": "Religamento em repouso",
    "79CY": "Religamento em ciclo", "79LO": "Religamento em bloqueio", "52A": "Estado do disjuntor (1 = fechado)",
}


def standard_label(name: str) -> str:
    """Descrição de bits/grandezas padrão do SEL-751 (fallback quando os ajustes não explicam)."""
    name = name.upper()
    if name in _STANDARD:
        return _STANDARD[name]
    m = _RE_OC.match(name)
    if m:
        fn, elem, suf = m.groups()
        what = "Instantâneo" if fn == "50" else "Temporizado"
        level = elem[1:] if len(elem) > 1 else ""
        return f"{what} {_ELEM[elem[0]]}{' nível ' + level if level else ''} – {'partida' if suf == 'P' else 'disparo'}"
    return ""


def parse_dp(value: str) -> dict | None:
    """Interpreta um ponto de display (DPnn). Retorna None se vazio."""
    value = value.strip()
    if not value:
        return None
    try:
        rows = next(csv.reader([value]))
    except (csv.Error, StopIteration):
        return None
    if not rows or not rows[0].strip():
        return None
    name = rows[0].strip().upper()
    rest = rows[1:]
    fmt_field = next((f for f in rest if "{" in f), None)
    if fmt_field is not None:
        return {"name": name, "kind": "numeric", "fmt": fmt_field}
    if len(rest) == 1:
        return {"name": name, "kind": "bool", "text1": rest[0], "text0": ""}
    text1 = rest[1] if len(rest) >= 2 else ""
    text0 = rest[2] if len(rest) >= 3 else ""
    return {"name": name, "kind": "bool", "text1": text1, "text0": text0}


def format_dp(fmt: str, value) -> str:
    """Aplica o formato ``{largura.decimais,escala}`` do display do SEL-751."""
    def repl(m: re.Match) -> str:
        width = int(m.group(1))
        dec = m.group(2)
        scale = float(m.group(3)) if m.group(3) else 1.0
        if isinstance(value, str):
            return value[:width].ljust(width)
        num = value * scale
        return f"{num:{width}.{int(dec) if dec is not None else 0}f}"
    return _FMT_RE.sub(repl, fmt)


def _aliases(settings: RelaySettings) -> dict[str, tuple[str, str, str]]:
    out: dict[str, tuple[str, str, str]] = {}
    for key, val in settings.sections.get("R", {}).items():
        if key.startswith("ALIAS") and key != "EALIAS":
            parts = val.split()
            if len(parts) >= 4:
                out[parts[0].upper()] = (parts[1], parts[2], parts[3])
    return out


def _text_dps(settings: RelaySettings) -> list[tuple[str, str, str]]:
    """Pontos de display do SEL-311C: bit em ``DPn`` (Lógica 1) e textos ``DPn_1``/``DPn_0`` (classe T)."""
    T = settings.sections.get("T", {})
    L = settings.sections.get("L1", {})
    out = []
    for n in range(1, 17):
        bit = split_comment(L.get(f"DP{n}", ""))[0].upper()
        if bit and re.fullmatch(r"[A-Z0-9_]+", bit):
            out.append((bit, T.get(f"DP{n}_1", "").strip(), T.get(f"DP{n}_0", "").strip()))
    return out


def normal_state(settings: RelaySettings, bit: str) -> bool | None:
    """Estado "normal" (1 ou 0) de um bit, deduzido de ALIAS e dos pontos de display."""
    bit = bit.upper()
    al = _aliases(settings).get(bit)
    if al:
        if al[1].upper() in _NORMAL_WORDS:
            return True
        if al[2].upper() in _NORMAL_WORDS:
            return False
    for key, val in settings.sections.get("F", {}).items():
        if re.fullmatch(r"DP\d\d", key):
            dp = parse_dp(val)
            if dp and dp["kind"] == "bool" and dp["name"] == bit:
                if dp["text0"] and not dp["text1"]:
                    return True
                if dp["text1"] and not dp["text0"]:
                    return False
    for name, t1, t0 in _text_dps(settings):
        if name == bit:
            if t0 and not t1:
                return True
            if t1 and not t0:
                return False
    return None


def build_labels(settings: RelaySettings) -> dict[str, str]:
    """Mapa nome-do-bit -> descrição curta."""
    labels: dict[str, str] = {}
    lsec = settings.sections.get("L1", {})
    gsec = settings.sections.get("1", {})
    # latches, variáveis e saídas pelo comentário da própria equação
    for key, val in lsec.items():
        _, comment = split_comment(val)
        if not comment:
            continue
        m = re.fullmatch(r"SET(\d{1,2})", key)
        if m:
            labels[f"LT{m.group(1)}"] = comment
        elif re.fullmatch(r"SV\d{1,2}", key):
            labels[key] = comment
            labels[key + "T"] = comment
        elif re.fullmatch(r"OUT\d{3}", key):
            labels[key] = comment
        elif re.fullmatch(r"MV\d\d", key):
            labels[key] = comment
    # equações que apenas "repassam" um bit (ex.: 52A = IN101 # ESTADO DO DISJUNTOR)
    for items in (gsec, lsec):
        for key, val in items.items():
            expr, comment = split_comment(val)
            if comment and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", expr) and not key.startswith(("SET", "RST")):
                labels.setdefault(expr.upper(), comment)
    # comandos remotos (RBnn, OC, CC): usa o comentário da equação em que aparecem
    for items in (gsec, lsec):
        for key, val in items.items():
            expr, comment = split_comment(val)
            if not comment:
                continue
            for ident in re.findall(r"[A-Za-z0-9_]+", expr):
                if _RE_CMD.match(ident.upper()):
                    labels.setdefault(ident.upper(), comment)
    for bit, (name, t1, t0) in _aliases(settings).items():
        labels.setdefault(bit, f"{name.replace('_', ' ')} ({t1}/{t0})")
    for key, val in settings.sections.get("F", {}).items():
        if re.fullmatch(r"DP\d\d", key):
            dp = parse_dp(val)
            if dp and dp["kind"] == "bool":
                text = dp["text1"] or dp["text0"]
                if text and dp["name"] != "1":
                    labels.setdefault(dp["name"], text.title())
    # SEL-311C: pontos de display (classe T) e nomes dos bits locais (NLBn)
    for name, t1, t0 in _text_dps(settings):
        text = t1 or t0
        if text and name != "1":
            labels.setdefault(name, text.title())
    for key, val in settings.sections.get("T", {}).items():
        m = re.fullmatch(r"NLB(\d{1,2})", key)
        if m and val.strip():
            labels.setdefault(f"LB{m.group(1)}", val.strip())
    return labels
