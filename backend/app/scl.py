"""Leitura de arquivos SCL (IEC 61850-6): .SCD (vários IEDs) e .CID/.ICD (um IED).

Extrai de cada IED: dados de rede, blocos de controle GOOSE (GSEControl + DataSet + endereço MAC/APPID/VLAN/tempos),
os publicadores, as assinaturas (de quem o IED assina) e, nos arquivos da SEL, o mapeamento dos bits virtuais (VB)
que o relé assina (bloco privado ``SEL_GooseSubscription`` / ``ExtRef``).

Os arquivos são dados não confiáveis: só são interpretados (XML sem resolver entidades externas), nunca executados.
"""
from __future__ import annotations

import copy
import re
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field

NS = {"s": "http://www.iec.ch/61850/2003/SCL", "e": "http://www.selinc.com/2006/61850"}
_MAX_SIZE = 50 * 1024 * 1024

# prefixo do GGIO da SEL -> (padrão do bit do relé, descrição)
_PREFIX: dict[str, tuple[str, str]] = {
    "SV": ("SV{n:02d}", "Variável SELogic"), "SVT": ("SV{n:02d}T", "Variável SELogic temporizada"),
    "LT": ("LT{n:02d}", "Latch"), "VB": ("VB{n:03d}", "Bit virtual"),
    "INA": ("IN10{n}", "Entrada digital (cartão 100)"), "OUTA": ("OUT10{n}", "Saída digital (cartão 100)"),
    "INC": ("IN30{n}", "Entrada digital (cartão 300)"), "OUTC": ("OUT30{n}", "Saída digital (cartão 300)"),
    "IND": ("IN40{n}", "Entrada digital (cartão 400)"), "OUTD": ("OUT40{n}", "Saída digital (cartão 400)"),
    "INE": ("IN50{n}", "Entrada digital (cartão 500)"), "OUTE": ("OUT50{n}", "Saída digital (cartão 500)"),
    "TLED": ("T{n:02d}_LED", "LED de alvo"), "PBLED": ("PBLED{n:02d}", "LED de botão"),
    "RMBA": ("RMB{n}A", "Mirrored bit recebido (A)"), "RMBB": ("RMB{n}B", "Mirrored bit recebido (B)"),
    "TMBA": ("TMB{n}A", "Mirrored bit transmitido (A)"), "TMBB": ("TMB{n}B", "Mirrored bit transmitido (B)"),
    "MV": ("MV{n:02d}", "Variável matemática"), "SC": ("SC{n:02d}", "Contador"), "RA": ("RA{n:03d}", "Analógico remoto"),
}


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _int(txt: str | None, default: int = 0) -> int:
    try:
        return int(str(txt).strip())
    except (TypeError, ValueError):
        return default


def _time_ms(el: ET.Element | None) -> float:
    """MinTime/MaxTime com unit="s" e multiplier ("m" = milis)."""
    if el is None or not (el.text or "").strip():
        return 0.0
    try:
        v = float(el.text.strip())
    except ValueError:
        return 0.0
    mult = {"m": 1.0, "": 1000.0, "u": 0.001, "k": 1e6}.get(el.get("multiplier", ""), 1.0)
    return v * mult


@dataclass
class Fcda:
    ld_inst: str = ""
    prefix: str = ""
    ln_class: str = ""
    ln_inst: str = ""
    do_name: str = ""
    da_name: str = ""
    fc: str = ""
    bit: str = ""            # bit do relé correspondente (ex.: SV10T), quando reconhecido
    desc: str = ""

    def ref(self) -> str:
        return f"{self.ld_inst}/{self.prefix}{self.ln_class}{self.ln_inst}.{self.do_name}.{self.da_name}"


def fcda_bit(f: Fcda) -> tuple[str, str]:
    """(bit do relé, descrição) a partir do prefixo do GGIO e do índice IndNN."""
    m = re.search(r"(\d+)$", f.do_name)
    if not m or f.prefix not in _PREFIX:
        return "", ""
    pat, what = _PREFIX[f.prefix]
    n = int(m.group(1))
    bit = pat.format(n=n)
    return bit, f"{bit} – {what}"


@dataclass
class Gcb:
    name: str
    ld_inst: str = "CFG"
    go_id: str = ""
    dataset: str = ""
    conf_rev: int = 1
    desc: str = ""
    mac: str = ""
    appid: str = ""
    vlan_id: str = ""
    vlan_prio: str = ""
    min_ms: float = 0.0
    max_ms: float = 0.0
    enabled: bool = True     # simulação: bloco habilitado a publicar
    entries: list[Fcda] = field(default_factory=list)


