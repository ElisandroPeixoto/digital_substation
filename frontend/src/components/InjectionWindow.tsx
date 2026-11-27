import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmt, modelLabel, usePoll } from '../hooks'
import { normAngle, sequence } from '../phasor'
import type { Polar } from '../phasor'
import type { SessionInfo, SimConfig } from '../types'
import { PhasorDiagram } from './PhasorDiagram'
import { DiffSection } from './VariablesView'
import { NumField, NumInput } from './ui'

type Mode = 'primary' | 'secondary'
const MODE_KEY = 'sel751.inject.mode'
const PH = ['A', 'B', 'C'] as const
const COLORS: Record<string, string> = { A: '#FC8181', B: '#4FD1C5', C: '#63B3ED' }

export function injectionUrl(sid: string): string {
  return `${window.location.origin}${window.location.pathname}#/injecao/${sid}`
}

const kn_sec = (ctrn: number) => 1 / ctrn

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
  // SEL-787: enrolamentos cujo diagrama fasorial está oculto (preferência do usuário)
  const [hidden, setHidden] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem('sel787.inject.hidden') ?? '[]') as number[] } catch { return [] }
  })
  const toggleW = (n: number) => setHidden((h) => {
    const v = h.includes(n) ? h.filter((x) => x !== n) : [...h, n]
    try { localStorage.setItem('sel787.inject.hidden', JSON.stringify(v)) } catch { /* sem armazenamento */ }
    return v
  })
  // Sessão encerrada (ex.: backend reiniciado): para de consultar e avisa.
  const [gone, setGone] = useState(false)
  const { data, error } = usePoll(() => api.panel(sid), 250, !gone, sid)
  // SEL-787: medições diferenciais (IOP, IRT, harmônicas, INR, 87R/87HR/87BL/87U) e REF, as mesmas de Variáveis internas
  const { data: st } = usePoll(() => api.state(sid), 500, !gone && info?.model === '787', `${sid}-diff`)
  useEffect(() => {
    if (error && /Sessão não encontrada/.test(error)) setGone(true)
  }, [error])

  useEffect(() => {
    document.title = `Injeção de corrente e tensão – ${modelLabel(info?.model)}`
    api.getSession(sid).then(setInfo).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [sid, info?.model])

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
  const ptrs = info.ptrs ?? info.ptr
  const kvs = sec ? 1 / ptrs : 1
  const vsU = sec ? 'V sec.' : 'V prim.'
  const iu = sec ? 'A sec.' : 'A prim.'
  const vu = sec ? 'V sec.' : 'V prim.'
  const num = (k: string) => (sim as unknown as Record<string, number>)[k]
  const is787 = info.model === '787'
  const slLock = !!(data.systemlab?.linked && !sim.sl_isolated)       // injeção comandada pelo SystemLab
  const windings = info.windings ?? [1, 2]
  const patch = (p: Record<string, number | boolean | string | null>) =>
    api.sim(sid, p as Partial<SimConfig>).then(() => setErr(null)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))

  const iPolar: Polar[] = PH.map((ph) => ({ mag: num(`i${ph.toLowerCase()}_mag`) * ki, ang: num(`i${ph.toLowerCase()}_ang`) }))
  const vPolar: Polar[] = PH.map((ph) => ({ mag: num(`v${ph.toLowerCase()}_mag`) * kv, ang: num(`v${ph.toLowerCase()}_ang`) }))
  const iSeq = sequence(iPolar[0], iPolar[1], iPolar[2])
  const vSeq = sequence(vPolar[0], vPolar[1], vPolar[2])

  const balance = (kind: 'i' | 'v', pre = '') => {
    const mag = num(`${pre}${kind}a_mag`)
    const ang = num(`${pre}${kind}a_ang`)
    patch({
      [`${pre}${kind}b_mag`]: mag, [`${pre}${kind}b_ang`]: normAngle(ang - 120),
      [`${pre}${kind}c_mag`]: mag, [`${pre}${kind}c_ang`]: normAngle(ang + 120),
    })
  }

  // pre: prefixo da chave de simulação ('' = enrolamento 1 / tensões; 'w2' = enrolamento 2 ...); ctr: relação do TC do enrolamento
  const phaseTable = (kind: 'i' | 'v', pre = '', ctr = info.ctr) => {
    const k1 = kind === 'i' ? (sec ? 1 / ctr : 1) : kv
    const other = kind === 'i' ? ctr : info.ptr
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
            const magP = num(`${pre}${kind}${k}_mag`)
            return (
              <tr key={ph}>
                <td><b style={{ color: COLORS[ph] }}>{kind.toUpperCase()}{ph}</b></td>
                <td>
                  <NumInput label={`Módulo ${kind.toUpperCase()}${ph}`} value={magP * k1} min={0} step={kind === 'i' ? 1 : 10}
                    onCommit={(v) => patch({ [`${pre}${kind}${k}_mag`]: v / k1 })} />
                </td>
                <td>
                  <NumInput label={`Ângulo ${kind.toUpperCase()}${ph}`} value={num(`${pre}${kind}${k}_ang`)} step={5} digits={2}
                    onCommit={(v) => patch({ [`${pre}${kind}${k}_ang`]: normAngle(v) })} />
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
        {!is787 && <span className={`bk bk-${data.breaker.state}`}>DJ {data.breaker.closed ? 'FECHADO' : 'ABERTO'}</span>}
        <button onClick={() => window.close()}>Fechar janela</button>
      </header>
      {err && <div className="alert">{err}</div>}
      {slLock && (
        <div className="notice">Este relé está associado a um IED no <b>SystemLab</b>: as correntes e tensões vêm da simulação do SystemLab e não podem ser
          editadas aqui. Para injetar direto no DigitalRelay, ligue <b>"Isolar do SystemLab"</b> no Painel frontal (cartão Medição).</div>
      )}
      {!sim.analog_on && <div className="alert">A injeção analógica está DESLIGADA na tela inicial: o relé enxerga tensão e corrente zero.</div>}
      {!data.breaker.closed && <div className="notice">Com o disjuntor aberto o relé enxerga corrente zero; as tensões continuam aplicadas.</div>}

      <fieldset className="inj-lock" disabled={slLock}>
      <div className="inj-grid">
        <section className="card">
          <div className="row"><h3>{is787 ? `Correntes – enrolamento 1 (W1, TC ${info.ctr}:1)` : 'Correntes'}</h3><span className="spacer" /><button onClick={() => balance('i')}>Equilibrar a partir de A</button></div>
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

      {is787 && (
        <>
          <div className="inj-grid">
            {windings.filter((n) => n > 1).map((n) => (
              <section className="card" key={n}>
                <div className="row"><h3>Correntes – enrolamento {n} (W{n}, TC {info.ctrs?.[n - 1] ?? 1}:1)</h3><span className="spacer" /><button onClick={() => balance('i', `w${n}`)}>Equilibrar a partir de A</button></div>
                {phaseTable('i', `w${n}`, info.ctrs?.[n - 1] ?? 1)}
              </section>
            ))}
          </div>
          <div className="inj-grid">
            <section className="card">
              <h3>Neutro (IN1) e harmônicas da corrente diferencial</h3>
              <table className="tbl inj-tbl">
                <thead><tr><th /><th>Módulo ({iu})</th><th>Ângulo (°)</th><th>{sec ? 'Primário equivalente' : 'Secundário equivalente'}</th></tr></thead>
                <tbody>
                  <tr>
                    <td><b>IN1</b></td>
                    <td><NumInput label="Módulo IN1" value={num('in1_mag') * kn} min={0} step={1} onCommit={(v) => patch({ in1_mag: v / kn })} /></td>
                    <td><NumInput label="Ângulo IN1" value={num('in1_ang')} step={5} digits={2} onCommit={(v) => patch({ in1_ang: normAngle(v) })} /></td>
                    <td className="mono muted">{sec ? `${fmt(num('in1_mag'), 2)} A prim.` : `${fmt(num('in1_mag') * kn_sec(info.ctrn), 3)} A sec.`}</td>
                  </tr>
                </tbody>
              </table>
              <div className="row wrap inj-freq">
                {([['h2_pct', '2ª harmônica (IF2/IF1)'], ['h4_pct', '4ª harmônica (IF4/IF1)'], ['h5_pct', '5ª harmônica (IF5/IF1)']] as const).map(([k, label]) => (
                  <NumField key={k} label={label} value={num(k)} unit="%" step={1} min={0} onCommit={(v) => patch({ [k]: v })} />
                ))}
              </div>
              <span className="hint">REF: o neutro IN1 é comparado com a corrente residual (3I0) dos enrolamentos escolhidos em REF1POL. Harmônicas: percentual da corrente diferencial (restrição/bloqueio por 2ª, 4ª e 5ª).</span>
            </section>
          </div>
        </>
      )}

      <div className="inj-grid">
        <section className="card">
          <div className="row"><h3>Tensão de sincronismo (VS)</h3></div>
          <table className="tbl inj-tbl">
            <thead><tr><th /><th>Módulo ({vsU})</th><th>Ângulo (°)</th><th>{sec ? 'Primário equivalente' : 'Secundário equivalente'}</th></tr></thead>
            <tbody>
              <tr>
                <td><b>VS</b></td>
                <td><NumInput label="Módulo VS" value={sim.vs_mag * kvs} min={0} step={10} onCommit={(v) => patch({ vs_mag: v / kvs })} /></td>
                <td><NumInput label="Ângulo VS" value={sim.vs_ang} step={5} digits={2} onCommit={(v) => patch({ vs_ang: normAngle(v) })} /></td>
                <td className="mono muted">{sec ? `${fmt(sim.vs_mag, 2)} V prim.` : `${fmt(sim.vs_mag / ptrs, 3)} V sec.`}</td>
              </tr>
            </tbody>
          </table>
          <div className="row wrap inj-freq">
            <NumField label="Frequência de VS" value={sim.vs_freq} unit="Hz" step={0.05} min={0} onCommit={(v) => patch({ vs_freq: v })} />
            <span className="hint">Usada na verificação de sincronismo (25): a diferença entre a frequência de VP e a de VS gera o escorregamento.</span>
          </div>
        </section>
      </div>
      </fieldset>

      <div className="inj-grid">
        {!is787 && (
          <section className="card">
            <PhasorDiagram id="di" title={`Diagrama fasorial – correntes (${iu})`} unit={sec ? 'A' : 'A'}
              items={PH.map((ph, n) => ({ label: `I${ph}`, mag: iPolar[n].mag, ang: iPolar[n].ang, color: COLORS[ph] }))} />
          </section>
        )}
        <section className="card">
          <PhasorDiagram id="dv" title={`Diagrama fasorial – tensões (${vu})`} unit="V"
            items={PH.map((ph, n) => ({ label: `V${ph}`, mag: vPolar[n].mag, ang: vPolar[n].ang, color: COLORS[ph] }))} />
        </section>
      </div>

      {is787 && (
        <section className="card">
          <div className="row wrap">
            <h3>Diagramas fasoriais – correntes dos enrolamentos</h3>
            <span className="spacer" />
            {windings.filter((n) => n <= 3).map((n) => (
              <button key={n} className={hidden.includes(n) ? '' : 'primary'} aria-pressed={!hidden.includes(n)} onClick={() => toggleW(n)}
                title={hidden.includes(n) ? `Mostrar o fasorial de W${n}` : `Ocultar o fasorial de W${n}`}>
                {hidden.includes(n) ? 'Mostrar' : 'Ocultar'} W{n}
              </button>
            ))}
          </div>
          <div className="inj-grid">
            {windings.filter((n) => n <= 3 && !hidden.includes(n)).map((n) => {
              const pre = n === 1 ? '' : `w${n}`
              const k = sec ? 1 / (info.ctrs?.[n - 1] ?? info.ctr) : 1
              return (
                <PhasorDiagram key={n} id={`di${n}`} title={`W${n} – correntes (${iu})`} unit="A"
                  items={PH.map((ph) => ({ label: `I${ph}`, mag: num(`${pre}i${ph.toLowerCase()}_mag`) * k, ang: num(`${pre}i${ph.toLowerCase()}_ang`), color: COLORS[ph] }))} />
              )
            })}
            {windings.filter((n) => n <= 3).every((n) => hidden.includes(n)) && <p className="hint">Todos os fasoriais estão ocultos.</p>}
          </div>
        </section>
      )}

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

      {is787 && st && <DiffSection elements={st.protection.elements} />}

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
