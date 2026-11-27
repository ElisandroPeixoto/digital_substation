import { useEffect, useState } from 'react'
import { api } from '../api'
import { labelOf, type Texts } from '../customTexts'
import type { PanelData, SessionInfo, SimConfig } from '../types'
import { injectionUrl } from './InjectionWindow'
import { BitsCards } from './BitsCards'
import { MeasurementCard } from './MeasurementCard'
import { NumField, Pill, Toggle } from './ui'

const BK_LABEL: Record<string, string> = { closed: 'FECHADO', open: 'ABERTO', opening: 'ABRINDO…', closing: 'FECHANDO…' }

/** Campo de texto que só grava ao sair ou com Enter (o polling não apaga a digitação). Vazio = valor automático. */
function VarField({ label, value, auto, hint, onCommit }: { label: string; value: string; auto: string; hint: string; onCommit: (v: string) => void }) {
  const [txt, setTxt] = useState(value)
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setTxt(value) }, [value, focus])
  const commit = () => { setFocus(false); if (txt.trim().toUpperCase() !== value) onCommit(txt.trim()) }
  return (
    <label className="numfield" title={hint}>
      <span>{label}</span>
      <input type="text" className="numinput mono bk-var" value={txt} placeholder={auto ? `automático: ${auto}` : 'automático'}
        onFocus={() => setFocus(true)} onChange={(e) => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  )
}

interface Props {
  sid: string
  info: SessionInfo
  data: PanelData | null
  texts: Texts
}

