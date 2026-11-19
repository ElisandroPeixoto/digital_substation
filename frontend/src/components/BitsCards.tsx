import { useState } from 'react'
import { api } from '../api'
import { usePoll } from '../hooks'
import { labelOf, type Texts } from '../customTexts'
import type { IoBit, IoBits } from '../types'
import { Pill } from './ui'

type Mode = 'set' | 'clear' | 'toggle' | 'pulse'

/** Chip de bit (VB/CB). Fica FORA dos painéis: definido dentro, o React o recriaria a cada atualização (10 Hz)
 *  e o clique que cai entre duas atualizações se perderia. */
function BitChip({ b, texts, onToggle, locked }: { b: IoBit; texts: Texts; onToggle: () => void; locked?: boolean }) {
  const label = labelOf(texts, b.name, b.label)
  return (
    <button className={`input-chip ${b.on ? 'on' : ''}`} onClick={onToggle} disabled={locked}
      title={`${b.name}${label ? ' – ' + label : ''}${texts[b.name] && b.label ? `\n(ajuste: ${b.label})` : ''}\nClique para alternar${b.held == null ? ' (estado vindo da lógica/pulso)' : ''}`}>
      <b>{b.name}</b>
      <small>{label || '—'}</small>
      <Pill on={b.on} onLabel="1" offLabel="0" />
    </button>
  )
}

interface Props {
  sid: string
  bits: IoBits
  texts: Texts
  /** Mostra também os CB (SEL-2440). */
  showCb?: boolean
}

/** Cartões de bits virtuais (VB) e remotos/controle (RB/CB): simulação para o SEL-751 e o SEL-2440. */
export function BitsCards({ sid, bits, texts, showCb = false }: Props) {
  const [err, setErr] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const run = (p: Promise<unknown>) => p.then(() => setErr(null)).catch((e) => setErr(String(e.message ?? e)))
  const bit = (name: string, mode: Mode) => run(api.bit(sid, name, mode))
  const ied = usePoll(() => api.sessions(), 2500, true, sid).data?.find((x) => x.id === sid)?.ied ?? null
  const locked = !!ied            // relé associado a um IED do app IEC61850: os VBs pertencem ao GOOSE
  const validName = /^(VB\d{3}|CB\d{3}|RB\d{2})$/.test(custom) && !(locked && custom.startsWith('VB'))

  return (
    <>
      {err && <div className="alert">{err}</div>}
      <section className="card">
        <h3>Bits virtuais (VB)</h3>
        {locked
          ? <div className="alert">Não é possível forçar os bits virtuais: este relé está associado ao IED <b>{ied}</b> e seus VBs são usados no app IEC61850 do simulador (recebem os valores do GOOSE). Para forçá-los, desassocie o relé na aba "IEC 61850".</div>
          : <p className="hint">Simulam os bits recebidos por GOOSE/outros dispositivos. Clique para ligar/desligar (ficam mantidos).</p>}
        {bits.vb.length === 0
          ? <p className="hint">Nenhum VB usado nos ajustes. Use o campo abaixo para acionar qualquer VB.</p>
          : <div className="inputs">{bits.vb.map((b) => <BitChip key={b.name} b={b} texts={texts} locked={locked} onToggle={() => bit(b.name, 'toggle')} />)}</div>}
      </section>

      <section className="card">
        <h3>Bits remotos (RB){showCb ? ' e de controle (CB)' : ''}</h3>
        {bits.rb.length > 0 && (
          <table className="tbl">
            <tbody>
              {bits.rb.map((b) => {
                const label = labelOf(texts, b.name, b.label)
                return (
                  <tr key={b.name}>
                    <td className="mono">{b.name}</td>
                    <td className="muted">{label}</td>
                    <td><Pill on={b.on} /></td>
                    <td className="actions">
                      <button onClick={() => bit(b.name, 'pulse')} title="Pulso de um ciclo">Pulso</button>
                      <button onClick={() => bit(b.name, 'set')}>Set</button>
                      <button onClick={() => bit(b.name, 'clear')}>Clear</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {showCb && bits.cb.length > 0 && <div className="inputs">{bits.cb.map((b) => <BitChip key={b.name} b={b} texts={texts} onToggle={() => bit(b.name, 'toggle')} />)}</div>}
        {bits.rb.length === 0 && (!showCb || bits.cb.length === 0) && <p className="hint">Nenhum RB{showCb ? '/CB' : ''} usado nos ajustes.</p>}
        <div className="row wrap p2440-free">
          <input type="text" className="search" placeholder="Outro bit (ex.: VB040, RB05)" value={custom} onChange={(e) => setCustom(e.target.value.toUpperCase())} />
          {(['set', 'clear', 'pulse'] as const).map((m) => (
            <button key={m} disabled={!validName} onClick={() => bit(custom, m)}>{m === 'set' ? 'Set' : m === 'clear' ? 'Clear' : 'Pulso'}</button>
          ))}
        </div>
      </section>
    </>
  )
}
