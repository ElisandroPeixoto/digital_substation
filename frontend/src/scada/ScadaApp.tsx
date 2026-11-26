import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppMark } from '../eclipse/AppMark'
import { api } from '../api'
import type { DnpData, DnpEvent, DnpResult, SessionBrief } from '../types'
import { buildXlsx } from './xlsx'
import { ResizableTables } from '../components/ResizableTables'

/** App SCADA: supervisório dos relés do DigitalRelay pelo mapa DNP3 ativo de cada um.
 *  Eventos binários e analógicos de todos os IEDs numa linha do tempo só, valores atuais e comandos (saídas binárias).
 *  A planilha de mapa (Tipo | Posição | Wordbit | Descrição | Valor 0 | Valor 1) personaliza descrições e estados. */

const KEY = 'scada.state'
const POLL_MIN = 1
const POLL_MAX = 60
const MAX_EVENTS = 5000

type Tab = 'bi' | 'ai' | 'bo'
interface MapEntry { index: number; desc?: string; v0?: string; v1?: string; note?: string }
interface MapInfo {
  filename: string
  at: string
  accepted: Record<string, MapEntry>          // chave "BI:WORDBIT"
  rejected: { line: number; tipo: string; wordbit: string; reason: string }[]
}
interface State { sids: string[]; poll: number; maps: Record<string, MapInfo> }   // maps por relay_id
type Ev = DnpEvent & { sid: string }
type Cmd = DnpResult & { sid: string }

function load(): State {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      sids: Array.isArray(j.sids) ? j.sids.filter((x: unknown) => typeof x === 'string') : [],
      poll: Math.min(POLL_MAX, Math.max(POLL_MIN, Number(j.poll) || 2)),
      maps: j.maps && typeof j.maps === 'object' ? j.maps : {},
    }
  } catch {
    return { sids: [], poll: 2, maps: {} }
  }
}

