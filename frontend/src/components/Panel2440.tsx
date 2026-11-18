import { useState } from 'react'
import { api } from '../api'
import { labelOf, type Texts } from '../customTexts'
import type { PanelData } from '../types'
import { BitsCards } from './BitsCards'
import { Pill, Toggle } from './ui'
import { Relay2440Front } from './Relay2440Front'

interface Props {
  sid: string
  data: PanelData | null
  texts: Texts
}

export function Panel2440({ sid, data, texts }: Props) {
  const [err, setErr] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const run = (p: Promise<unknown>) => p.then(() => setErr(null)).catch((e) => setErr(String(e.message ?? e)))
  const io = data?.io
  if (!data || !io || !data.bits) return <div className="muted">Aguardando o simulador…</div>

  const toggleInput = (name: string) => {
    const p = io.slots.flatMap((s) => s.points).find((x) => x.in === name)
    if (p) run(api.setInput(sid, name, !p.in_raw))
  }

  const ins = io.slots.flatMap((s) => s.points.filter((p) => showAll || p.in_used).map((p) => ({ ...p, slot: s.slot })))
  const outs = io.slots.flatMap((s) => s.points.filter((p) => p.out_used).map((p) => ({ ...p, slot: s.slot })))

  return (
    <div className="p2440">
      <Relay2440Front io={io} texts={texts} onToggleInput={toggleInput} />
      {err && <div className="alert">{err}</div>}

      <div className="p2440-grid">
        <section className="card">
          <div className="row">
            <h3>Entradas digitais</h3>
            <span className="spacer" />
            <Toggle checked={showAll} onChange={setShowAll} label="mostrar não usadas" />
          </div>
          {ins.length === 0 ? <p className="hint">Nenhuma entrada usada nos ajustes.</p> : (
            <div className="inputs">
              {ins.map((p) => {
                const label = labelOf(texts, p.in, p.in_label)
                return (
                  <button key={p.in} className={`input-chip ${p.in_raw ? 'on' : ''} ${p.in_raw !== p.in_on ? 'pending' : ''}`} onClick={() => toggleInput(p.in)}
                    title={`${p.in}${label ? '\n' + label : ''}\nClique para alternar${p.in_raw !== p.in_on ? '\n(aguardando o filtro de debounce)' : ''}`}>
                    <b>{p.in}</b>
                    <small>{label || '—'}</small>
                    <Pill on={p.in_raw} onLabel="ON" offLabel="OFF" />
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="card">
          <h3>Saídas digitais</h3>
          {outs.length === 0 ? <p className="hint">Nenhuma saída configurada.</p> : (
            <div className="inputs outputs">
              {outs.map((p) => {
                const label = labelOf(texts, p.out, p.out_label)
                return (
                  <div key={p.out} className={`output-chip ${p.out_on ? 'on' : ''}`} title={`${p.out}${label ? ' – ' + label : ''}`}>
                    <b>{p.out}</b>
                    <small>{label || '—'}</small>
                    <Pill on={p.out_on} onLabel="ATUADA" offLabel="REPOUSO" />
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <BitsCards sid={sid} bits={data.bits} texts={texts} showCb />

        <section className="card">
          <h3>Comandos</h3>
          <button onClick={() => run(api.button(sid, 'TARGET_RESET', true))} title="Pulsa TRGTR (equivale ao comando TAR R)">Target reset (TRGTR)</button>
        </section>
      </div>
    </div>
  )
}
