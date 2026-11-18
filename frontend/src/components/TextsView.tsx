import { useMemo, useState } from 'react'
import { api } from '../api'
import type { Texts } from '../customTexts'
import type { IoBit, PanelData } from '../types'

interface Props {
  sid: string
  data: PanelData | null
  texts: Texts
  setText: (name: string, text: string) => void
  clearAll: () => void
}

interface Row { name: string; original: string }

function Table({ title, rows, texts, setText, hint }: { title: string; rows: Row[]; texts: Texts; setText: (n: string, t: string) => void; hint?: string }) {
  if (rows.length === 0) return null
  return (
    <section className="card">
      <h3>{title} <span className="muted">({rows.length})</span></h3>
      {hint && <p className="hint">{hint}</p>}
      <table className="tbl txt-table">
        <thead><tr><th>Ponto</th><th>Descrição dos ajustes</th><th>Texto personalizado</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="mono">{r.name}</td>
              <td className="muted">{r.original || '—'}</td>
              <td className="txt-cell">
                <input type="text" className="numinput" value={texts[r.name] ?? ''} maxLength={80} placeholder={r.original || 'sem texto'}
                  onChange={(e) => setText(r.name, e.target.value)} aria-label={`Texto de ${r.name}`} />
                {texts[r.name] && <button className="link" onClick={() => setText(r.name, '')} title="Voltar à descrição dos ajustes">limpar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Aba "Textos": textos personalizados para entradas, saídas, bits virtuais (VB), remotos (RB) e de controle (CB). */
export function TextsView({ sid, data, texts, setText, clearAll }: Props) {
  const [q, setQ] = useState('')
  const [extra, setExtra] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const sets = useMemo(() => {
    if (!data) return null
    const is2440 = data.model === '2440' && !!data.io
    const inputs: Row[] = is2440
      ? data.io!.slots.flatMap((s) => s.points.filter((p) => p.in_used).map((p) => ({ name: p.in, original: p.in_label })))
      : data.inputs.map((i) => ({ name: i.name, original: i.label }))
    const outputs: Row[] = is2440
      ? data.io!.slots.flatMap((s) => s.points.filter((p) => p.out_used).map((p) => ({ name: p.out, original: p.out_label })))
      : data.outputs.map((o) => ({ name: o.name, original: o.label }))
    const bits = (l: IoBit[]): Row[] => l.map((b) => ({ name: b.name, original: b.label }))
    return { inputs, outputs, vb: bits(data.bits?.vb ?? []), rb: bits(data.bits?.rb ?? []), cb: bits(data.bits?.cb ?? []), is2440 }
  }, [data])

  if (!sets) return <div className="muted">Aguardando o simulador…</div>
  const f = (rows: Row[]) => rows.filter((r) => !q || `${r.name} ${r.original} ${texts[r.name] ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const validExtra = /^(VB\d{3}|CB\d{3}|RB\d{2})$/.test(extra)
  const count = Object.keys(texts).length

  return (
    <div className="texts">
      <div className="toolbar">
        <input className="search" placeholder="Filtrar pontos…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">{count} texto(s) personalizado(s) · salvos neste navegador, por relé</span>
        <span className="spacer" />
        <button disabled={count === 0} onClick={() => { if (window.confirm('Apagar todos os textos personalizados deste relé?')) clearAll() }}>Limpar todos</button>
      </div>
      <div className="notice">
        Os textos substituem a descrição dos ajustes no <b>Painel frontal</b> (chips de entradas, saídas e bits e balões dos LEDs). Não alteram a lógica nem o ajuste.
      </div>
      {err && <div className="alert">{err}</div>}

      <Table title="Entradas digitais" rows={f(sets.inputs)} texts={texts} setText={setText} />
      <Table title="Saídas digitais" rows={f(sets.outputs)} texts={texts} setText={setText} />
      <Table title="Bits virtuais (VB)" rows={f(sets.vb)} texts={texts} setText={setText} />
      <Table title="Bits remotos (RB)" rows={f(sets.rb)} texts={texts} setText={setText} />
      {sets.is2440 && <Table title="Bits de controle (CB)" rows={f(sets.cb)} texts={texts} setText={setText} />}

      <section className="card">
        <h3>Adicionar bit</h3>
        <p className="hint">Inclui um VB, RB{sets.is2440 ? ' ou CB' : ''} que não aparece nos ajustes (ex.: <code>VB040</code>) para poder dar um texto e simulá-lo no Painel frontal.</p>
        <div className="row wrap">
          <input type="text" className="search" placeholder="VB040" value={extra} onChange={(e) => setExtra(e.target.value.toUpperCase())} />
          <button className="primary" disabled={!validExtra || (!sets.is2440 && extra.startsWith('CB'))}
            onClick={() => api.bit(sid, extra, 'watch').then(() => { setErr(null); setExtra('') }).catch((e) => setErr(String(e.message ?? e)))}>Adicionar</button>
        </div>
      </section>
    </div>
  )
}
