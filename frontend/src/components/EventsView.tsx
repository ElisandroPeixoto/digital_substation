import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { usePoll } from '../hooks'
import { useStamp } from '../prefs'
import { ResizableTables } from './ResizableTables'
import type { SerEvent } from '../types'
import { Empty, Pill } from './ui'

export function EventsView({ sid }: { sid: string }) {
  const since = useRef(0)
  const [events, setEvents] = useState<SerEvent[]>([])
  const [q, setQ] = useState('')
  const ts = useStamp()

  useEffect(() => {
    since.current = 0
    setEvents([])
  }, [sid])

  usePoll(
    async () => {
      const d = await api.ser(sid, since.current)
      if (d.events.length) setEvents((prev) => [...prev, ...d.events].slice(-1500))
      since.current = d.last_seq
      return d
    },
    500,
    true,
    sid,
  )

  const rows = [...events].reverse().filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()) || e.text.toLowerCase().includes(q.toLowerCase()))
  return (
    <ResizableTables id="ser" className="ser">
      <div className="toolbar">
        <input className="search" placeholder="Filtrar eventos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={async () => { await api.clearSer(sid); setEvents([]) }}>Limpar</button>
        <span className="muted">SER: registra as mudanças dos bits das listas SER1–SER4 do relatório (set_R).</span>
      </div>
      {rows.length === 0 ? (
        <Empty>Sem eventos ainda. Pressione um botão, aplique uma falta ou altere uma entrada.</Empty>
      ) : (
        <table className="tbl">
          <thead><tr><th>#</th><th>{ts.header}</th><th>Bit</th><th>Estado</th><th>Texto</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.seq}>
                <td className="mono">{e.seq}</td>
                <td className="mono">{ts.stamp(e.t, e.w, 3)}</td>
                <td className="mono">{e.name}</td>
                <td><Pill on={e.value} onLabel="Asserted" offLabel="Deasserted" /></td>
                <td>{e.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ResizableTables>
  )
}
