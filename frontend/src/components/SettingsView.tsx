import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { SessionInfo, SettingsData } from '../types'
import { Empty } from './ui'

const ORDER = ['G', '1', '2', '3', '4', 'L1', 'L2', 'L3', 'L4', 'F', 'R', 'D1', 'D2', 'D3']
const NOT_SIMULATED = (cls: string) => cls === 'M' || cls === 'I' || /^E\d/.test(cls) || /^P/.test(cls)
const LIMIT = 400

function SettingRow({ sid, cls, item, onSaved }: { sid: string; cls: string; item: SettingsData['items'][number]; onSaved: () => void }) {
  const [text, setText] = useState(item.value)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setText(item.value), [item.value])
  const save = async () => {
    if (text === item.value) return
    try {
      await api.patchSetting(sid, cls, item.key, text)
      setErr(null)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setText(item.value)
    }
  }
  return (
    <tr className={item.modified ? 'hl' : ''}>
      <td className="mono">{item.key}</td>
      <td>
        <input
          className="setting-input mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setText(item.value)
          }}
        />
        {err && <div className="err-text">{err}</div>}
      </td>
      <td>{item.modified && <span className="tag">alterado</span>}</td>
    </tr>
  )
}

export function SettingsView({ sid, info, activeGroup }: { sid: string; info: SessionInfo; activeGroup: number }) {
  const classes = useMemo(
    () =>
      [...info.classes].sort((a, b) => {
        const ia = ORDER.indexOf(a.cls), ib = ORDER.indexOf(b.cls)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.cls.localeCompare(b.cls)
      }),
    [info.classes],
  )
  const [cls, setCls] = useState('1')
  const [q, setQ] = useState('')
  const [data, setData] = useState<SettingsData | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.settings(sid, cls).then((d) => { setData(d); setError(null) }).catch((e) => setError(String(e.message ?? e)))
  }, [sid, cls])
  useEffect(() => { setData(null); load() }, [load])
  useEffect(() => {
    if (showRaw) api.settingsRaw(sid, cls).then(setRaw).catch(() => setRaw(null))
  }, [showRaw, sid, cls])

  const filtered = (data?.items ?? []).filter((i) => !q || i.key.toLowerCase().includes(q.toLowerCase()) || i.value.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="settings">
      <aside className="classes">
        {classes.map((c) => (
          <button key={c.cls} className={cls === c.cls ? 'active' : ''} onClick={() => setCls(c.cls)}>
            <b>{c.cls}</b>
            <span>{c.name}</span>
            <small>{c.count}{String(activeGroup) === c.cls || `L${activeGroup}` === c.cls ? ' · ativo' : ''}{NOT_SIMULATED(c.cls) ? ' · não simulado' : ''}</small>
          </button>
        ))}
      </aside>
      <div className="settings-main">
        <div className="toolbar">
          <input className="search" placeholder="Filtrar por nome ou valor…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> Texto original do arquivo</label>
          <span className="muted">{filtered.length} de {data?.items.length ?? 0} ajustes</span>
        </div>
        <div className="notice">
          Edite um valor e pressione Enter: o relé simulado recompila as equações imediatamente. Use <code>OFF</code> para desabilitar um pickup.
          As alterações valem só para esta sessão (o .rdb original não é modificado).
        </div>
        {error && <div className="alert">{error}</div>}
        {showRaw ? (
          <pre className="raw">{raw ?? 'Carregando…'}</pre>
        ) : !data ? (
          <Empty>Carregando ajustes…</Empty>
        ) : (
          <>
            <table className="tbl">
              <thead><tr><th style={{ width: 150 }}>Ajuste</th><th>Valor / equação</th><th style={{ width: 80 }} /></tr></thead>
              <tbody>
                {filtered.slice(0, LIMIT).map((it) => (
                  <SettingRow key={cls + it.key} sid={sid} cls={cls} item={it} onSaved={load} />
                ))}
              </tbody>
            </table>
            {filtered.length > LIMIT && <div className="muted pad">Mostrando {LIMIT} primeiros. Refine o filtro para ver os demais.</div>}
          </>
        )}
      </div>
    </div>
  )
}
