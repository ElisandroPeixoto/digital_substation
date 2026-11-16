import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { fmt, usePoll } from '../hooks'
import { useStamp } from '../prefs'
import { ResizableTables } from './ResizableTables'
import type { DnpData, DnpEvent, DnpResult } from '../types'
import { Empty, Pill } from './ui'

const CODES = [
  { v: 'PULSE_ON', l: 'Pulse On' },
  { v: 'LATCH_ON', l: 'Latch On' },
  { v: 'LATCH_OFF', l: 'Latch Off' },
]
type Sub = 'bo' | 'bi' | 'ai' | 'ev'

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'SUCCESS' ? 'ok' : status === 'NOT_SUPPORTED' || status === 'NO_SELECT' || status === 'TIMEOUT' ? 'warn' : 'err'
  return <span className={`badge ${tone}`}>{status}</span>
}

export function DnpView({ sid }: { sid: string }) {
  const since = useRef(0)
  const [events, setEvents] = useState<DnpEvent[]>([])
  const [sub, setSub] = useState<Sub>('bo')
  const ts = useStamp()
  const [q, setQ] = useState('')
  const [showNA, setShowNA] = useState(false)
  const [codes, setCodes] = useState<Record<number, string>>({})
  const [last, setLast] = useState<DnpResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    since.current = 0
    setEvents([])
  }, [sid])

  const { data } = usePoll<DnpData>(
    async () => {
      const d = await api.dnp(sid, since.current)
      if (d.events.length) setEvents((prev) => [...prev, ...d.events].slice(-600))
      since.current = d.last_seq
      return d
    },
    400,
    true,
    sid,
  )

  if (!data) return <Empty>Carregando mapa DNP3…</Empty>
  const match = (...t: string[]) => !q || t.some((x) => x.toLowerCase().includes(q.toLowerCase()))
  const codeOf = (i: number) => codes[i] ?? 'PULSE_ON'

  const send = async (index: number, mode: 'select' | 'operate' | 'direct') => {
    try {
      const r = await api.dnpCommand(sid, index, codeOf(index), mode)
      setLast(r)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const bo = data.bo.filter((p) => (showNA || p.name !== 'NA') && match(p.name, p.desc, `BO_${p.index}`))
  const bi = data.bi.filter((p) => (showNA || p.name !== 'NA') && match(p.name, p.desc, `BI_${p.index}`))
  const ai = data.ai.filter((p) => (showNA || p.name !== 'NA') && match(p.name, p.desc, `AI_${p.index}`))

  return (
    <ResizableTables id="dnp" className="dnp">
      <div className="toolbar">
        <div className="subtabs">
          {([['bo', `Comandos (BO) ${data.bo.filter((p) => p.name !== 'NA').length}`],
            ['bi', `Entradas binárias (BI) ${data.bi.filter((p) => p.name !== 'NA').length}`],
            ['ai', `Entradas analógicas (AI) ${data.ai.filter((p) => p.name !== 'NA').length}`],
            ['ev', `Eventos ${events.length}`]] as [Sub, string][]).map(([k, l]) => (
            <button key={k} className={sub === k ? 'active' : ''} onClick={() => setSub(k)}>{l}</button>
          ))}
        </div>
        <input className="search" placeholder="Filtrar pontos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={showNA} onChange={(e) => setShowNA(e.target.checked)} /> Mostrar não mapeados</label>
        {data.maps.length > 1 && (
          <label className="check">
            Mapa
            <select value={data.map} onChange={(e) => { api.dnpMap(sid, Number(e.target.value)); since.current = 0; setEvents([]) }}>
              {data.maps.map((m) => <option key={m} value={m}>D{m}</option>)}
            </select>
          </label>
        )}
      </div>

      {sub === 'bo' && (
        <>
          <div className="notice">
            Simula um mestre DNP3 enviando CROB. <b>Select → Operate</b> exige seleção prévia (validade de 10 s simulados); <b>Direct</b> opera de imediato.
            Os bits remotos (RBxx), OC e CC são pulsos de um ciclo de processamento – a lógica do relé decide se o comando é aceito (ex.: modo Local/Remoto).
          </div>
          {(last || err) && (
            <div className={`result ${last && last.status === 'SUCCESS' ? 'ok' : 'warn'}`}>
              {err ? err : last && (<><StatusBadge status={last.status} /> <b>BO_{String(last.index).padStart(2, '0')} {last.name}</b> · {last.code} · {last.mode} – {last.message}</>)}
            </div>
          )}
          <table className="tbl">
            <thead><tr><th>Ponto</th><th>Bit</th><th>Descrição</th><th>Código</th><th>Comando</th></tr></thead>
            <tbody>
              {bo.map((p) => {
                const sel = data.selected && data.selected.index === p.index
                const na = p.name === 'NA'
                return (
                  <tr key={p.index} className={sel ? 'hl' : na ? 'dim' : ''}>
                    <td className="mono">BO_{String(p.index).padStart(2, '0')}</td>
                    <td className="mono">{p.name}</td>
                    <td>{p.desc}</td>
                    <td>
                      <select disabled={na} value={codeOf(p.index)} onChange={(e) => setCodes({ ...codes, [p.index]: e.target.value })}>
                        {CODES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
                      </select>
                    </td>
                    <td className="actions">
                      <button disabled={na} onClick={() => send(p.index, 'select')}>Select</button>
                      <button disabled={na} onClick={() => send(p.index, 'operate')}>Operate</button>
                      <button disabled={na} className="primary" onClick={() => send(p.index, 'direct')}>Direct</button>
                      {sel && data.selected && <span className="tag">selecionado · {data.selected.left.toFixed(0)} s</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h4>Registro de comandos</h4>
          {data.log.length === 0 ? <Empty>Nenhum comando enviado.</Empty> : (
            <table className="tbl">
              <thead><tr><th>{ts.header}</th><th>Ponto</th><th>Código</th><th>Modo</th><th>Resultado</th><th>Mensagem</th></tr></thead>
              <tbody>
                {data.log.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{ts.stamp(r.t, r.w)}</td>
                    <td className="mono">BO_{String(r.index).padStart(2, '0')} {r.name}</td>
                    <td>{r.code}</td><td>{r.mode}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="muted">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {sub === 'bi' && (
        <table className="tbl">
          <thead><tr><th>Ponto</th><th>Bit</th><th>Descrição</th><th>Valor</th><th>Última mudança</th></tr></thead>
          <tbody>
            {bi.map((p) => (
              <tr key={p.index} className={p.value ? 'hl' : p.name === 'NA' ? 'dim' : ''}>
                <td className="mono">BI_{String(p.index).padStart(2, '0')}</td>
                <td className="mono">{p.name}</td>
                <td>{p.desc}</td>
                <td><Pill on={p.value} /></td>
                <td className="mono">{p.changed !== null ? ts.stamp(p.changed, p.changed_w) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sub === 'ai' && (
        <table className="tbl">
          <thead><tr><th>Ponto</th><th>Grandeza</th><th>Descrição</th><th>Valor (eng.)</th><th>Escala</th><th>Contagem DNP</th><th>Banda morta</th><th>Qualidade</th></tr></thead>
          <tbody>
            {ai.map((p) => (
              <tr key={p.index} className={p.name === 'NA' ? 'dim' : ''}>
                <td className="mono">AI_{String(p.index).padStart(2, '0')}</td>
                <td className="mono">{p.name}</td>
                <td>{p.desc}</td>
                <td className="mono">{fmt(p.value, 3)}</td>
                <td className="mono">{p.name === 'NA' ? '–' : p.scale}</td>
                <td className="mono"><b>{p.raw ?? '–'}</b></td>
                <td className="mono">{p.name === 'NA' ? '–' : p.deadband}</td>
                <td>{p.quality === 'ONLINE' ? <span className="badge ok">ONLINE</span> : p.quality === 'NA' ? '–' : <span className="badge err">{p.quality}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sub === 'ev' && (
        <>
          <div className="toolbar">
            <button onClick={async () => { await api.clearDnpEvents(sid); setEvents([]) }} disabled={events.length === 0}>Limpar eventos</button>
          </div>
          <div className="notice">Eventos que um mestre receberia numa varredura de classe 1/2/3: mudança de estado nos BI e variação acima da banda morta nos AI.</div>
          {events.length === 0 ? <Empty>Sem eventos ainda. Aplique uma falta ou envie um comando.</Empty> : (
            <table className="tbl">
              <thead><tr><th>#</th><th>{ts.header}</th><th>Tipo</th><th>Ponto</th><th>Bit / grandeza</th><th>Valor</th></tr></thead>
              <tbody>
                {[...events].reverse().filter((e) => match(e.name, `${e.kind}_${e.index}`)).map((e) => (
                  <tr key={e.seq}>
                    <td className="mono">{e.seq}</td>
                    <td className="mono">{ts.stamp(e.t, e.w)}</td>
                    <td>{e.kind}</td>
                    <td className="mono">{e.kind}_{String(e.index).padStart(2, '0')}</td>
                    <td className="mono">{e.name}</td>
                    <td className="mono">{e.kind === 'BI' ? <Pill on={e.value} /> : `${fmt(e.value, 2)} (cont. ${e.raw})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </ResizableTables>
  )
}