@dataclass
class SubEntry:
    index: int
    vb: str = ""             # bit virtual (ou endereço interno) que recebe o valor; vazio = entrada não mapeada
    fcda: Fcda | None = None  # dado publicado correspondente (resolvido a partir do publicador)


@dataclass
class Subscription:
    pub_ied: str
    cb_name: str
    ld_inst: str = "CFG"
    dataset: str = ""
    go_id: str = ""
    conf_rev: int = 1
    mac: str = ""
    appid: str = ""
    vlan_id: str = ""
    vlan_prio: str = ""
    status_vb: str = ""      # bit que sinaliza o estado da mensagem recebida (pubRxStatus)
    source: str = ""
    enabled: bool = True     # simulação: assinatura habilitada a receber
    entries: list[SubEntry] = field(default_factory=list)


@dataclass
class Ied:
    name: str
    type: str = ""
    manufacturer: str = ""
    desc: str = ""
    config_version: str = ""
    model: str = ""
    ip: str = ""
    subnet: str = ""
    gateway: str = ""
    subnet_name: str = ""
    source_file: str = ""
    vb_max: int = 0
    gcbs: list[Gcb] = field(default_factory=list)
    subs: list[Subscription] = field(default_factory=list)

    def gcb(self, name: str) -> Gcb | None:
        return next((g for g in self.gcbs if g.name == name), None)

    @property
    def is_sel(self) -> bool:
        return self.manufacturer.upper() == "SEL" or self.type.upper().startswith("SEL")


# ------------------------------------------------------------------------ parse
def _parse_fcda(el: ET.Element) -> Fcda:
    f = Fcda(el.get("ldInst", ""), el.get("prefix", ""), el.get("lnClass", ""), el.get("lnInst", ""),
             el.get("doName", ""), el.get("daName", ""), el.get("fc", ""))
    f.bit, f.desc = fcda_bit(f)
    return f


def _comm_info(root: ET.Element) -> tuple[dict, dict]:
    """Dados de ConnectedAP (IP etc.) e de GSE (MAC/APPID/VLAN/tempos) indexados por IED (e por IED/bloco)."""
    ap: dict[str, dict] = {}
    gse: dict[tuple[str, str], dict] = {}
    for sn in root.findall("s:Communication/s:SubNetwork", NS):
        for cap in sn.findall("s:ConnectedAP", NS):
            ied = cap.get("iedName", "")
            ps = {p.get("type", ""): (p.text or "").strip() for p in cap.findall("s:Address/s:P", NS)}
            ap.setdefault(ied, {"ip": ps.get("IP", ""), "subnet": ps.get("IP-SUBNET", ""), "gateway": ps.get("IP-GATEWAY", ""),
                                "subnet_name": sn.get("name", "")})
            for g in cap.findall("s:GSE", NS):
                gp = {p.get("type", ""): (p.text or "").strip() for p in g.findall("s:Address/s:P", NS)}
                gse[(ied, g.get("cbName", ""))] = {
                    "mac": gp.get("MAC-Address", ""), "appid": gp.get("APPID", ""), "vlan_id": gp.get("VLAN-ID", ""),
                    "vlan_prio": gp.get("VLAN-PRIORITY", ""), "min_ms": _time_ms(g.find("s:MinTime", NS)),
                    "max_ms": _time_ms(g.find("s:MaxTime", NS)),
                }
    return ap, gse


