import { api } from '../api'
import { fmt } from '../hooks'
import type { PanelData, SessionInfo } from '../types'
import { Toggle } from './ui'

function Row({ name, prim, sec, ang, unitP, unitS }: { name: string; prim: number; sec?: number; ang?: number; unitP: string; unitS?: string }) {
  return (
    <tr>
      <td><b>{name}</b></td>
      <td className="mono num">{fmt(prim, prim >= 1000 ? 1 : 2)} <span className="muted">{unitP}</span></td>
      <td className="mono num">{sec === undefined ? '–' : <>{fmt(sec, 3)} <span className="muted">{unitS}</span></>}</td>
      <td className="mono num">{ang === undefined ? '–' : `${fmt(ang, 1)}°`}</td>
    </tr>
  )
}

/** Valores injetados (efetivos no relé): correntes, tensões, frequência e potências. */
export function MeasurementCard({ sid, data, info, onOpenInjection }: { sid: string; data: PanelData; info: SessionInfo; onOpenInjection: () => void }) {
  const m = data.meter
  const { ctr, ctrn, ptr } = info
  const fault = data.sim.fault_type
  const sl = data.systemlab
  const slLock = !!(sl?.linked && !data.sim.sl_isolated)
  return (
    <section className="card">
      <div className="row">
        <h3>Medição (valores injetados)</h3>
        <span className="spacer" />
        <button
          disabled={slLock}
          className={`analog-switch ${data.sim.analog_on ? 'on' : 'off'}`}
          onClick={() => api.sim(sid, { analog_on: !data.sim.analog_on })}
          title="Liga ou desliga a injeção de corrente e tensão enquanto a simulação roda"
          aria-pressed={data.sim.analog_on}
        >
          <span className="dot" /> Injeção analógica: {data.sim.analog_on ? 'LIGADA' : 'DESLIGADA'}
        </button>
        <button className="primary" onClick={onOpenInjection}>Abrir janela de injeção ↗</button>
      </div>
      {(sl?.linked || data.sim.sl_isolated) && (
        <div className="row wrap">
          <Toggle
            checked={!!data.sim.sl_isolated}
            onChange={(v) => api.sim(sid, { sl_isolated: v })}
            label="Isolar do SystemLab (injetar direto no DigitalRelay)"
            hint="Desligado: as correntes e tensões vêm do SystemLab (IED associado). Ligado: o relé usa a injeção manual da janela de injeção."
          />
          <span className={`hint ${slLock ? '' : 'warn'}`}>{slLock ? 'Injeção comandada pelo SystemLab.' : sl?.linked ? 'Isolado: o SystemLab não altera a injeção deste relé.' : 'Isolado (SystemLab sem atualização recente).'}</span>
        </div>
      )}
      <div className="row wrap">
        <Toggle
          checked={data.sim.analog_off_on_output}
          onChange={(v) => api.sim(sid, { analog_off_on_output: v })}
          label="Desligar a injeção analógica quando uma saída digital atuar"
          hint="Quando uma das saídas escolhidas passar de desligada para ligada, a injeção é desligada. Religue-a pela chave acima."
        />
      </div>
      {data.sim.analog_off_on_output && (
        <div className="row wrap off-outputs">
          <span className="muted">Saídas que desligam a injeção{data.sim.analog_off_outputs.length === 0 ? ' (nenhuma marcada = qualquer saída)' : ''}:</span>
          {data.outputs.map((o) => {
            const sel = data.sim.analog_off_outputs.includes(o.name)
            return (
              <label key={o.name} className="chk" title={o.label}>
                <input
                  type="checkbox"
                  checked={sel}
                  onChange={() => api.sim(sid, {
                    analog_off_outputs: sel ? data.sim.analog_off_outputs.filter((n) => n !== o.name) : [...data.sim.analog_off_outputs, o.name],
                  })}
                /> {o.name}
              </label>
            )
          })}
        </div>
      )}
      {!data.sim.analog_on && <p className="hint warn">Injeção desligada: os valores abaixo são os ajustados na janela de injeção, mas o relé enxerga corrente, tensão e potência zero.</p>}
      {fault && <p className="hint warn">Falta ativa ({fault}): as correntes mostradas já incluem a falta.</p>}
      <table className="tbl meas">
        <thead>
          <tr><th /><th>Primário</th><th>Secundário</th><th>Ângulo</th></tr>
        </thead>
        <tbody>
          <Row name={info.model === '787' ? 'IA (W1)' : 'IA'} prim={m.IA_MAG} sec={m.IA_MAG / ctr} ang={m.IA_ANG} unitP="A" unitS="A" />
          <Row name={info.model === '787' ? 'IB (W1)' : 'IB'} prim={m.IB_MAG} sec={m.IB_MAG / ctr} ang={m.IB_ANG} unitP="A" unitS="A" />
          <Row name={info.model === '787' ? 'IC (W1)' : 'IC'} prim={m.IC_MAG} sec={m.IC_MAG / ctr} ang={m.IC_ANG} unitP="A" unitS="A" />
          <Row name="IG" prim={m.IG_MAG} sec={m.IG_MAG / ctrn} unitP="A" unitS="A" />
          {info.model === '787' && (info.windings ?? [1, 2]).filter((n) => n > 1).flatMap((n) => (['A', 'B', 'C'] as const).map((p) => {
            const k = `I${p}W${n}`
            return <Row key={k} name={`${k.slice(0, 2)} (W${n})`} prim={m[`${k}_MAG`]} sec={m[`${k}_MAG`] / (info.ctrs?.[n - 1] ?? 1)} ang={m[`${k}_ANG`]} unitP="A" unitS="A" />
          }))}
          {info.model === '787' && <Row name="IN1" prim={m.IN1_MAG} sec={m.IN1_MAG / ctrn} ang={m.IN1_ANG} unitP="A" unitS="A" />}
          <Row name="VA" prim={m.VA_MAG} sec={m.VA_MAG / ptr} ang={m.VA_ANG} unitP="V" unitS="V" />
          <Row name="VB" prim={m.VB_MAG} sec={m.VB_MAG / ptr} ang={m.VB_ANG} unitP="V" unitS="V" />
          <Row name="VC" prim={m.VC_MAG} sec={m.VC_MAG / ptr} ang={m.VC_ANG} unitP="V" unitS="V" />
          <Row name="VAB" prim={m.VAB_MAG} sec={m.VAB_MAG / ptr} ang={m.VAB_ANG} unitP="V" unitS="V" />
          <Row name="VBC" prim={m.VBC_MAG} sec={m.VBC_MAG / ptr} ang={m.VBC_ANG} unitP="V" unitS="V" />
          <Row name="VCA" prim={m.VCA_MAG} sec={m.VCA_MAG / ptr} ang={m.VCA_ANG} unitP="V" unitS="V" />
        </tbody>
      </table>
      <div className="meas-power">
        <div><span>Frequência</span><b>{fmt(m.FREQ, 2)} Hz</b></div>
        <div><span>Potência ativa (P)</span><b>{fmt(m.P, 1)} kW</b></div>
        <div><span>Potência reativa (Q)</span><b>{fmt(m.Q, 1)} kVAr</b></div>
        <div><span>Potência aparente (S)</span><b>{fmt(m.S, 1)} kVA</b></div>
        <div><span>Fator de potência</span><b>{fmt(m.PF, 3)}</b></div>
      </div>
    </section>
  )
}
