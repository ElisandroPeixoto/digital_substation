import { useEffect, useRef, useState } from 'react'
import { KIND_INFO, type Curve } from './model'

const VW = 780
const VH = 470
const L = 60
const R = 18
const T = 16
const B = 48
const YMIN = 0.01
const YMAX = 1000
const MIN_SPAN = 0.05 // zoom máximo: 0,05 década
const MAX_SPAN = 12

const fmt = (x: number, d = 2) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtI = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('pt-BR') : fmt(x, 1))
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

function fmtTick(v: number): string {
  if (v >= 1000) return `${Number((v / 1000).toPrecision(3)).toLocaleString('pt-BR')}k`
  return Number(v.toPrecision(3)).toLocaleString('pt-BR', { maximumFractionDigits: 6 })
}

/** Marcas de uma escala logarítmica (mantissa 1..9 em cada década) dentro de [l0, l1] (log10). */
function logTicks(l0: number, l1: number): { v: number; m: number }[] {
  const out: { v: number; m: number }[] = []
  for (let e = Math.floor(l0) - 1; e <= Math.ceil(l1); e++) {
    for (let m = 1; m < 10; m++) {
      const v = m * 10 ** e
      if (v >= 10 ** l0 * 0.9999 && v <= 10 ** l1 * 1.0001) out.push({ v, m })
    }
  }
  return out
}
/** Quais marcas recebem rótulo, conforme o zoom (poucas décadas ⇒ mais rótulos). */
const labelled = (m: number, span: number) => m === 1 || (span < 3.2 && (m === 2 || m === 5)) || span < 1.3

interface View { x0: number; x1: number; y0: number; y1: number }   // faixas em log10

interface Props {
  curves: Curve[]
  xmin: number
  xmax: number
  ifaults: number[]          // marcações fixas de corrente (A primários)
  hoverKey: string | null
  onHover: (key: string | null) => void
}

interface Hov { key: string; i: number; px: number; py: number }

