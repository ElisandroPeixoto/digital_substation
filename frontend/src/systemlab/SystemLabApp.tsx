import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GRID, KINDS, KIND_ORDER, busCells, flag, hitRect, makeElement, num, worldPorts,
  type Diagram, type El, type Kind, type PortRef,
} from './model'
import { solve, type ElResult, type Ph } from './solver'
import { ElementSymbol, SymbolShape } from './symbols'

const KEY = 'systemlab.diagram'
const DND = 'application/x-systemlab'
const snap = (v: number) => Math.round(v / GRID) * GRID
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

type Sel = { type: 'el' | 'wire'; id: number } | null
type Drag =
  | { mode: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { mode: 'move'; id: number; ox: number; oy: number }
  | { mode: 'wire'; from: PortRef; sx: number; sy: number }
  | null

function emptyDiagram(): Diagram {
  return { els: [], wires: [], nextId: 1 }
}

function load(): Diagram {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (d && Array.isArray(d.els) && Array.isArray(d.wires) && typeof d.nextId === 'number') return d
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
    case 'bus': return [r.energized ? ph(r.v[0], 'kV') : 'desenergizado']
    case 'source': return [`${fmt(r.extra.p)} MW · ${fmt(r.extra.q)} Mvar`]
    case 'load': return r.energized ? [`${fmt(r.extra.p)} MW · ${fmt(r.extra.q)} Mvar`, `${fmt(r.v[0].mag)} kV`] : ['desenergizado']
    case 'breaker':
    case 'switch': return flag(el, 'closed') ? [r.energized ? `${fmt(r.i[0].mag, 1)} A` : 'desenergizado'] : ['aberto']
    case 'tc': return [r.energized ? `${fmt(r.i[0].mag, 1)} A → ${fmt(r.extra.isec, 3)} A` : 'desenergizado']
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
  const [dragId, setDragId] = useState<number | null>(null) // elemento sendo arrastado: mostra só o símbolo
  const [showVals, setShowVals] = useState(true)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const sol = useMemo(() => solve(dg.els, dg.wires), [dg])
  const elById = useMemo(() => new Map(dg.els.map((e) => [e.id, e])), [dg.els])

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(dg)) } catch { /* ignora */ }
  }, [dg])

  const toWorld = useCallback((cx: number, cy: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return [(cx - r.left - v.tx) / v.k, (cy - r.top - v.ty) / v.k]
  }, [])

  // ---- edição
  const addElement = useCallback((kind: Kind, x: number, y: number) => {
    setDg((d) => {
      const el = makeElement(kind, d.nextId, snap(x), snap(y), d.els)
      setSel({ type: 'el', id: el.id })
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
    setDg((d) => sel.type === 'wire'
      ? { ...d, wires: d.wires.filter((w) => w.id !== sel.id) }
      : { ...d, els: d.els.filter((e) => e.id !== sel.id), wires: d.wires.filter((w) => w.a[0] !== sel.id && w.b[0] !== sel.id) })
    setSel(null)
  }, [sel])

  const rotateSel = useCallback(() => {
    if (sel?.type === 'el') updateEl(sel.id, (e) => ({ ...e, rot: (e.rot + 1) % 4 }))
  }, [sel, updateEl])

  // ---- teclado e roda do mouse
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Delete' || e.key === 'Backspace') removeSel()
      else if (e.key === 'r' || e.key === 'R') rotateSel()
      else if (e.key === 'Escape') { setWiring(null); setSel(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  const onBgDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }
    setSel(null)
    setWiring(null)
  }
  const onElDown = (e: React.PointerEvent, el: El) => {
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e)
    const [wx, wy] = toWorld(e.clientX, e.clientY)
    drag.current = { mode: 'move', id: el.id, ox: wx - el.x, oy: wy - el.y }
    setSel({ type: 'el', id: el.id })
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
    else if (d.mode === 'move') {
      const x = snap(wx - d.ox)
      const y = snap(wy - d.oy)
      const cur = elById.get(d.id)
      if (cur && (cur.x !== x || cur.y !== y)) {
        setDragId(d.id)
        updateEl(d.id, (el) => ({ ...el, x, y }))
      }
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setDragId(null)
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
      const pts = routePoints(a, b)
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
    setSel({ type: 'el', id: dg.nextId })
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
  const route = (a: [number, number], b: [number, number]) =>
    routePoints(a, b).map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')

  const selEl = sel?.type === 'el' ? elById.get(sel.id) : undefined
  const selRes = selEl ? sol.res.get(selEl.id) : undefined
  const fitView = () => setView({ tx: 40, ty: 40, k: 1 })
  const clearAll = () => {
    if (dg.els.length === 0 || window.confirm('Apagar todo o diagrama?')) { setDg(emptyDiagram()); setSel(null); setWiring(null) }
  }

  const wiringPos = wiring ? portPos(wiring) : null

  return (
    <div className="sl">
      {/* ---------------------------------------------------------- toolbox */}
      <aside className="sl-tools">
        <h3>Elementos</h3>
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
        <p className="hint">
          Arraste um elemento para a área central. Para ligar, clique em um terminal (●) e depois em outro, ou arraste de um até o outro.
          Duplo clique em disjuntor/chave abre ou fecha. <b>R</b> gira, <b>Delete</b> remove, a roda do mouse dá zoom e arrastar o fundo move a vista.
        </p>
      </aside>

      {/* ---------------------------------------------------------- canvas */}
      <section className="sl-main">
        <div className="sl-bar">
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
              const d = route(a, b)
              const selected = sel?.type === 'wire' && sel.id === w.id
              return (
                <g key={w.id}>
                  <path d={d} fill="none" stroke={selected ? 'var(--accent-2)' : on ? 'var(--accent)' : 'var(--muted)'} strokeWidth={selected ? 3 : 2} strokeLinejoin="round" />
                  <path
                    d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => { e.stopPropagation(); setSel({ type: 'wire', id: w.id }) }}
                  />
                </g>
              )
            })}

            {/* elementos */}
            {dg.els.map((el) => {
              const r = sol.res.get(el.id)
              const on = el.kind === 'source' || !!r?.energized
              const color = on ? 'var(--accent)' : 'var(--muted)'
              const dragging = dragId === el.id
              const selected = sel?.type === 'el' && sel.id === el.id && !dragging
              const [hx, hy, hw, hh] = hitRect(el)
              const ports = worldPorts(el)
              const showPorts = !dragging && (el.kind !== 'bus' || wiring != null || selected || hover === el.id)
              const vertBus = el.kind === 'bus' && el.rot % 2 === 1
              const lab: [number, number] = el.kind === 'bus'
                ? (vertBus ? [el.x + 16, el.y - busCells(el) * 10 - 6] : [el.x, el.y + 26])
                : [el.x, el.y + (el.kind === 'tp' ? 40 : 40)]
              const lines = showVals && !dragging ? valueLines(el, r) : []
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
                  {!dragging && <text x={lab[0]} y={lab[1]} textAnchor={vertBus ? 'start' : 'middle'} className="sl-name" fill="var(--ink)" pointerEvents="none">{el.name}</text>}
                  {lines.map((t, i) => (
                    <text key={i} x={lab[0]} y={lab[1] + 12 * (i + 1)} textAnchor={vertBus ? 'start' : 'middle'} className="sl-val" fill={on ? 'var(--accent-2)' : 'var(--muted)'} pointerEvents="none">{t}</text>
                  ))}
                  {ports.map(([px, py], k) => (
                    <g key={k}>
                      {showPorts && <circle cx={px} cy={py} r={el.kind === 'bus' ? 2.8 : 3.8} fill="var(--panel)" stroke="var(--accent-2)" strokeWidth={1.5} pointerEvents="none" />}
                      <circle cx={px} cy={py} r={9} fill="transparent" data-port={`${el.id}:${k}`} style={{ cursor: 'crosshair' }} onPointerDown={(e) => onPortDown(e, [el.id, k])} />
                    </g>
                  ))}
                </g>
              )
            })}

            {/* ligação em andamento */}
            {wiringPos && <path d={route(wiringPos, [snap(mouse[0]), snap(mouse[1])])} fill="none" stroke="var(--accent-2)" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />}
          </g>
        </svg>
        {dg.els.length === 0 && <div className="sl-empty">Arraste elementos da barra à esquerda para começar<br /><small>ou use “Carregar exemplo”</small></div>}
      </section>

      {/* ---------------------------------------------------------- propriedades */}
      <aside className="sl-side">
        {selEl ? (
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
                  <NumInput key={`${selEl.id}-${f.key}`} value={num(selEl, f.key)} onChange={(n) => updateEl(selEl.id, (x) => ({ ...x, p: { ...x.p, [f.key]: f.min != null ? Math.max(f.min, n) : n } }))} />
                )}
              </label>
            ))}
            <div className="row">
              <button onClick={rotateSel}>↻ Girar (R)</button>
              <button className="danger" onClick={removeSel}>Excluir</button>
            </div>
            <Results el={selEl} r={selRes} />
          </>
        ) : sel?.type === 'wire' ? (
          <>
            <h3>Ligação</h3>
            <p className="muted">{(() => {
              const w = dg.wires.find((x) => x.id === sel.id)
              return w ? `${elById.get(w.a[0])?.name} ↔ ${elById.get(w.b[0])?.name}` : ''
            })()}</p>
            <button className="danger" onClick={removeSel}>Excluir ligação</button>
          </>
        ) : (
          <Summary dg={dg} sol={sol} onSelect={(id) => setSel({ type: 'el', id })} />
        )}
      </aside>
    </div>
  )
}

// ------------------------------------------------------------------ painéis
function Results({ el, r }: { el: El; r: ElResult | undefined }) {
  if (!r || el.kind === 'switch') return null
  return (
    <div className="sl-results">
      <h4>Resultados</h4>
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
