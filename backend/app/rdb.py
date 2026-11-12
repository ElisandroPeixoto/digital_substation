"""Leitura de arquivos .rdb do AcSELerator QuickSet.

Um .rdb é um contêiner OLE (Compound File). Cada relé fica em
``Relays/<nome>/`` com arquivos ``set_*.txt`` e uma subpasta ``Misc``.
"""
from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field

import olefile

# Arquivos grandes/binários que não interessam ao simulador.
_SKIP_SUFFIXES = (".gle",)
_KEEP_MISC = {"cfg.txt", "device.txt", "databaseversion.txt", "version"}


def decode_text(data: bytes) -> str:
    """Decodifica texto do QuickSet (UTF-8 ou Windows-1252)."""
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


@dataclass
class RdbRelay:
    """Um conjunto de ajustes (um relé) dentro do .rdb."""

    id: str                     # nome da pasta dentro do .rdb (pode estar truncado)
    name: str                   # nome completo (Misc/Device.txt)
    files: dict[str, str] = field(default_factory=dict)  # caminho relativo -> texto

    @property
    def fid(self) -> str:
        for fname, text in self.files.items():
            if fname.lower().endswith("set_1.txt"):
                for line in text.splitlines():
                    if line.startswith("FID="):
                        return line[4:].strip()
        return ""

    def summary(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "fid": self.fid,
            "file_count": len(self.files),
            "files": sorted(self.files.keys()),
        }

    def to_zip(self) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for fname, text in self.files.items():
                zf.writestr(fname, text.encode("utf-8"))
        return buf.getvalue()


@dataclass
class RdbArchive:
    filename: str
    relays: dict[str, RdbRelay]

    def summary(self) -> dict:
        return {
            "filename": self.filename,
            "relays": [r.summary() for r in self.relays.values()],
        }


def parse_rdb(data: bytes, filename: str = "arquivo.rdb") -> RdbArchive:
    """Extrai os arquivos de texto de cada relé do .rdb."""
    if not olefile.isOleFile(io.BytesIO(data)):
        raise ValueError("O arquivo não é um .rdb válido (contêiner OLE não reconhecido).")
    ole = olefile.OleFileIO(io.BytesIO(data))
    relays: dict[str, RdbRelay] = {}
    try:
        for entry in ole.listdir(streams=True, storages=False):
            if len(entry) < 3 or entry[0].lower() != "relays":
                continue
            relay_id = entry[1]
            rel_path = "/".join(entry[2:])
            lower = rel_path.lower()
            if lower.endswith(_SKIP_SUFFIXES):
                continue
            is_set = len(entry) == 3 and lower.endswith(".txt")
            is_misc = len(entry) == 4 and entry[2].lower() == "misc" and entry[3].lower() in _KEEP_MISC
            if not (is_set or is_misc):
                continue
            text = decode_text(ole.openstream(entry).read())
            relay = relays.setdefault(relay_id, RdbRelay(id=relay_id, name=relay_id))
            relay.files[rel_path] = text
    finally:
        ole.close()
    for relay in relays.values():
        device = relay.files.get("Misc/Device.txt", "").strip()
        if device:
            relay.name = device
    if not relays:
        raise ValueError("Nenhum relé encontrado dentro do .rdb.")
    return RdbArchive(filename=filename, relays=dict(sorted(relays.items(), key=lambda kv: kv[1].name)))
