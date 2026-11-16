import { useEffect, useMemo, useState } from 'react'
import { sequence, type Polar } from '../phasor'
import { PhasorDiagram } from '../components/PhasorDiagram'
import { powers, referenced, type PhasePower } from './calc'

const COLORS = ['#FC8181', '#4FD1C5', '#63B3ED']
const NAMES = ['Va', 'Vb', 'Vc', 'Ia', 'Ib', 'Ic']
const DEFAULT: [string, string][] = [
  ['127', '0'], ['127', '-120'], ['127', '120'],
  ['100', '-30'], ['100', '-150'], ['100', '90'],
]
const KEY = 'phaseengine.state'
type Seq = 'phase' | 'triple' // I2/I0 ou 3I2/3I0

interface Saved { vals: [string, string][]; ref: number | null; seq: Seq }

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (s && Array.isArray(s.vals) && s.vals.length === 6) return s
  } catch { /* ignora */ }
  return { vals: DEFAULT, ref: null, seq: 'phase' }
}

const num = (s: string) => {
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const fmt = (x: number, d = 2) =>
  Math.abs(x) < 5e-13 ? '0' : x.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d })

/** Formata com prefixo SI (k, M). */
function si(x: number, unit: string): string {
  const a = Math.abs(x)
  if (a >= 1e6) return `${fmt(x / 1e6, 3)} M${unit}`
  if (a >= 1e3) return `${fmt(x / 1e3, 3)} k${unit}`
  return `${fmt(x, 2)} ${unit}`
}
const pfText = (p: PhasePower) => `${fmt(p.pf, 3)}${p.kind === 'ind' ? ' (ind.)' : p.kind === 'cap' ? ' (cap.)' : ''}`

interface SeqProps { title: string; unit: string; pos: Polar; neg: Polar; zero: Polar; triple: boolean; sym: string }

function SeqTable({ title, unit, pos, neg, zero, triple, sym }: SeqProps) {
  const k = triple ? 3 : 1
  const row = (label: string, p: Polar, mult: number) => (
    <tr>
      <td>{label}</td>
      <td className="num">{fmt(p.mag * mult, 3)} {unit}</td>
      <td className="num">{fmt(p.ang, 2)}°</td>
    </tr>
  )
  return (
    <div className="card">
      <h3>{title}</h3>
      <table className="tbl meas">
        <thead><tr><th>Componente</th><th>Módulo</th><th>Ângulo</th></tr></thead>
        <tbody>
          {row(`${sym}1`, pos, 1)}
          {row(`${triple ? '3' : ''}${sym}2`, neg, k)}
          {row(`${triple ? '3' : ''}${sym}0`, zero, k)}
        </tbody>
      </table>
    </div>
  )
}