def _parse_ied(el: ET.Element, ap: dict, gse: dict, filename: str) -> Ied:
    name = el.get("name", "")
    ied = Ied(name=name, type=el.get("type", ""), manufacturer=el.get("manufacturer", ""), desc=el.get("desc", ""),
              config_version=el.get("configVersion", ""), source_file=filename)
    info = ap.get(name, {})
    ied.ip, ied.subnet, ied.gateway, ied.subnet_name = info.get("ip", ""), info.get("subnet", ""), info.get("gateway", ""), info.get("subnet_name", "")
    for p in el.findall("s:Private", NS):
        t = p.get("type", "")
        if t == "SEL_IedInfo":
            m = p.find("e:ModelNumber", NS)
            ied.model = (m.text or "").strip() if m is not None else ""
        elif t == "SEL_IedResources":
            ib = p.find("e:InDigitals/e:InBits", NS)
            ied.vb_max = _int(ib.get("max") if ib is not None else None)
    # LDevice -> LN0
    for ldev in el.findall(".//s:LDevice", NS):
        ln0 = ldev.find("s:LN0", NS)
        if ln0 is None:
            continue
        datasets = {d.get("name", ""): [_parse_fcda(f) for f in d.findall("s:FCDA", NS)] for d in ln0.findall("s:DataSet", NS)}
        for g in ln0.findall("s:GSEControl", NS):
            gc = Gcb(name=g.get("name", ""), ld_inst=ldev.get("inst", ""), go_id=g.get("appID", ""), dataset=g.get("datSet", ""),
                     conf_rev=_int(g.get("confRev"), 1), desc=g.get("desc", ""))
            comm = gse.get((name, gc.name))
            if comm:
                gc.mac, gc.appid, gc.vlan_id, gc.vlan_prio, gc.min_ms, gc.max_ms = (
                    comm["mac"], comm["appid"], comm["vlan_id"], comm["vlan_prio"], comm["min_ms"], comm["max_ms"])
            gc.entries = datasets.get(gc.dataset, [])
            ied.gcbs.append(gc)
    # assinaturas: bloco privado da SEL (preferencial) ou ExtRef
    for p in el.findall("s:Private", NS):
        if p.get("type") != "SEL_GooseSubscription":
            continue
        for g in p.findall("e:GooseSubscription", NS):
            sub = Subscription(
                pub_ied=g.get("iedName", ""), cb_name=g.get("cbName", ""), ld_inst=g.get("ldInst", "CFG"), dataset=g.get("datSet", ""),
                go_id=g.get("appId", ""), conf_rev=_int(g.get("confRev"), 1), mac=g.get("mAddr", ""), appid=g.get("APPID", ""),
                vlan_id=g.get("VLAN-ID", ""), vlan_prio=g.get("VLAN-PRIORITY", ""), status_vb=g.get("pubRxStatus", ""), source="SEL_GooseSubscription")
            for i, e in enumerate(g.findall("e:GooseRxEntry", NS)):
                m = re.match(r"\(([^)]+)\)", e.get("tdlString", ""))
                sub.entries.append(SubEntry(index=i + 1, vb=m.group(1) if m else ""))
            ied.subs.append(sub)
    if not ied.subs:
        _subs_from_extref(el, ied)
    return ied


def _subs_from_extref(el: ET.Element, ied: Ied) -> None:
    """Fallback: assinaturas a partir de Inputs/ExtRef (arquivos que não são da SEL ou sem o bloco privado)."""
    by: dict[tuple[str, str], Subscription] = {}
    for ex in el.findall(".//s:Inputs/s:ExtRef", NS):
        if not ex.get("iedName") or ex.get("serviceType", "GOOSE") != "GOOSE":
            continue
        key = (ex.get("iedName", ""), ex.get("srcCBName", ""))
        sub = by.setdefault(key, Subscription(pub_ied=key[0], cb_name=key[1], ld_inst=ex.get("srcLDInst", "CFG"), source="ExtRef"))
        addr = (ex.get("intAddr") or "").split("|")[0]
        if ex.get("doName"):
            f = Fcda(ex.get("ldInst", ""), ex.get("prefix", ""), ex.get("lnClass", ""), ex.get("lnInst", ""), ex.get("doName", ""), ex.get("daName", ""), "ST")
            f.bit, f.desc = fcda_bit(f)
            sub.entries.append(SubEntry(index=len(sub.entries) + 1, vb=addr, fcda=f))
        else:
            sub.status_vb = addr
    ied.subs.extend(by.values())


def parse_scl(data: bytes, filename: str = "arquivo.scd") -> list[Ied]:
    """Interpreta um .SCD/.CID/.ICD e devolve os IEDs encontrados."""
    if len(data) > _MAX_SIZE:
        raise ValueError("Arquivo SCL maior que 50 MB.")
    if b"<!ENTITY" in data[:100000]:
        raise ValueError("SCL com declaração de entidades não é aceito.")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ValueError(f"XML inválido: {exc}") from exc
    if _tag(root) != "SCL":
        raise ValueError("O arquivo não é um SCL (elemento raiz SCL ausente).")
    ap, gse = _comm_info(root)
    ieds = [_parse_ied(el, ap, gse, filename) for el in root.findall("s:IED", NS)]
    if not ieds:
        raise ValueError("Nenhum IED encontrado no arquivo.")
    return ieds


# ------------------------------------------------------------------------ projeto
@dataclass
class Issue:
    level: str   # error | warn
    text: str


