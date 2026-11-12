"""Parser dos arquivos de ajuste (set_*.txt) do SEL-751."""
from __future__ import annotations

import re
from collections import OrderedDict

_SET_FILE_RE = re.compile(r"(?:^|/)set_([A-Za-z0-9]+)\.txt$", re.IGNORECASE)


def _unquote(rest: str) -> str:
    rest = rest.strip()
    if not rest.startswith('"'):
        return rest
    out: list[str] = []
    i = 1
    n = len(rest)
    while i < n:
        c = rest[i]
        if c == '"':
            if i + 1 < n and rest[i + 1] == '"':
                out.append('"')
                i += 2
                continue
            break
        out.append(c)
        i += 1
    return "".join(out)


def parse_set_text(text: str) -> tuple[str | None, dict[str, str], "OrderedDict[str, str]"]:
    """Retorna (classe, cabeçalho [INFO], ajustes)."""
    header: dict[str, str] = {}
    items: "OrderedDict[str, str]" = OrderedDict()
    section: str | None = None
    main: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            if section.upper() != "INFO":
                main = section
            continue
        if section is not None and section.upper() == "INFO":
            key, _, value = line.partition("=")
            header[key.strip()] = value.strip()
            continue
        key, sep, rest = line.partition(",")
        if not sep:
            continue
        items[key.strip()] = _unquote(rest)
    return main, header, items


class RelaySettings:
    """Todos os ajustes carregados de um relé, por classe (G, 1..4, L1..L4, F, R, D1...)."""

    def __init__(self) -> None:
        self.sections: dict[str, "OrderedDict[str, str]"] = {}
        self.raw: dict[str, str] = {}            # classe -> texto original
        self.header: dict[str, str] = {}
        self.class_names: dict[str, str] = {}
        self.device_name: str = ""
        self.modified: set[tuple[str, str]] = set()

    @classmethod
    def from_files(cls, files: dict[str, str]) -> "RelaySettings":
        rs = cls()
        for path, text in files.items():
            lower = path.lower()
            if lower.endswith("misc/device.txt"):
                rs.device_name = text.strip()
                continue
            if lower.endswith("misc/cfg.txt"):
                rs._parse_cfg(text)
                continue
            if lower.endswith("set_hmi.txt"):
                continue  # tela touchscreen: fora do escopo
            m = _SET_FILE_RE.search(path)
            if not m:
                continue
            section, header, items = parse_set_text(text)
            key = section or m.group(1)
            rs.sections[key] = items
            rs.raw[key] = text
            if header and not rs.header:
                rs.header = header
        if "1" not in rs.sections:
            raise ValueError("O ajuste não contém o arquivo set_1.txt (Grupo 1).")
        return rs

    def _parse_cfg(self, text: str) -> None:
        in_classes = False
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("["):
                in_classes = s.upper() == "[CLASSES]"
                continue
            if in_classes and "," in s:
                key, _, rest = s.partition(",")
                self.class_names[key.strip()] = _unquote(rest)

    # -- acesso -----------------------------------------------------------
    def get(self, cls: str, key: str, default: str = "") -> str:
        return self.sections.get(cls, {}).get(key, default)

    def group(self, n: int) -> "OrderedDict[str, str]":
        return self.sections.get(str(n)) or self.sections["1"]

    def logic(self, n: int) -> "OrderedDict[str, str]":
        return self.sections.get(f"L{n}") or self.sections.get("L1") or OrderedDict()

    def set_value(self, cls: str, key: str, value: str) -> None:
        if cls not in self.sections or key not in self.sections[cls]:
            raise KeyError(f"{cls}/{key}")
        self.sections[cls][key] = value
        self.modified.add((cls, key))

    def number(self, cls: str, key: str, default: float | None = None) -> float | None:
        """Lê um ajuste numérico. 'OFF'/'NA'/inválido retornam ``default``."""
        raw = self.get(cls, key, "").strip()
        if raw.upper() in ("", "OFF", "NA"):
            return default
        try:
            return float(raw)
        except ValueError:
            return default
