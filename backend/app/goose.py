"""Rede GOOSE simulada: liga as sessões do DigitalRelay aos IEDs de um projeto SCL (módulo IEC61850).

Modelo (MVP, não é uma pilha Ethernet real):
- Cada sessão associada a um IED **publica** os blocos GOOSE dele (valores lidos do Relay Word pelos FCDA) e **assina** os
  blocos de outros IEDs (valores gravados nos bits virtuais VBnnn indicados no SCD).
- Publicação: a cada mudança de valor `stNum`++ e `sqNum`=0 com envio imediato; depois retransmissões com intervalo
  dobrando de MinTime até MaxTime (como no padrão).
- Assinatura: a mensagem só é aceita se MAC, APPID, VLAN-ID, confRev, GoID e tamanho do dataset conferem. Sem mensagem
  válida em TAL (= 2 × MaxTime, "time allowed to live") a assinatura cai: VBs vão a 0 e o bit de status (pubRxStatus) vai a 1.
- Condições que interrompem a comunicação: publicador/assinante sem sessão ou pausado, 61850/GSE desabilitado no ajuste (P1
  E61850/EGSE), alarme de hardware (HALARM), enlaces LINKA e LINKB caídos, cabo do IED desconectado (rede), perda e latência.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from .scl import Ied, SclProject, check_subscription

_VB = re.compile(r"VB\d{3}")
_YES = {"Y", "YES", "1", "ON", "TRUE"}


def rdb_flag(engine, key: str) -> bool:
    """Valor Y/N do ajuste (classe P1) – desabilitado quando o relé não tem o ajuste."""
    try:
        return str(engine.settings.get("P1", key, "N")).strip().strip('"').upper() in _YES
    except Exception:  # noqa: BLE001
        return False


@dataclass
class _Pub:
    st_num: int = 1
    sq_num: int = 0
    values: tuple = ()
    last_tx: float = -1e9
    interval: float = 0.0
    sent: int = 0
    last_change: float = 0.0


@dataclass
class _Msg:
    due: float
    src: str
    cb: str
    st_num: int
    sq_num: int
    values: tuple
    min_ms: float
    max_ms: float


@dataclass
class _Rx:
    last_rx: float | None = None
    st_num: int = 0
    sq_num: int = 0
    rx_count: int = 0
    values: tuple = ()
    valid: bool = False
    reason: str = "sem mensagem recebida"


@dataclass
class GooseNetwork:
    project: SclProject = field(default_factory=SclProject)
    bindings: dict[str, str] = field(default_factory=dict)      # sid -> nome do IED
    latency_ms: float = 2.0
    loss_pct: float = 0.0
    cut: set[str] = field(default_factory=set)                    # IEDs com cabo desconectado
    status_on_loss: bool = True                                   # pubRxStatus = 1 enquanto a assinatura está inválida
    seed: int | None = None
    networks: list[dict] | None = None                            # redes do SystemLab: [{id, name, sids}]; None = tudo interligado

    @property
    def vlan_aware(self) -> bool:
        return self.project.vlan_aware

    @vlan_aware.setter
    def vlan_aware(self, value: bool) -> None:
        self.project.vlan_aware = bool(value)

    def same_net(self, sid_a: str | None, sid_b: str | None) -> bool:
        """Com topologia do SystemLab ativa, só relés na mesma rede se comunicam; sem topologia, todos se comunicam."""
        if self.networks is None:
            return True
        if not sid_a or not sid_b:
            return False
        return any(sid_a in n["sids"] and sid_b in n["sids"] for n in self.networks)

    def in_any_net(self, sid: str) -> bool:
        return self.networks is None or any(sid in n["sids"] for n in self.networks)

    def __post_init__(self) -> None:
        self._pub: dict[tuple[str, str], _Pub] = {}
        self._rx: dict[tuple[str, str, str], _Rx] = {}
        self._q: list[_Msg] = []
        self._rng = random.Random(self.seed)
        self.sent_total = 0
        self.lost_total = 0

    # ------------------------------------------------------------ vínculos
    def bind(self, sid: str, ied: str) -> None:
        if ied not in self.project.ieds:
            raise ValueError(f"IED desconhecido: {ied}")
        for s, i in list(self.bindings.items()):
            if i == ied and s != sid:
                del self.bindings[s]          # um IED tem no máximo uma sessão
        self.bindings[sid] = ied

    def unbind(self, sid: str) -> None:
        self.bindings.pop(sid, None)

    def sid_of(self, ied: str) -> str | None:
        return next((s for s, i in self.bindings.items() if i == ied), None)

    def reset(self) -> None:
        self._pub.clear(); self._rx.clear(); self._q.clear()
        self.sent_total = self.lost_total = 0

    # ------------------------------------------------------------ condição do IED
    def ied_state(self, ied: Ied, sessions: dict) -> tuple[bool, str]:
        """(comunicando?, motivo) para o IED, conforme a sessão associada."""
        sid = self.sid_of(ied.name)
        sess = sessions.get(sid) if sid else None
        if sess is None:
            return False, "sem relé associado no DigitalRelay"
        eng = sess.engine
        if not sess.running:
            return False, "simulação pausada"
        if ied.name in self.cut:
            return False, "cabo de rede desconectado (simulado)"
        if not self.in_any_net(sid):
            return False, "relé fora de qualquer rede do SystemLab"
        if not rdb_flag(eng, "E61850"):
            return False, "E61850 = N no ajuste (porta 1)"
        if not rdb_flag(eng, "EGSE"):
            return False, "EGSE = N no ajuste (porta 1)"
        if eng.vals.get("HALARM", 0.0):
            return False, "alarme de hardware (HALARM)"
        if not (eng.vals.get("LINKA", 1.0) or eng.vals.get("LINKB", 1.0)):
            return False, "enlaces LINKA e LINKB caídos"
        return True, "ok"

    # ------------------------------------------------------------ ciclo
    def tick(self, now: float, sessions: dict) -> None:
        for sid in [s for s in self.bindings if s not in sessions]:
            del self.bindings[sid]
        live = {n: self.ied_state(i, sessions) for n, i in self.project.ieds.items()}
        # 1) publicação
        for name, ied in self.project.ieds.items():
            ok, _ = live[name]
            sid = self.sid_of(name)
            if not sid:
                continue
            eng = sessions[sid].engine
            for g in ied.gcbs:
                key = (name, g.name)
                ok_g = ok and g.enabled
                vals = tuple(int(bool(eng.vals.get(f.bit, 0.0))) if f.bit else 0 for f in g.entries)
                p = self._pub.get(key)
                if p is None:
                    p = self._pub[key] = _Pub(values=vals, last_change=now)
                    first = True
                else:
                    first = False
                if vals != p.values:
                    p.values, p.st_num, p.sq_num, p.interval, p.last_change = vals, p.st_num + 1, 0, 0.0, now
                    p.last_tx = -1e9
                if not ok_g:
                    p.last_tx = -1e9 if not first else p.last_tx
                    continue
                min_s, max_s = max(g.min_ms, 1.0) / 1000.0, max(g.max_ms, g.min_ms, 1.0) / 1000.0
                if now - p.last_tx >= p.interval or p.last_tx < -1e8:
                    if p.last_tx < -1e8:
                        p.interval = min_s
                    else:
                        p.sq_num += 1
                        p.interval = min(p.interval * 2.0, max_s)
                    p.last_tx = now
                    p.sent += 1
                    self.sent_total += 1
                    if name in self.cut or self._rng.random() * 100.0 < self.loss_pct:
                        self.lost_total += 1
                    else:
                        self._q.append(_Msg(now + self.latency_ms / 1000.0, name, g.name, p.st_num, p.sq_num, p.values, g.min_ms, g.max_ms))
        # 2) entrega
        pend, self._q = self._q, []
        for m in pend:
            if m.due > now:
                self._q.append(m)
                continue
            self._deliver(m, now, live)
        # 3) estado das assinaturas e escrita nos VBs
        for name, ied in self.project.ieds.items():
            sid = self.sid_of(name)
            if not sid:
                continue
            eng = sessions[sid].engine
            ok, why = live[name]
            ext: dict[str, bool] = {}
            for sub in ied.subs:
                rx = self._rx.setdefault((name, sub.pub_ied, sub.cb_name), _Rx())
                psid = self.sid_of(sub.pub_ied)
                other_net = bool(psid) and not self.same_net(psid, sid)
                tal = 2.0 * max(self._max_ms(sub), 1.0) / 1000.0
                if not sub.enabled:
                    rx.valid, rx.reason = False, "assinatura desabilitada (simulação)"
                elif other_net and ok:
                    rx.valid, rx.reason = False, "publicador em outra rede do SystemLab"
                elif not ok:
                    rx.valid, rx.reason = False, why
                elif rx.last_rx is None:
                    rx.valid = False
                elif now - rx.last_rx > tal:
                    rx.valid, rx.reason = False, f"sem mensagem há mais de {tal * 1000:.0f} ms (TAL)"
                if rx.valid:
                    rx.reason = "ok"
                for i, e in enumerate(sub.entries):
                    if e.vb and _VB.fullmatch(e.vb):
                        ext[e.vb] = bool(rx.values[i]) if rx.valid and i < len(rx.values) else False
                if sub.status_vb and _VB.fullmatch(sub.status_vb):
                    ext[sub.status_vb] = (not rx.valid) if self.status_on_loss else rx.valid
            eng.ext_bits = ext
            for b in ext:
                eng.vals.setdefault(b, 0.0)
                eng.watched.add(b)

    def _max_ms(self, sub) -> float:
        pub = self.project.ieds.get(sub.pub_ied)
        g = pub.gcb(sub.cb_name) if pub else None
        return g.max_ms if g else 1000.0

    def _deliver(self, m: _Msg, now: float, live: dict) -> None:
        pub = self.project.ieds.get(m.src)
        pg = pub.gcb(m.cb) if pub else None
        for name, ied in self.project.ieds.items():
            if name == m.src or name in self.cut:
                continue
            for sub in ied.subs:
                if sub.pub_ied != m.src or sub.cb_name != m.cb:
                    continue
                rx = self._rx.setdefault((name, m.src, m.cb), _Rx())
                if not live[name][0] or not sub.enabled or not self.same_net(self.sid_of(m.src), self.sid_of(name)):
                    continue
                errs = [i.text for i in check_subscription(sub, pg, pub, self.vlan_aware) if i.level == "error"]
                if errs:
                    rx.valid, rx.reason = False, "assinatura incompatível: " + "; ".join(errs)
                    continue
                rx.last_rx, rx.st_num, rx.sq_num, rx.values, rx.valid = now, m.st_num, m.sq_num, m.values, True
                rx.rx_count += 1

    # ------------------------------------------------------------ visão
    def status(self, sessions: dict) -> dict:
        ieds = []
        for name, ied in self.project.ieds.items():
            ok, why = self.ied_state(ied, sessions)
            sid = self.sid_of(name)
            subs = []
            for sub in ied.subs:
                rx = self._rx.get((name, sub.pub_ied, sub.cb_name)) or _Rx()
                subs.append({"pub_ied": sub.pub_ied, "cb_name": sub.cb_name, "valid": rx.valid, "reason": rx.reason,
                             "st_num": rx.st_num, "sq_num": rx.sq_num, "rx_count": rx.rx_count, "values": list(rx.values),
                             "status_vb": sub.status_vb})
            pubs = []
            for g in ied.gcbs:
                p = self._pub.get((name, g.name))
                pubs.append({"cb_name": g.name, "st_num": p.st_num if p else 0, "sq_num": p.sq_num if p else 0,
                             "sent": p.sent if p else 0, "values": list(p.values) if p else []})
            ieds.append({"name": name, "sid": sid, "comm_ok": ok, "reason": why, "cut": name in self.cut,
                         "rdb_e61850": bool(sid and sid in sessions and rdb_flag(sessions[sid].engine, "E61850")),
                         "rdb_egse": bool(sid and sid in sessions and rdb_flag(sessions[sid].engine, "EGSE")),
                         "pubs": pubs, "subs": subs})
        return {"bindings": dict(self.bindings), "latency_ms": self.latency_ms, "loss_pct": self.loss_pct,
                "status_on_loss": self.status_on_loss, "vlan_aware": self.vlan_aware, "topology": self.networks, "sent": self.sent_total, "lost": self.lost_total, "ieds": ieds}