export function PhaseEngineApp() {
  const [st, setSt] = useState<Saved>(load)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* ignora */ }
  }, [st])

  const abs: Polar[] = useMemo(() => st.vals.map(([m, a]) => ({ mag: Math.abs(num(m)), ang: num(a) })), [st.vals])
  const rel = useMemo(() => referenced(abs, st.ref), [abs, st.ref])
  const v = rel.slice(0, 3)
  const i = rel.slice(3)
  const pw = useMemo(() => powers(abs.slice(0, 3), abs.slice(3)), [abs])
  const vs = useMemo(() => sequence(v[0], v[1], v[2]), [v])
  const is = useMemo(() => sequence(i[0], i[1], i[2]), [i])
  const triple = st.seq === 'triple'

  const setVal = (idx: number, col: 0 | 1, text: string) =>
    setSt((s) => ({
      ...s,
      vals: s.vals.map((r, k) => (k !== idx ? r : col === 0 ? [text, r[1]] : [r[0], text])) as [string, string][],
    }))

  const items = (arr: Polar[], pre: string) =>
    arr.map((p, k) => ({ label: `${pre}${'abc'[k]}`, mag: p.mag, ang: p.ang, color: COLORS[k] }))

  return (
    <main className="pe">
      <div className="pe-head">
        <h2>PhaseEngine</h2>
        <small className="muted">Diagrama fasorial, potências e componentes simétricas · tensões fase-neutro (V) e correntes (A)</small>
      </div>

      <div className="pe-grid">
        <div className="card">
          <h3>Valores de entrada</h3>
          <table className="tbl pe-in">
            <thead><tr><th>Fasor</th><th>Módulo</th><th>Ângulo (°)</th><th>Referenciado</th></tr></thead>
            <tbody>
              {NAMES.map((n, k) => (
                <tr key={n}>
                  <td style={{ color: COLORS[k % 3], fontWeight: 700 }}>{n}{st.ref === k ? ' (ref.)' : ''}</td>
                  <td>
                    <input type="text" inputMode="decimal" className="numinput" value={st.vals[k][0]} onChange={(e) => setVal(k, 0, e.target.value)} aria-label={`Módulo de ${n}`} /> <em>{k < 3 ? 'V' : 'A'}</em>
                  </td>
                  <td>
                    <input type="text" inputMode="decimal" className="numinput" value={st.vals[k][1]} onChange={(e) => setVal(k, 1, e.target.value)} aria-label={`Ângulo de ${n}`} />
                  </td>
                  <td className="mono num">{fmt(rel[k].ang, 2)}°</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Fasor de referência</h4>
          <div className="seg pe-seg">
            <button className={st.ref == null ? 'active' : ''} onClick={() => setSt((s) => ({ ...s, ref: null }))}>Nenhum</button>
            {NAMES.map((n, k) => (
              <button key={n} className={st.ref === k ? 'active' : ''} onClick={() => setSt((s) => ({ ...s, ref: k }))}>{n}</button>
            ))}
          </div>
          <p className="hint">O fasor escolhido fica em 0° e os demais são mostrados a partir dele. As potências não dependem da referência.</p>

          <h4>Componentes de sequência</h4>
          <div className="seg pe-seg">
            <button className={!triple ? 'active' : ''} onClick={() => setSt((s) => ({ ...s, seq: 'phase' }))}>I2, I0</button>
            <button className={triple ? 'active' : ''} onClick={() => setSt((s) => ({ ...s, seq: 'triple' }))}>3I2, 3I0</button>
          </div>
          <p className="hint">Vale também para as tensões (V2, V0 ou 3V2, 3V0). A sequência positiva é sempre I1/V1.</p>
          <button className="link" onClick={() => setSt((s) => ({ ...s, vals: DEFAULT, ref: null }))}>Restaurar valores de exemplo</button>
        </div>

        <div className="pe-diagrams">
          <PhasorDiagram id="pv" title="Tensões" unit="V" items={items(v, 'V')} />
          <PhasorDiagram id="pi" title="Correntes" unit="A" items={items(i, 'I')} />
        </div>
      </div>

      <div className="card">
        <h3>Potências</h3>
        <table className="tbl meas">
          <thead>
            <tr><th></th><th>Ativa (P)</th><th>Reativa (Q)</th><th>Aparente (S)</th><th>Fator de potência</th></tr>
          </thead>
          <tbody>
            {pw.phases.map((p, k) => (
              <tr key={k}>
                <td style={{ color: COLORS[k], fontWeight: 700 }}>Fase {'ABC'[k]}</td>
                <td className="num">{si(p.p, 'W')}</td>
                <td className="num">{si(p.q, 'var')}</td>
                <td className="num">{si(p.s, 'VA')}</td>
                <td className="num">{pfText(p)}</td>
              </tr>
            ))}
            <tr>
              <td><b>Trifásica</b></td>
              <td className="num"><b>{si(pw.total.p, 'W')}</b></td>
              <td className="num"><b>{si(pw.total.q, 'var')}</b></td>
              <td className="num"><b>{si(pw.total.s, 'VA')}</b></td>
              <td className="num"><b>{pfText(pw.total)}</b></td>
            </tr>
          </tbody>
        </table>
        <p className="hint">S = V·I* por fase; total = soma complexa (S3φ = √(P²+Q²)). Q positivo = corrente atrasada da tensão (indutivo); FP = |P|/S.</p>
      </div>

      <div className="pe-seqs">
        <SeqTable title="Sequência – tensões" unit="V" pos={vs.pos} neg={vs.neg} zero={vs.zero} triple={triple} sym="V" />
        <SeqTable title="Sequência – correntes" unit="A" pos={is.pos} neg={is.neg} zero={is.zero} triple={triple} sym="I" />
      </div>
    </main>
  )
}
