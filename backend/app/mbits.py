"""Links SEL MIRRORED BITS entre relés simulados (app MBitConfig).

Modelo (baseado no guia de aplicação SEL AG2018-24):
- Um relé pode usar a porta 2 ou 3 em Mirrored Bits quando `PROTO` = MB8A/MB8B (também aceitos MBA/MBB). A letra A/B é o canal local:
  o canal A transmite as equações TMB1A–TMB8A e recebe em RMB1A–RMB8A (canal B idem com B). As letras não trafegam no link.
- O link só fecha se os ajustes casam nas duas pontas: TXID de um = RXID do outro (e vice-versa), TXID ≠ RXID em cada relé,
  mesma taxa (SPEED) e mesma família de protocolo (MB × MB8).
- Com o link fechado, o TMBnX de um relé aparece no RMBnY do outro (X, Y = canais das portas ligadas).
- Cada sentido envia uma mensagem a cada 40 bits / SPEED (mínimo de 4 ms); o RMB só muda após RMBnPU (subida) ou RMBnDO (descida)
  mensagens consecutivas iguais. Com 3 mensagens sem recepção (underrun) o canal cai: ROK = 0 e os RMB vão ao estado RXDFLT
  (X mantém o último valor; o primeiro caractere é o RMB8). RBAD = 1 se o canal ficar fora por RBADPU s; CBAD = 1 se a proporção de
  mensagens perdidas passar de CBADPU ppm.
- Fora do escopo: loopback (LOOP), TXMODE e o relatório COM.
"""
from __future__ import annotations

import random
import re
import uuid
from collections import deque
from dataclasses import dataclass, field

PORTS = (2, 3)
PROTOS = ("MB8A", "MB8B", "MBA", "MBB")
MIN_PERIOD = 0.004


def _s(eng, cls: str, key: str, default: str = "") -> str:
    try:
        return str(eng.settings.get(cls, key, default)).strip().strip('"')
    except Exception:  # noqa: BLE001
        return default


def _i(text: str, default: int) -> int:
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return default


def port_config(eng, port: int) -> dict:
    """Ajustes Mirrored Bits da porta `port` (classe P<n>) de um relé."""
    cls = f"P{port}"
    proto = _s(eng, cls, "PROTO", "").upper()
    eligible = proto in PROTOS
    dflt = _s(eng, cls, "RXDFLT", "XXXXXXXX").upper()
    dflt = (dflt + "XXXXXXXX")[:8] if len(dflt) < 8 else dflt[:8]
    return {
        "port": port, "proto": proto, "eligible": eligible,
        "family": ("MB8" if proto.startswith("MB8") else "MB") if eligible else "",
        "channel": proto[-1] if eligible else "",
        "txid": _i(_s(eng, cls, "TXID", "2"), 2), "rxid": _i(_s(eng, cls, "RXID", "1"), 1),
        "speed": _i(_s(eng, cls, "SPEED", "9600"), 9600), "rxdflt": dflt,
        "pu": [max(1, _i(_s(eng, cls, f"RMB{n}PU", "1"), 1)) for n in range(1, 9)],
        "do": [max(1, _i(_s(eng, cls, f"RMB{n}DO", "1"), 1)) for n in range(1, 9)],
        "rbadpu": _i(_s(eng, cls, "RBADPU", "60"), 60), "cbadpu": _i(_s(eng, cls, "CBADPU", "1000"), 1000),
    }


def check_pair(a: dict, b: dict) -> list[str]:
    """Condições de ajuste que impedem o link de fechar (lista vazia = ajustes compatíveis)."""
    out: list[str] = []
    for tag, c in (("A", a), ("B", b)):
        if not c["eligible"]:
            out.append(f"Porta {c['port']} do relé {tag} não está em MB8A/MB8B (PROTO = {c['proto'] or '—'})")
        elif c["txid"] == c["rxid"]:
            out.append(f"Relé {tag}: TXID e RXID não podem ser iguais ({c['txid']})")
    if a["eligible"] and b["eligible"]:
        if a["family"] != b["family"]:
            out.append(f"Protocolos incompatíveis ({a['proto']} × {b['proto']}): MB e MB8 diferem nos bits de parada")
        if a["txid"] != b["rxid"]:
            out.append(f"TXID de A ({a['txid']}) ≠ RXID de B ({b['rxid']})")
        if b["txid"] != a["rxid"]:
            out.append(f"TXID de B ({b['txid']}) ≠ RXID de A ({a['rxid']})")
        if a["speed"] != b["speed"]:
            out.append(f"Taxas diferentes (A = {a['speed']}, B = {b['speed']})")
    return out


@dataclass
class MbLink:
    id: str
    a_sid: str
    a_port: int
    b_sid: str
    b_port: int
    cut: bool = False
    loss_pct: float = 0.0


