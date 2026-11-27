import { useEffect, useMemo, useRef, useState } from 'react'
import { AppMark } from '../eclipse/AppMark'
import { api } from '../api'
import { modelLabel, usePoll } from '../hooks'
import type { MbLinkS, MbPortInfo, MbRelay, MbStatus } from '../types'

const CARD_W = 270
const HEAD_H = 38
const BLOCK_H = 74
const CARD_H = HEAD_H + 2 * BLOCK_H
const POS_KEY = 'mbitconfig.pos'
const PROTOS = ['SEL', 'MB8A', 'MB8B', 'MBA', 'MBB']
const SPEEDS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600]

type Pos = Record<string, [number, number]>

function loadPos(): Pos {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Posição (x, y) do ponto de ligação da porta: P2 na borda esquerda do cartão, P3 na direita. */
function anchor(pos: [number, number], port: number): { x: number; y: number; dir: 1 | -1 } {
  const y = pos[1] + HEAD_H + (port === 2 ? 0 : 1) * BLOCK_H + 18
  return port === 2 ? { x: pos[0], y, dir: -1 } : { x: pos[0] + CARD_W, y, dir: 1 }
}

const portOf = (r: MbRelay, p: number): MbPortInfo => r.ports.find((x) => x.port === p)!

function Strip({ prefix, ch, bits, title }: { prefix: 'TMB' | 'RMB'; ch: string; bits: Record<string, number>; title: string }) {
  return (
    <div className="mb-strip" title={title}>
      <span>{prefix}</span>
      {Array.from({ length: 8 }, (_, k) => {
        const v = bits[`${prefix}${k + 1}${ch}`] ?? 0
        return <i key={k} className={v ? 'on' : ''} title={`${prefix}${k + 1}${ch} = ${v}`}>{k + 1}</i>
      })}
    </div>
  )
}

function PortForm({ sid, port }: { sid: string; port: MbPortInfo }) {
  const [err, setErr] = useState<string | null>(null)
  const set = (key: string, value: string) => api.patchSetting(sid, `P${port.port}`, key, value).then(() => setErr(null)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  return (
    <div className="mb-form">
      <h4>Porta {port.port}</h4>
      <label>PROTO
        <select value={PROTOS.includes(port.proto) ? port.proto : ''} onChange={(e) => set('PROTO', e.target.value)}>
          {!PROTOS.includes(port.proto) && <option value="">{port.proto || '—'} (atual)</option>}
          {PROTOS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>TXID
        <select value={port.txid} onChange={(e) => set('TXID', e.target.value)}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
      </label>
      <label>RXID
        <select value={port.rxid} onChange={(e) => set('RXID', e.target.value)}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
      </label>
      <label>SPEED
        <select value={port.speed} onChange={(e) => set('SPEED', e.target.value)}>{SPEEDS.map((n) => <option key={n} value={n}>{n}</option>)}</select>
      </label>
      <label title="Estado dos RMB8…RMB1 quando o canal cai: 0, 1 ou X (mantém o último)">RXDFLT
        <input className="numinput" defaultValue={port.rxdflt} key={port.rxdflt} maxLength={8}
          onBlur={(e) => { const v = e.target.value.toUpperCase(); if (/^[01X]{8}$/.test(v) && v !== port.rxdflt) set('RXDFLT', v) }} />
      </label>
      {err && <p className="err-text">{err}</p>}
    </div>
  )
}

function LinkPanel({ link, relays, onChange }: { link: MbLinkS; relays: MbRelay[]; onChange: () => void }) {
  const ra = relays.find((r) => r.sid === link.a.sid)
  const rb = relays.find((r) => r.sid === link.b.sid)
  if (!ra || !rb) return null
  const pa = portOf(ra, link.a.port)
  const pb = portOf(rb, link.b.port)
  const chA = pa.channel || '?'
  const chB = pb.channel || '?'
  const nameA = ra.relay_id.slice(0, 30)
  const nameB = rb.relay_id.slice(0, 30)
  const match = async () => {            // ajusta o relé B para casar com o A (RXID, TXID, SPEED e família do protocolo)
    const cls = `P${link.b.port}`
    await api.patchSetting(rb.sid, cls, 'RXID', String(pa.txid))
    await api.patchSetting(rb.sid, cls, 'TXID', String(pa.rxid))
    await api.patchSetting(rb.sid, cls, 'SPEED', String(pa.speed))
    if (!pb.eligible || pb.family !== pa.family) await api.patchSetting(rb.sid, cls, 'PROTO', `${pa.family}${pb.channel || 'A'}`)
    onChange()
  }
  const rows = Array.from({ length: 8 }, (_, k) => k + 1)
  return (
    <div className="mb-link-panel">
      <h3>Link: {nameA} (P{link.a.port}, canal {chA}) ↔ {nameB} (P{link.b.port}, canal {chB})</h3>
      <p>
        <span className={`pill ${link.closed ? 'on' : 'off'}`}>{link.closed ? 'COMUNICAÇÃO FECHADA' : 'SEM COMUNICAÇÃO'}</span>{' '}
        {link.phys.map((p) => <span key={p} className="chip">{p}</span>)}
      </p>
      {link.issues.length > 0 && (
        <div className="alert">
          <b>Ajustes que impedem o link:</b>
          <ul>{link.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          <button onClick={match}>Casar os ajustes de B com A</button>
        </div>
      )}
      <table className="tbl">
        <thead><tr><th>Bit</th><th>{nameA} TMB{chA} → {nameB} RMB{chB}</th><th>{nameB} TMB{chB} → {nameA} RMB{chA}</th></tr></thead>
        <tbody>
          {rows.map((n) => {
            const t1 = ra.bits[`TMB${n}${chA}`] ?? 0
            const r1 = rb.bits[`RMB${n}${chB}`] ?? 0
            const t2 = rb.bits[`TMB${n}${chB}`] ?? 0
            const r2 = ra.bits[`RMB${n}${chA}`] ?? 0
            return (
              <tr key={n}>
                <td>{n}</td>
                <td><span className={`chip ${t1 ? 'on' : ''}`}>TMB{n}{chA} = {t1}</span> → <span className={`chip ${r1 ? 'on' : ''}`}>RMB{n}{chB} = {r1}</span></td>
                <td><span className={`chip ${t2 ? 'on' : ''}`}>TMB{n}{chB} = {t2}</span> → <span className={`chip ${r2 ? 'on' : ''}`}>RMB{n}{chA} = {r2}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <table className="tbl">
        <thead><tr><th>Sentido</th><th>ROK</th><th>RBAD</th><th>CBAD</th><th>Enviadas</th><th>Recebidas</th><th>Perdidas</th></tr></thead>
        <tbody>
          {([['A → B', link.ab], ['B → A', link.ba]] as const).map(([lab, d]) => (
            <tr key={lab}>
              <td>{lab}</td>
              <td><span className={`pill ${d.rok ? 'on' : 'off'}`}>{d.rok ? '1' : '0'}</span></td>
              <td><span className={`pill ${d.rbad ? 'off' : 'on'}`}>{d.rbad ? '1' : '0'}</span></td>
              <td><span className={`pill ${d.cbad ? 'off' : 'on'}`}>{d.cbad ? '1' : '0'}</span></td>
              <td>{d.tx ?? 0}</td><td>{d.rx ?? 0}</td><td>{d.lost ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mb-ctl">
        <label className="check"><input type="checkbox" checked={link.cut} onChange={(e) => api.mbPatchLink(link.id, { cut: e.target.checked }).then(onChange)} /> Cabo desconectado</label>
        <label>Perda de mensagens (%) <input type="number" min={0} max={100} className="numinput" style={{ width: 70 }} defaultValue={link.loss_pct} key={link.loss_pct}
          onBlur={(e) => api.mbPatchLink(link.id, { loss_pct: Number(e.target.value) }).then(onChange)} /></label>
        <button onClick={() => api.mbClear().then(onChange)}>Zerar estatísticas (COM A C)</button>
        <button className="danger" onClick={() => api.mbDeleteLink(link.id).then(onChange)}>Remover link</button>
      </div>
      <p className="hint">TMB de um relé é recebido no RMB do outro (as letras A/B são locais). O link só fecha com TXID de um = RXID do outro, mesma taxa e mesmo protocolo (MB8). Sem mensagens por 3 períodos o canal cai (ROK = 0) e os RMB vão ao RXDFLT; RBAD = 1 após RBADPU s fora.</p>
    </div>
  )
}

export function MBitConfigApp() {
  const { data, reload } = usePollReload()
  const [pos, setPos] = useState<Pos>(loadPos)
  const [picked, setPicked] = useState<{ sid: string; port: number } | null>(null)
  const [selLink, setSelLink] = useState<string | null>(null)
  const [selRelay, setSelRelay] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const drag = useRef<{ sid: string; ox: number; oy: number } | null>(null)
  const area = useRef<HTMLDivElement>(null)

  const relays = data?.relays ?? []
  const links = data?.links ?? []
  const place = useMemo(() => {
    const out: Pos = {}
    relays.forEach((r, i) => { out[r.sid] = pos[r.sid] ?? [30 + (i % 3) * (CARD_W + 90), 30 + Math.floor(i / 3) * (CARD_H + 60)] })
    return out
  }, [relays, pos])
  const linked = useMemo(() => new Set(links.flatMap((l) => [`${l.a.sid}:${l.a.port}`, `${l.b.sid}:${l.b.port}`])), [links])

  useEffect(() => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignora */ }
  }, [pos])

  const clickPort = async (r: MbRelay, p: MbPortInfo) => {
    setSelRelay(r.sid); setSelLink(null)
    if (!p.eligible || linked.has(`${r.sid}:${p.port}`)) { setPicked(null); return }
    if (!picked) { setPicked({ sid: r.sid, port: p.port }); return }
    if (picked.sid === r.sid) { setPicked(picked.port === p.port ? null : { sid: r.sid, port: p.port }); return }
    try {
      setErr(null)
      await api.mbAddLink({ sid: picked.sid, port: picked.port }, { sid: r.sid, port: p.port })
      setPicked(null)
      reload()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  const onDown = (e: React.PointerEvent, sid: string) => {
    const p = place[sid]
    drag.current = { sid, ox: e.clientX - p[0], oy: e.clientY - p[1] }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    setPos((p) => ({ ...p, [d.sid]: [Math.max(0, e.clientX - d.ox), Math.max(0, e.clientY - d.oy)] }))
  }

  const curve = (l: MbLinkS) => {
    const a = anchor(place[l.a.sid], l.a.port)
    const b = anchor(place[l.b.sid], l.b.port)
    const k = 70
    return `M ${a.x} ${a.y} C ${a.x + a.dir * k} ${a.y}, ${b.x + b.dir * k} ${b.y}, ${b.x} ${b.y}`
  }
  const w = Math.max(900, ...Object.values(place).map((p) => p[0] + CARD_W + 80))
  const h = Math.max(520, ...Object.values(place).map((p) => p[1] + CARD_H + 80))
  const selectedLink = links.find((l) => l.id === selLink)
  const selectedRelay = relays.find((r) => r.sid === selRelay)

  return (
    <div className="app mb">
      <header className="topbar">
        <div className="brand"><AppMark id="mbitconfig" /><div><b>MBitConfig</b><small>Links Mirrored Bits entre os relés do DigitalRelay</small></div></div>
        <div className="controls">
          <span className="muted">{relays.length} relé(s) · {links.length} link(s)</span>
        </div>
      </header>
      <main>
        {err && <p className="err-text">{err}</p>}
        {relays.length === 0 ? (
          <section className="card"><h3>Nenhum relé na simulação</h3>
            <p className="hint">Abra o <a href="#/digitalrelay">DigitalRelay</a>, carregue um ou mais relés (botão "＋ Relé") e volte. Para poder ser ligado, o relé precisa ter a porta 2 ou 3 com PROTO = MB8A ou MB8B; dá para ajustar aqui, no painel do relé.</p>
          </section>
        ) : (
          <>
            <p className="hint">
              Portas <b>verdes</b> estão aptas (PROTO = MB8A/MB8B). Clique em uma porta apta de um relé e depois em uma porta apta de outro para criar o link.
              {picked ? <b> Escolha agora a porta do segundo relé…</b> : null} Clique em um relé ou link para ver e editar os ajustes. Arraste o título para reposicionar.
            </p>
            <div className="mb-layout">
              <div className="mb-canvas" ref={area} onPointerMove={onMove} onPointerUp={() => { drag.current = null }}>
                <div style={{ position: 'relative', width: w, height: h }}>
                  <svg width={w} height={h} className="mb-svg">
                    {links.map((l) => {
                      const d = curve(l)
                      const cls = l.cut ? 'cut' : l.closed ? 'ok' : 'bad'
                      return (
                        <g key={l.id} onClick={() => { setSelLink(l.id); setSelRelay(null) }} style={{ cursor: 'pointer' }}>
                          <path d={d} className={`mb-link ${cls} ${selLink === l.id ? 'sel' : ''}`} />
                          <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                        </g>
                      )
                    })}
                  </svg>
                  {relays.map((r) => {
                    const p = place[r.sid]
                    return (
                      <div key={r.sid} className={`mb-card ${selRelay === r.sid ? 'sel' : ''} ${r.ports.some((x) => x.eligible) ? '' : 'dim'}`}
                        style={{ left: p[0], top: p[1], width: CARD_W, height: CARD_H }} onClick={() => { setSelRelay(r.sid); setSelLink(null) }}>
                        <div className="mb-head" onPointerDown={(e) => onDown(e, r.sid)} title={r.device}>
                          <b>{r.relay_id.slice(0, 28)}</b>
                          <small>{modelLabel(r.model)}{r.running ? '' : ' · pausado'}</small>
                        </div>
                        {r.ports.map((pt, i) => {
                          const free = !linked.has(`${r.sid}:${pt.port}`)
                          const isPicked = picked?.sid === r.sid && picked.port === pt.port
                          return (
                            <div key={pt.port} className="mb-port-block" style={{ top: HEAD_H + i * BLOCK_H, height: BLOCK_H }}>
                              <button
                                className={`mb-port ${pt.eligible ? 'ok' : 'off'} ${isPicked ? 'picked' : ''} ${free ? '' : 'used'} ${pt.port === 2 ? 'left' : 'right'}`}
                                onClick={(e) => { e.stopPropagation(); clickPort(r, pt) }}
                                title={pt.eligible ? (free ? 'Clique para iniciar/fechar um link' : 'Porta já ligada') : `PROTO = ${pt.proto || '—'}: configure MB8A ou MB8B para usar Mirrored Bits`}
                              >{pt.channel || ''}</button>
                              <div className="mb-pline">
                                <b>P{pt.port}</b> <span className={`chip ${pt.eligible ? 'on' : ''}`}>{pt.proto || '—'}</span>
                                <small className="muted"> TX {pt.txid} · RX {pt.rxid} · {pt.speed}</small>
                              </div>
                              {pt.eligible ? (
                                <>
                                  <Strip prefix="TMB" ch={pt.channel} bits={r.bits} title="Bits transmitidos" />
                                  <Strip prefix="RMB" ch={pt.channel} bits={r.bits} title="Bits recebidos" />
                                </>
                              ) : <small className="muted">não apta (PROTO ≠ MB8A/MB8B)</small>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
              <aside className="mb-side">
                {selectedLink ? <LinkPanel link={selectedLink} relays={relays} onChange={reload} /> : selectedRelay ? (
                  <div>
                    <h3>{selectedRelay.relay_id}</h3>
                    <p className="hint">Ajustes das portas 2 e 3 (classes P2/P3). Para ser ligada, a porta precisa de PROTO = MB8A ou MB8B. Alterações valem só na simulação.</p>
                    {selectedRelay.ports.map((pt) => <PortForm key={`${selectedRelay.sid}${pt.port}${pt.proto}${pt.txid}${pt.rxid}${pt.speed}`} sid={selectedRelay.sid} port={pt} />)}
                    <p className="hint">As equações TMB1A–TMB8A / TMB1B–TMB8B ficam na lógica do relé (aba Ajustes do DigitalRelay).</p>
                  </div>
                ) : <p className="muted">Selecione um relé ou um link.</p>}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

/** Consulta periódica do estado dos links, com recarga imediata após uma alteração. */
function usePollReload(): { data: MbStatus | null; reload: () => void } {
  const [tick, setTick] = useState(0)
  const { data } = usePoll(() => api.mbStatus(), 500, true, `mb${tick}`)
  const last = useRef<MbStatus | null>(null)
  if (data) last.current = data
  return { data: last.current, reload: () => setTick((t) => t + 1) }
}