def check_subscription(sub: Subscription, pub: Gcb | None, pub_ied: Ied | None, vlan_aware: bool = True) -> list[Issue]:
    """Confere a assinatura com o bloco publicado (MAC, APPID, VLAN, confRev, GoID, tamanho do dataset).

    Com `vlan_aware` falso, VLAN-ID e prioridade VLAN não são comparados (rede que ignora a marcação VLAN)."""
    out: list[Issue] = []
    if pub_ied is None:
        return [Issue("error", f"O publicador {sub.pub_ied} não está no projeto")]
    if pub is None:
        return [Issue("error", f"{sub.pub_ied} não publica o bloco {sub.cb_name}")]
    if sub.mac and pub.mac and sub.mac.upper() != pub.mac.upper():
        out.append(Issue("error", f"MAC diferente (assinante {sub.mac} × publicador {pub.mac})"))
    if sub.appid and pub.appid and sub.appid.upper() != pub.appid.upper():
        out.append(Issue("error", f"APPID diferente ({sub.appid} × {pub.appid})"))
    if vlan_aware and sub.vlan_id and pub.vlan_id and _int(sub.vlan_id) != _int(pub.vlan_id):
        out.append(Issue("error", f"VLAN-ID diferente ({sub.vlan_id} × {pub.vlan_id})"))
    if sub.conf_rev != pub.conf_rev:
        out.append(Issue("error", f"confRev diferente ({sub.conf_rev} × {pub.conf_rev})"))
    if sub.go_id and pub.go_id and sub.go_id != pub.go_id:
        out.append(Issue("error", f"GoID diferente ({sub.go_id} × {pub.go_id})"))
    if sub.entries and len(sub.entries) != len(pub.entries):
        out.append(Issue("error", f"Dataset com {len(pub.entries)} entradas no publicador e {len(sub.entries)} na assinatura"))
    if vlan_aware and sub.vlan_prio and pub.vlan_prio and sub.vlan_prio != pub.vlan_prio:
        out.append(Issue("warn", f"Prioridade VLAN diferente ({sub.vlan_prio} × {pub.vlan_prio})"))
    return out


GCB_FIELDS = ("go_id", "dataset", "conf_rev", "mac", "appid", "vlan_id", "vlan_prio", "min_ms", "max_ms", "enabled")
SUB_FIELDS = ("go_id", "dataset", "conf_rev", "mac", "appid", "vlan_id", "vlan_prio", "status_vb", "enabled")
_MAC = re.compile(r"([0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}")


def _coerce(field_name: str, value):
    """Valida e converte um parâmetro GOOSE editado pelo usuário (lança ValueError se inválido)."""
    if field_name == "enabled":
        return bool(value)
    if field_name == "conf_rev":
        n = int(value)
        if not 0 <= n <= 4294967295:
            raise ValueError("confRev fora da faixa")
        return n
    if field_name in ("min_ms", "max_ms"):
        v = float(value)
        if v < 0 or v > 600000:
            raise ValueError(f"{field_name} fora da faixa (0 a 600000 ms)")
        return v
    v = str(value).strip()
    if field_name == "mac" and v and not _MAC.fullmatch(v):
        raise ValueError("MAC inválido (use o formato 01-0C-CD-01-00-01)")
    if field_name == "appid" and v and not re.fullmatch(r"[0-9A-Fa-f]{1,4}", v):
        raise ValueError("APPID inválido (hexadecimal de até 4 dígitos)")
    if field_name == "vlan_id" and v and not (v.isdigit() and 0 <= int(v) <= 4095):
        raise ValueError("VLAN-ID inválido (0 a 4095)")
    if field_name == "vlan_prio" and v and not (v.isdigit() and 0 <= int(v) <= 7):
        raise ValueError("VLAN-PRIORITY inválida (0 a 7)")
    if field_name == "status_vb" and v and not re.fullmatch(r"VB\d{3}", v.upper()):
        raise ValueError("Bit de status deve ser VBnnn")
    if field_name in ("go_id", "dataset") and len(v) > 129:
        raise ValueError(f"{field_name} longo demais")
    return v.upper() if field_name in ("status_vb", "mac") else v


