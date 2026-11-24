import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { simTime, usePrefs } from '../prefs'
import type { SessionBrief } from '../types'
import {
  BUS_MAX_CELLS, FAULT_TYPES, GRID, KINDS, KIND_ORDER, busCells, flag, hitRect, isBar, isComm, makeElement, num, rotate, worldPorts,
  type Diagram, type El, type Kind, type PortRef,
} from './model'
import { DEFAULT_SBASE, solve, type ElResult, type FaultStudy, type Ph, type PhasorSet } from './solver'
import { ElementSymbol, SymbolShape } from './symbols'
import { ShortcutEditor, ShortcutPanel } from './Shortcuts'

const KEY = 'systemlab.diagram'
const DND = 'application/x-systemlab'
const snap = (v: number) => Math.round(v / GRID) * GRID
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

type Pt = [number, number]
type Sel = { type: 'el'; ids: number[] } | { type: 'wire'; id: number } | null
type Drag =
  | { mode: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { mode: 'move'; id: number; ox: number; oy: number; orig: Map<number, [number, number]>; vias: Map<number, Pt[]> }
  | { mode: 'seg'; wireId: number; idx: number; path: Pt[]; horiz: boolean }
  | { mode: 'box'; x0: number; y0: number; base: number[] }
  | { mode: 'wire'; from: PortRef; sx: number; sy: number }
  | { mode: 'busend'; id: number; side: 'lo' | 'hi'; d0: Diagram }
  | null
interface Box { x0: number; y0: number; x1: number; y1: number }

/** Retângulo do elemento no mundo (área de captura girada): [x0, y0, x1, y1]. */
function bounds(el: El): [number, number, number, number] {
  const [x, y, w, h] = hitRect(el)
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => rotate(px, py, el.rot))
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return [el.x + Math.min(...xs), el.y + Math.min(...ys), el.x + Math.max(...xs), el.y + Math.max(...ys)]
}

/**
 * Redimensiona o barramento `id` para `n1` células mantendo fixa a extremidade oposta à `side` ('hi' = extremidade do último terminal,
 * 'lo' = extremidade do terminal 0). As ligações acompanham seus terminais; as dos terminais removidos são apagadas.
 */
function resizeBus(d0: Diagram, id: number, n1raw: number, side: 'lo' | 'hi'): Diagram {
  const el = d0.els.find((e) => e.id === id)
  if (!el || !isBar(el.kind)) return d0
  const n0 = busCells(el)
  const n1 = clamp(Math.round(n1raw / 2) * 2, 2, BUS_MAX_CELLS)
  const [ux, uy] = rotate(1, 0, el.rot)
  const half0 = n0 * (GRID / 2)
  const half1 = n1 * (GRID / 2)
  const sgn = side === 'hi' ? 1 : -1                      // 'hi': extremidade fixa é a do terminal 0 (lado -u)
  const fx = el.x - sgn * ux * half0
  const fy = el.y - sgn * uy * half0
  const cx = fx + sgn * ux * half1
  const cy = fy + sgn * uy * half1
  const shift = side === 'hi' ? 0 : n1 - n0               // índices contados a partir da extremidade fixa
  const moved = (r: PortRef): PortRef | null => {
    if (r[0] !== id) return r
    const k = r[1] + shift
    return k < 0 || k > n1 ? null : [id, k]
  }
  const wires = d0.wires.flatMap((w) => {
    const a = moved(w.a)
    const b = moved(w.b)
    return a && b ? [{ ...w, a, b }] : []
  })
  const els = d0.els.map((e) => (e.id === id ? { ...e, x: cx, y: cy, p: { ...e.p, cells: n1 } } : e))
  return { ...d0, els, wires }
}

const EXPORT_FORMAT = 'eclipse-systemlab'

/** Valida e normaliza um arquivo JSON exportado pelo SystemLab: devolve o diagrama e as configurações ou lança um Error com o motivo. */
function parseImport(text: string): { diagram: Diagram; settings?: { sbase: number; pu: boolean } } {
  let j: unknown
  try { j = JSON.parse(text) } catch { throw new Error('O arquivo não é um JSON válido.') }
  const o = j as { format?: string; diagram?: { els?: unknown; wires?: unknown }; settings?: { sbase?: number; pu?: boolean } }
  if (!o || typeof o !== 'object' || o.format !== EXPORT_FORMAT || !o.diagram) throw new Error('O arquivo não é uma exportação do SystemLab (formato desconhecido).')
  const rawEls = o.diagram.els
  const rawWires = o.diagram.wires
  if (!Array.isArray(rawEls) || !Array.isArray(rawWires)) throw new Error('Diagrama inválido: faltam elementos ou ligações.')
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const els: El[] = []
  const ids = new Set<number>()
  for (const e of rawEls as Record<string, unknown>[]) {
    if (!e || !isNum(e.id) || typeof e.kind !== 'string' || !(e.kind in KINDS) || !isNum(e.x) || !isNum(e.y)) throw new Error('Diagrama inválido: elemento com tipo ou posição desconhecidos.')
    if (ids.has(e.id)) throw new Error(`Diagrama inválido: id de elemento repetido (${e.id}).`)
    ids.add(e.id)
    const p: Record<string, number | boolean> = {}
    for (const [k, v] of Object.entries((e.p && typeof e.p === 'object' ? e.p : {}) as Record<string, unknown>)) if (isNum(v) || typeof v === 'boolean') p[k] = v
    els.push({ ...(e as unknown as El), rot: isNum(e.rot) ? e.rot : 0, name: typeof e.name === 'string' ? e.name : `${e.kind}${e.id}`, p })
  }
  const port = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])
  const wires = (rawWires as Record<string, unknown>[]).filter((w) => w && isNum(w.id) && port(w.a) && port(w.b) && ids.has(w.a[0]) && ids.has(w.b[0])) as unknown as Diagram['wires']
  const nextId = Math.max(1, ...els.map((e) => e.id), ...wires.map((w) => w.id)) + 1
  const settings = o.settings && isNum(o.settings.sbase) && o.settings.sbase > 0 ? { sbase: o.settings.sbase, pu: o.settings.pu === true } : undefined
  return { diagram: { els, wires: pruneTaps(wires), nextId }, settings }
}

/** Ícone de contato (traço simples, na cor do texto): fechado = ligado; aberto = lâmina levantada. */
function SwitchIcon({ closed }: { closed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx={4} cy={15} r={1.6} fill="currentColor" />
      <circle cx={20} cy={15} r={1.6} fill="currentColor" />
      {closed ? <line x1={4} y1={15} x2={20} y2={15} /> : <line x1={4} y1={15} x2={17} y2={7} />}
    </svg>
  )
}

const ICON = { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

/** Olho (mostrar dados) ou olho riscado (ocultar dados). */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg {...ICON}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx={12} cy={12} r={2.8} />
      {off && <line x1={4} y1={20} x2={20} y2={4} />}
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  )
}

function emptyDiagram(): Diagram {
  return { els: [], wires: [], nextId: 1 }
}

function load(): Diagram {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (d && Array.isArray(d.els) && Array.isArray(d.wires) && typeof d.nextId === 'number') {
      d.wires = pruneTaps(d.wires)
      const gone = new Set<number>(d.els.filter((e: { kind: string }) => e.kind === 'network').map((e: { id: number }) => e.id))   // elemento Rede removido
      if (gone.size === 0) return d
      return { ...d, els: d.els.filter((e: { id: number }) => !gone.has(e.id)), wires: d.wires.filter((w: Diagram['wires'][number]) => !gone.has(w.a[0]) && !gone.has(w.b[0])) }
    }
  } catch { /* ignora */ }
  return emptyDiagram()
}

/** Diagrama de exemplo: fonte → DJ → barra → trafo → barra → DJ → TC → carga, com um TP na barra de saída. */
function example(): Diagram {
  const els: El[] = []
  const wires: Diagram['wires'] = []
  let id = 1
  const add = (kind: Kind, x: number, y: number, rot = 0, p: Record<string, number | boolean> = {}) => {
    const el = makeElement(kind, id++, x, y, els)
    el.rot = rot
    el.p = { ...el.p, ...p }
    els.push(el)
    return el
  }
  const wire = (a: El, ap: number, b: El, bp: number) => wires.push({ id: id++, a: [a.id, ap], b: [b.id, bp] })
  const g = add('source', 100, 200)
  const dj1 = add('breaker', 240, 200)
  const ba1 = add('bus', 360, 200, 1)
  const tr = add('transformer', 500, 200)
  const ba2 = add('bus', 680, 200, 1)
  const dj2 = add('breaker', 800, 200)
  const tc = add('tc', 940, 200)
  const cg = add('load', 1080, 200)
  const tp = add('tp', 780, 360)
  wire(g, 0, dj1, 0); wire(dj1, 1, ba1, 4); wire(ba1, 4, tr, 0); wire(tr, 1, ba2, 4)
  wire(ba2, 4, dj2, 0); wire(dj2, 1, tc, 0); wire(tc, 1, cg, 0); wire(ba2, 7, tp, 0)
  return { els, wires, nextId: id }
}

/** Trajeto ortogonal de uma ligação, como lista de pontos. */
function routePoints(a: [number, number], b: [number, number]): [number, number][] {
  const dx = Math.abs(b[0] - a[0])
  const dy = Math.abs(b[1] - a[1])
  if (dx >= dy) {
    const mx = snap((a[0] + b[0]) / 2)
    return [a, [mx, a[1]], [mx, b[1]], b]
  }
  const my = snap((a[1] + b[1]) / 2)
  return [a, [a[0], my], [b[0], my], b]
}

/** Remove pontos repetidos e intermediários colineares. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    out.push(p)
    while (out.length >= 3) {
      const [x, y, z] = out.slice(-3)
      if ((x[0] === y[0] && y[0] === z[0]) || (x[1] === y[1] && y[1] === z[1])) out.splice(out.length - 2, 1)
      else break
    }
  }
  return out
}

/** Ponto do trajeto mais próximo de (x, y); em trechos ortogonais o ponto é alinhado à grade. */
function nearestOnPath(path: Pt[], x: number, y: number): { pt: Pt; d: number } {
  let best: { pt: Pt; d: number } = { pt: path[0], d: Infinity }
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i]
    const [x2, y2] = path[i + 1]
    const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2
    if (len2 === 0) continue
    const t = clamp(((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / len2, 0, 1)
    let px = x1 + t * (x2 - x1)
    let py = y1 + t * (y2 - y1)
    if (y1 === y2) px = clamp(snap(px), Math.min(x1, x2), Math.max(x1, x2))
    else if (x1 === x2) py = clamp(snap(py), Math.min(y1, y2), Math.max(y1, y2))
    const d = Math.hypot(x - px, y - py)
    if (d < best.d) best = { pt: [px, py], d }
  }
  return best
}

