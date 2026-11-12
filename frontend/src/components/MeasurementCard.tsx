import { api } from '../api'
import { fmt } from '../hooks'
import type { PanelData, SessionInfo } from '../types'

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
  return (
    <section className="card">
      <div className="row">
        <h3>Medição (valores injetados)</h3>
        <span className="spacer" />
        <button
          className={`analog-switch ${data.sim.analog_on ? 'on' : 'off'}`}
          onClick={() => api.sim(sid, { analog_on: !data.sim.analog_on })}
          title="Liga ou desliga a injeção de corrente e tensão enquanto a simulação roda"
          aria-pressed={data.sim.analog_on}
        >
          <span className="dot" /> Injeção analógica: {data.sim.analog_on ? 'LIGADA' : 'DESLIGADA'}
        </button>
        <button className="primary" onClick={onOpenInjection}>Abrir janela de injeção ↗</button>
      </div>
      {!data.sim.analog_on && <p className="hint warn">Injeção desligada: o relé enxerga corrente, tensão e potência zero.</p>}
      {fault && <p className="hint warn">Falta ativa ({fault}): as correntes mostradas já incluem a falta.</p>}
      <table className="tbl meas">
        <thead>
          <tr><th /><th>Primário</th><th>Secundário</th><th>Ângulo</th></tr>
        </thead>
        <tbody>
          <Row name="IA" prim={m.IA_MAG} sec={m.IA_MAG / ctr} ang={m.IA_ANG} unitP="A" unitS="A" />
          <Row name="IB" prim={m.IB_MAG} sec={m.IB_MAG / ctr} ang={m.IB_ANG} unitP="A" unitS="A" />
          <Row name="IC" prim={m.IC_MAG} sec={m.IC_MAG / ctr} ang={m.IC_ANG} unitP="A" unitS="A" />
          <Row name="IG" prim={m.IG_MAG} sec={m.IG_MAG / ctrn} unitP="A" unitS="A" />
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