@dataclass
class _Dir:
    """Um sentido do link (transmissor → receptor)."""
    next_send: float = 0.0
    queue: deque = field(default_factory=deque)          # (instante de chegada, bits)
    state: list = field(default_factory=lambda: [0] * 8)  # RMB1..8 efetivos
    count: list = field(default_factory=lambda: [0] * 8)  # mensagens consecutivas divergentes
    last_rx: float | None = None
    tx: int = 0
    rx: int = 0
    lost: int = 0
    down_since: float | None = None
    rok: bool = False
    rbad: bool = False
    cbad: bool = False


class MbNetwork:
    def __init__(self, seed: int | None = None) -> None:
        self.links: dict[str, MbLink] = {}
        self._dirs: dict[tuple[str, str], _Dir] = {}
        self._rng = random.Random(seed)
        self._written: set[str] = set()      # sids cujo mb_bits já foi escrito (para limpar quando o link some)
        self._last: dict[str, dict] = {}

    # ------------------------------------------------------------ links
    def add_link(self, a_sid: str, a_port: int, b_sid: str, b_port: int) -> MbLink:
        if a_port not in PORTS or b_port not in PORTS:
            raise ValueError("Mirrored Bits usa a porta 2 ou 3")
        if a_sid == b_sid:
            raise ValueError("Escolha dois relés diferentes")
        for lk in self.links.values():
            for sid, port in ((a_sid, a_port), (b_sid, b_port)):
                if (lk.a_sid, lk.a_port) == (sid, port) or (lk.b_sid, lk.b_port) == (sid, port):
                    raise ValueError(f"A porta {port} desse relé já está em outro link")
        lk = MbLink(id=uuid.uuid4().hex[:8], a_sid=a_sid, a_port=a_port, b_sid=b_sid, b_port=b_port)
        self.links[lk.id] = lk
        return lk

    def remove_link(self, link_id: str) -> None:
        self.links.pop(link_id, None)
        self._dirs.pop((link_id, "ab"), None)
        self._dirs.pop((link_id, "ba"), None)

    def drop_session(self, sid: str) -> None:
        for lid in [i for i, lk in self.links.items() if sid in (lk.a_sid, lk.b_sid)]:
            self.remove_link(lid)

    def reset_stats(self, link_id: str | None = None) -> None:
        for (lid, _), d in self._dirs.items():
            if link_id in (None, lid):
                d.tx = d.rx = d.lost = 0
                d.cbad = False

    # ------------------------------------------------------------ ciclo
    def _channel_conflicts(self, sessions: dict) -> set[tuple[str, str]]:
        """(sid, canal) usados por mais de um link no mesmo relé."""
        seen: dict[tuple[str, str], int] = {}
        for lk in self.links.values():
            for sid, port in ((lk.a_sid, lk.a_port), (lk.b_sid, lk.b_port)):
                s = sessions.get(sid)
                if s is None:
                    continue
                ch = port_config(s.engine, port)["channel"]
                if ch:
                    seen[(sid, ch)] = seen.get((sid, ch), 0) + 1
        return {k for k, n in seen.items() if n > 1}

    def tick(self, now: float, sessions: dict) -> None:
        for lid, lk in list(self.links.items()):
            if lk.a_sid not in sessions or lk.b_sid not in sessions:
                self.remove_link(lid)
        out: dict[str, dict[str, float]] = {}
        conflicts = self._channel_conflicts(sessions)
        info: dict[str, dict] = {}
        for lk in self.links.values():
            sa, sb = sessions[lk.a_sid], sessions[lk.b_sid]
            ca, cb = port_config(sa.engine, lk.a_port), port_config(sb.engine, lk.b_port)
            issues = check_pair(ca, cb)
            for tag, sid, c in (("A", lk.a_sid, ca), ("B", lk.b_sid, cb)):
                if c["eligible"] and (sid, c["channel"]) in conflicts:
                    issues.append(f"Relé {tag}: o canal {c['channel']} está em dois links (use portas com canais A e B diferentes)")
            phys: list[str] = []
            if lk.cut:
                phys.append("cabo desconectado (simulado)")
            for tag, s in (("A", sa), ("B", sb)):
                if not s.running:
                    phys.append(f"relé {tag} pausado")
                elif s.engine.vals.get("HALARM", 0.0):
                    phys.append(f"relé {tag} desabilitado (HALARM)")
            up = not issues
            info[lk.id] = {"issues": issues, "phys": phys, "closed": up and not phys, "ca": ca, "cb": cb}
            for key, tx_s, tx_c, rx_s, rx_c, rx_sid in (("ab", sa, ca, sb, cb, lk.b_sid), ("ba", sb, cb, sa, ca, lk.a_sid)):
                d = self._dirs.setdefault((lk.id, key), _Dir(next_send=now))
                self._run_dir(d, now, up and not phys, lk, tx_s, tx_c, rx_c)
                if rx_c["eligible"]:
                    ch = rx_c["channel"]
                    o = out.setdefault(rx_sid, {})
                    for n in range(1, 9):
                        o[f"RMB{n}{ch}"] = float(d.state[n - 1])
                    o[f"ROK{ch}"] = float(d.rok)
                    o[f"RBAD{ch}"] = float(d.rbad)
                    o[f"CBAD{ch}"] = float(d.cbad)
        self._last = info
        for sid, bits in out.items():
            sessions[sid].engine.mb_bits = bits
        for sid in self._written - set(out):
            if sid in sessions:
                sessions[sid].engine.mb_bits = {}
        self._written = set(out)

    def _run_dir(self, d: _Dir, now: float, active: bool, lk: MbLink, tx_s, tx_c: dict, rx_c: dict) -> None:
        period = max(MIN_PERIOD, 40.0 / max(tx_c["speed"], 300))
        chx = tx_c["channel"]
        if active and chx:
            if now - d.next_send > 0.1:
                d.next_send = now
            while now >= d.next_send:
                d.tx += 1
                if self._rng.random() * 100.0 < lk.loss_pct:
                    d.lost += 1
                else:
                    bits = tuple(int(bool(tx_s.engine.vals.get(f"TMB{n}{chx}", 0.0))) for n in range(1, 9))
                    d.queue.append((d.next_send + period, bits))
                d.next_send += period
        else:
            d.queue.clear()
            d.next_send = now
        while d.queue and d.queue[0][0] <= now:
            due, bits = d.queue.popleft()
            d.rx += 1
            d.last_rx = due
            for i in range(8):
                if bits[i] == d.state[i]:
                    d.count[i] = 0
                else:
                    d.count[i] += 1
                    need = rx_c["pu"][i] if bits[i] else rx_c["do"][i]
                    if d.count[i] >= need:
                        d.state[i], d.count[i] = bits[i], 0
        d.rok = bool(active and d.last_rx is not None and now - d.last_rx <= 3 * period + 1e-9)
        if not d.rok:
            if d.down_since is None:
                d.down_since = now
            for i in range(8):                      # RXDFLT: primeiro caractere = RMB8; X mantém o último valor
                ch = rx_c["rxdflt"][7 - i]
                if ch in "01":
                    d.state[i] = int(ch)
                    d.count[i] = 0
            d.rbad = d.rbad or (d.down_since is not None and now - d.down_since >= rx_c["rbadpu"])
        else:
            d.down_since = None
            d.rbad = False
        d.cbad = d.tx > 0 and (d.lost / d.tx) * 1e6 > rx_c["cbadpu"]

    # ------------------------------------------------------------ visão
    def status(self, sessions: dict) -> dict:
        relays = []
        for sid, s in sessions.items():
            eng = s.engine
            ports = []
            for p in PORTS:
                c = port_config(eng, p)
                ports.append({k: c[k] for k in ("port", "proto", "eligible", "family", "channel", "txid", "rxid", "speed", "rxdflt")})
            vals = {f"{pre}{n}{ch}": int(bool(eng.vals.get(f"{pre}{n}{ch}", 0.0))) for pre in ("TMB", "RMB") for n in range(1, 9) for ch in "AB"}
            relays.append({"sid": sid, "relay_id": s.relay.id, "device": eng.device_name, "model": eng.model, "running": s.running,
                           "ports": ports, "bits": vals,
                           "status": {k: int(bool(eng.vals.get(k, 0.0))) for k in ("ROKA", "ROKB", "RBADA", "RBADB", "CBADA", "CBADB")}})
        links = []
        for lk in self.links.values():
            inf = self._last.get(lk.id)
            dab, dba = self._dirs.get((lk.id, "ab")), self._dirs.get((lk.id, "ba"))

            def dd(d: _Dir | None) -> dict:
                return {"tx": d.tx, "rx": d.rx, "lost": d.lost, "rok": d.rok, "rbad": d.rbad, "cbad": d.cbad, "state": d.state} if d else {}
            links.append({"id": lk.id, "a": {"sid": lk.a_sid, "port": lk.a_port}, "b": {"sid": lk.b_sid, "port": lk.b_port},
                          "cut": lk.cut, "loss_pct": lk.loss_pct, "closed": bool(inf and inf["closed"]),
                          "issues": inf["issues"] if inf else [], "phys": inf["phys"] if inf else [],
                          "ab": dd(dab), "ba": dd(dba)})
        return {"relays": relays, "links": links}
