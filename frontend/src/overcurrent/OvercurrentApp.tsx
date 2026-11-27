import { useEffect, useMemo, useState } from 'react'
import { Chart } from './Chart'
import { CURVES } from './curves'
import { COLORS, KIND_INFO, buildCurves, newRelay, type Curve, type Elem50, type Elem51, type Kind, type Relay } from './model'

const KEY = 'overcurrent.state'

interface Saved {
  relays: Relay[]
  nextId: number
  hidden: string[]
  colors: Record<string, string> // cor escolhida para uma curva específica (chave "idRelé:51P")
  sat: boolean
  xmin: string
  xmax: string
  ifaults: string[] // marcações fixas de corrente (A primários): cada uma vira uma linha no gráfico e uma tabela de tempos
}

function defaults(): Saved {
  return {
    relays: [
      newRelay(1, 'Alimentador', { ctr: 120, ctrn: 120 }),
      newRelay(2, 'Entrada', {
        ctr: 240, ctrn: 240,
        p51: { on: true, pickup: 4, curve: 'C1', td: 0.5, ct: 0, mr: 0 },
        n51: { on: true, pickup: 0.8, curve: 'C1', td: 0.4, ct: 0, mr: 0 },
        p50: { on: true, pickup: 30, delay: 0.3 },
        n50: { on: false, pickup: 5, delay: 0.3 },
      }),
    ],
    nextId: 3, hidden: [], colors: {}, sat: true, xmin: '', xmax: '', ifaults: [''],
  }
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (s && Array.isArray(s.relays) && typeof s.nextId === 'number') {
      const ifaults: string[] = Array.isArray(s.ifaults) ? s.ifaults : [typeof s.ifault === 'string' ? s.ifault : '']   // estado antigo: uma só corrente
      return { ...defaults(), ...s, ifaults: ifaults.length ? ifaults : [''] }
    }
  } catch { /* ignora */ }
  return defaults()
}

const fmt = (x: number, d = 2) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtI = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('pt-BR') : fmt(x, 1))
const toNum = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() !== '' && Number.isFinite(n) ? n : 0 }

function niceFloor(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x))
  const m = x / p
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p
}
function niceCeil(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x))
  const m = x / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