export function TestBench({ sid, info, data, texts }: Props) {
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

      {info.model !== '787' && info.model !== '2440' && <section className="card">
        <h3>Disjuntor (campo)</h3>
        <div className="row wrap bk-auto">
          <Toggle
            checked={sim.breaker_auto}
            onChange={(v) => patch({ breaker_auto: v })}
            label="Simular disjuntor"
            hint="Ligado: as variáveis de abertura/fechamento movem o disjuntor e a entrada de estado acompanha a posição (também no SystemLab). Desligado: não há disjuntor; a entrada de estado fica livre em Entradas digitais."
          />
        </div>
        {sim.breaker_auto ? (
          <>
            <div className="row">
              <span className={`bk bk-${data.breaker.state}`}>{BK_LABEL[data.breaker.state] ?? data.breaker.state}</span>
              <span className="muted">{data.breaker.operations} operações</span>
              <span className="spacer" />
              <button onClick={() => run(api.forceBreaker(sid, false))}>Abrir (campo)</button>
              <button onClick={() => run(api.forceBreaker(sid, true))}>Fechar (campo)</button>
            </div>
            <div className="grid2">
              <VarField label="Variáveis de abertura" value={sim.bk_trip ?? ''} auto={(data.breaker.auto_trip ?? []).join(', ')}
                hint="Bits do Relay Word que abrem o disjuntor (ex.: OUT101, TRIP), separados por vírgula. Vazio = deduzidas das saídas OUTxxx."
                onCommit={(v) => patch({ bk_trip: v })} />
              <VarField label="Variáveis de fechamento" value={sim.bk_close ?? ''} auto={(data.breaker.auto_close ?? []).join(', ')}
                hint="Bits do Relay Word que fecham o disjuntor (ex.: OUT103, CLOSE), separados por vírgula. Vazio = deduzidas das saídas OUTxxx."
                onCommit={(v) => patch({ bk_close: v })} />
              <VarField label="Estado do disjuntor (entrada)" value={sim.bk_status ?? ''} auto={data.breaker.auto_status ?? ''}
                hint="Entrada digital (INxxx) que recebe a posição do disjuntor (52A). Vazio = a da equação 52A."
                onCommit={(v) => patch({ bk_status: v })} />
            </div>
            <div className="grid2">
              <NumField label="Tempo de abertura" value={sim.open_ms} unit="ms" step={10} min={1} onCommit={(v) => patch({ open_ms: v })} />
              <NumField label="Tempo de fechamento" value={sim.close_ms} unit="ms" step={10} min={1} onCommit={(v) => patch({ close_ms: v })} />
            </div>
            <p className="hint">
              Em uso: abre por <b className="mono">{(data.breaker.trip_vars ?? []).join(', ') || '–'}</b>, fecha por{' '}
              <b className="mono">{(data.breaker.close_vars ?? []).join(', ') || '–'}</b>, estado em <b className="mono">{data.breaker.status_var || '–'}</b>.
              Campos vazios usam o que foi deduzido dos ajustes. Abertura ≥ 100 / 120 / 140 ms aciona os alarmes de tempo de abertura (níveis 1–3).
            </p>
          </>
        ) : (
          <p className="hint">Sem disjuntor simulado: as saídas não movem nada e a entrada de estado{bkInput ? ` (${bkInput.name})` : ''} é definida em Entradas digitais. No SystemLab, a posição do disjuntor deixa de ser sincronizada com este relé.</p>
        )}
      </section>}

      <MeasurementCard sid={sid} data={data} info={info} onOpenInjection={openInjection} />

      <section className="card">
        <h3>Entradas digitais</h3>
        {info.model === '787' && (                      /* no SEL-787 (sem o cartão Disjuntor (campo)) a opção continua aqui */
          <div className="row wrap bk-auto">
            <Toggle
              checked={sim.breaker_auto}
              onChange={(v) => patch({ breaker_auto: v })}
              label={`Simular o estado do disjuntor automaticamente${bkInput ? ` (${bkInput.name})` : ''}`}
              hint="Ligado: a entrada do 52A acompanha as bobinas de abertura/fechamento. Desligado: você define o estado da entrada."
            />
          </div>
        )}
        <div className="inputs">
          {data.inputs.map((i) => (
            <button
              key={i.name}
              className={`input-chip ${i.raw ? 'on' : ''} ${Boolean(i.value) !== i.raw ? 'pending' : ''} ${i.breaker && sim.breaker_auto ? 'auto' : ''}`}
              onClick={() => run(api.setInput(sid, i.name, !i.raw))}
              title={
                `${labelOf(texts, i.name, i.label) || i.name}\nClique para alternar` +
                (i.breaker && sim.breaker_auto ? '\n(modo automático: move o disjuntor)' : '') +
                (Boolean(i.value) !== i.raw ? '\n(aguardando o filtro de debounce)' : '')
              }
            >
              <b>{i.name}{i.breaker ? ' · 52A' : ''}</b>
              <small>{labelOf(texts, i.name, i.label) || '—'}</small>
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
              <div key={o.name} className={`output-chip ${o.value ? 'on' : ''}`} title={`${o.name}${labelOf(texts, o.name, o.label) ? ' – ' + labelOf(texts, o.name, o.label) : ''}${o.role ? ` (bobina de ${o.role})` : ''}`}>
                <b>{o.name}{o.role ? <em className="role">{o.role}</em> : null}</b>
                <small>{labelOf(texts, o.name, o.label) || '—'}</small>
                <Pill on={o.value} onLabel="ATUADA" offLabel="REPOUSO" />
              </div>
            ))}
          </div>
        )}
      </section>

      {data.bits && <BitsCards sid={sid} bits={data.bits} texts={texts} />}

      {!!data.panel.local_bits?.length && (
        <section className="card">
          <h3>Bits locais (LB) – menu CNTRL</h3>
          <p className="hint">Os mesmos comandos do menu CNTRL do frontal (textos NLB/CLB/SLB/PLB da classe T).</p>
          <table className="tbl">
            <tbody>
              {data.panel.local_bits.map((lb) => (
                <tr key={lb.n}>
                  <td className="mono">LB{lb.n}</td>
                  <td>{lb.name}</td>
                  <td><Pill on={lb.on} /></td>
                  <td className="row wrap">
                    {lb.clear && <button onClick={() => run(api.bit(sid, `LB${lb.n}`, 'clear'))}>{lb.clear}</button>}
                    {lb.set && <button onClick={() => run(api.bit(sid, `LB${lb.n}`, 'set'))}>{lb.set}</button>}
                    {lb.pulse && <button onClick={() => run(api.bit(sid, `LB${lb.n}`, 'pulse'))}>{lb.pulse}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

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
