import { useState } from 'react'
import { api } from '../api'
import type { PanelData, SessionInfo, SimConfig } from '../types'
import { injectionUrl } from './InjectionWindow'
import { MeasurementCard } from './MeasurementCard'
import { NumField, Pill, Toggle } from './ui'

const BK_LABEL: Record<string, string> = { closed: 'FECHADO', open: 'ABERTO', opening: 'ABRINDO…', closing: 'FECHANDO…' }

interface Props {
  sid: string
  info: SessionInfo
  data: PanelData | null
}

export function TestBench({ sid, info, data }: Props) {
  const [err, setErr] = useState<string | null>(null)
  if (!data) return <div className="bench muted">Aguardando o simulador…</div>
  const sim = data.sim
  const bkInput = data.inputs.find((i) => i.breaker)
  const run = (p: Promise<unknown>) => p.then(() => setErr(null)).catch((e) => setErr(String(e.message ?? e)))
  const patch = (p: Partial<SimConfig>) => run(api.sim(sid, p))

  const openInjection = () => {
    const url = injectionUrl(sid)
    const w = window.open(url, 'sel751-injecao', 'popup=yes,width=1120,height=940,resizable=yes,scrollbars=yes')
    if (!w) {
      setErr('O navegador bloqueou o pop-up. Permita pop-ups para este endereço ou abra a janela manualmente: ' + url)
    } else {
      w.focus()
    }
  }

  return (
    <div className="bench">
      {err && <div className="alert">{err}</div>}

      <section className="card">
        <h3>Disjuntor (campo)</h3>
        <div className="row">
          <span className={`bk bk-${data.breaker.state}`}>{BK_LABEL[data.breaker.state] ?? data.breaker.state}</span>
          <span className="muted">{data.breaker.operations} operações</span>
          <span className="spacer" />
          <button onClick={() => run(api.forceBreaker(sid, false))}>Abrir (campo)</button>
          <button onClick={() => run(api.forceBreaker(sid, true))}>Fechar (campo)</button>
        </div>
        <div className="grid2">
          <NumField label="Tempo de abertura" value={sim.open_ms} unit="ms" step={10} min={1} onCommit={(v) => patch({ open_ms: v })} />
          <NumField label="Tempo de fechamento" value={sim.close_ms} unit="ms" step={10} min={1} onCommit={(v) => patch({ close_ms: v })} />
        </div>
        <p className="hint">Abertura ≥ 100 / 120 / 140 ms aciona os alarmes de tempo de abertura (níveis 1–3).</p>
      </section>

      <MeasurementCard sid={sid} data={data} info={info} onOpenInjection={openInjection} />

      <section className="card">
        <h3>Entradas digitais</h3>
        <div className="row wrap bk-auto">
          <Toggle
            checked={sim.breaker_auto}
            onChange={(v) => patch({ breaker_auto: v })}
            label={`Simular o estado do disjuntor automaticamente${bkInput ? ` (${bkInput.name})` : ''}`}
            hint="Ligado: a entrada do 52A acompanha as bobinas de abertura/fechamento. Desligado: você define o estado da entrada."
          />
        </div>
        <div className="inputs">
          {data.inputs.map((i) => (
            <button
              key={i.name}
              className={`input-chip ${i.raw ? 'on' : ''} ${Boolean(i.value) !== i.raw ? 'pending' : ''} ${i.breaker && sim.breaker_auto ? 'auto' : ''}`}
              onClick={() => run(api.setInput(sid, i.name, !i.raw))}
              title={
                `${i.label || i.name}\nClique para alternar` +
                (i.breaker && sim.breaker_auto ? '\n(modo automático: move o disjuntor)' : '') +
                (Boolean(i.value) !== i.raw ? '\n(aguardando o filtro de debounce)' : '')
              }
            >
              <b>{i.name}{i.breaker ? ' · 52A' : ''}</b>
              <small>{i.label || '—'}</small>
              <Pill on={i.raw} onLabel="ON" offLabel="OFF" />
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Saídas digitais</h3>
        {data.outputs.length === 0 ? (
          <p className="hint">Nenhuma saída configurada neste ajuste.</p>
        ) : (
          <div className="inputs outputs">
            {data.outputs.map((o) => (
              <div key={o.name} className={`output-chip ${o.value ? 'on' : ''}`} title={`${o.name}${o.label ? ' – ' + o.label : ''}${o.role ? ` (bobina de ${o.role})` : ''}`}>
                <b>{o.name}{o.role ? <em className="role">{o.role}</em> : null}</b>
                <small>{o.label || '—'}</small>
                <Pill on={o.value} onLabel="ATUADA" offLabel="REPOUSO" />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Auxiliares do relé</h3>
        <div className="toggles">
          <Toggle checked={sim.halarm} onChange={(v) => patch({ halarm: v })} label="Falha de hardware (HALARM)" />
          <Toggle
            checked={sim.lop}
            onChange={(v) => patch({ lop: v })}
            label="Perda de potencial (LOP)"
            hint="Aciona o bit LOP: os elementos direcionais de tensão são desabilitados e, com EFWDLOP = Y, os elementos ajustados para frente (DIRn = F) passam a atuar sem direção."
          />
          <Toggle checked={sim.linka} onChange={(v) => patch({ linka: v })} label="Link Ethernet A" />
          <Toggle checked={sim.linkb} onChange={(v) => patch({ linkb: v })} label="Link Ethernet B" />
          <Toggle checked={sim.tsntpp} onChange={(v) => patch({ tsntpp: v })} label="SNTP principal" />
          <Toggle checked={sim.tsntpb} onChange={(v) => patch({ tsntpb: v })} label="SNTP backup" />
        </div>
        <div className="grid2">
          <NumField label="Tensão CC do relé" value={sim.vdc} unit="V" step={1} min={0} onCommit={(v) => patch({ vdc: v })} />
        </div>
      </section>
    </div>
  )
}