/** Remove derivações cuja ligação-alvo não existe mais (em cascata). */
function pruneTaps(wires: Diagram['wires']): Diagram['wires'] {
  let cur = wires
  for (;;) {
    const ids = new Set(cur.map((w) => w.id))
    const next = cur.filter((w) => !w.tap || ids.has(w.tap.w))
    if (next.length === cur.length) return cur
    cur = next
  }
}

/** Trajeto da ligação: automático, ou passando pelos pontos `via` (cotovelos são inseridos se algum extremo se moveu). */
function wirePath(a: Pt, b: Pt, via?: Pt[]): Pt[] {
  if (!via || via.length === 0) return routePoints(a, b)
  const pts: Pt[] = [a, ...via, b]
  const out: Pt[] = [a]
  for (let k = 1; k < pts.length; k++) {
    const p = out[out.length - 1]
    const q = pts[k]
    if (p[0] !== q[0] && p[1] !== q[1]) {
      const prev = out.length >= 2 ? out[out.length - 2] : null
      const horizPrev = prev ? prev[1] === p[1] : Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1])
      out.push(horizPrev ? [q[0], p[1]] : [p[0], q[1]])
    }
    out.push(q)
  }
  return simplify(out)
}

// ------------------------------------------------------------------ formatação
const fmt = (x: number, d = 2) => {
  const f = Math.pow(10, d)
  const r = Math.round(x * f) / f
  return (Object.is(r, -0) || r === 0 ? 0 : r).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
}
/** Exibição: valores em unidades de engenharia ou em pu (base = potência de base e tensão de base do terminal). Atualizado a cada renderização. */
const DISP = { pu: false, sbase: DEFAULT_SBASE }
/** Potência (MW/Mvar/MVA) em pu quando habilitado. */
const fP = (x: number, d = 2) => (DISP.pu ? `${fmt(x / DISP.sbase, 4)} pu` : `${fmt(x, d)} MW`)
const fQ = (x: number, d = 2) => (DISP.pu ? `${fmt(x / DISP.sbase, 4)} pu` : `${fmt(x, d)} Mvar`)
/** Tensão em kV (fase-fase; `ln` = fase-neutro) ou pu da tensão de base `kvb` (fase-fase) do terminal. */
const fV = (p: Ph | undefined, kvb: number | undefined, d = 2, ln = false) =>
  (p ? (DISP.pu && kvb && kvb > 0 ? `${fmt(p.mag / (ln ? kvb / Math.sqrt(3) : kvb), 4)} pu ∠${fmt(p.ang, 1)}°` : `${fmt(p.mag, d)} kV ∠${fmt(p.ang, 1)}°`) : '–')
const fI = (p: Ph | undefined, kvb: number | undefined, d = 1) =>
  (p ? (DISP.pu && kvb && kvb > 0 ? `${fmt(p.mag / ((DISP.sbase * 1000) / (Math.sqrt(3) * kvb)), 4)} pu ∠${fmt(p.ang, 1)}°` : `${fmt(p.mag, d)} A ∠${fmt(p.ang, 1)}°`) : '–')
const fIm = (mag: number, kvb: number | undefined, d = 1) => fI({ mag, ang: 0 }, kvb, d).replace(/ ∠.*$/, '')

/** Linhas de valores do elemento no diagrama (sem os avisos de "desenergizado"). */
function valueLines(el: El, r: ElResult | undefined): string[] {
  return valueLinesRaw(el, r).filter((t) => t && t !== 'desenergizado')
}

function valueLinesRaw(el: El, r: ElResult | undefined): string[] {
  if (!r) return []
  switch (el.kind) {
    case 'ied': return []
    case 'battery': return [`SOC ${fmt(r.extra.soc, 0)}% · ${fP(r.extra.pdc)}`, r.note ?? '']
    case 'inverter': return [r.energized ? `${fP(r.extra.p)} · ${fQ(r.extra.q)}` : (r.note ?? 'inativo'), ...(r.energized && r.note ? [r.note] : [])]
    case 'bus': return [r.energized ? fV(r.v[0], r.kvb?.[0]) : 'desenergizado']
    case 'source': return [`${fP(r.extra.p)} · ${fQ(r.extra.q)}`]
    case 'load': return r.energized ? [`${fP(r.extra.p)} · ${fQ(r.extra.q)}`, fV({ mag: r.v[0].mag, ang: 0 }, r.kvb?.[0]).replace(/ ∠.*$/, '')] : ['desenergizado']
    case 'breaker':
    case 'switch': {
      if (!flag(el, 'closed')) return ['aberto']
      const main = r.extra.dc ? `${fmt(r.extra.idc, 1)} A CC` : r.energized ? `${fIm(r.i[0].mag, r.kvb?.[0])}` : 'desenergizado'
      return r.note ? [main, `⚠ ${r.note}`] : [main]
    }
    case 'tc': if (r.extra.dc) return [`${fmt(r.extra.idc, 1)} A CC`]
      return [r.energized ? `${fIm(r.i[0].mag, r.kvb?.[0])} → ${fmt(r.extra.isec, 3)} A` : 'desenergizado']
    case 'transformer': return r.energized ? [`${fP(r.p[0])} · ${fmt(r.extra.loading, 0)}%`] : ['desenergizado']
    case 'transformer3': return r.energized ? [`${fP(r.p[0])} · ${fmt(r.extra.loading, 0)}%`] : ['desenergizado']
    case 'line': return r.energized ? [`${fmt(r.extra.len, 1)} km · ${fIm(r.i[0].mag, r.kvb?.[0])}`] : [`${fmt(r.extra.len, 1)} km`]
    case 'tp': return [r.energized ? `${fmt(r.extra.vsec, 1)} V` : 'desenergizado']
    case 'fault': return flag(el, 'on') ? [`${FAULT_TYPES.find((t) => t.v === num(el, 'type'))?.short ?? ''}${r.extra.pos >= 0 ? ` @ ${fmt(r.extra.pos, 0)}%` : ''} · ${r.extra.ifault > 0 ? `${fIm(r.extra.ifault, r.kvb?.[0], 0)}` : 'sem corrente'}`] : ['desligada']
  }
}

