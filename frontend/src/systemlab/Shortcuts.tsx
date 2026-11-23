import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { DnpData } from '../types'
import type { El, Shortcut, ShortcutKind } from './model'

const NO_EVENTS = 2147483647   // `since` alto: o mapa vem sem a lista de eventos

const fmt = (v: number, d: number) => (Math.abs(v) >= 1000 ? v.toFixed(Math.max(0, d - 1)) : v.toFixed(d))
const pt = (kind: ShortcutKind, i: number) => `${kind === 'cmd' ? 'BO' : kind === 'bit' ? 'BI' : 'AI'}_${String(i).padStart(2, '0')}`

/** Lê o mapa DNP3 do relé (pontos BO/BI/AI e valores atuais). */
function useDnp(sid: string, ms: number, enabled = true): DnpData | null {
  const [d, setD] = useState<DnpData | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const f = () => api.dnp(sid, NO_EVENTS).then((r) => { if (alive) setD(r) }).catch(() => undefined)
    f()
    const t = setInterval(f, ms)
    return () => { alive = false; clearInterval(t) }
  }, [sid, ms, enabled])
  return d
}

/** Painel flutuante com os atalhos de um IED: comandos (BO), valores binários (BI) e medidas (AI) do mapa DNP3 do relé. */
export function ShortcutPanel({ el, onMove, onToggle }: { el: El; onMove: (x: number, y: number) => void; onToggle: (open: boolean) => void }) {
  const sid = el.sid!
  const list = el.sc ?? []
  const open = el.scOpen !== false
  const dnp = useDnp(sid, 700, open)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const pos = el.scPos ?? { x: 16, y: 96 }

  const send = (s: Shortcut) => api.dnpCommand(sid, s.index, 'PULSE_ON', 'direct')
    .then((r) => { if (r.status === 'SUCCESS') { setErr(null); setOk(`${s.label}: ok`) } else { setOk(null); setErr(`${s.label}: ${r.status} – ${r.message}`) } })
    .catch((e) => { setOk(null); setErr(String(e.message ?? e)) })

  const onDown = (e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMoveEv = (e: React.PointerEvent) => {
    if (drag.current) onMove(Math.max(0, e.clientX - drag.current.dx), Math.max(0, e.clientY - drag.current.dy))
  }
  /** Ponto atual do mapa para o atalho; `stale` quando o índice agora aponta para outro bit (mapa trocado). */
  const look = <T extends { index: number; name: string }>(arr: T[] | undefined, s: Shortcut) => {
    const p = arr?.find((x) => x.index === s.index)
    return { p, stale: !!p && p.name !== s.name }
  }

  return (
    <div className="sl-sc" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sl-sc-head" onPointerDown={onDown} onPointerMove={onMoveEv} onPointerUp={() => { drag.current = null }} title="Arraste para mover">
        <b>{el.name}</b>
        <small>{dnp ? `DNP3 mapa ${dnp.map}` : (el.rname ?? '')}</small>
        <button className="sl-sc-x" onPointerDown={(e) => e.stopPropagation()} onClick={() => onToggle(!open)} aria-label={open ? 'Recolher' : 'Expandir'}>{open ? '▾' : '▸'}</button>
      </div>
      {open && (
        <div className="sl-sc-body">
          {err && <div className="alert">{err}</div>}
          {!err && ok && <small className="muted">{ok}</small>}
          {list.some((s) => s.kind === 'cmd') && (
            <div className="sl-sc-cmds">
              {list.filter((s) => s.kind === 'cmd').map((s) => {
                const { p, stale } = look(dnp?.bo, s)
                return <button key={s.id} disabled={!p || p.name === 'NA' || stale} onClick={() => send(s)} title={`${pt('cmd', s.index)} – ${s.name}${stale ? ' (o mapa mudou)' : ''}`}>{s.label}</button>
              })}
            </div>
          )}
          {list.filter((s) => s.kind === 'bit').map((s) => {
            const { p, stale } = look(dnp?.bi, s)
            const v = !p || stale ? null : p.value
            return (
              <div key={s.id} className="sl-sc-row" title={`${pt('bit', s.index)} – ${s.name}${stale ? ' (o mapa mudou)' : ''}`}>
                <span className={`sl-sc-lamp ${v ? 'on' : ''} ${v == null ? 'na' : ''}`} />
                <span>{s.label}</span>
                <b>{v == null ? '–' : v ? '1' : '0'}</b>
              </div>
            )
          })}
          {list.filter((s) => s.kind === 'meas').map((s) => {
            const { p, stale } = look(dnp?.ai, s)
            const v = !p || stale ? null : p.value
            return (
              <div key={s.id} className="sl-sc-row" title={`${pt('meas', s.index)} – ${s.name}${stale ? ' (o mapa mudou)' : ''}`}>
                <span>{s.label}</span>
                <b className="num">{v == null ? '–' : fmt(v, s.dec ?? 2)} <small>{s.unit ?? ''}</small></b>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const guessUnit = (n: string): string => {
  const u = n.toUpperCase()
  if (/^I[ABCGN]?_MAG$|^I(A|B|C|N)RMS$|^3I[02]$/.test(u)) return 'A'
  if (/^V[ABCS]{1,2}_MAG$|^3V2$/.test(u)) return 'V'
  if (/_ANG$/.test(u)) return '°'
  if (u === 'P') return 'kW'
  if (u === 'Q') return 'kvar'
  if (u === 'S') return 'kVA'
  if (u === 'FREQ') return 'Hz'
  return ''
}

/** Edição dos atalhos de um IED: só pontos do mapa DNP3 do relé associado. */
export function ShortcutEditor({ el, onChange }: { el: El; onChange: (f: (x: El) => El) => void }) {
  const sid = el.sid!
  const dnp = useDnp(sid, 3000)
  const [kind, setKind] = useState<ShortcutKind>('bit')
  const [pick, setPick] = useState('')
  const [label, setLabel] = useState('')
  const list = el.sc ?? []
  const pts = (dnp ? (kind === 'cmd' ? dnp.bo : kind === 'bit' ? dnp.bi : dnp.ai) : []).filter((p) => p.name !== 'NA')
  const cur = pts.find((p) => String(p.index) === pick)
  const add = () => {
    if (!cur) return
    const s: Shortcut = {
      id: Math.max(0, ...list.map((x) => x.id)) + 1, kind, index: cur.index, name: cur.name,
      label: label.trim() || ('desc' in cur && cur.desc ? cur.desc : cur.name),
      ...(kind === 'meas' ? { unit: guessUnit(cur.name), dec: 2 } : {}),
    }
    onChange((x) => ({ ...x, sc: [...(x.sc ?? []), s] }))
    setPick(''); setLabel('')
  }
  const remove = (id: number) => onChange((x) => ({ ...x, sc: (x.sc ?? []).filter((s) => s.id !== id) }))
  const move = (i: number, d: number) => onChange((x) => {
    const a = [...(x.sc ?? [])]
    const j = i + d
    if (j < 0 || j >= a.length) return x
    ;[a[i], a[j]] = [a[j], a[i]]
    return { ...x, sc: a }
  })
  const tag = (k: ShortcutKind) => (k === 'cmd' ? 'BO' : k === 'bit' ? 'BI' : 'AI')
  return (
    <div className="sl-sc-editor">
      <h4>Atalhos na tela (mapa DNP3)</h4>
      <p className="hint">Comandos (BO), valores binários (BI) e medidas (AI) do mapa DNP3 do relé associado, em um painel flutuante sobre o diagrama.</p>
      {list.map((s, i) => (
        <div key={s.id} className="sl-sc-item">
          <span className="tag" title={s.name}>{tag(s.kind)}_{String(s.index).padStart(2, '0')}</span>
          <input type="text" className="numinput" value={s.label} onChange={(e) => onChange((x) => ({ ...x, sc: (x.sc ?? []).map((y) => (y.id === s.id ? { ...y, label: e.target.value } : y)) }))} title={s.name} />
          <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
          <button onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Descer">▼</button>
          <button className="danger" onClick={() => remove(s.id)} aria-label="Remover">✕</button>
        </div>
      ))}
      <div className="sl-sc-add">
        <select className="numinput" value={kind} onChange={(e) => { setKind(e.target.value as ShortcutKind); setPick('') }}>
          <option value="bit">Valor binário (BI)</option>
          <option value="meas">Medida (AI)</option>
          <option value="cmd">Comando (BO)</option>
        </select>
        <select className="numinput" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{dnp ? `— ponto do mapa ${dnp.map} —` : 'carregando mapa DNP3…'}</option>
          {pts.map((p) => <option key={p.index} value={p.index}>{tag(kind)}_{String(p.index).padStart(2, '0')} · {p.name}{p.desc ? ` – ${p.desc}` : ''}</option>)}
        </select>
        <input type="text" className="numinput" placeholder="Rótulo (opcional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="primary" disabled={!cur} onClick={add}>＋ Adicionar</button>
      </div>
    </div>
  )
}