export function Chart({ curves, xmin, xmax, ifaults, hoverKey, onHover }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [hov, setHov] = useState<Hov | null>(null)
  const [view, setView] = useState<View | null>(null)           // null = faixa base (automática)
  const pan = useRef<{ vx: number; vy: number; v: View } | null>(null)

  const base: View = { x0: Math.log10(xmin), x1: Math.log10(xmax), y0: Math.log10(YMIN), y1: Math.log10(YMAX) }
  const baseRef = useRef(base)
  baseRef.current = base
  const cur = view ?? base
  const { x0: lx0, x1: lx1, y0: ly0, y1: ly1 } = cur
  const xminV = 10 ** lx0
  const xmaxV = 10 ** lx1
  const W = VW - L - R
  const H = VH - T - B
  const lx = (i: number) => L + ((Math.log10(i) - lx0) / (lx1 - lx0)) * W
  const ly = (t: number) => T + ((ly1 - clamp(Math.log10(Math.max(t, 1e-12)), ly0, ly1)) / (ly1 - ly0)) * H
  const invX = (vx: number) => 10 ** (lx0 + ((vx - L) / W) * (lx1 - lx0))
  const zoomed = view != null

  // ---- zoom e deslocamento
  /** Zoom por fator f (<1 aproxima) em torno do ponto (fx, fy) da área do gráfico (0..1; fy = 0 no topo). */
  function zoomAt(fx: number, fy: number, f: number) {
    setView((v) => {
      const c = v ?? baseRef.current
      const sx = clamp((c.x1 - c.x0) * f, MIN_SPAN, MAX_SPAN)
      const sy = clamp((c.y1 - c.y0) * f, MIN_SPAN, MAX_SPAN)
      const px = c.x0 + fx * (c.x1 - c.x0)
      const py = c.y1 - fy * (c.y1 - c.y0)
      const x0 = px - fx * sx
      const y1 = py + fy * sy
      return { x0, x1: x0 + sx, y1, y0: y1 - sy }
    })
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const vx = ((e.clientX - r.left) * VW) / r.width
      const vy = ((e.clientY - r.top) * VH) / r.height
      zoomAt(clamp((vx - L) / W, 0, 1), clamp((vy - T) / H, 0, 1), e.deltaY < 0 ? 0.8 : 1.25)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toView(e: React.PointerEvent | React.MouseEvent): [number, number] {
    const r = svgRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) * VW) / r.width, ((e.clientY - r.top) * VH) / r.height]
  }
  function onDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const [vx, vy] = toView(e)
    pan.current = { vx, vy, v: view ?? base }
    svgRef.current?.setPointerCapture?.(e.pointerId)
  }
  function onMovePan(e: React.PointerEvent) {
    const p = pan.current
    if (!p) return
    const [vx, vy] = toView(e)
    if (Math.abs(vx - p.vx) + Math.abs(vy - p.vy) < 3 && !view) return
    const dx = ((vx - p.vx) / W) * (p.v.x1 - p.v.x0)
    const dy = ((vy - p.vy) / H) * (p.v.y1 - p.v.y0)
    setView({ x0: p.v.x0 - dx, x1: p.v.x1 - dx, y0: p.v.y0 + dy, y1: p.v.y1 + dy })
    setHov(null)
    onHover(null)
  }
  function onUp(e: React.PointerEvent) {
    pan.current = null
    svgRef.current?.releasePointerCapture?.(e.pointerId)
  }

  function curvePath(c: Curve): string {
    const top = ly(10 ** ly1)
    if (c.kind === '51P' || c.kind === '51N') {
      const start = Math.max(c.ipk * 1.0005, xminV)
      if (start >= xmaxV) return ''
      const pts: [number, number][] = []
      const N = 280
      for (let k = 0; k <= N; k++) {
        const i = start * (xmaxV / start) ** (k / N)
        const t = c.time(i)
        if (t == null) continue
        pts.push([lx(i), ly(t)])
      }
      while (pts.length > 1 && pts[1][1] <= top + 0.01) pts.shift()      // pontos acima do gráfico: só o último toca o topo
      if (!pts.length) return ''
      return `M ${pts[0][0]} ${top} ` + pts.map(([x, y]) => `L ${x} ${y}`).join(' ')
    }
    if (c.ipk > xmaxV) return ''
    const y = ly(Math.max(c.delay ?? 0, YMIN))
    return c.ipk >= xminV ? `M ${lx(c.ipk)} ${top} L ${lx(c.ipk)} ${y} L ${lx(xmaxV)} ${y}` : `M ${lx(xminV)} ${y} L ${lx(xmaxV)} ${y}`
  }

  const xTicks = logTicks(lx0, lx1)
  const yTicks = logTicks(ly0, ly1)
  const xSpan = lx1 - lx0
  const ySpan = ly1 - ly0

  function move(e: React.MouseEvent, c: Curve) {
    if (pan.current) return
    const b = boxRef.current!.getBoundingClientRect()
    const [vx] = toView(e)
    const i = clamp(invX(vx), xminV, xmaxV)
    setHov({ key: c.key, i, px: e.clientX - b.left, py: e.clientY - b.top })
    onHover(c.key)
  }
  function leave() {
    setHov(null)
    onHover(null)
  }

  const hc = hov ? curves.find((c) => c.key === hov.key) : undefined
  const ht = hc && hov ? hc.time(hov.i) : null
  const inView = (t: number) => Math.log10(t) >= ly0 && Math.log10(t) <= ly1

  return (
    <div className="oc-chart" ref={boxRef} onMouseLeave={leave}>
      <div className="oc-zoom">
        <button onClick={() => zoomAt(0.5, 0.5, 0.7)} title="Aproximar (ou use a roda do mouse)">+</button>
        <button onClick={() => zoomAt(0.5, 0.5, 1 / 0.7)} title="Afastar">−</button>
        <button onClick={() => setView(null)} disabled={!zoomed} title="Voltar à vista inicial (ou duplo clique)">↺</button>
      </div>
      <svg
        ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Coordenograma de sobrecorrente"
        className={zoomed ? 'zoomed' : ''}
        onPointerDown={onDown} onPointerMove={onMovePan} onPointerUp={onUp} onDoubleClick={() => setView(null)}
      >
        <rect x={L} y={T} width={W} height={H} fill="var(--bg)" />
        {xTicks.map((t, k) => <line key={`x${k}`} x1={lx(t.v)} x2={lx(t.v)} y1={T} y2={T + H} stroke="var(--line)" strokeWidth={t.m === 1 ? 1 : 0.4} opacity={t.m === 1 ? 0.9 : 0.55} />)}
        {yTicks.map((t, k) => <line key={`y${k}`} x1={L} x2={L + W} y1={ly(t.v)} y2={ly(t.v)} stroke="var(--line)" strokeWidth={t.m === 1 ? 1 : 0.4} opacity={t.m === 1 ? 0.9 : 0.55} />)}
        {xTicks.filter((t) => labelled(t.m, xSpan)).map((t, k) => (
          <text key={`xl${k}`} x={lx(t.v)} y={T + H + 16} textAnchor="middle" className="oc-tick">{fmtTick(t.v)}</text>
        ))}
        {yTicks.filter((t) => labelled(t.m, ySpan)).map((t, k) => <text key={`yl${k}`} x={L - 8} y={ly(t.v) + 4} textAnchor="end" className="oc-tick">{fmtTick(t.v)}</text>)}
        <rect x={L} y={T} width={W} height={H} fill="none" stroke="var(--muted)" />
        <text x={L + W / 2} y={VH - 10} textAnchor="middle" className="oc-axis">Corrente (A primários)</text>
        <text transform={`translate(16 ${T + H / 2}) rotate(-90)`} textAnchor="middle" className="oc-axis">Tempo de atuação (s)</text>

        {ifaults.map((f, k) => f > 0 && f >= xminV && f <= xmaxV && (
          <g key={`f${k}`}>
            <line x1={lx(f)} x2={lx(f)} y1={T} y2={T + H} stroke="var(--err)" strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={lx(f) + 5} y={T + 13 + 14 * (k % 3)} className="oc-tick" fill="var(--err)">{fmtI(f)} A</text>
          </g>
        ))}

        <g clipPath="url(#oc-clip)">
          {curves.map((c) => {
            const d = curvePath(c)
            if (!d) return null
            const info = KIND_INFO[c.kind]
            const dim = hoverKey != null && hoverKey !== c.key
            return (
              <g key={c.key}>
                <path d={d} fill="none" stroke={c.color} strokeWidth={hoverKey === c.key ? info.width + 1.6 : info.width} strokeDasharray={info.dash} opacity={dim ? 0.25 : 1} strokeLinejoin="round" />
                <path d={d} fill="none" stroke="transparent" strokeWidth={16} style={{ cursor: 'crosshair' }} onMouseMove={(e) => move(e, c)} onMouseLeave={leave} />
              </g>
            )
          })}
        </g>
        <defs><clipPath id="oc-clip"><rect x={L} y={T} width={W} height={H} /></clipPath></defs>

        {hc && hov && ht != null && inView(ht) && (
          <g pointerEvents="none">
            <line x1={lx(hov.i)} x2={lx(hov.i)} y1={ly(ht)} y2={T + H} stroke={hc.color} strokeDasharray="3 3" />
            <line x1={L} x2={lx(hov.i)} y1={ly(ht)} y2={ly(ht)} stroke={hc.color} strokeDasharray="3 3" />
            <circle cx={lx(hov.i)} cy={ly(ht)} r={5.5} fill={hc.color} stroke="var(--panel)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hc && hov && (
        <div className="oc-tip" style={{ left: hov.px + 14, top: hov.py + 14 }}>
          <span>I = {fmtI(hov.i)} A</span>
          <strong>{ht != null ? `t = ${ht >= 100 ? fmt(ht, 1) : fmt(ht, 3)} s` : 'não atua'}</strong>
        </div>
      )}
    </div>
  )
}
