import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmt, usePoll } from '../hooks'
import { normAngle, sequence } from '../phasor'
import type { Polar } from '../phasor'
import type { SessionInfo, SimConfig } from '../types'
import { PhasorDiagram } from './PhasorDiagram'
import { NumField, NumInput } from './ui'

type Mode = 'primary' | 'secondary'
const MODE_KEY = 'sel751.inject.mode'
const PH = ['A', 'B', 'C'] as const
const COLORS: Record<string, string> = { A: '#d64545', B: '#1f9d55', C: '#2f6df6' }

export function injectionUrl(sid: string): string {
  return `${window.location.origin}${window.location.pathname}#/injecao/${sid}`
}

function SeqRow({ label, i, v, iu, vu }: { label: string; i: Polar; v: Polar; iu: string; vu: string }) {
  return (
    <tr>
      <td><b>{label}</b></td>
      <td className="mono">{fmt(i.mag, 3)} {iu}</td>
      <td className="mono">{fmt(i.ang, 2)}°</td>
      <td className="mono">{fmt(v.mag, 3)} {vu}</td>
      <td className="mono">{fmt(v.ang, 2)}°</td>
    </tr>
  )
}

export function InjectionWindow({ sid }: { sid: string }) {
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'secondary' ? 'secondary' : 'primary'
    } catch {
      return 'primary'
    }
  })
  // Sessão encerrada (ex.: backend reiniciado): para de consultar e avisa.
  const [gone, setGone] = useState(false)
  const { data, error } = usePoll(() => api.panel(sid), 250, !gone, sid)
  useEffect(() => {
    if (error && /Sessão não encontrada/.test(error)) setGone(true)
  }, [error])

  useEffect(() => {
    document.title = 'Injeção de corrente e tensão – SEL-751'
    api.getSession(sid).then(setInfo).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [sid])

  const setMode = (m: Mode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      /* sem armazenamento */
    }
  }

  if (gone) {
    return (
      <div className="inject-win">
        <div className="alert">
          A sessão do simulador foi encerrada (o backend foi reiniciado?). Feche esta janela e abra a injeção novamente a partir do simulador.
          <div><button onClick={() => window.close()}>Fechar janela</button></div>
        </div>
      </div>
    )
  }
  if (!info || !data) {
    return <div className="inject-win"><div className="empty">{err ?? error ?? 'Conectando ao simulador…'}</div></div>
  }

  const sim = data.sim
  const sec = mode === 'secondary'
  const ki = sec ? 1 / info.ctr : 1
  const kv = sec ? 1 / info.ptr : 1
  const kn = sec ? 1 / info.ctrn : 1
  const iu = sec ? 'A sec.' : 'A prim.'
  const vu = sec ? 'V sec.' : 'V prim.'
  const num = (k: string) => sim[k as keyof SimConfig] as number
  const patch = (p: Record<string, number | boolean | string | null>) =>
    api.sim(sid, p as Partial<SimConfig>).then(() => setErr(null)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))

  const iPolar: Polar[] = PH.map((ph) => ({ mag: num(`i${ph.toLowerCase()}_mag`) * ki, ang: num(`i${ph.toLowerCase()}_ang`) }))
  const vPolar: Polar[] = PH.map((ph) => ({ mag: num(`v${ph.toLowerCase()}_mag`) * kv, ang: num(`v${ph.toLowerCase()}_ang`) }))
  const iSeq = sequence(iPolar[0], iPolar[1], iPolar[2])
  const vSeq = sequence(vPolar[0], vPolar[1], vPolar[2])

  const balance = (kind: 'i' | 'v') => {
    const mag = num(`${kind}a_mag`)
    const ang = num(`${kind}a_ang`)
    patch({
      [`${kind}b_mag`]: mag, [`${kind}b_ang`]: normAngle(ang - 120),
      [`${kind}c_mag`]: mag, [`${kind}c_ang`]: normAngle(ang + 120),
    })
  }

  const phaseTable = (kind: 'i' | 'v') => {
    const k1 = kind === 'i' ? ki : kv
    const other = kind === 'i' ? info.ctr : info.ptr
    return (
      <table className="tbl inj-tbl">
        <thead>
          <tr>
            <th />
            <th>Módulo ({kind === 'i' ? iu : vu})</th>
            <th>Ângulo (°)</th>
            <th>{sec ? 'Primário equivalente' : 'Secundário equivalente'}</th>
          </tr>
        </thead>
        <tbody>
          {PH.map((ph) => {
            const k = ph.toLowerCase()
            const magP = num(`${kind}${k}_mag`)
            return (
              <tr key={ph}>
                <td><b style={{ color: COLORS[ph] }}>{kind.toUpperCase()}{ph}</b></td>
                <td>
                  <NumInput label={`Módulo ${kind.toUpperCase()}${ph}`} value={magP * k1} min={0} step={kind === 'i' ? 1 : 10}
                    onCommit={(v) => patch({ [`${kind}${k}_mag`]: v / k1 })} />
                </td>
                <td>
                  <NumInput label={`Ângulo ${kind.toUpperCase()}${ph}`} value={num(`${kind}${k}_ang`)} step={5} digits={2}
                    onCommit={(v) => patch({ [`${kind}${k}_ang`]: normAngle(v) })} />
                </td>
                <td className="mono muted">
                  {sec ? `${fmt(magP, 2)} ${kind === 'i' ? 'A' : 'V'} prim.` : `${fmt(magP / other, 3)} ${kind === 'i' ? 'A' : 'V'} sec.`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  const m = data.meter
  return (
    <div className="inject-win">
      <header className="inject-head">
        <div>
          <h1>Injeção de corrente e tensão</h1>
          <small>{info.device} · TC {info.ctr}:1 · TP {info.ptr}:1</small>
        </div>
        <div className="seg" role="group" aria-label="Modo de entrada">
          <button className={!sec ? 'active' : ''} onClick={() => setMode('primary')}>Primário</button>
          <button className={sec ? 'active' : ''} onClick={() => setMode('secondary')}>Secundário</button>
        </div>
        <span className={`bk bk-${data.breaker.state}`}>DJ {data.breaker.closed ? 'FECHADO' : 'ABERTO'}</span>
        <button onClick={() => window.close()}>Fechar janela</button>
      </header>
      {err && <div className="alert">{err}</div>}
      {!sim.analog_on && <div className="alert">A injeção analógica está DESLIGADA na tela inicial: o relé enxerga tensão e corrente zero.</div>}
      {!data.breaker.closed && <div className="notice">Com o disjuntor aberto o relé enxerga corrente zero; as tensões continuam aplicadas.</div>}

      <div className="inj-grid">
        <section className="card">
          <div className="row"><h3>Correntes</h3><span className="spacer" /><button onClick={() => balance('i')}>Equilibrar a partir de A</button></div>
          {phaseTable('i')}
        </section>
        <section className="card">
          <div className="row"><h3>Tensões (fase-neutro)</h3><span className="spacer" /><button onClick={() => balance('v')}>Equilibrar a partir de A</button></div>
          {phaseTable('v')}
          <div className="row wrap inj-freq">
            <NumField label="Frequência" value={sim.freq} unit="Hz" step={0.1} min={0} onCommit={(v) => patch({ freq: v })} />
            <span className="hint">Tensão de linha nominal: {fmt((info.vnom * info.ptr) / 1000, 2)} kV prim. / {fmt(info.vnom, 1)} V sec.</span>
          </div>
        </section>
      </div>

      <div className="inj-grid">
        <section className="card">
          <PhasorDiagram id="di" title={`Diagrama fasorial – correntes (${iu})`} unit={sec ? 'A' : 'A'}
            items={PH.map((ph, n) => ({ label: `I${ph}`, mag: iPolar[n].mag, ang: iPolar[n].ang, color: COLORS[ph] }))} />
        </section>
        <section className="card">
          <PhasorDiagram id="dv" title={`Diagrama fasorial – tensões (${vu})`} unit="V"
            items={PH.map((ph, n) => ({ label: `V${ph}`, mag: vPolar[n].mag, ang: vPolar[n].ang, color: COLORS[ph] }))} />
        </section>
      </div>

      <section className="card">
        <h3>Componentes de sequência (dos valores inseridos)</h3>
        <table className="tbl">
          <thead>
            <tr><th>Componente</th><th>Corrente – módulo</th><th>ângulo</th><th>Tensão – módulo</th><th>ângulo</th></tr>
          </thead>
          <tbody>
            <SeqRow label="Sequência zero (0)" i={iSeq.zero} v={vSeq.zero} iu={iu} vu={vu} />
            <SeqRow label="Sequência positiva (1)" i={iSeq.pos} v={vSeq.pos} iu={iu} vu={vu} />
            <SeqRow label="Sequência negativa (2)" i={iSeq.neg} v={vSeq.neg} iu={iu} vu={vu} />
          </tbody>
        </table>
        <p className="hint">
          I0 = (IA + IB + IC)/3 · I1 = (IA + a·IB + a²·IC)/3 · I2 = (IA + a²·IB + a·IC)/3, com a = 1∠120°. As grandezas 3I0 e 3I2 usadas pelo relé
          valem três vezes os módulos acima.
        </p>
      </section>

      <div className="inj-grid">
        <section className="card">
          <h3>Valores vistos pelo relé</h3>
          <table className="tbl">
            <thead><tr><th /><th>Módulo</th><th>Ângulo</th></tr></thead>
            <tbody>
              {(['IA', 'IB', 'IC'] as const).map((n) => (
                <tr key={n}><td><b>{n}</b></td><td className="mono">{fmt(m[`${n}_MAG`] * ki, 3)} {iu}</td><td className="mono">{fmt(m[`${n}_ANG`], 2)}°</td></tr>
              ))}
              <tr><td><b>IG (residual)</b></td><td className="mono">{fmt(m.IG_MAG * kn, 3)} {iu}</td><td className="mono">–</td></tr>
              {(['VA', 'VB', 'VC'] as const).map((n) => (
                <tr key={n}><td><b>{n}</b></td><td className="mono">{fmt(m[`${n}_MAG`] * kv, 3)} {vu}</td><td className="mono">{fmt(m[`${n}_ANG`], 2)}°</td></tr>
              ))}
              <tr><td><b>Frequência</b></td><td className="mono">{fmt(m.FREQ, 2)} Hz</td><td /></tr>
            </tbody>
          </table>
          <p className="hint">Inclui a posição do disjuntor e o estado da injeção analógica (chave na tela inicial).</p>
        </section>
      </div>
    </div>
  )
}