class SclProject:
    """Conjunto de IEDs carregados de um ou mais arquivos SCL."""

    def __init__(self) -> None:
        self.ieds: dict[str, Ied] = {}
        self.files: list[str] = []
        self.vlan_aware = True               # falso: a comparação de VLAN é desconsiderada
        self._orig: dict[str, Ied] = {}      # cópia do que veio do arquivo (para restaurar)

    def add(self, ieds: list[Ied], filename: str) -> list[str]:
        names = []
        for i in ieds:
            self.ieds[i.name] = i
            self._orig[i.name] = copy.deepcopy(i)
            names.append(i.name)
        if filename not in self.files:
            self.files.append(filename)
        self._resolve()
        return names

    def remove(self, name: str) -> None:
        self.ieds.pop(name, None)
        self._orig.pop(name, None)
        self._resolve()

    def clear(self) -> None:
        self.ieds.clear()
        self._orig.clear()
        self.files.clear()

    # --------------------------------------------------------------- edição (simulação)
    def edit_gcb(self, ied: str, cb: str, fields: dict) -> None:
        g = self.ieds[ied].gcb(cb) if ied in self.ieds else None
        if g is None:
            raise ValueError(f"Bloco {ied}/{cb} não encontrado")
        new = {k: _coerce(k, v) for k, v in fields.items() if k in GCB_FIELDS}
        for k, v in new.items():
            setattr(g, k, v)

    def edit_sub(self, ied: str, pub: str, cb: str, fields: dict, vbs: dict | None = None) -> None:
        i = self.ieds.get(ied)
        sub = next((s for s in i.subs if s.pub_ied == pub and s.cb_name == cb), None) if i else None
        if sub is None:
            raise ValueError(f"Assinatura {ied} <- {pub}/{cb} não encontrada")
        new = {k: _coerce(k, v) for k, v in fields.items() if k in SUB_FIELDS}
        mapping: dict[int, str] = {}
        for k, v in (vbs or {}).items():
            vb = str(v).strip().upper()
            if vb and not re.fullmatch(r"VB\d{3}", vb):
                raise ValueError(f"Bit virtual inválido: {vb}")
            mapping[int(k)] = vb
        for k, v in new.items():
            setattr(sub, k, v)
        for e in sub.entries:
            if e.index in mapping:
                e.vb = mapping[e.index]

    def reset(self, ied: str | None = None) -> None:
        """Restaura os parâmetros GOOSE para os valores do arquivo (de um IED ou de todos)."""
        for name in ([ied] if ied else list(self._orig)):
            if name in self._orig:
                self.ieds[name] = copy.deepcopy(self._orig[name])
        self._resolve()

    def _modified(self, name: str) -> tuple[dict, dict]:
        cur, org = self.ieds[name], self._orig.get(name)
        gm: dict[str, list[str]] = {}
        sm: dict[tuple[str, str], list[str]] = {}
        if org is None:
            return gm, sm
        for g in cur.gcbs:
            o = org.gcb(g.name)
            gm[g.name] = [k for k in GCB_FIELDS if o is not None and getattr(g, k) != getattr(o, k)]
        for s in cur.subs:
            o = next((x for x in org.subs if x.pub_ied == s.pub_ied and x.cb_name == s.cb_name), None)
            ch = [k for k in SUB_FIELDS if o is not None and getattr(s, k) != getattr(o, k)]
            if o is not None and [e.vb for e in s.entries] != [e.vb for e in o.entries]:
                ch.append("vbs")
            sm[(s.pub_ied, s.cb_name)] = ch
        return gm, sm

    def _resolve(self) -> None:
        """Liga cada entrada de assinatura ao dado publicado (FCDA) do publicador, quando ele está no projeto."""
        for ied in self.ieds.values():
            for sub in ied.subs:
                pub = self.ieds.get(sub.pub_ied)
                gcb = pub.gcb(sub.cb_name) if pub else None
                for e in sub.entries:
                    if gcb and e.fcda is None and 0 < e.index <= len(gcb.entries):
                        e.fcda = gcb.entries[e.index - 1]

    # --------------------------------------------------------------- visões
    def subscribers_of(self, ied: str, cb: str) -> list[tuple[str, Subscription]]:
        return [(i.name, s) for i in self.ieds.values() for s in i.subs if s.pub_ied == ied and s.cb_name == cb]

    def to_dict(self) -> dict:
        out = []
        for ied in self.ieds.values():
            d = asdict(ied)
            gm, sm = self._modified(ied.name)
            for g, gc in zip(d["gcbs"], ied.gcbs):
                g["modified"] = gm.get(gc.name, [])
                g["subscribers"] = [{"ied": n, "status_vb": s.status_vb,
                                     "vbs": [e.vb for e in s.entries if e.vb]} for n, s in self.subscribers_of(ied.name, gc.name)]
            for s_d, s in zip(d["subs"], ied.subs):
                pub = self.ieds.get(s.pub_ied)
                gcb = pub.gcb(s.cb_name) if pub else None
                s_d["issues"] = [asdict(i) for i in check_subscription(s, gcb, pub, self.vlan_aware)]
                s_d["modified"] = sm.get((s.pub_ied, s.cb_name), [])
            d["is_sel"] = ied.is_sel
            out.append(d)
        return {"files": list(self.files), "ieds": out}