function NumInput({ value, onChange, title }: { value: number; onChange: (n: number) => void; title?: string }) {
  const [txt, setTxt] = useState(String(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setTxt(String(value)) }, [value, focus])
  return (
    <input
      type="text" inputMode="decimal" className="numinput" value={txt} title={title}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onChange={(e) => {
        setTxt(e.target.value)
        const n = Number(e.target.value.replace(',', '.'))
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

function Num({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <label className="oc-num">
      <span>{label}</span>
      <NumInput value={value} onChange={onChange} title={hint} />
    </label>
  )
}

function Sample({ kind, color }: { kind: Kind; color: string }) {
  const k = KIND_INFO[kind]
  return (
    <svg width={30} height={10} aria-hidden>
      <line x1={1} x2={29} y1={5} y2={5} stroke={color} strokeWidth={k.width} strokeDasharray={k.dash} />
    </svg>
  )
}

export function OvercurrentApp() {
  const [st, setSt] = useState<Saved>(load)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(st)) } catch { /* ignora */ }
  }, [st])

  // curvas com a cor escolhida pelo usuário (por curva) ou a cor do relé
  const all = useMemo(() => buildCurves(st.relays, st.sat).map((c) => ({ ...c, color: st.colors[c.key] ?? c.color })), [st.relays, st.sat, st.colors])
  const visible = useMemo(() => all.filter((c) => !st.hidden.includes(c.key)), [all, st.hidden])

  const auto = useMemo(() => {
    const src = visible.length ? visible : all
    if (!src.length) return { min: 100, max: 10000 }
    const min = Math.min(...src.map((c) => c.ipk))
    const max50 = Math.max(0, ...src.filter((c) => c.kind.startsWith('50')).map((c) => c.ipk))
    const max51 = Math.max(0, ...src.filter((c) => c.kind.startsWith('51')).map((c) => c.ipk))
    return { min: niceFloor(min * 0.7), max: niceCeil(Math.max(max50 * 4, max51 * 40, min * 20)) }
  }, [all, visible])
  const xmin = toNum(st.xmin) > 0 ? toNum(st.xmin) : auto.min
  const xmax = Math.max(toNum(st.xmax) > 0 ? toNum(st.xmax) : auto.max, xmin * 2)
  const ifaults = st.ifaults.map(toNum)

  const patchRelay = (id: number, f: (r: Relay) => Relay) => setSt((s) => ({ ...s, relays: s.relays.map((r) => (r.id === id ? f(r) : r)) }))
  const patchEl = <K extends 'p51' | 'n51' | 'p50' | 'n50'>(id: number, k: K, p: Partial<Relay[K]>) => patchRelay(id, (r) => ({ ...r, [k]: { ...r[k], ...p } }))
  const toggle = (key: string) => setSt((s) => ({ ...s, hidden: s.hidden.includes(key) ? s.hidden.filter((h) => h !== key) : [...s.hidden, key] }))
  const setColor = (key: string, color: string) => setSt((s) => ({ ...s, colors: { ...s.colors, [key]: color } }))
  const setRelayColor = (id: number, color: string) => setSt((s) => {
    const colors = Object.fromEntries(Object.entries(s.colors).filter(([k]) => !k.startsWith(`${id}:`)))   // a cor do relé vale para todas as curvas dele
    return { ...s, colors, relays: s.relays.map((r) => (r.id === id ? { ...r, color } : r)) }
  })
  const addRelay = () => setSt((s) => ({ ...s, relays: [...s.relays, newRelay(s.nextId, `Relé ${s.relays.length + 1}`)], nextId: s.nextId + 1 }))
  const removeRelay = (id: number) => setSt((s) => ({ ...s, relays: s.relays.filter((r) => r.id !== id), hidden: s.hidden.filter((h) => !h.startsWith(`${id}:`)) }))

  // uma tabela de tempos por marcação (correntes repetidas ou vazias não geram tabela)
  const tables = useMemo(() => [...new Set(ifaults.filter((f) => f > 0))].map((f) => ({
    f, rows: visible.map((c) => ({ c, t: c.time(f) })).sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity)),
  })), [visible, ifaults.join('|')])  // eslint-disable-line react-hooks/exhaustive-deps
  const setMark = (k: number, v: string) => setSt((s) => ({ ...s, ifaults: s.ifaults.map((x, i) => (i === k ? v : x)) }))
  const addMark = () => setSt((s) => ({ ...s, ifaults: [...s.ifaults, ''] }))
  const delMark = (k: number) => setSt((s) => ({ ...s, ifaults: s.ifaults.length > 1 ? s.ifaults.filter((_, i) => i !== k) : [''] }))
  const fmtT = (t: number) => `${t >= 100 ? fmt(t, 1) : fmt(t, 3)} s`

  return (
    <div className="oc">
      {/* ------------------------------------------------------------- gráfico */}
      <main className="oc-main">
        <div className="oc-legend">
          {all.length === 0 && <span className="muted">Nenhuma curva ativa: marque os elementos de um relé.</span>}
          {all.map((c: Curve) => {
            const off = st.hidden.includes(c.key)
            return (
              <div key={c.key} className={`oc-item ${off ? 'off' : ''} ${hover === c.key ? 'hl' : ''}`} onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}>
                <input type="checkbox" checked={!off} onChange={() => toggle(c.key)} title="Mostrar/ocultar a curva" />
                <input type="color" className="oc-color" value={c.color} onChange={(e) => setColor(c.key, e.target.value)} title="Cor da curva" />
                <span className="oc-name" onClick={() => toggle(c.key)} title={c.info}><Sample kind={c.kind} color={c.color} /> {c.label}</span>
              </div>
            )
          })}
          {all.length > 1 && (
            <span className="oc-bulk">
              <button className="link" onClick={() => setSt((s) => ({ ...s, hidden: [] }))}>mostrar todas</button> ·{' '}
              <button className="link" onClick={() => setSt((s) => ({ ...s, hidden: all.map((c) => c.key) }))}>ocultar todas</button>
            </span>
          )}
        </div>

        <div className="oc-plot">
          <Chart curves={visible} xmin={xmin} xmax={xmax} ifaults={ifaults} hoverKey={hover} onHover={setHover} />
        </div>
        <p className="hint oc-hint">Passe o mouse sobre uma curva para ver o tempo de atuação · roda do mouse = zoom · arrastar = mover · duplo clique = vista inicial.</p>

        {visible.length > 0 && tables.map(({ f: ifault, rows }) => (
          <table key={ifault} className="tbl meas oc-table">
            <thead><tr><th>Curva ({fmtI(ifault)} A)</th><th>I ÷ pickup</th><th>Tempo</th><th>Margem</th></tr></thead>
            <tbody>
              {rows.map(({ c, t }, i) => {
                const prev = i > 0 ? rows[i - 1].t : null
                return (
                  <tr key={c.key}>
                    <td><span className="oc-dot" style={{ background: c.color }} />{c.label}</td>
                    <td className="num">{fmt(ifault / c.ipk, 2)}</td>
                    <td className="num">{t == null ? 'não atua' : fmtT(t)}</td>
                    <td className="num">{t != null && prev != null ? `+${fmt(t - prev, 3)} s` : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ))}
      </main>

      {/* ------------------------------------------------------------- ajustes */}
      <aside className="oc-side">
        <div className="row">
          <h3>Ajustes</h3>
          <span className="spacer" />
          <button onClick={addRelay}>+ Relé</button>
        </div>

        {st.relays.map((r, idx) => (
          <details key={r.id} className="oc-relay" open={idx === 0}>
            <summary>
              <span className="oc-dot" style={{ background: r.color ?? COLORS[idx % COLORS.length] }} />{r.name}
            </summary>
            <div className="oc-body">
              <div className="oc-row">
                <input type="text" className="numinput oc-wide" value={r.name} onChange={(e) => patchRelay(r.id, (x) => ({ ...x, name: e.target.value }))} title="Nome do relé" />
                <input type="color" className="oc-color" value={r.color ?? COLORS[idx % COLORS.length]} onChange={(e) => setRelayColor(r.id, e.target.value)} title="Cor de todas as curvas do relé" />
              </div>
              <div className="oc-row">
                <Num label="CTR" value={r.ctr} onChange={(n) => patchRelay(r.id, (x) => ({ ...x, ctr: Math.max(1, n) }))} hint="Relação do TC de fase (primário ÷ 5 A)" />
                <Num label="CTRN" value={r.ctrn} onChange={(n) => patchRelay(r.id, (x) => ({ ...x, ctrn: Math.max(1, n) }))} hint="Relação do TC de neutro" />
              </div>

              {(['p51', 'n51'] as const).map((k) => {
                const e: Elem51 = r[k]
                const ct = k === 'p51' ? r.ctr : r.ctrn
                return (
                  <div key={k} className={`oc-el ${e.on ? '' : 'off'}`}>
                    <label className="check"><input type="checkbox" checked={e.on} onChange={(ev) => patchEl(r.id, k, { on: ev.target.checked })} /> <b>{k === 'p51' ? '51 Fase' : '51 Neutro'}</b></label>
                    {e.on && (
                      <>
                        <div className="oc-row">
                          <Num label="Pickup (A sec.)" value={e.pickup} onChange={(n) => patchEl(r.id, k, { pickup: Math.max(0, n) })} hint={`= ${fmtI(e.pickup * ct)} A primários`} />
                          <label className="oc-num"><span>Curva</span>
                            <select value={e.curve} onChange={(ev) => patchEl(r.id, k, { curve: ev.target.value })}>
                              {CURVES.map((c) => <option key={c.code} value={c.code} title={c.name}>{c.code} – {c.name}</option>)}
                            </select>
                          </label>
                          <Num label="TD" value={e.td} onChange={(n) => patchEl(r.id, k, { td: Math.max(0, n) })} />
                        </div>
                        <details className="oc-more">
                          <summary>CT / MR</summary>
                          <div className="oc-row">
                            <Num label="CT (s)" value={e.ct} onChange={(n) => patchEl(r.id, k, { ct: Math.max(0, n) })} hint="Tempo constante somado" />
                            <Num label="MR (s)" value={e.mr} onChange={(n) => patchEl(r.id, k, { mr: Math.max(0, n) })} hint="Resposta mínima" />
                          </div>
                        </details>
                        <span className="oc-pri">pickup = {fmtI(e.pickup * ct)} A primários</span>
                      </>
                    )}
                  </div>
                )
              })}

              {(['p50', 'n50'] as const).map((k) => {
                const e: Elem50 = r[k]
                const ct = k === 'p50' ? r.ctr : r.ctrn
                return (
                  <div key={k} className={`oc-el ${e.on ? '' : 'off'}`}>
                    <label className="check"><input type="checkbox" checked={e.on} onChange={(ev) => patchEl(r.id, k, { on: ev.target.checked })} /> <b>{k === 'p50' ? '50 Fase' : '50 Neutro'}</b></label>
                    {e.on && (
                      <>
                        <div className="oc-row">
                          <Num label="Pickup (A sec.)" value={e.pickup} onChange={(n) => patchEl(r.id, k, { pickup: Math.max(0, n) })} hint={`= ${fmtI(e.pickup * ct)} A primários`} />
                          <Num label="Atraso (s)" value={e.delay} onChange={(n) => patchEl(r.id, k, { delay: Math.max(0, n) })} />
                        </div>
                        <span className="oc-pri">pickup = {fmtI(e.pickup * ct)} A primários</span>
                      </>
                    )}
                  </div>
                )
              })}
              <button className="link oc-del" onClick={() => removeRelay(r.id)}>excluir relé</button>
            </div>
          </details>
        ))}

        <details className="oc-relay">
          <summary>Opções do gráfico</summary>
          <div className="oc-body">
            <span className="oc-num"><span>Marcações de corrente (A pri.) – cada uma mostra uma tabela de tempos</span></span>
            {st.ifaults.map((v, k) => (
              <div key={k} className="oc-row oc-mark">
                <input type="text" className="numinput" placeholder="ex.: 2400" value={v} onChange={(e) => setMark(k, e.target.value)} aria-label={`Marcação ${k + 1} (A primários)`} />
                <button className="link" onClick={() => delMark(k)} title="Remover a marcação">✕</button>
              </div>
            ))}
            <button className="link" onClick={addMark}>+ marcação</button>
            <div className="oc-row">
              <label className="oc-num"><span>I mín. (A)</span>
                <input type="text" className="numinput" placeholder={`auto`} title={`auto: ${fmtI(auto.min)}`} value={st.xmin} onChange={(e) => setSt((s) => ({ ...s, xmin: e.target.value }))} /></label>
              <label className="oc-num"><span>I máx. (A)</span>
                <input type="text" className="numinput" placeholder={`auto`} title={`auto: ${fmtI(auto.max)}`} value={st.xmax} onChange={(e) => setSt((s) => ({ ...s, xmax: e.target.value }))} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={st.sat} onChange={(e) => setSt((s) => ({ ...s, sat: e.target.checked }))} /> 51SAT: limita o múltiplo a 30</label>
            <button className="link" onClick={() => setSt(defaults())}>restaurar exemplo</button>
          </div>
        </details>
      </aside>
    </div>
  )
}
