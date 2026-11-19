import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { simTime, usePrefs } from '../prefs'
import type { SessionBrief } from '../types'
import {
  BUS_MAX_CELLS, GRID, KINDS, KIND_ORDER, busCells, flag, hitRect, isBar, isComm, makeElement, num, rotate, worldPorts,
  type Diagram, type El, type Kind, type PortRef,
} from './model'
import { solve, type ElResult, type Ph } from './solver'
import { ElementSymbol, SymbolShape } from './symbols'

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

function emptyDiagram(): Diagram {
  return { els: [], wires: [], nextId: 1 }
}

function load(): Diagram {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (d && Array.isArray(d.els) && Array.isArray(d.wires) && typeof d.nextId === 'number') {
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
const ph = (p: Ph | undefined, unit: string, d = 2) => (p ? `${fmt(p.mag, d)} ${unit} ∠${fmt(p.ang, 1)}°` : '–')

function valueLines(el: El, r: ElResult | undefined): string[] {
  if (!r) return []
  switch (el.kind) {
    case 'ied': return []
    case 'battery': return [`SOC ${fmt(r.extra.soc, 0)}% · ${fmt(r.extra.pdc)} MW`, r.note ?? '']
    case 'inverter': return [r.energized ? `${fmt(r.extra.p)} MW · ${fmt(r.extra.q)} Mvar` : (r.note ?? 'inativo'), ...(r.energized && r.note ? [r.note] : [])]
    case 'bus': return [r.energized ? ph(r.v[0], 'kV') : 'desenergizado']
    case 'source': return [`${fmt(r.extra.p)} MW · ${fmt(r.extra.q)} Mvar`]
    case 'load': return r.energized ? [`${fmt(r.extra.p)} MW · ${fmt(r.extra.q)} Mvar`, `${fmt(r.v[0].mag)} kV`] : ['desenergizado']
    case 'breaker':
    case 'switch': {
      if (!flag(el, 'closed')) return ['aberto']
      const main = r.extra.dc ? `${fmt(r.extra.idc, 1)} A CC` : r.energized ? `${fmt(r.i[0].mag, 1)} A` : 'desenergizado'
      return r.note ? [main, `⚠ ${r.note}`] : [main]
    }
    case 'tc': if (r.extra.dc) return [`${fmt(r.extra.idc, 1)} A CC`]
      return [r.energized ? `${fmt(r.i[0].mag, 1)} A → ${fmt(r.extra.isec, 3)} A` : 'desenergizado']
    case 'transformer': return r.energized ? [`${fmt(r.p[0])} MW · ${fmt(r.extra.loading, 0)}%`] : ['desenergizado']
    case 'tp': return [r.energized ? `${fmt(r.extra.vsec, 1)} V` : 'desenergizado']
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
  const sol = useMemo(() => solve(dg.els, dg.wires, run !== 'stopped'), [dg, run])

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
        if (tc?.kind === 'tc') {
          const mag = r?.energized ? r.i[0].mag : 0
          const ang = r?.energized ? r.i[0].ang : 0
          Object.assign(patch, { ia_mag: mag, ib_mag: mag, ic_mag: mag, ia_ang: ang, ib_ang: ang - 120, ic_ang: ang + 120 })
        }
        const rv = tp?.kind === 'tp' ? sol.res.get(tp.id) : undefined
        if (tp?.kind === 'tp') {
          const mag = rv?.energized ? (rv.v[0].mag * 1000) / Math.sqrt(3) : 0
          const ang = rv?.energized ? rv.v[0].ang : 0
          Object.assign(patch, { va_mag: mag, vb_mag: mag, vc_mag: mag, va_ang: ang, vb_ang: ang - 120, vc_ang: ang + 120 })
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
      if (sel.type === 'wire') return { ...d, wires: d.wires.filter((w) => w.id !== sel.id) }
      const ids = new Set(sel.ids)
      return { ...d, els: d.els.filter((e) => !ids.has(e.id)), wires: d.wires.filter((w) => !ids.has(w.a[0]) && !ids.has(w.b[0])) }
    })
    setSel(null)
  }, [sel])

  const rotateSel = useCallback(() => {
    if (sel?.type !== 'el') return
    const ids = new Set(sel.ids)
    setDg((d) => ({ ...d, els: d.els.map((e) => (ids.has(e.id) ? { ...e, rot: (e.rot + 1) % 4 } : e)) }))
  }, [sel])

  // ---- teclado e roda do mouse
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Delete' || e.key === 'Backspace') removeSel()
      else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSel({ type: 'el', ids: dgRef.current.els.map((x) => x.id) })
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
  }, [removeSel, rotateSel])

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
    const a = portPos(w.a)
    const b = portPos(w.b)
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
    } else if (moved) setWiring(null)
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
      const b = portPos(w.b)
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
        wires: [...d.wires.filter((x) => x.id !== w.id), { id: id + 1, a: w.a, b: [id, near] }, { id: id + 2, a: [id, 1 - near], b: w.b }],
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
  const pathD = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')
  const route = (a: [number, number], b: [number, number]) => pathD(routePoints(a, b))

  const selIds = useMemo(() => new Set(sel?.type === 'el' ? sel.ids : []), [sel])
  const selEl = sel?.type === 'el' && sel.ids.length === 1 ? elById.get(sel.ids[0]) : undefined
  const multi = sel?.type === 'el' && sel.ids.length > 1
  const selRes = selEl ? sol.res.get(selEl.id) : undefined
  const fitView = () => setView({ tx: 40, ty: 40, k: 1 })
  const clearAll = () => {
    if (dg.els.length === 0 || window.confirm('Apagar todo o diagrama?')) { setDg(emptyDiagram()); setSel(null); setWiring(null) }
  }

  const wiringPos = wiring ? portPos(wiring) : null
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
            <svg viewBox="-48 -48 96 96" width={44} height={44} aria-hidden>
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
          <span className="muted">{Math.round(view.k * 100)}% · {dg.els.length} elementos · {dg.wires.length} ligações</span>
        </div>
        <svg
          ref={svgRef}
          className={`sl-svg ${wiring ? 'wiring' : ''}`}
          onPointerDown={onBgDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onContextMenu={(e) => e.preventDefault()}
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
              const b = portPos(w.b)
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
                    onPointerDown={(e) => onWireDown(e, w)}
                    onDoubleClick={() => resetWire(w.id)}
                  />
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
                : [el.x, el.y + (el.kind === 'ied' ? 46 : 40)]
              const hidden = !!el.hide
              const lines = showVals && !dragging && !hidden ? (isComm(el.kind) ? commLines(el) : valueLines(el, r)) : []
              return (
                <g key={el.id} onMouseEnter={() => setHover(el.id)} onMouseLeave={() => setHover((h) => (h === el.id ? null : h))}>
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
            {KINDS[selEl.kind].fields.map((f) => (
              <label key={f.key} className="sl-field">
                <span>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
                {f.type === 'bool' ? (
                  <input type="checkbox" checked={flag(selEl, f.key)} onChange={(e) => updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, [f.key]: e.target.checked } }))} />
                ) : (
                  <NumInput key={`${selEl.id}-${f.key}`} value={num(selEl, f.key)} onChange={(n) => (isBar(selEl.kind) && f.key === 'cells'
                    ? setDg((g) => resizeBus(g, selEl.id, n, 'hi'))
                    : updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, [f.key]: f.min != null ? Math.max(f.min, n) : n } })))} />
                )}
              </label>
            ))}
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
                    <p className="hint">O estado do <b>disjuntor</b> segue nos dois sentidos (a abertura pelo relé abre o disjuntor do diagrama). O <b>TC</b> fornece as correntes e o <b>TP</b> as tensões do relé (trifásico equilibrado, valores primários); a injeção analógica do relé é ligada.</p>
                  </>
                )}
                {sessions.length === 0 && <p className="hint">Nenhum relé ativo. Abra o DigitalRelay, carregue um .rdb e crie o relé; ele aparece aqui.</p>}
                <p className="hint">Os IEDs associados a relés do mesmo projeto IEC61850 (aba IEC 61850 do DigitalRelay / app IEC61850) se comunicam por GOOSE automaticamente.</p>
              </>
            )}
            <label className="sl-field">
              <span>Ocultar nome e dados no diagrama</span>
              <input type="checkbox" checked={!!selEl.hide} onChange={(e) => updateEl(selEl.id, (x) => ({ ...x, hide: e.target.checked }))} />
            </label>
            <div className="row">
              <button onClick={rotateSel}>↻ Girar (R)</button>
              <button className="danger" onClick={removeSel}>Excluir</button>
            </div>
            <Results el={selEl} r={selRes} />
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
function Results({ el, r }: { el: El; r: ElResult | undefined }) {
  if (!r || (el.kind === 'switch' && !r.note)) return null
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
            <tr><td>Potência CC</td><td className="num">{fmt(r.extra.pdc, 3)} MW</td></tr>
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
            <tr><td>Potência CC (+ descarga)</td><td className="num">{fmt(r.extra.pdc, 3)} MW</td></tr>
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
            <tr><td>P CA (+ injeta na rede)</td><td className="num">{fmt(r.extra.p, 3)} MW</td></tr>
            <tr><td>Q CA (+ injeta)</td><td className="num">{fmt(r.extra.q, 3)} Mvar</td></tr>
            <tr><td>Carregamento</td><td className="num">{fmt(r.extra.loading, 1)} %</td></tr>
            <tr><td>Potência CC (+ descarga)</td><td className="num">{fmt(r.extra.pdc, 3)} MW</td></tr>
            <tr><td>Tensão CA</td><td className="num">{ph(r.v[1], 'kV')}</td></tr>
            <tr><td>Corrente CA</td><td className="num">{ph(r.i[1], 'A', 1)}</td></tr>
          </tbody>
        </table>
        <p className="hint">Com fonte na rede o inversor segue a rede (P/Q constantes, limitados pela potência nominal e pelo SOC). Sem fonte, ele forma a rede (ilhado) e fornece o que a carga consome.</p>
      </div>
    )
  }
  return (
    <div className="sl-results">
      <h4>Resultados</h4>
      {r.note && (el.kind === 'breaker' || el.kind === 'switch') && <p className="hint warn">⚠ {r.note}. Ajuste "Circuito CC" nas propriedades.</p>}
      {!r.energized && el.kind !== 'source' && <p className="hint warn">Desenergizado (sem caminho fechado até uma fonte).</p>}
      <table className="tbl meas">
        <thead><tr><th>Terminal</th><th>Tensão</th><th>Corrente</th><th>P (MW)</th><th>Q (Mvar)</th></tr></thead>
        <tbody>
          {r.v.map((v, k) => (
            <tr key={k}>
              <td>{el.kind === 'bus' ? '–' : k + 1}</td>
              <td className="num">{ph(v, 'kV')}</td>
              <td className="num">{r.i[k] ? ph(r.i[k], 'A', 1) : '–'}</td>
              <td className="num">{r.p[k] != null ? fmt(r.p[k]) : '–'}</td>
              <td className="num">{r.q[k] != null ? fmt(r.q[k]) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {el.kind === 'tp' && <p className="hint">Tensão secundária: <b>{fmt(r.extra.vsec, 2)} V</b> (relação {fmt(r.extra.ratio, 1)}:1)</p>}
      {el.kind === 'tc' && <p className="hint">Corrente secundária: <b>{fmt(r.extra.isec, 3)} A</b> (relação {fmt(r.extra.ratio, 1)}:1)</p>}
      {el.kind === 'transformer' && <p className="hint">Carregamento: <b>{fmt(r.extra.loading, 1)} %</b> · perdas: <b>{fmt(r.extra.loss, 3)} MW</b></p>}
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
              <tr><td>Geração</td><td className="num">{fmt(t.gen)} MW · {fmt(t.genQ)} Mvar</td></tr>
              <tr><td>Carga</td><td className="num">{fmt(t.load)} MW · {fmt(t.loadQ)} Mvar</td></tr>
              <tr><td>Perdas (trafos)</td><td className="num">{fmt(t.loss, 3)} MW</td></tr>
            </tbody>
          </table>
          {rows('bus').length > 0 && (
            <>
              <h4>Barramentos</h4>
              <table className="tbl meas">
                <tbody>
                  {rows('bus').map((e) => {
                    const r = sol.res.get(e.id)
                    return <tr key={e.id} className="sl-link" onClick={() => onSelect(e.id)}><td>{e.name}</td><td className="num">{r?.energized ? ph(r.v[0], 'kV') : 'desenergizado'}</td></tr>
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
                    return <tr key={e.id} className="sl-link" onClick={() => onSelect(e.id)}><td>{e.name}</td><td className="num">{r?.energized ? `${fmt(r.extra.p)} MW · ${fmt(r.extra.q)} Mvar` : (r?.note ?? 'inativo')}</td></tr>
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
        Modelo: regime permanente trifásico equilibrado (Sbase = 100 MVA). Fonte = tensão atrás da impedância de curto-circuito;
        carga = impedância constante na tensão nominal da zona; transformador = impedância série (sem derivação).
        Selecione um elemento para editar os parâmetros e ver os resultados.
      </p>
    </>
  )
}