const fmtTime = (w?: number) => {
  if (!w) return '–'
  const d = new Date(w * 1000)
  const p = (n: number, k = 2) => String(n).padStart(k, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}
const fmtNum = (x: number | null | undefined, d = 3) => (x == null ? '–' : x.toLocaleString('pt-BR', { maximumFractionDigits: d }))

export function ScadaApp() {
  const [st, setSt] = useState<State>(load)
  const save = useCallback((f: (s: State) => State) => setSt((s) => {
    const n = f(s)
    try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* armazenamento indisponível */ }
    return n
  }), [])
  const [tab, setTab] = useState<Tab>('bi')
  const [sessions, setSessions] = useState<SessionBrief[]>([])
  const [snap, setSnap] = useState<Record<string, DnpData>>({})
  const [events, setEvents] = useState<Ev[]>([])
  const [cmds, setCmds] = useState<Cmd[]>([])
  const [paused, setPaused] = useState(false)
  const [lastPoll, setLastPoll] = useState<number | null>(null)
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showRej, setShowRej] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [iedFilter, setIedFilter] = useState('')
  const [tFrom, setTFrom] = useState('')          // período (datetime-local, hora local) – vazio = sem limite
  const [tTo, setTTo] = useState('')
  const [sortAsc, setSortAsc] = useState(false)   // false = mais recente primeiro
  const since = useRef<Record<string, number>>({})
  const seenCmd = useRef(new Set<string>())
  const fileFor = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // tela cheia dos eventos (abas Binários / Analógicos / Comandos): tela cheia do navegador quando permitido, senão sobreposição na janela
  const viewRef = useRef<HTMLDivElement>(null)
  // tabela "Estado atual dos pontos binários": aberta ou recolhida (preferência guardada no navegador)
  const [stateOpen, setStateOpenRaw] = useState(() => { try { return localStorage.getItem('scada.stateOpen') !== '0' } catch { return true } })
  const setStateOpen = (f: (o: boolean) => boolean) => setStateOpenRaw((o) => {
    const n = f(o)
    try { localStorage.setItem('scada.stateOpen', n ? '1' : '0') } catch { /* armazenamento indisponível */ }
    return n
  })
  const [full, setFull] = useState(false)
  const toggleFull = () => {
    if (!full) {
      setFull(true)
      viewRef.current?.requestFullscreen?.().catch(() => undefined)
    } else {
      setFull(false)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    }
  }
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFull(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    document.addEventListener('fullscreenchange', onFs)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('keydown', onKey) }
  }, [])

  // relés existentes no DigitalRelay (nomes e quais ainda existem)
  useEffect(() => {
    let on = true
    const f = () => api.sessions().then((s) => { if (on) setSessions(s) }).catch(() => undefined)
    f()
    const t = setInterval(f, 5000)
    return () => { on = false; clearInterval(t) }
  }, [])
  const sess = (sid: string) => sessions.find((x) => x.id === sid)
  const relayName = (sid: string) => sess(sid)?.device || sess(sid)?.relay_id || `${sid} (encerrado)`
  const relayId = (sid: string) => sess(sid)?.relay_id ?? ''

  // polling dos mapas DNP3 (eventos desde a última leitura)
  const poll = useCallback(async () => {
    const sids = st.sids.filter((s) => sessions.length === 0 || sessions.some((x) => x.id === s))
    for (const sid of sids) {
      try {
        const d = await api.dnp(sid, since.current[sid] ?? 0)
        if ((since.current[sid] ?? 0) > d.last_seq) since.current[sid] = 0           // eventos limpos no relé: recomeça
        since.current[sid] = d.last_seq
        setSnap((s) => ({ ...s, [sid]: d }))
        if (d.events.length) setEvents((e) => [...e, ...d.events.map((x) => ({ ...x, sid }))].slice(-MAX_EVENTS))
        const fresh = d.log.filter((c) => {
          const k = `${sid}|${c.w}|${c.index}|${c.mode}|${c.code}`
          if (seenCmd.current.has(k)) return false
          seenCmd.current.add(k)
          return true
        }).map((c) => ({ ...c, sid }))
        if (fresh.length) setCmds((c) => [...fresh, ...c].slice(0, 1000))
      } catch { /* relé indisponível: tenta de novo no próximo ciclo */ }
    }
    setLastPoll(Date.now())
  }, [st.sids, sessions])
  const pollRef = useRef(poll)
  pollRef.current = poll
  useEffect(() => {
    if (paused) return
    pollRef.current()
    const t = setInterval(() => pollRef.current(), st.poll * 1000)
    return () => clearInterval(t)
  }, [st.poll, paused, st.sids.join(',')])   // eslint-disable-line react-hooks/exhaustive-deps

  // ----------------------------------------------------------------- textos (planilha > relé)
  const entry = (sid: string, tipo: 'BI' | 'AI' | 'BO', wb: string): MapEntry | undefined => st.maps[relayId(sid)]?.accepted[`${tipo}:${wb}`]
  const biPoint = (sid: string, index: number) => snap[sid]?.bi.find((p) => p.index === index)
  const descOf = (sid: string, tipo: 'BI' | 'AI' | 'BO', wb: string, fallback?: string) => entry(sid, tipo, wb)?.desc || fallback || wb
  const stateOf = (sid: string, wb: string, index: number, v: number | null | undefined) => {
    if (v == null) return '–'
    const m = entry(sid, 'BI', wb)
    const p = biPoint(sid, index) as (DnpData['bi'][number] & { t0?: string; t1?: string }) | undefined
    return v ? (m?.v1 || p?.t1 || '1') : (m?.v0 || p?.t0 || '0')
  }

  // ----------------------------------------------------------------- IEDs
  const available = sessions.filter((s) => !st.sids.includes(s.id))
  const addIed = () => {
    if (!pick) return
    since.current[pick] = 0
    save((s) => ({ ...s, sids: [...s.sids, pick] }))
    setPick('')
  }
  const removeIed = (sid: string) => {
    save((s) => ({ ...s, sids: s.sids.filter((x) => x !== sid) }))
    setEvents((e) => e.filter((x) => x.sid !== sid))
    setCmds((c) => c.filter((x) => x.sid !== sid))
    setSnap((s) => { const n = { ...s }; delete n[sid]; return n })
    delete since.current[sid]
  }
  const onMapFile = async (f: File) => {
    const sid = fileFor.current
    if (!sid) return
    setMsg(null)
    try {
      const r = await api.scadaMap(sid, f)
      const accepted: Record<string, MapEntry> = {}
      for (const a of r.accepted) accepted[`${a.tipo}:${a.wordbit}`] = { index: a.index, desc: a.desc, v0: a.v0, v1: a.v1, note: a.note }
      save((s) => ({ ...s, maps: { ...s.maps, [r.relay_id]: { filename: f.name, at: new Date().toISOString(), accepted, rejected: r.rejected.slice(0, 500) } } }))
      setMsg({ ok: true, text: `${relayName(sid)}: ${r.accepted.length} ponto(s) aceito(s), ${r.rejected.length} rejeitado(s) (mapa DNP D${r.map}).` })
      if (r.rejected.length) setShowRej(r.relay_id)
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }
  const sendCmd = async (sid: string, index: number, wb: string) => {
    if (!window.confirm(`Enviar comando (Direct Operate, pulso) para ${relayName(sid)} – BO ${index} (${descOf(sid, 'BO', wb)})?`)) return
    try {
      const r = await api.dnpCommand(sid, index, 'PULSE_ON', 'direct')
      setMsg({ ok: r.status === 'SUCCESS', text: `${relayName(sid)} – BO ${index}: ${r.status} – ${r.message}` })
      pollRef.current()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  // ----------------------------------------------------------------- linhas das tabelas
  const match = (sid: string, ...txt: (string | undefined)[]) =>
    (!iedFilter || iedFilter === sid) && (!q || txt.some((t) => (t ?? '').toLowerCase().includes(q.toLowerCase())))
  // filtro por período (data/hora real do evento) e ordenação pela data/hora
  const tMin = tFrom ? new Date(tFrom).getTime() / 1000 : -Infinity
  const tMax = tTo ? new Date(tTo).getTime() / 1000 + (tTo.length <= 16 ? 59.999 : 0.999) : Infinity
  const inRange = (w?: number) => (!tFrom && !tTo) || (w != null && w >= tMin && w <= tMax)
  const byTime = <T extends { w?: number; seq?: number }>(a: T, b: T) => ((a.w ?? 0) - (b.w ?? 0) || (a.seq ?? 0) - (b.seq ?? 0)) * (sortAsc ? 1 : -1)
  const evRows = useMemo(() => [...events], [events])
  const biEv = evRows.filter((e) => e.kind === 'BI' && inRange(e.w)).filter((e) => match(e.sid, e.name, descOf(e.sid, 'BI', e.name, biPoint(e.sid, e.index)?.desc), relayName(e.sid))).sort(byTime)
  const aiEv = evRows.filter((e) => e.kind === 'AI' && inRange(e.w)).filter((e) => match(e.sid, e.name, descOf(e.sid, 'AI', e.name), relayName(e.sid))).sort(byTime)
  const cmdRows = cmds.filter((c) => inRange(c.w) && match(c.sid, c.name, descOf(c.sid, 'BO', c.name))).sort(byTime)
  const timeHead = (
    <th className="sortable" onClick={() => setSortAsc((v) => !v)} title={sortAsc ? 'Ordenado do mais antigo para o mais recente (clique para inverter)' : 'Ordenado do mais recente para o mais antigo (clique para inverter)'}>
      Data/hora {sortAsc ? '▲' : '▼'}
    </th>
  )
  const sids = st.sids

  /** Exporta os eventos do SCADA (todos os IEDs, sem filtros) numa planilha .xlsx com as abas Binários, Analógicos e Comandos. */
  const exportExcel = () => {
    const all = [...events].reverse()
    const bi = all.filter((e) => e.kind === 'BI')
    const ai = all.filter((e) => e.kind === 'AI')
    if (bi.length + ai.length + cmds.length === 0) { setMsg({ ok: false, text: 'Não há eventos para exportar.' }); return }
    const when = (w?: number) => (w ? fmtTime(w).replace(/^(\d\d)\/(\d\d) /, `$1/$2/${new Date(w * 1000).getFullYear()} `) : '')
    const blob = buildXlsx([
      { name: 'Binários', widths: [24, 40, 10, 14, 50, 18, 8],
        rows: [['Data/hora', 'IED', 'Posição', 'Wordbit', 'Descrição', 'Estado', 'Valor'],
          ...bi.map((e) => [when(e.w), relayName(e.sid), e.index, e.name, descOf(e.sid, 'BI', e.name, biPoint(e.sid, e.index)?.desc), stateOf(e.sid, e.name, e.index, e.value), e.value])] },
      { name: 'Analógicos', widths: [24, 40, 10, 14, 50, 14, 12],
        rows: [['Data/hora', 'IED', 'Posição', 'Wordbit', 'Descrição', 'Valor', 'Contagem DNP'],
          ...ai.map((e) => [when(e.w), relayName(e.sid), e.index, e.name, descOf(e.sid, 'AI', e.name), e.value, e.raw])] },
      { name: 'Comandos', widths: [24, 40, 10, 14, 50, 10, 12, 16, 50],
        rows: [['Data/hora', 'IED', 'Posição', 'Wordbit', 'Descrição', 'Modo', 'Código', 'Resultado', 'Mensagem'],
          ...cmds.map((c) => [when(c.w), relayName(c.sid), c.index, c.name, descOf(c.sid, 'BO', c.name), c.mode, c.code, c.status, c.message])] },
    ])
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    link.download = `scada-eventos-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  return (
    <div className="app scada">
      <header className="topbar">
        <div className="brand"><AppMark id="scada" /><div><b>SCADA</b><small>Supervisório dos IEDs do DigitalRelay (mapa DNP3 ativo)</small></div></div>
        <div className="controls">
          <label className="speed">Polling
            <input type="number" className="numinput" min={POLL_MIN} max={POLL_MAX} step={1} value={st.poll} style={{ width: 64 }}
              onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) save((s) => ({ ...s, poll: Math.min(POLL_MAX, Math.max(POLL_MIN, n)) })) }} /> s
          </label>
          <button onClick={() => setPaused((p) => !p)}>{paused ? '▶ Retomar' : '⏸ Pausar'}</button>
          <button onClick={() => pollRef.current()} title="Lê os relés agora">↻ Atualizar</button>
          <button onClick={() => { setEvents([]); setCmds([]) }} title="Limpa a lista de eventos do SCADA (não altera os relés)">Limpar eventos</button>
          <span className="muted">{lastPoll ? `última leitura ${new Date(lastPoll).toLocaleTimeString('pt-BR')}` : '–'}</span>
        </div>
      </header>
      <main>
        <section className="card">
          <div className="row wrap">
            <h3>IEDs supervisionados</h3>
            <span className="spacer" />
            <select className="numinput" value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 260 }}>
              <option value="">{available.length ? '— escolha um relé do DigitalRelay —' : 'nenhum relé disponível'}</option>
              {available.map((s) => <option key={s.id} value={s.id}>{(s.device || s.relay_id).slice(0, 50)}</option>)}
            </select>
            <button className="primary" disabled={!pick} onClick={addIed}>+ Adicionar IED</button>
          </div>
          {sids.length === 0 ? <p className="hint">Adicione os relés em execução no DigitalRelay que deseja supervisionar. O SCADA lê o mapa DNP3 ativo de cada um a cada {st.poll} s.</p> : (
            <table className="tbl">
              <thead><tr><th>IED</th><th>Modelo</th><th>Mapa DNP</th><th>Pontos (BI / AI / BO)</th><th>Planilha de mapa</th><th /></tr></thead>
              <tbody>
                {sids.map((sid) => {
                  const s = sess(sid)
                  const d = snap[sid]
                  const m = st.maps[relayId(sid)]
                  return (
                    <tr key={sid} className={s ? '' : 'muted'}>
                      <td><b>{relayName(sid)}</b>{s && !s.running && <span className="muted"> · pausado</span>}</td>
                      <td>{s ? `SEL-${s.model}` : '–'}</td>
                      <td>{d ? `D${d.map}` : '–'}</td>
                      <td className="mono">{d ? `${d.bi.filter((p) => p.name !== 'NA').length} / ${d.ai.filter((p) => p.name !== 'NA').length} / ${d.bo.filter((p) => p.name !== 'NA').length}` : '–'}</td>
                      <td>
                        {m ? <span title={`carregada em ${new Date(m.at).toLocaleString('pt-BR')}`}>{m.filename} · {Object.keys(m.accepted).length} aceitos{m.rejected.length ? <> · <button className="link" onClick={() => setShowRej(relayId(sid))}>{m.rejected.length} rejeitados</button></> : ''}</span> : <span className="muted">textos do relé</span>}
                      </td>
                      <td className="row">
                        <button disabled={!s} onClick={() => { fileFor.current = sid; fileRef.current?.click() }} title="Planilha .xlsx/.csv com as colunas Tipo | Posição | Wordbit | Descrição | Valor 0 | Valor 1">Carregar mapa (Excel)</button>
                        {m && <button onClick={() => save((x) => { const maps = { ...x.maps }; delete maps[relayId(sid)]; return { ...x, maps } })}>Remover mapa</button>}
                        <button onClick={() => removeIed(sid)}>Remover IED</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onMapFile(f) }} />
          {msg && <p className={msg.ok ? 'hint' : 'err-text'}>{msg.text}</p>}
          {showRej && st.maps[showRej] && (
            <div className="scada-rej">
              <div className="row"><b>Linhas rejeitadas – {st.maps[showRej].filename}</b><span className="spacer" /><button className="link" onClick={() => setShowRej(null)}>fechar</button></div>
              <table className="tbl"><thead><tr><th>Linha</th><th>Tipo</th><th>Wordbit</th><th>Motivo</th></tr></thead>
                <tbody>{st.maps[showRej].rejected.map((r, i) => <tr key={i}><td>{r.line}</td><td>{r.tipo || '–'}</td><td className="mono">{r.wordbit || '–'}</td><td>{r.reason}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>

        <div ref={viewRef} className={`scada-view ${full ? 'full' : ''}`}>
        <nav className="tabs">
          {full && <b className="scada-full-title">SCADA</b>}
          {([['bi', 'Binários'], ['ai', 'Analógicos'], ['bo', 'Comandos']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
          <span className="spacer" />
          <select className="numinput" value={iedFilter} onChange={(e) => setIedFilter(e.target.value)} style={{ width: 220 }}>
            <option value="">Todos os IEDs</option>
            {sids.map((sid) => <option key={sid} value={sid}>{relayName(sid)}</option>)}
          </select>
          <input className="search" placeholder="Filtrar (wordbit, descrição…)" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="scada-period" title="Mostra só os eventos e comandos dentro do período (data e hora local)">De
            <input type="datetime-local" step={1} className="numinput" value={tFrom} onChange={(e) => setTFrom(e.target.value)} />
          </label>
          <label className="scada-period">Até
            <input type="datetime-local" step={1} className="numinput" value={tTo} onChange={(e) => setTTo(e.target.value)} />
          </label>
          {(tFrom || tTo) && <button className="link" onClick={() => { setTFrom(''); setTTo('') }} title="Remove o filtro de período">limpar período</button>}
          <button onClick={() => setSortAsc((v) => !v)} title="Inverte a ordem dos eventos pela data/hora">{sortAsc ? '▲ Mais antigos primeiro' : '▼ Mais recentes primeiro'}</button>
          {full && <span className="muted">{lastPoll ? `última leitura ${new Date(lastPoll).toLocaleTimeString('pt-BR')}` : ''}</span>}
          <button onClick={exportExcel} title="Baixa uma planilha Excel com os eventos binários, analógicos e comandos de todos os IEDs">⬇ Exportar Excel</button>
          <button onClick={toggleFull} title={full ? 'Sair da tela cheia (Esc)' : 'Abrir os eventos em tela cheia'}>{full ? '✕ Sair da tela cheia' : '⛶ Tela cheia'}</button>
        </nav>

        {tab === 'bi' && (
          <>
            <section className="card">
              <h3>Eventos binários <span className="muted">({biEv.length})</span></h3>
              {biEv.length === 0 ? <p className="hint">Sem eventos. As mudanças dos pontos BI dos IEDs adicionados aparecem aqui, do mais recente para o mais antigo.</p> : (
                <ResizableTables id="scada-bi-ev"><div className="scada-scroll"><table className="tbl">
                  <thead><tr>{timeHead}<th>IED</th><th>Posição</th><th>Wordbit</th><th>Descrição</th><th>Estado</th></tr></thead>
                  <tbody>{biEv.slice(0, 1000).map((e) => (
                    <tr key={`${e.sid}-${e.seq}`} className={e.value ? 'scada-on' : ''}>
                      <td className="mono">{fmtTime(e.w)}</td><td>{relayName(e.sid)}</td><td className="mono">{e.index}</td><td className="mono">{e.name}</td>
                      <td>{descOf(e.sid, 'BI', e.name, biPoint(e.sid, e.index)?.desc)}</td>
                      <td><span className={`scada-state ${e.value ? 'on' : 'off'}`}>{stateOf(e.sid, e.name, e.index, e.value)}</span></td>
                    </tr>))}</tbody>
                </table></div></ResizableTables>
              )}
            </section>
            <section className="card">
              <div className="row">
                <h3>Estado atual dos pontos binários</h3>
                <span className="spacer" />
                <button onClick={() => setStateOpen((o) => !o)} aria-expanded={stateOpen} title={stateOpen ? 'Recolher a tabela de estado atual' : 'Expandir a tabela de estado atual'}>{stateOpen ? '▴ Recolher' : '▾ Expandir'}</button>
              </div>
              {stateOpen && <ResizableTables id="scada-bi-state"><div className="scada-scroll"><table className="tbl">
                <thead><tr><th>IED</th><th>Posição</th><th>Wordbit</th><th>Descrição</th><th>Estado</th><th>Última mudança</th></tr></thead>
                <tbody>{sids.flatMap((sid) => (snap[sid]?.bi ?? []).filter((p) => p.name !== 'NA' && match(sid, p.name, descOf(sid, 'BI', p.name, p.desc))).map((p) => (
                  <tr key={`${sid}-${p.index}`} className={p.value ? 'scada-on' : ''}>
                    <td>{relayName(sid)}</td><td className="mono">{p.index}</td><td className="mono">{p.name}</td><td>{descOf(sid, 'BI', p.name, p.desc)}</td>
                    <td><span className={`scada-state ${p.value ? 'on' : 'off'}`}>{stateOf(sid, p.name, p.index, p.value)}</span></td><td className="mono">{fmtTime(p.changed_w ?? undefined)}</td>
                  </tr>)))}</tbody>
              </table></div></ResizableTables>}
            </section>
          </>
        )}

        {tab === 'ai' && (
          <>
            <section className="card">
              <h3>Medidas analógicas</h3>
              <ResizableTables id="scada-ai"><div className="scada-scroll"><table className="tbl">
                <thead><tr><th>IED</th><th>Posição</th><th>Wordbit</th><th>Descrição</th><th>Valor</th><th>Contagem DNP</th><th>Qualidade</th></tr></thead>
                <tbody>{sids.flatMap((sid) => (snap[sid]?.ai ?? []).filter((p) => p.name !== 'NA' && match(sid, p.name, descOf(sid, 'AI', p.name, p.desc))).map((p) => (
                  <tr key={`${sid}-${p.index}`}>
                    <td>{relayName(sid)}</td><td className="mono">{p.index}</td><td className="mono">{p.name}</td><td>{descOf(sid, 'AI', p.name, p.desc)}</td>
                    <td className="mono">{fmtNum(p.value)}</td><td className="mono">{p.raw ?? '–'}</td><td className={p.quality === 'ONLINE' ? '' : 'err-text'}>{p.quality}</td>
                  </tr>)))}</tbody>
              </table></div></ResizableTables>
            </section>
            <section className="card">
              <h3>Eventos analógicos (banda morta) <span className="muted">({aiEv.length})</span></h3>
              {aiEv.length === 0 ? <p className="hint">Sem eventos analógicos: um evento é gerado quando a medida varia mais que a banda morta do mapa DNP.</p> : (
                <ResizableTables id="scada-ai-ev"><div className="scada-scroll"><table className="tbl">
                  <thead><tr>{timeHead}<th>IED</th><th>Posição</th><th>Wordbit</th><th>Descrição</th><th>Valor</th><th>Contagem</th></tr></thead>
                  <tbody>{aiEv.slice(0, 1000).map((e) => (
                    <tr key={`${e.sid}-${e.seq}`}><td className="mono">{fmtTime(e.w)}</td><td>{relayName(e.sid)}</td><td className="mono">{e.index}</td><td className="mono">{e.name}</td>
                      <td>{descOf(e.sid, 'AI', e.name)}</td><td className="mono">{fmtNum(e.value)}</td><td className="mono">{e.raw}</td></tr>))}</tbody>
                </table></div></ResizableTables>
              )}
            </section>
          </>
        )}

        {tab === 'bo' && (
          <>
            <section className="card">
              <h3>Comandos (saídas binárias)</h3>
              <ResizableTables id="scada-bo"><div className="scada-scroll"><table className="tbl">
                <thead><tr><th>IED</th><th>Posição</th><th>Wordbit</th><th>Descrição</th><th /></tr></thead>
                <tbody>{sids.flatMap((sid) => (snap[sid]?.bo ?? []).filter((p) => p.name !== 'NA' && match(sid, p.name, descOf(sid, 'BO', p.name, p.desc))).map((p) => (
                  <tr key={`${sid}-${p.index}`}>
                    <td>{relayName(sid)}</td><td className="mono">{p.index}</td><td className="mono">{p.name}</td><td>{descOf(sid, 'BO', p.name, p.desc)}</td>
                    <td><button disabled={!sess(sid)} onClick={() => sendCmd(sid, p.index, p.name)}>Enviar pulso</button></td>
                  </tr>)))}</tbody>
              </table></div></ResizableTables>
            </section>
            <section className="card">
              <h3>Registro de comandos <span className="muted">({cmdRows.length})</span></h3>
              {cmdRows.length === 0 ? <p className="hint">Sem comandos registrados no período/filtro. Comandos enviados pelo SCADA ou pela aba DNP3 do DigitalRelay aparecem aqui.</p> : (
                <ResizableTables id="scada-bo-log"><div className="scada-scroll"><table className="tbl">
                  <thead><tr>{timeHead}<th>IED</th><th>Posição</th><th>Wordbit</th><th>Descrição</th><th>Modo</th><th>Código</th><th>Resultado</th></tr></thead>
                  <tbody>{cmdRows.map((c, i) => (
                    <tr key={i} className={c.status === 'SUCCESS' ? '' : 'hl-red'}>
                      <td className="mono">{fmtTime(c.w)}</td><td>{relayName(c.sid)}</td><td className="mono">{c.index}</td><td className="mono">{c.name}</td>
                      <td>{descOf(c.sid, 'BO', c.name)}</td><td>{c.mode}</td><td>{c.code}</td><td title={c.message}>{c.status}</td>
                    </tr>))}</tbody>
                </table></div></ResizableTables>
              )}
            </section>
          </>
        )}
        </div>
      </main>
    </div>
  )
}