// ------------------------------------------------------------------ campo numérico
function NumInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [txt, setTxt] = useState(String(value))
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setTxt(String(value)) }, [value, focus])
  return (
    <input
      type="text"
      inputMode="decimal"
      className="numinput"
      value={txt}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        setTxt(e.target.value)
        const n = Number(e.target.value.replace(',', '.'))
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

// ------------------------------------------------------------------ app
export function SystemLabApp() {
  const [dg, setDg] = useState<Diagram>(load)
  const [view, setView] = useState({ tx: 40, ty: 40, k: 1 })
  const [sel, setSel] = useState<Sel>(null)
  const [wiring, setWiring] = useState<PortRef | null>(null)
  const [mouse, setMouse] = useState<[number, number]>([0, 0])
  const [hover, setHover] = useState<number | null>(null)
  const [dragIds, setDragIds] = useState<number[]>([]) // elementos sendo arrastados: mostram só o símbolo
  const [box, setBox] = useState<Box | null>(null)      // retângulo de seleção
  const [showVals, setShowVals] = useState(true)
  // configurações do SystemLab (engrenagem): potência de base e exibição em pu
  const [cfg, setCfg] = useState<{ sbase: number; pu: boolean }>(() => {
    try {
      const j = JSON.parse(localStorage.getItem('systemlab.settings') ?? '{}')
      return { sbase: Number.isFinite(j.sbase) && j.sbase > 0 ? j.sbase : DEFAULT_SBASE, pu: j.pu === true }
    } catch { return { sbase: DEFAULT_SBASE, pu: false } }
  })
  const [showCfg, setShowCfg] = useState(false)
  const [ioMsg, setIoMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const saveCfg = (n: { sbase: number; pu: boolean }) => {
    setCfg(n)
    try { localStorage.setItem('systemlab.settings', JSON.stringify(n)) } catch { /* ignora */ }
  }
  DISP.pu = cfg.pu
  DISP.sbase = cfg.sbase
  const { prefs } = usePrefs()
  const [run, setRun] = useState<'stopped' | 'playing' | 'paused'>('stopped')   // parado: fontes desligadas; Play energiza e roda
  const [speed, setSpeed] = useState(1)
  const [simT, setSimT] = useState(0)                                          // tempo simulado (s)
  const touched = useRef(false)                                                // só mexe nos relés depois de o usuário usar Play/Pause
  const [sessions, setSessions] = useState<SessionBrief[]>([])      // relés do DigitalRelay (para os elementos IED)
  const [iecIeds, setIecIeds] = useState<string[]>([])               // IEDs do projeto IEC61850
  const [panels, setPanels] = useState<{ tools: boolean; side: boolean }>(() => {
    try { return { tools: true, side: true, ...JSON.parse(localStorage.getItem('systemlab.panels') ?? '{}') } } catch { return { tools: true, side: true } }
  })
  const togglePanel = (k: 'tools' | 'side') => setPanels((p) => {
    const n = { ...p, [k]: !p[k] }
    try { localStorage.setItem('systemlab.panels', JSON.stringify(n)) } catch { /* ignora */ }
    return n
  })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const spaceDown = useRef(false)

  const dgRef = useRef(dg)
  dgRef.current = dg
  const solBase = useMemo(() => solve(dg.els, dg.wires, run !== 'stopped', false, cfg.sbase), [dg, run, cfg.sbase])
  // estudo de falta: sempre com as fontes ligadas (permite ver as grandezas antes de rodar); em execução, o diagrama passa a mostrar a falta
  const hasFault = dg.els.some((e) => e.kind === 'fault' && flag(e, 'on'))
  const study = useMemo(() => (hasFault ? solve(dg.els, dg.wires, true, true, cfg.sbase) : null), [dg, hasFault, cfg.sbase])
  const sol = run !== 'stopped' && study?.fault ? study : solBase

  // relógio da simulação (tempo real × velocidade)
  useEffect(() => {
    if (run !== 'playing') return
    let last = performance.now()
    const id = setInterval(() => {
      const n = performance.now()
      setSimT((t) => t + ((n - last) / 1000) * speed)
      last = n
    }, 100)
    return () => clearInterval(id)
  }, [run, speed])

  // Play/Pause também executam/pausam os relés do DigitalRelay associados aos IEDs do diagrama
  const iedSids = dg.els.filter((e) => e.kind === 'ied' && e.sid).map((e) => e.sid!).sort().join(',')
  useEffect(() => {
    if (!touched.current) return
    for (const sid of iedSids.split(',').filter(Boolean)) api.control(sid, { running: run === 'playing', speed }).catch(() => undefined)
  }, [run, speed, iedSids])
  const play = () => { touched.current = true; setRun('playing') }
  const pause = () => { touched.current = true; setRun('paused') }
  const stop = () => { touched.current = true; setRun('stopped'); setSimT(0) }
  const elById = useMemo(() => new Map(dg.els.map((e) => [e.id, e])), [dg.els])

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(dg)) } catch { /* ignora */ }
  }, [dg])

  // relés do DigitalRelay disponíveis (consulta periódica; sem backend a lista fica vazia)
  useEffect(() => {
    let on = true
    const f = () => api.sessions().then((s) => { if (on) setSessions(s) }).catch(() => undefined)
    f()
    const t = setInterval(f, 2000)
    return () => { on = false; clearInterval(t) }
  }, [])

  // associação IED ↔ disjuntor/TC/TP: estado do disjuntor nos dois sentidos; correntes (TC) e tensões (TP) injetadas no relé
  const syncRef = useRef(new Map<number, { rel?: boolean; diag?: boolean; hold: number; sent: string; t: number }>())
  useEffect(() => {
    const now = Date.now()
    for (const ied of dg.els) {
      if (ied.kind !== 'ied' || !ied.sid) continue
      const s = sessions.find((x) => x.id === ied.sid)
      if (!s) continue
      const st = syncRef.current.get(ied.id) ?? { hold: 0, sent: '', t: 0 }
      syncRef.current.set(ied.id, st)
      const L = ied.links ?? {}
      const brk = L.breaker != null ? elById.get(L.breaker) : undefined
      if (brk?.kind === 'breaker' && s.breaker_closed != null) {
        const dgc = flag(brk, 'closed')
        if (st.rel === undefined || (dgc !== st.diag)) {                       // 1ª vez ou o diagrama mudou: envia ao relé
          if (dgc !== s.breaker_closed) api.forceBreaker(s.id, dgc).catch(() => undefined)
          st.rel = dgc; st.diag = dgc; st.hold = now + 2500
        } else if (now > st.hold && s.breaker_closed !== st.rel) {             // o relé mudou (ex.: trip): reflete no diagrama
          st.rel = s.breaker_closed; st.diag = s.breaker_closed
          if (dgc !== s.breaker_closed) updateEl(brk.id, (x) => ({ ...x, p: { ...x.p, closed: s.breaker_closed! } }))
        }
      } else { st.rel = undefined; st.diag = undefined }
      const tc = L.tc != null ? elById.get(L.tc) : undefined
      const tp = L.tp != null ? elById.get(L.tp) : undefined
      if (tc?.kind === 'tc' || tp?.kind === 'tp') {
        const patch: Record<string, number | boolean> = { analog_on: true }
        const r = tc?.kind === 'tc' ? sol.res.get(tc.id) : undefined
        const ft = tc?.kind === 'tc' ? sol.fault?.terms.get(tc.id)?.[0] : undefined      // em falta: fasores por fase
        if (tc?.kind === 'tc') {
          const mag = r?.energized ? r.i[0].mag : 0
          const ang = r?.energized ? r.i[0].ang : 0
          if (ft && r?.energized) {
            Object.assign(patch, { ia_mag: ft.i.a.mag, ib_mag: ft.i.b.mag, ic_mag: ft.i.c.mag, ia_ang: ft.i.a.ang, ib_ang: ft.i.b.ang, ic_ang: ft.i.c.ang })
          } else {
            Object.assign(patch, { ia_mag: mag, ib_mag: mag, ic_mag: mag, ia_ang: ang, ib_ang: ang - 120, ic_ang: ang + 120 })
          }
        }
        const rv = tp?.kind === 'tp' ? sol.res.get(tp.id) : undefined
        const fv = tp?.kind === 'tp' ? sol.fault?.terms.get(tp.id)?.[0] : undefined
        if (tp?.kind === 'tp') {
          const mag = rv?.energized ? (rv.v[0].mag * 1000) / Math.sqrt(3) : 0
          const ang = rv?.energized ? rv.v[0].ang : 0
          if (fv && rv?.energized) {
            Object.assign(patch, { va_mag: fv.v.a.mag * 1000, vb_mag: fv.v.b.mag * 1000, vc_mag: fv.v.c.mag * 1000, va_ang: fv.v.a.ang, vb_ang: fv.v.b.ang, vc_ang: fv.v.c.ang })
          } else {
            Object.assign(patch, { va_mag: mag, vb_mag: mag, vc_mag: mag, va_ang: ang, vb_ang: ang - 120, vc_ang: ang + 120 })
          }
        }
        const key = JSON.stringify(patch, (_, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))
        if (key !== st.sent || now - st.t > 5000) {
          st.sent = key; st.t = now
          api.sim(s.id, patch).catch(() => undefined)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, dg, sol])
  const toWorld = useCallback((cx: number, cy: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return [(cx - r.left - v.tx) / v.k, (cy - r.top - v.ty) / v.k]
  }, [])

  // ---- edição
  const addElement = useCallback((kind: Kind, x: number, y: number) => {
    setDg((d) => {
      const el = makeElement(kind, d.nextId, snap(x), snap(y), d.els)
      setSel({ type: 'el', ids: [el.id] })
      return { ...d, els: [...d.els, el], nextId: d.nextId + 1 }
    })
  }, [])

  const updateEl = useCallback((id: number, f: (e: El) => El) => {
    setDg((d) => ({ ...d, els: d.els.map((e) => (e.id === id ? f(e) : e)) }))
  }, [])

  const connect = useCallback((a: PortRef, b: PortRef) => {
    if (a[0] === b[0]) return
    setDg((d) => {
      const dup = d.wires.some((w) => (w.a[0] === a[0] && w.a[1] === a[1] && w.b[0] === b[0] && w.b[1] === b[1])
        || (w.a[0] === b[0] && w.a[1] === b[1] && w.b[0] === a[0] && w.b[1] === a[1]))
      return dup ? d : { ...d, wires: [...d.wires, { id: d.nextId, a, b }], nextId: d.nextId + 1 }
    })
  }, [])

  const removeSel = useCallback(() => {
    if (!sel) return
    setDg((d) => {
      if (sel.type === 'wire') return { ...d, wires: pruneTaps(d.wires.filter((w) => w.id !== sel.id)) }
      const ids = new Set(sel.ids)
      return { ...d, els: d.els.filter((e) => !ids.has(e.id)), wires: pruneTaps(d.wires.filter((w) => !ids.has(w.a[0]) && !ids.has(w.b[0]))) }
    })
    setSel(null)
  }, [sel])

  const rotateSel = useCallback(() => {
    if (sel?.type !== 'el') return
    const ids = new Set(sel.ids)
    setDg((d) => ({ ...d, els: d.els.map((e) => (ids.has(e.id) ? { ...e, rot: (e.rot + 1) % 4 } : e)) }))
  }, [sel])

  // ---- copiar e colar
  const clipRef = useRef<{ els: El[]; wires: Diagram['wires'] } | null>(null)
  const pasteN = useRef(0)
  const mouseSeen = useRef(false)
  const mouseRef = useRef(mouse)
  mouseRef.current = mouse
  const selRef = useRef(sel)
  selRef.current = sel
  const panStart = useRef<[number, number] | null>(null)
  const panMoved = useRef(false)
  const [ctx, setCtx] = useState<{ x: number; y: number; wx: number; wy: number; elId?: number } | null>(null)
  const [hasClip, setHasClip] = useState(false)

  /** Copia a seleção (ou o elemento `onlyId`) com as ligações entre eles. */
  const copySel = useCallback((onlyId?: number): boolean => {
    const d = dgRef.current
    const cur = selRef.current
    const ids = new Set<number>(onlyId != null ? [onlyId] : cur?.type === 'el' ? cur.ids : [])
    const els = d.els.filter((e) => ids.has(e.id))
    if (els.length === 0) return false
    const wires = d.wires.filter((w) => !w.tap && ids.has(w.a[0]) && ids.has(w.b[0]))
    clipRef.current = { els: JSON.parse(JSON.stringify(els)), wires: JSON.parse(JSON.stringify(wires)) }
    pasteN.current = 0
    setHasClip(true)
    return true
  }, [])

  /** Cola o conteúdo copiado centrado em (wx, wy); sem ponto, desloca a cada colagem. Os IEDs colados saem sem relé associado. */
  const pasteClip = useCallback((at?: [number, number]) => {
    const c = clipRef.current
    if (!c) return
    pasteN.current += 1
    const n = pasteN.current
    setDg((d) => {
      const map = new Map<number, number>()
      let id = d.nextId
      for (const e of c.els) map.set(e.id, id++)
      const xs = c.els.map((e) => e.x)
      const ys = c.els.map((e) => e.y)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const dx = at ? snap(at[0] - cx) : GRID * 2 * n
      const dy = at ? snap(at[1] - cy) : GRID * 2 * n
      const taken: El[] = [...d.els]
      const added: El[] = []
      for (const e of c.els) {
        const prefix = KINDS[e.kind].prefix
        let k = taken.filter((x) => x.kind === e.kind).length + 1
        while (taken.some((x) => x.name === `${prefix}${k}`)) k++
        const copy: El = { ...e, id: map.get(e.id)!, x: e.x + dx, y: e.y + dy, name: `${prefix}${k}`, p: { ...e.p } }
        if (e.kind === 'ied') {
          delete copy.sid; delete copy.rname; delete copy.sc; delete copy.scPos; delete copy.scOpen
          if (e.links) {
            const links: NonNullable<El['links']> = {}
            for (const key of ['breaker', 'tc', 'tp'] as const) { const v = e.links[key]; if (v != null && map.has(v)) links[key] = map.get(v) }
            copy.links = links
          }
        }
        taken.push(copy)
        added.push(copy)
      }
      const wires = c.wires.map((w) => ({
        ...w, id: id++, a: [map.get(w.a[0])!, w.a[1]] as PortRef, b: [map.get(w.b[0])!, w.b[1]] as PortRef,
        ...(w.via ? { via: w.via.map(([x, y]) => [x + dx, y + dy] as Pt) } : {}),
      }))
      setSel({ type: 'el', ids: added.map((e) => e.id) })
      return { ...d, els: [...d.els, ...added], wires: [...d.wires, ...wires], nextId: id }
    })
  }, [])

  // menu do botão direito: fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!ctx) return
    const close = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.sl-ctx')) setCtx(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtx(null) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc) }
  }, [ctx])

  // ---- teclado e roda do mouse
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Delete' || e.key === 'Backspace') removeSel()
      else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSel({ type: 'el', ids: dgRef.current.els.map((x) => x.id) })
      } else if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
        if (copySel()) e.preventDefault()
      } else if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        pasteClip(mouseSeen.current ? mouseRef.current : undefined)
      } else if (e.key === 'r' || e.key === 'R') rotateSel()
      else if (e.key === ' ') { e.preventDefault(); spaceDown.current = true }
      else if (e.key === 'Escape') { setWiring(null); setSel(null) }
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') spaceDown.current = false }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [removeSel, rotateSel, copySel, pasteClip])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const v = viewRef.current
      const k = clamp(v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.3, 2.5)
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      setView({ k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // ---- ponteiro
  const capture = (e: React.PointerEvent) => svgRef.current?.setPointerCapture(e.pointerId)

  const additive = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => e.shiftKey || e.ctrlKey || e.metaKey

  /** Fundo: arrastar com o botão esquerdo desenha o retângulo de seleção; botão do meio/direito (ou Espaço) move a vista. */
  const onBgDown = (e: React.PointerEvent) => {
    capture(e)
    setWiring(null)
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      panStart.current = [e.clientX, e.clientY]
      panMoved.current = false
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }
      return
    }
    if (e.button !== 0) return
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const base = additive(e) && sel?.type === 'el' ? sel.ids : []
    drag.current = { mode: 'box', x0: wx, y0: wy, base }
    if (!base.length) setSel(null)
  }
  /** Ligação: seleciona e, ao arrastar, desloca o trecho mais próximo do ponteiro (desenho manual). */
  const onWireDown = (e: React.PointerEvent, w: Diagram['wires'][number]) => {
    e.stopPropagation()
    setSel({ type: 'wire', id: w.id })
    if (wiring) {                                           // ligação em andamento: encosta no trecho clicado
      const [tx, ty] = toWorld(e.clientX, e.clientY)
      tapConnect(wiring, w, tx, ty)
      setWiring(null)
      return
    }
    const a = portPos(w.a)
    const b = wireB(w)
    if (!a || !b || e.button !== 0) return
    capture(e)
    const path = wirePath(a, b, w.via)
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    let best = -1
    let bd = Infinity
    for (let i = 0; i < path.length - 1; i++) {
      const [x1, y1] = path[i]
      const [x2, y2] = path[i + 1]
      const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2
      const t = len2 === 0 ? 0 : clamp(((wx - x1) * (x2 - x1) + (wy - y1) * (y2 - y1)) / len2, 0, 1)
      const dd = Math.hypot(wx - (x1 + t * (x2 - x1)), wy - (y1 + t * (y2 - y1)))
      if (dd < bd) { bd = dd; best = i }
    }
    if (best >= 0) drag.current = { mode: 'seg', wireId: w.id, idx: best, path, horiz: path[best][1] === path[best + 1][1] }
  }
  const resetWire = (id: number) => setDg((d) => ({ ...d, wires: d.wires.map((w) => (w.id === id ? { ...w, via: undefined } : w)) }))

  const onElDown = (e: React.PointerEvent, el: El) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const cur = sel?.type === 'el' ? sel.ids : []
    if (additive(e)) {                                     // Shift/Ctrl+clique: inclui ou retira da seleção
      setSel({ type: 'el', ids: cur.includes(el.id) ? cur.filter((i) => i !== el.id) : [...cur, el.id] })
      return
    }
    capture(e)
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    const ids = cur.includes(el.id) ? cur : [el.id]       // arrastar um elemento já selecionado move o grupo todo
    if (!cur.includes(el.id)) setSel({ type: 'el', ids })
    const orig = new Map<number, [number, number]>()
    for (const id of ids) { const o = elById.get(id); if (o) orig.set(id, [o.x, o.y]) }
    const vias = new Map<number, Pt[]>()
    for (const w of dg.wires) if (w.via?.length && orig.has(w.a[0]) && orig.has(w.b[0])) vias.set(w.id, w.via)
    drag.current = { mode: 'move', id: el.id, ox: wx - el.x, oy: wy - el.y, orig, vias }
  }
  const onBusEndDown = (e: React.PointerEvent, el: El, side: 'lo' | 'hi') => {
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e)
    drag.current = { mode: 'busend', id: el.id, side, d0: dgRef.current }
  }
  const onPortDown = (e: React.PointerEvent, ref: PortRef) => {
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e)
    if (wiring && !(wiring[0] === ref[0] && wiring[1] === ref[1])) {
      connect(wiring, ref)
      setWiring(null)
      drag.current = null
      return
    }
    setWiring(ref)
    drag.current = { mode: 'wire', from: ref, sx: e.clientX, sy: e.clientY }
  }
  const onMove = (e: React.PointerEvent) => {
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    mouseSeen.current = true
    const ps0 = panStart.current
    if (drag.current?.mode === 'pan' && ps0 && Math.hypot(e.clientX - ps0[0], e.clientY - ps0[1]) > 5) panMoved.current = true
    setMouse([wx, wy])
    const d = drag.current
    if (!d) return
    if (d.mode === 'pan') setView((v) => ({ ...v, tx: d.tx + e.clientX - d.sx, ty: d.ty + e.clientY - d.sy }))
    else if (d.mode === 'box') {
      setBox({ x0: d.x0, y0: d.y0, x1: wx, y1: wy })
      const [ax, bx] = [Math.min(d.x0, wx), Math.max(d.x0, wx)]
      const [ay, by] = [Math.min(d.y0, wy), Math.max(d.y0, wy)]
      const hit = dg.els.filter((el) => { const [x0, y0, x1, y1] = bounds(el); return x1 >= ax && x0 <= bx && y1 >= ay && y0 <= by }).map((el) => el.id)
      const ids = [...new Set([...d.base, ...hit])]
      setSel(ids.length ? { type: 'el', ids } : null)
    } else if (d.mode === 'move') {
      const x = snap(wx - d.ox)
      const y = snap(wy - d.oy)
      const cur = elById.get(d.id)
      const anchor = d.orig.get(d.id)
      if (cur && anchor && (cur.x !== x || cur.y !== y)) {
        const dx = x - anchor[0]
        const dy = y - anchor[1]
        setDragIds([...d.orig.keys()])
        setDg((g) => ({
          ...g,
          els: g.els.map((el) => { const o = d.orig.get(el.id); return o ? { ...el, x: o[0] + dx, y: o[1] + dy } : el }),
          wires: d.vias.size ? g.wires.map((w) => { const v = d.vias.get(w.id); return v ? { ...w, via: v.map(([px, py]) => [px + dx, py + dy] as Pt) } : w }) : g.wires,
        }))
      }
    } else if (d.mode === 'busend') {
      const el0 = d.d0.els.find((x) => x.id === d.id)
      if (!el0) return
      const [ux, uy] = rotate(1, 0, el0.rot)
      const half = busCells(el0) * (GRID / 2)
      const sgn = d.side === 'hi' ? 1 : -1
      const fx = el0.x - sgn * ux * half
      const fy = el0.y - sgn * uy * half
      const t = ((wx - fx) * ux + (wy - fy) * uy) * sgn            // distância (com sinal) da extremidade fixa até o ponteiro
      const n1 = Math.max(2, Math.round(t / GRID / 2) * 2)
      setDg(resizeBus(d.d0, d.id, n1, d.side))
    } else if (d.mode === 'seg') {
      // arrastar um trecho da ligação: ele se desloca na perpendicular; nos trechos presos aos terminais surge um cotovelo
      const k = d.horiz ? 1 : 0
      const v = snap(d.horiz ? wy : wx)
      if (v === d.path[d.idx][k] && !dgRef.current.wires.find((w) => w.id === d.wireId)?.via) return
      const pts = d.path.map((p) => [...p] as Pt)
      let idx = d.idx
      if (idx === 0) { pts.splice(1, 0, [...pts[0]] as Pt); idx = 1 }
      if (idx + 1 === pts.length - 1) pts.splice(pts.length - 1, 0, [...pts[pts.length - 1]] as Pt)
      pts[idx][k] = v
      pts[idx + 1][k] = v
      const via = simplify(pts).slice(1, -1)
      setDg((g) => ({ ...g, wires: g.wires.map((w) => (w.id === d.wireId ? { ...w, via } : w)) }))
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setDragIds([])
    setBox(null)
    svgRef.current?.releasePointerCapture?.(e.pointerId)
    if (d?.mode !== 'wire') return
    const t = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-port]')
    const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6
    if (t) {
      const [a, b] = (t.getAttribute('data-port') ?? '').split(':').map(Number)
      if (a === d.from[0] && b === d.from[1]) return // clique simples: aguarda o segundo terminal
      connect(d.from, [a, b])
      setWiring(null)
    } else if (moved) {
      const wid = Number((document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-wire]')?.getAttribute('data-wire'))
      const target = Number.isFinite(wid) ? dgRef.current.wires.find((w) => w.id === wid) : undefined
      if (target) { const [tx, ty] = toWorld(e.clientX, e.clientY); tapConnect(d.from, target, tx, ty) }
      setWiring(null)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const kind = e.dataTransfer.getData(DND) as Kind
    if (!(kind in KINDS)) return
    const [x, y] = toWorld(e.clientX, e.clientY)
    if (kind === 'tc' && insertTcOnWire(x, y)) return
    addElement(kind, x, y)
  }

  /** Solta de um TC sobre uma ligação: o TC entra em série, dividindo a ligação em duas. */
  const insertTcOnWire = (wx: number, wy: number): boolean => {
    let best: { id: number; d: number; px: number; py: number; horiz: boolean } | null = null
    for (const w of dg.wires) {
      const a = portPos(w.a)
      const b = wireB(w)
      if (!a || !b) continue
      const pts = wirePath(a, b, w.via)
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i]
        const [x2, y2] = pts[i + 1]
        const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2
        if (len2 === 0) continue
        const t = clamp(((wx - x1) * (x2 - x1) + (wy - y1) * (y2 - y1)) / len2, 0, 1)
        const px = x1 + t * (x2 - x1)
        const py = y1 + t * (y2 - y1)
        const d = Math.hypot(wx - px, wy - py)
        if (!best || d < best.d) best = { id: w.id, d, px, py, horiz: y1 === y2 }
      }
    }
    if (!best || best.d > 14) return false
    const hit = best
    setDg((d) => {
      const w = d.wires.find((x) => x.id === hit.id)
      if (!w) return d
      const id = d.nextId
      const tc = makeElement('tc', id, snap(hit.px), snap(hit.py), d.els)
      tc.rot = hit.horiz ? 0 : 1
      const [p0, p1] = worldPorts(tc)
      const ea = d.els.find((e) => e.id === w.a[0])
      const pa = ea ? worldPorts(ea)[w.a[1]] : p0
      const near = Math.hypot(pa[0] - p0[0], pa[1] - p0[1]) <= Math.hypot(pa[0] - p1[0], pa[1] - p1[1]) ? 0 : 1
      return {
        els: [...d.els, tc],
        wires: pruneTaps([...d.wires.filter((x) => x.id !== w.id), { id: id + 1, a: w.a, b: [id, near] }, { id: id + 2, a: [id, 1 - near], b: w.b }]),
        nextId: id + 3,
      }
    })
    setSel({ type: 'el', ids: [dg.nextId] })
    return true
  }
  /** Arraste a partir da toolbox: a imagem arrastada é só o símbolo (sem borda nem nome), na escala atual do diagrama. */
  const startToolDrag = (e: React.DragEvent<HTMLDivElement>, kind: Kind) => {
    e.dataTransfer.setData(DND, kind)
    e.dataTransfer.effectAllowed = 'copy'
    const src = e.currentTarget.querySelector('svg')
    if (!src) return
    const size = Math.round(96 * view.k)
    const ghost = src.cloneNode(true) as SVGSVGElement
    ghost.setAttribute('width', String(size))
    ghost.setAttribute('height', String(size))
    Object.assign(ghost.style, { position: 'fixed', top: '-1000px', left: '-1000px', pointerEvents: 'none' })
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, size / 2, size / 2)
    setTimeout(() => ghost.remove(), 0)
  }
  const addAtCenter = (kind: Kind) => {
    const r = svgRef.current!.getBoundingClientRect()
    const [x, y] = toWorld(r.left + r.width / 2, r.top + r.height / 2)
    addElement(kind, x + (dg.els.length % 5) * GRID, y + (dg.els.length % 5) * GRID)
  }

  // ---- geometria das ligações
  const portPos = (ref: PortRef): [number, number] | null => {
    const e = elById.get(ref[0])
    return e ? worldPorts(e)[ref[1]] ?? null : null
  }
  /** Extremo `b` da ligação no desenho: terminal, ou o ponto da derivação sobre o trecho da ligação-alvo. */
  const wireB = (w: Diagram['wires'][number], depth = 0): Pt | null => {
    if (!w.tap) return portPos(w.b)
    const tw = dg.wires.find((x) => x.id === w.tap!.w)
    if (!tw || depth > 4) return null
    const a = portPos(tw.a)
    const b = wireB(tw, depth + 1)
    if (!a || !b) return null
    return nearestOnPath(wirePath(a, b, tw.via), w.tap.x, w.tap.y).pt
  }
  /** Liga o terminal `from` a um trecho da ligação `target` (derivação) perto do ponto (wx, wy). */
  const tapConnect = (from: PortRef, target: Diagram['wires'][number], wx: number, wy: number) => {
    if (from[0] === target.a[0] || from[0] === target.b[0]) return
    const a = portPos(target.a)
    const b = wireB(target)
    if (!a || !b) return
    const path = wirePath(a, b, target.via)
    let pt = nearestOnPath(path, wx, wy).pt
    const fp = portPos(from)
    if (fp) {                                                // se possível, a derivação sai em linha reta do terminal
      for (const c of [[fp[0], pt[1]], [pt[0], fp[1]]] as Pt[]) {
        const n = nearestOnPath(path, c[0], c[1])
        if (n.d < 0.5 && Math.hypot(n.pt[0] - pt[0], n.pt[1] - pt[1]) < 100) { pt = n.pt; break }
      }
    }
    setDg((d) => ({ ...d, wires: [...d.wires, { id: d.nextId, a: from, b: target.a, tap: { w: target.id, x: pt[0], y: pt[1] } }], nextId: d.nextId + 1 }))
  }
  const pathD = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')
  const route = (a: [number, number], b: [number, number]) => pathD(routePoints(a, b))

  const selIds = useMemo(() => new Set(sel?.type === 'el' ? sel.ids : []), [sel])
  const selEl = sel?.type === 'el' && sel.ids.length === 1 ? elById.get(sel.ids[0]) : undefined
  const multi = sel?.type === 'el' && sel.ids.length > 1
  const selRes = selEl ? sol.res.get(selEl.id) : undefined
  /** Linha à qual a Falta selecionada está ligada (pelo ponto central da linha), seguindo as ligações. */
  const faultLine = useMemo(() => {
    if (selEl?.kind !== 'fault') return null
    const parent = new Map<string, string>()
    const find = (x: string): string => { let p = parent.get(x) ?? x; while ((parent.get(p) ?? p) !== p) p = parent.get(p) ?? p; parent.set(x, p); return p }
    for (const w of dg.wires) parent.set(find(`${w.a[0]}:${w.a[1]}`), find(`${w.b[0]}:${w.b[1]}`))
    const mine = find(`${selEl.id}:0`)
    return dg.els.find((x) => x.kind === 'line' && find(`${x.id}:2`) === mine) ?? null
  }, [dg, selEl])
  const fitView = () => setView({ tx: 40, ty: 40, k: 1 })
  const clearAll = () => {
    if (dg.els.length === 0 || window.confirm('Apagar todo o diagrama?')) { setDg(emptyDiagram()); setSel(null); setWiring(null) }
  }

  const wiringPos = wiring ? portPos(wiring) : null

  /** Exporta o diagrama e as configurações para um arquivo JSON. */
  const exportJson = () => {
    const payload = {
      format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      settings: { sbase: cfg.sbase, pu: cfg.pu },
      diagram: { els: dg.els, wires: dg.wires, nextId: dg.nextId },
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `systemlab-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setIoMsg({ ok: true, text: `Exportado: ${dg.els.length} elementos, ${dg.wires.length} ligações.` })
  }
  /** Importa um JSON exportado: substitui o diagrama (e as configurações, se vierem no arquivo). */
  const importJson = async (file: File) => {
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Arquivo maior que 20 MB.')
      const { diagram, settings } = parseImport(await file.text())
      if (dg.els.length > 0 && !window.confirm(`Substituir o diagrama atual (${dg.els.length} elementos) pelo arquivo "${file.name}" (${diagram.els.length} elementos)?`)) return
      setDg(diagram)
      setSel(null)
      setWiring(null)
      if (settings) saveCfg(settings)
      setIoMsg({ ok: true, text: `Importado: ${diagram.els.length} elementos, ${diagram.wires.length} ligações.` })
    } catch (e) {
      setIoMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }
  const commLines = (el: El): string[] => {
    const s = sessions.find((x) => x.id === el.sid)
    if (!el.sid) return ['sem relé associado']
    if (!s) return ['relé encerrado']
    const L = el.links ?? {}
    const nm = (id?: number) => (id != null ? elById.get(id)?.name : undefined)
    const lk = [nm(L.breaker), nm(L.tc), nm(L.tp)].filter(Boolean).join(' · ')
    return [(s.device || s.relay_id).slice(0, 28), s.ied ? `61850: ${s.ied}` : 'sem IED 61850', ...(lk ? [lk] : [])]
  }
  // IED selecionado: carrega os IEDs do projeto IEC61850 para a associação
  const selKind = sel?.type === 'el' && sel.ids.length === 1 ? elById.get(sel.ids[0])?.kind : undefined
  useEffect(() => {
    if (selKind === 'ied') api.iecProject().then((p) => setIecIeds(p.ieds.map((i) => i.name))).catch(() => setIecIeds([]))
  }, [selKind])
  const pickRelay = (elId: number, sid: string) => {
    const s = sessions.find((x) => x.id === sid)
    setDg((d) => ({
      ...d,
      els: d.els.map((e) => (e.id === elId ? { ...e, sid: sid || undefined, rname: s ? (s.device || s.relay_id) : undefined }
        : sid && e.kind === 'ied' && e.sid === sid ? { ...e, sid: undefined, rname: undefined } : e)),   // um relé só em um IED
    }))
  }
  const pickIec = (sid: string, ied: string) => api.iecBind(sid, ied || null).then(() => api.sessions().then(setSessions)).catch(() => undefined)
  const setHide = (hide: boolean) => setDg((d) => ({ ...d, els: d.els.map((e) => (selIds.has(e.id) ? { ...e, hide } : e)) }))

  return (
    <div className="sl" style={{ ['--sl-l' as string]: panels.tools ? '180px' : '34px', ['--sl-r' as string]: panels.side ? '330px' : '34px' }}>
      {/* ---------------------------------------------------------- toolbox */}
      <aside className={`sl-tools ${panels.tools ? '' : 'collapsed'}`}>
        <button className="sl-collapse" onClick={() => togglePanel('tools')} title={panels.tools ? 'Recolher elementos' : 'Expandir elementos'} aria-expanded={panels.tools}>
          {panels.tools ? '◀' : '▶'}
        </button>
        {!panels.tools && <span className="sl-vlabel">Elementos</span>}
        {panels.tools && <><h3>Elementos</h3>
        {KIND_ORDER.map((k) => (
          <div
            key={k}
            className="sl-tool"
            draggable
            onDragStart={(e) => startToolDrag(e, k)}
            onDoubleClick={() => addAtCenter(k)}
            title="Arraste para o diagrama (ou dê duplo clique)"
          >
            <svg viewBox={k === 'transformer3' ? "-66 -66 132 132" : "-48 -48 96 96"} width={44} height={44} aria-hidden>
              <g transform={k === 'tp' ? 'translate(0 8)' : undefined}>
                <SymbolShape kind={k} color="var(--ink)" cells={4} />
              </g>
            </svg>
            <span>{KINDS[k].label}</span>
          </div>
        ))}
        </>}
      </aside>

      {/* ---------------------------------------------------------- canvas */}
      <section className="sl-main">
        <div className="sl-bar">
          <div className="sl-run">
            {run === 'playing'
              ? <button className="primary" onClick={pause} title="Pausa o tempo e os relés associados">⏸ Pause</button>
              : <button className="primary" onClick={play} title="Liga as fontes e executa a simulação">▶ Play</button>}
            <button onClick={stop} disabled={run === 'stopped'} title="Desliga as fontes e zera o tempo">⏹ Parar</button>
            <label className="speed">Velocidade
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {[0.5, 1, 2, 5, 10].map((v) => <option key={v} value={v}>{v}×</option>)}
              </select>
            </label>
            <span className="clock" title="Tempo simulado">{simTime(prefs, simT)}</span>
            <span className={`chip-state ${run === 'playing' ? 'bk-closed' : ''}`}>{run === 'playing' ? 'EM EXECUÇÃO' : run === 'paused' ? 'PAUSADO' : 'PARADO'}</span>
          </div>
          <button onClick={() => setDg(example())}>Carregar exemplo</button>
          <button onClick={clearAll}>Limpar tudo</button>
          <button onClick={fitView}>Centralizar vista</button>
          <label className="check"><input type="checkbox" checked={showVals} onChange={(e) => setShowVals(e.target.checked)} /> Mostrar valores</label>
          <span className="spacer" />
          <button className="sl-gear" onClick={() => setShowCfg(true)} title="Configurações do SystemLab" aria-label="Configurações">⚙</button>
          <span className="muted">{Math.round(view.k * 100)}% · {dg.els.length} elementos · {dg.wires.length} ligações</span>
        </div>
        <svg
          ref={svgRef}
          className={`sl-svg ${wiring ? 'wiring' : ''}`}
          onPointerDown={onBgDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onContextMenu={(e) => {
            e.preventDefault()
            if (panMoved.current) { panMoved.current = false; return }                  // arrastou com o botão direito: foi um deslocamento da vista
            const [wx, wy] = toWorld(e.clientX, e.clientY)
            const idAttr = (e.target as Element).closest('[data-elid]')?.getAttribute('data-elid')
            const elId = idAttr != null ? Number(idAttr) : undefined
            if (elId != null && !(sel?.type === 'el' && sel.ids.includes(elId))) setSel({ type: 'el', ids: [elId] })
            setCtx({ x: e.clientX, y: e.clientY, wx, wy, elId })
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
          onDrop={onDrop}
        >
          <defs>
            <pattern id="sl-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
              <circle cx={0} cy={0} r={0.9} fill="var(--line)" />
            </pattern>
          </defs>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            <rect x={-4000} y={-4000} width={8000} height={8000} fill="url(#sl-grid)" pointerEvents="none" />

            {/* ligações */}
            {dg.wires.map((w) => {
              const a = portPos(w.a)
              const b = wireB(w)
              if (!a || !b) return null
              const on = sol.nodeEnergized.get(`${w.a[0]}:${w.a[1]}`)
              const commWire = isComm(elById.get(w.a[0])?.kind ?? 'bus') || isComm(elById.get(w.b[0])?.kind ?? 'bus')
              const path = wirePath(a, b, w.via)
              const d = pathD(path)
              const selected = sel?.type === 'wire' && sel.id === w.id
              return (
                <g key={w.id}>
                  <path d={d} fill="none" stroke={selected ? 'var(--accent-2)' : commWire ? 'var(--accent-2)' : on ? 'var(--accent)' : 'var(--muted)'} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" strokeDasharray={commWire ? '6 4' : undefined} />
                  <path
                    d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'grab' }}
                    data-wire={w.id}
                    onPointerDown={(e) => onWireDown(e, w)}
                    onDoubleClick={() => resetWire(w.id)}
                  />
                  {w.tap && <circle cx={b[0]} cy={b[1]} r={4} fill={on ? 'var(--accent)' : 'var(--muted)'} pointerEvents="none" />}
                  {selected && path.slice(0, -1).map(([x1, y1], i) => (
                    <rect key={i} x={(x1 + path[i + 1][0]) / 2 - 4} y={(y1 + path[i + 1][1]) / 2 - 4} width={8} height={8} rx={2}
                      fill="var(--accent-2)" stroke="var(--panel)" pointerEvents="none" />
                  ))}
                </g>
              )
            })}

            {/* elementos */}
            {dg.els.map((el) => {
              const r = sol.res.get(el.id)
              const on = el.kind === 'source' || !!r?.energized
              const color = isComm(el.kind) ? 'var(--accent-2)' : on ? 'var(--accent)' : 'var(--muted)'
              const dragging = dragIds.includes(el.id)
              const selected = selIds.has(el.id) && !dragging
              const [hx, hy, hw, hh] = hitRect(el)
              const ports = worldPorts(el)
              const showPorts = !dragging && (!(isBar(el.kind) || el.kind === 'ied') || wiring != null || selected || hover === el.id)
              const vertBus = isBar(el.kind) && el.rot % 2 === 1
              const lab: [number, number] = isBar(el.kind)
                ? (vertBus ? [el.x + 16, el.y - busCells(el) * 10 - 6] : [el.x, el.y + 26])
                : el.kind === 'fault' ? [el.x + 84, el.y - 12] : [el.x, el.y + (el.kind === 'ied' ? 46 : el.kind === 'transformer3' ? 66 : 40)]
              const hidden = !!el.hide
              const lines = showVals && !dragging && !hidden ? (isComm(el.kind) ? commLines(el) : valueLines(el, r)) : []
              return (
                <g key={el.id} data-elid={el.id} onMouseEnter={() => setHover(el.id)} onMouseLeave={() => setHover((h) => (h === el.id ? null : h))}>
                  <g
                    transform={`translate(${el.x} ${el.y}) rotate(${el.rot * 90})`}
                    onPointerDown={(e) => onElDown(e, el)}
                    onDoubleClick={() => (el.kind === 'breaker' || el.kind === 'switch') && updateEl(el.id, (x) => ({ ...x, p: { ...x.p, closed: !flag(x, 'closed') } }))}
                    style={{ cursor: 'move' }}
                  >
                    <rect x={hx} y={hy} width={hw} height={hh} fill="transparent" stroke={selected ? 'var(--accent-2)' : 'none'} strokeDasharray="4 3" rx={4} />
                    <ElementSymbol el={el} color={color} />
                  </g>
                  {!dragging && !hidden && <text x={lab[0]} y={lab[1]} textAnchor={vertBus ? 'start' : 'middle'} className="sl-name" fill="var(--ink)" pointerEvents="none">{el.name}</text>}
                  {lines.map((t, i) => (
                    <text key={i} x={lab[0]} y={lab[1] + 12 * (i + 1)} textAnchor={vertBus ? 'start' : 'middle'} className="sl-val" fill={on ? 'var(--accent-2)' : 'var(--muted)'} pointerEvents="none">{t}</text>
                  ))}
                  {ports.map(([px, py], k) => (
                    <g key={k}>
                      {showPorts && <circle cx={px} cy={py} r={isBar(el.kind) ? 2.8 : 3.8} fill="var(--panel)" stroke="var(--accent-2)" strokeWidth={1.5} pointerEvents="none" />}
                      <circle cx={px} cy={py} r={9} fill="transparent" data-port={`${el.id}:${k}`} style={{ cursor: 'crosshair' }} onPointerDown={(e) => onPortDown(e, [el.id, k])} />
                    </g>
                  ))}
                  {isBar(el.kind) && selected && selIds.size === 1 && !dragging && (['lo', 'hi'] as const).map((side) => {
                    const [hxp, hyp] = side === 'lo' ? ports[0] : ports[ports.length - 1]
                    const [ux, uy] = rotate(1, 0, el.rot)
                    const o = side === 'lo' ? -9 : 9
                    return (
                      <g key={side} style={{ cursor: vertBus ? 'ns-resize' : 'ew-resize' }} onPointerDown={(e) => onBusEndDown(e, el, side)}>
                        <title>Arraste para aumentar ou diminuir o barramento</title>
                        <rect x={hxp + ux * o - 6} y={hyp + uy * o - 6} width={12} height={12} rx={3} fill="var(--accent-2)" stroke="var(--panel)" strokeWidth={1.5} />
                      </g>
                    )
                  })}
                </g>
              )
            })}

            {/* retângulo de seleção */}
            {box && (
              <rect x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)}
                fill="var(--accent)" fillOpacity={0.12} stroke="var(--accent)" strokeDasharray="4 3" pointerEvents="none" />
            )}

            {/* ligação em andamento */}
            {wiringPos && <path d={route(wiringPos, [snap(mouse[0]), snap(mouse[1])])} fill="none" stroke="var(--accent-2)" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />}
          </g>
        </svg>
        {ctx && (
          <div className="sl-ctx" style={{ left: ctx.x, top: ctx.y }} role="menu">
            {ctx.elId != null && <button role="menuitem" onClick={() => { copySel(ctx.elId); setCtx(null) }}>⧉ Copiar <small>Ctrl+C</small></button>}
            <button role="menuitem" disabled={!hasClip} onClick={() => { pasteClip([ctx.wx, ctx.wy]); setCtx(null) }}>📋 Colar{ctx.elId == null ? ' aqui' : ''} <small>Ctrl+V</small></button>
          </div>
        )}
        {showCfg && (
          <div className="sl-modal" onPointerDown={(e) => { if (e.target === e.currentTarget) setShowCfg(false) }}>
            <div className="sl-modal-card" role="dialog" aria-label="Configurações">
              <div className="row"><h3>⚙ Configurações</h3><span className="spacer" /><button onClick={() => setShowCfg(false)}>Fechar</button></div>
              <label className="sl-field">
                <span>Potência de base (Sbase)</span>
                <span><NumInput key={`sb-${cfg.sbase}`} value={cfg.sbase} onChange={(n) => saveCfg({ ...cfg, sbase: n > 0 ? n : DEFAULT_SBASE })} /> MVA</span>
              </label>
              <label className="sl-field">
                <span>Exibir grandezas em pu</span>
                <input type="checkbox" checked={cfg.pu} onChange={(e) => saveCfg({ ...cfg, pu: e.target.checked })} />
              </label>
              <div className="row"><button onClick={() => saveCfg({ ...cfg, sbase: DEFAULT_SBASE })} disabled={cfg.sbase === DEFAULT_SBASE}>Restaurar {DEFAULT_SBASE} MVA</button></div>
              <div className="sl-actions">
                <h4>Dados da simulação</h4>
                <div className="row">
                  <button onClick={exportJson} title="Baixa um arquivo JSON com o diagrama (elementos, ligações, atalhos) e as configurações">⬇ Exportar JSON</button>
                  <button onClick={() => fileRef.current?.click()} title="Substitui o diagrama atual pelo conteúdo de um JSON exportado">⬆ Importar JSON</button>
                  <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f) }} />
                </div>
                {ioMsg && <p className={`hint ${ioMsg.ok ? '' : 'warn'}`}>{ioMsg.text}</p>}
              </div>
            </div>
          </div>
        )}
        {dg.els.filter((x) => x.kind === 'ied' && x.sid && (x.sc?.length ?? 0) > 0).map((x) => (
          <ShortcutPanel key={x.id} el={x}
            onMove={(px, py) => updateEl(x.id, (y) => ({ ...y, scPos: { x: px, y: py } }))}
            onToggle={(o) => updateEl(x.id, (y) => ({ ...y, scOpen: o }))} />
        ))}
        {dg.els.length === 0 && <div className="sl-empty">Arraste elementos da barra à esquerda para começar<br /><small>ou use “Carregar exemplo” e pressione Play</small></div>}
      </section>

      {/* ---------------------------------------------------------- propriedades */}
      <aside className={`sl-side ${panels.side ? '' : 'collapsed'}`}>
        <button className="sl-collapse" onClick={() => togglePanel('side')} title={panels.side ? 'Recolher propriedades' : 'Expandir propriedades'} aria-expanded={panels.side}>
          {panels.side ? '▶' : '◀'}
        </button>
        {!panels.side ? <span className="sl-vlabel">Propriedades e resultados</span> : selEl ? (
          <>
            <h3>{KINDS[selEl.kind].label}</h3>
            <label className="sl-field">
              <span>Nome</span>
              <input type="text" className="numinput" value={selEl.name} onChange={(e) => updateEl(selEl.id, (x) => ({ ...x, name: e.target.value }))} />
            </label>
            {KINDS[selEl.kind].fields.filter((f) => !(f.key === 'closed' && (selEl.kind === 'breaker' || selEl.kind === 'switch'))).map((f) => (
              <label key={f.key} className="sl-field">
                <span>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
                {f.type === 'bool' ? (
                  <input type="checkbox" checked={flag(selEl, f.key)} onChange={(e) => updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, [f.key]: e.target.checked } }))} />
                ) : f.type === 'select' ? (
                  <select className="numinput" value={num(selEl, f.key)} onChange={(e) => updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, [f.key]: Number(e.target.value) } }))}>
                    {f.options!.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                ) : (
                  <NumInput key={`${selEl.id}-${f.key}`} value={num(selEl, f.key)} onChange={(n) => (isBar(selEl.kind) && f.key === 'cells'
                    ? setDg((g) => resizeBus(g, selEl.id, n, 'hi'))
                    : updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, [f.key]: f.min != null ? Math.max(f.min, n) : n } })))} />
                )}
              </label>
            ))}
            {selEl.kind === 'fault' && faultLine && (
              <>
                <label className="sl-field">
                  <span>Linha conectada</span>
                  <b>{faultLine.name}</b>
                </label>
                <label className="sl-field">
                  <span>Posição na linha (0–100 %, a partir do terminal 1)</span>
                  <NumInput key={`${selEl.id}-pos`} value={num(selEl, 'pos')} onChange={(n) => updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, pos: Math.min(100, Math.max(0, n)) } }))} />
                </label>
              </>
            )}
            {selEl.kind === 'ied' && (
              <>
                <label className="sl-field">
                  <span>Relé do DigitalRelay</span>
                  <select className="numinput" value={selEl.sid ?? ''} onChange={(e) => pickRelay(selEl.id, e.target.value)}>
                    <option value="">— nenhum —</option>
                    {selEl.sid && !sessions.some((x) => x.id === selEl.sid) && <option value={selEl.sid}>{selEl.rname ?? selEl.sid} (encerrado)</option>}
                    {sessions.map((x) => <option key={x.id} value={x.id}>{(x.device || x.relay_id).slice(0, 40)}</option>)}
                  </select>
                </label>
                {selEl.sid && sessions.some((x) => x.id === selEl.sid) && (
                  <label className="sl-field">
                    <span>IED do projeto IEC61850</span>
                    <select className="numinput" value={sessions.find((x) => x.id === selEl.sid)?.ied ?? ''} onChange={(e) => pickIec(selEl.sid!, e.target.value)}>
                      <option value="">— nenhum —</option>
                      {iecIeds.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
                {selEl.sid && (
                  <>
                    {([['breaker', 'Disjuntor monitorado', 'breaker'], ['tc', 'TC (correntes)', 'tc'], ['tp', 'TP (tensões)', 'tp']] as const).map(([key, label, kind]) => (
                      <label className="sl-field" key={key}>
                        <span>{label}</span>
                        <select className="numinput" value={selEl.links?.[key] ?? ''}
                          onChange={(e) => updateEl(selEl.id, (x) => ({ ...x, links: { ...x.links, [key]: e.target.value === '' ? undefined : Number(e.target.value) } }))}>
                          <option value="">— nenhum —</option>
                          {dg.els.filter((x) => x.kind === kind).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </label>
                    ))}
                  </>
                )}
                {selEl.sid && sessions.some((x) => x.id === selEl.sid) && <ShortcutEditor key={selEl.id} el={selEl} onChange={(f) => updateEl(selEl.id, f)} />}
                {sessions.length === 0 && <p className="hint">Nenhum relé ativo. Abra o DigitalRelay, carregue um .rdb e crie o relé; ele aparece aqui.</p>}
                <p className="hint">Os IEDs associados a relés do mesmo projeto IEC61850 (aba IEC 61850 do DigitalRelay / app IEC61850) se comunicam por GOOSE automaticamente.</p>
              </>
            )}
            <Results el={selEl} r={selRes} />
            <FaultPanel el={selEl} study={study?.fault ?? null} hasFault={hasFault} />
            <div className="sl-actions">
              <h4>Ações</h4>
              <div className="row">
                {(selEl.kind === 'breaker' || selEl.kind === 'switch') && (
                  <button className="primary" onClick={() => updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, closed: !flag(x, 'closed') } }))} title="Abre ou fecha (também por duplo clique no símbolo)"><span className="ic"><SwitchIcon closed={!flag(selEl, 'closed')} /></span><span>{flag(selEl, 'closed') ? 'Abrir' : 'Fechar'}</span></button>
                )}
                <button onClick={() => updateEl(selEl.id, (x) => ({ ...x, hide: !x.hide }))} title="Mostra ou oculta o nome e os dados deste elemento no diagrama"><span className="ic"><EyeIcon off={!selEl.hide} /></span><span>{selEl.hide ? 'Mostrar dados' : 'Ocultar dados'}</span></button>
                <button onClick={rotateSel}><span className="ic">↻</span><span>Girar (R)</span></button>
                <button className="danger" onClick={removeSel}><span className="ic"><TrashIcon /></span><span>Excluir</span></button>
              </div>
            </div>
          </>
        ) : multi ? (
          <>
            <h3>{selIds.size} elementos selecionados</h3>
            <p className="muted">{dg.els.filter((x) => selIds.has(x.id)).map((x) => x.name).join(', ')}</p>
            <p className="hint">Arraste um deles para mover o grupo. As ligações entre os selecionados acompanham.</p>
            <div className="row wrap">
              <button onClick={() => setHide(true)}>Ocultar nomes e dados</button>
              <button onClick={() => setHide(false)}>Mostrar nomes e dados</button>
            </div>
            <div className="row">
              <button onClick={rotateSel}>↻ Girar cada um (R)</button>
              <button className="danger" onClick={removeSel}>Excluir {selIds.size}</button>
            </div>
          </>
        ) : sel?.type === 'wire' ? (
          <>
            <h3>Ligação</h3>
            <p className="muted">{(() => {
              const w = dg.wires.find((x) => x.id === sel.id)
              return w ? `${elById.get(w.a[0])?.name} ↔ ${elById.get(w.b[0])?.name}` : ''
            })()}</p>
            <p className="hint">Arraste um trecho da ligação (marcado por quadradinhos) para reorganizar o desenho. Duplo clique volta ao trajeto automático.</p>
            <div className="row">
              {dg.wires.find((x) => x.id === sel.id)?.via?.length ? <button onClick={() => resetWire(sel.id)}>Trajeto automático</button> : null}
              <button className="danger" onClick={removeSel}>Excluir ligação</button>
            </div>
          </>
        ) : (
          <Summary dg={dg} sol={sol} onSelect={(id) => setSel({ type: 'el', ids: [id] })} />
        )}
      </aside>
    </div>
  )
}

// ------------------------------------------------------------------ painéis
const SET_ROWS: { k: keyof PhasorSet; l: string }[] = [
  { k: 'a', l: 'Fase A' }, { k: 'b', l: 'Fase B' }, { k: 'c', l: 'Fase C' },
  { k: 's1', l: 'Seq. + (1)' }, { k: 's2', l: 'Seq. − (2)' }, { k: 's0', l: 'Seq. 0' },
]

/** Estudo de falta do elemento selecionado: tensões (fase-neutro) e correntes por fase e por componente de sequência. */
function FaultPanel({ el, study, hasFault }: { el: El; study: FaultStudy | null; hasFault: boolean }) {
  if (el.kind === 'fault' && !hasFault) return <p className="hint">Marque “Falta aplicada” para calcular a falta. Ligue o terminal da falta ao ponto desejado (barramento, terminal de qualquer elemento).</p>
  if (!hasFault) return null
  if (!study) return el.kind === 'fault' ? <p className="hint warn">A falta não está ligada a um ponto energizado (verifique a ligação e se há fonte fechada até ele).</p> : null
  const terms = study.terms.get(el.id)
  if (!terms) return null
  const isF = el.kind === 'fault' && el.id === study.info.elId
  const tag = (k: number) => (el.kind === 'bus' || terms.length === 1 ? '' : ` – terminal ${k + 1}`)
  return (
    <div className="sl-results">
      <h4>Em falta ({study.info.label}{study.info.line ? ` a ${fmt(study.info.line.pos, 1)}% de ${study.info.line.name}` : ''}{study.info.rf > 0 ? `, Rf = ${fmt(study.info.rf, 2)} Ω` : ''})</h4>
      {study.warns.map((w) => <p key={w} className="hint warn">⚠ {w}</p>)}
      {isF && (
        <p className="hint">
          Impedâncias de Thévenin no ponto: Z1 = {fmt(study.info.z1.mag, 3)} Ω ∠{fmt(study.info.z1.ang, 1)}° · Z2 = {fmt(study.info.z2.mag, 3)} Ω ∠{fmt(study.info.z2.ang, 1)}° ·
          Z0 = {study.info.z0 ? `${fmt(study.info.z0.mag, 3)} Ω ∠${fmt(study.info.z0.ang, 1)}°` : '∞ (sem aterramento)'}
        </p>
      )}
      {terms.map((t, k) => (
        <table key={k} className="tbl meas">
          <thead><tr><th>{`Fase / seq.${tag(k)}`}</th><th>{DISP.pu ? 'Tensão (pu, fase-neutro)' : 'Tensão (kV, fase-neutro)'}</th><th>{DISP.pu ? 'Corrente (pu)' : 'Corrente (A)'}</th></tr></thead>
          <tbody>
            {SET_ROWS.map((row) => (
              <tr key={row.k}>
                <td>{row.l}</td>
                <td className="num">{fV(t.v[row.k], t.kvb, 3, true)}</td>
                <td className="num">{el.kind === 'bus' || el.kind === 'tp' ? '–' : fI(t.i[row.k], t.kvb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <p className="hint">Componentes de sequência no ponto de cada terminal (valor da componente, não 3×). A defasagem do transformador vem do esquema de ligação (ex.: Dyn1: terminal 2 atrasa 30°). Corrente positiva entrando no elemento (fonte: entregue). O resultado vale sem simular: ligue as fontes na simulação para ver estas grandezas no diagrama e injetadas nos relés.</p>
    </div>
  )
}

function Results({ el, r }: { el: El; r: ElResult | undefined }) {
  if (!r || el.kind === 'fault' || (el.kind === 'switch' && !r.note)) return null
  if (r.extra.dc) {
    return (
      <div className="sl-results">
        <h4>Resultados</h4>
        <table className="tbl meas">
          <tbody>
            <tr><td>Estado</td><td className="num">Energizado (circuito CC)</td></tr>
            {r.note && <tr><td>Aviso</td><td className="num">{r.note}</td></tr>}
            <tr><td>Tensão CC</td><td className="num">{fmt(r.extra.vdc, 0)} V</td></tr>
            <tr><td>Corrente CC (+ descarga)</td><td className="num">{fmt(r.extra.idc, 1)} A</td></tr>
            <tr><td>Potência CC</td><td className="num">{fP(r.extra.pdc, 3)}</td></tr>
          </tbody>
        </table>
      </div>
    )
  }
  if (el.kind === 'battery') {
    const h = r.extra.hours
    return (
      <div className="sl-results">
        <h4>Resultados</h4>
        <table className="tbl meas">
          <tbody>
            <tr><td>Estado</td><td className="num">{r.note}</td></tr>
            <tr><td>SOC</td><td className="num">{fmt(r.extra.soc, 1)} %</td></tr>
            <tr><td>Energia armazenada</td><td className="num">{fmt(r.extra.energy, 0)} kWh</td></tr>
            <tr><td>Potência CC (+ descarga)</td><td className="num">{fP(r.extra.pdc, 3)}</td></tr>
            <tr><td>Corrente CC</td><td className="num">{fmt(r.extra.idc, 1)} A</td></tr>
            <tr><td>Tempo até o limite de SOC</td><td className="num">{h < 0 ? '–' : `${fmt(h, 2)} h`}</td></tr>
          </tbody>
        </table>
        <p className="hint">O SOC é um parâmetro (a simulação é de regime permanente, sem evolução no tempo).</p>
      </div>
    )
  }
  if (el.kind === 'inverter') {
    return (
      <div className="sl-results">
        <h4>Resultados</h4>
        <table className="tbl meas">
          <tbody>
            <tr><td>Estado</td><td className="num">{r.note || '–'}</td></tr>
            <tr><td>P CA (+ injeta na rede)</td><td className="num">{fP(r.extra.p, 3)}</td></tr>
            <tr><td>Q CA (+ injeta)</td><td className="num">{fQ(r.extra.q, 3)}</td></tr>
            <tr><td>Carregamento</td><td className="num">{fmt(r.extra.loading, 1)} %</td></tr>
            <tr><td>Potência CC (+ descarga)</td><td className="num">{fP(r.extra.pdc, 3)}</td></tr>
            <tr><td>Tensão CA</td><td className="num">{fV(r.v[1], r.kvb?.[1])}</td></tr>
            <tr><td>Corrente CA</td><td className="num">{fI(r.i[1], r.kvb?.[1])}</td></tr>
          </tbody>
        </table>
        <p className="hint">Com fonte na rede o inversor segue a rede (P/Q constantes, limitados pela potência nominal e pelo SOC). Sem fonte, ele forma a rede (ilhado) e fornece o que a carga consome. O modo (Automático, Seguidor ou Formador de rede) é escolhido nas propriedades: vários formadores na mesma ilha dividem a carga em paralelo.</p>
      </div>
    )
  }
  return (
    <div className="sl-results">
      <h4>Resultados</h4>
      {r.note && (el.kind === 'breaker' || el.kind === 'switch') && <p className="hint warn">⚠ {r.note}. Ajuste "Circuito CC" nas propriedades.</p>}
      {r.note && (el.kind === 'transformer' || el.kind === 'transformer3') && <p className="hint warn">⚠ {r.note}</p>}
      <table className="tbl meas">
        <thead><tr><th>Terminal</th><th>Tensão</th><th>Corrente</th><th>{DISP.pu ? 'P (pu)' : 'P (MW)'}</th><th>{DISP.pu ? 'Q (pu)' : 'Q (Mvar)'}</th></tr></thead>
        <tbody>
          {r.v.map((v, k) => (
            <tr key={k}>
              <td>{el.kind === 'bus' ? '–' : k + 1}</td>
              <td className="num">{fV(v, r.kvb?.[k])}</td>
              <td className="num">{r.i[k] ? fI(r.i[k], r.kvb?.[k]) : '–'}</td>
              <td className="num">{r.p[k] != null ? fmt(DISP.pu ? r.p[k] / DISP.sbase : r.p[k], DISP.pu ? 4 : 2) : '–'}</td>
              <td className="num">{r.q[k] != null ? fmt(DISP.pu ? r.q[k] / DISP.sbase : r.q[k], DISP.pu ? 4 : 2) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {el.kind === 'tp' && <p className="hint">Tensão secundária: <b>{fmt(r.extra.vsec, 2)} V</b> (relação {fmt(r.extra.ratio, 1)}:1)</p>}
      {el.kind === 'transformer3' && <p className="hint">Terminais: 1 = P (primário), 2 = S (secundário), 3 = T (terciário). Carregamento de P: <b>{fmt(r.extra.loading, 1)} %</b> · perdas: <b>{fP(r.extra.loss, 3)}</b></p>}
      {el.kind === 'line' && <p className="hint">Impedância total (seq. +): <b>{fmt(r.extra.rt, 3)} + j{fmt(r.extra.xt, 3)} Ω</b> · comprimento {fmt(r.extra.len, 1)} km · perdas {fP(r.extra.loss, 3)}</p>}
      {el.kind === 'tc' && <p className="hint">Corrente secundária: <b>{fmt(r.extra.isec, 3)} A</b> (relação {fmt(r.extra.ratio, 1)}:1)</p>}
      {el.kind === 'transformer' && <p className="hint">Carregamento: <b>{fmt(r.extra.loading, 1)} %</b> · perdas: <b>{fP(r.extra.loss, 3)}</b></p>}
      <p className="hint">Em elementos de dois terminais, as grandezas são positivas entrando no elemento; o fluxo 1→2 é a P do terminal 1.</p>
    </div>
  )
}

function Summary({ dg, sol, onSelect }: { dg: Diagram; sol: ReturnType<typeof solve>; onSelect: (id: number) => void }) {
  const rows = (kind: Kind) => dg.els.filter((e) => e.kind === kind)
  const t = sol.totals
  return (
    <>
      <h3>Resumo do sistema</h3>
      {dg.els.length === 0 ? <p className="muted">Nenhum elemento ainda.</p> : (
        <>
          <table className="tbl meas">
            <tbody>
              <tr><td>Geração</td><td className="num">{fP(t.gen)} · {fQ(t.genQ)}</td></tr>
              <tr><td>Carga</td><td className="num">{fP(t.load)} · {fQ(t.loadQ)}</td></tr>
              <tr><td>Perdas (trafos)</td><td className="num">{fP(t.loss, 3)}</td></tr>
            </tbody>
          </table>
          {rows('bus').length > 0 && (
            <>
              <h4>Barramentos</h4>
              <table className="tbl meas">
                <tbody>
                  {rows('bus').map((e) => {
                    const r = sol.res.get(e.id)
                    return <tr key={e.id} className="sl-link" onClick={() => onSelect(e.id)}><td>{e.name}</td><td className="num">{r?.energized ? fV(r.v[0], r.kvb?.[0]) : '–'}</td></tr>
                  })}
                </tbody>
              </table>
            </>
          )}
          {rows('inverter').length > 0 && (
            <>
              <h4>Armazenamento (BESS)</h4>
              <table className="tbl meas">
                <tbody>
                  {rows('inverter').map((e) => {
                    const r = sol.res.get(e.id)
                    return <tr key={e.id} className="sl-link" onClick={() => onSelect(e.id)}><td>{e.name}</td><td className="num">{r?.energized ? `${fP(r.extra.p)} · ${fQ(r.extra.q)}` : (r?.note ?? 'inativo')}</td></tr>
                  })}
                  {rows('battery').map((e) => {
                    const r = sol.res.get(e.id)
                    return <tr key={e.id} className="sl-link" onClick={() => onSelect(e.id)}><td>{e.name}</td><td className="num">SOC {fmt(r?.extra.soc ?? num(e, 'soc'), 0)} % · {r?.note}</td></tr>
                  })}
                </tbody>
              </table>
            </>
          )}
          {(rows('tc').length > 0 || rows('tp').length > 0) && (
            <>
              <h4>Medição</h4>
              <table className="tbl meas">
                <tbody>
                  {rows('tc').map((e) => <tr key={e.id} className="sl-link" onClick={() => onSelect(e.id)}><td>{e.name}</td><td className="num">{valueLines(e, sol.res.get(e.id))[0]}</td></tr>)}
                  {rows('tp').map((e) => <tr key={e.id} className="sl-link" onClick={() => onSelect(e.id)}><td>{e.name}</td><td className="num">{valueLines(e, sol.res.get(e.id))[0]}</td></tr>)}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      <p className="hint">
        Modelo: regime permanente trifásico equilibrado (Sbase = {DISP.sbase} MVA). Fonte = tensão atrás da impedância de curto-circuito;
        carga = impedância constante na tensão nominal da zona; transformador = impedância série (sem derivação).
        Selecione um elemento para editar os parâmetros e ver os resultados.
      </p>
    </>
  )
}
