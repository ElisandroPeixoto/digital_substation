import { useEffect, useMemo, useRef, useState } from 'react'
import type { IecProject, IecStatus } from '../types'

/** Aba "Interface gráfica" do IEC61850: IEDs como blocos e uma seta por par publicador → assinante.
 *  Seta contínua na cor --ok (azul-água) = assinatura recebendo GOOSE válido; cinza tracejada = configurada, mas sem comunicação. */

const POS_KEY = 'iec61850.graph.pos'
const W = 168
const H = 58

type Pos = Record<string, { x: number; y: number }>

function loadPos(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

interface Edge { pub: string; sub: string; cbs: string[]; ok: boolean; why: string }

/** Ponto de saída na borda do bloco (centro c) em direção ao ponto t. */
function border(c: { x: number; y: number }, t: { x: number; y: number }) {
  const dx = t.x - c.x
  const dy = t.y - c.y
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return c
  const s = Math.min((W / 2 + 6) / Math.abs(dx || 1e-6), (H / 2 + 6) / Math.abs(dy || 1e-6))
  return { x: c.x + dx * s, y: c.y + dy * s }
}

const ICON = { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
function HandIcon() {
  return (
    <svg {...ICON}>
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5" />
      <path d="M14 11.5V5.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.4-1.9L4.3 16.8a1.6 1.6 0 0 1 2.3-2.2L8 16" />
    </svg>
  )
}

const ZMIN = 0.25
const ZMAX = 4

export function GooseGraph({ project, status }: { project: IecProject; status: IecStatus | null }) {
  const [pos, setPos] = useState<Pos>(loadPos)
  const drag = useRef<{ name: string; dx: number; dy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // vista: zoom (k) e deslocamento (tx, ty) em unidades do viewBox; Pan = arrastar a vista com o botão esquerdo
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [panMode, setPanMode] = useState(false)
  const pan = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const names = project.ieds.map((i) => i.name)

  // posição padrão: IEDs em círculo
  const n = names.length
  const R = Math.max(150, n * 42)
  const cx0 = R + W
  const cy0 = R + H + 20
  const at = (name: string, k: number) => pos[name] ?? { x: cx0 + R * Math.cos((2 * Math.PI * k) / Math.max(n, 1) - Math.PI / 2), y: cy0 + R * Math.sin((2 * Math.PI * k) / Math.max(n, 1) - Math.PI / 2) }
  const P = Object.fromEntries(names.map((nm, k) => [nm, at(nm, k)]))

  const edges = useMemo(() => {
    const m = new Map<string, Edge>()
    for (const ied of project.ieds) {
      const st = status?.ieds.find((s) => s.name === ied.name)
      for (const sub of ied.subs) {
        if (!names.includes(sub.pub_ied) || sub.pub_ied === ied.name) continue
        const key = `${sub.pub_ied}→${ied.name}`
        const s = st?.subs.find((x) => x.pub_ied === sub.pub_ied && x.cb_name === sub.cb_name)
        const ok = !!(s?.valid && sub.enabled !== false)
        const why = ok ? 'comunicação ok' : s ? (s.reason || 'sem mensagens válidas') : st?.sid ? 'assinatura sem status' : 'relé não instanciado no DigitalRelay'
        const e = m.get(key)
        if (e) { e.cbs.push(sub.cb_name); e.ok = e.ok && ok; if (!ok) e.why = why }
        else m.set(key, { pub: sub.pub_ied, sub: ied.name, cbs: [sub.cb_name], ok, why })
      }
    }
    return [...m.values()]
  }, [project, status]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Ponto do mouse em unidades do viewBox (sem a transformação da vista). */
  const svgPt = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const r = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    const s = Math.max(vb.width / r.width, vb.height / r.height)           // preserveAspectRatio "meet"
    return { x: vb.x + vb.width / 2 + (clientX - r.left - r.width / 2) * s, y: vb.y + vb.height / 2 + (clientY - r.top - r.height / 2) * s }
  }
  /** Ponto do mouse no desenho (desfaz zoom e deslocamento). */
  const world = (e: React.PointerEvent) => {
    const p = svgPt(e.clientX, e.clientY)
    const v = viewRef.current
    return { x: (p.x - v.tx) / v.k, y: (p.y - v.ty) / v.k }
  }
  /** Zoom em torno de um ponto (unidades do viewBox); sem ponto = centro da área. */
  const zoomAt = (f: number, at?: { x: number; y: number }) => setView((v) => {
    const k = Math.min(ZMAX, Math.max(ZMIN, v.k * f))
    const vb = svgRef.current?.viewBox.baseVal
    const c = at ?? (vb ? { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 } : { x: 0, y: 0 })
    return { k, tx: c.x - ((c.x - v.tx) * k) / v.k, ty: c.y - ((c.y - v.ty) * k) / v.k }
  })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, svgPt(e.clientX, e.clientY)) }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (p: Pos) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* ignora */ } }

  // área do desenho: envolve os blocos; fica fixa enquanto o usuário arrasta (recalculada em Centralizar / Reorganizar / novos IEDs)
  const { minX, minY, maxX, maxY } = useMemo(() => {
    const xs = names.map((nm) => P[nm].x)
    const ys = names.map((nm) => P[nm].y)
    const x0 = Math.min(...xs) - W
    const y0 = Math.min(...ys) - H - 10
    return { minX: x0, minY: y0, maxX: Math.max(Math.max(...xs) + W, x0 + 2 * W + 240), maxY: Math.max(Math.max(...ys) + H + 10, y0 + 2 * H + 160) }
  }, [fitKey, names.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const center = () => { setView({ k: 1, tx: 0, ty: 0 }); setFitKey((x) => x + 1) }
  const okCount = edges.filter((e) => e.ok).length

  if (n === 0) return <section className="card"><p className="hint">Nenhum IED carregado.</p></section>
  return (
    <section className="card goose-graph">
      <div className="row wrap">
        <h3>Interface gráfica</h3>
        <span className="gg-legend"><svg width={40} height={10}><line x1={0} y1={5} x2={40} y2={5} className="gg-ok" /></svg> comunicação ok</span>
        <span className="gg-legend"><svg width={40} height={10}><line x1={0} y1={5} x2={40} y2={5} className="gg-off" /></svg> configurada, sem comunicação</span>
        <span className="spacer" />
        <span className="muted">{edges.length} ligações GOOSE · {okCount} ativas</span>
        <span className="sl-zoom" role="group" aria-label="Zoom">
          <button onClick={() => zoomAt(1 / 1.2)} disabled={view.k <= ZMIN} title="Diminuir o zoom" aria-label="Diminuir o zoom">−</button>
          <button onClick={() => zoomAt(1.2)} disabled={view.k >= ZMAX} title="Aumentar o zoom" aria-label="Aumentar o zoom">+</button>
        </span>
        <button className={`sl-pan ${panMode ? 'active' : ''}`} onClick={() => setPanMode((v) => !v)} aria-pressed={panMode}
          title="Pan: arrasta a vista com o botão esquerdo (também com o botão do meio/direito; roda do mouse = zoom)"><span className="ic"><HandIcon /></span><span>Pan</span></button>
        <button onClick={center} title="Volta ao zoom de 100 % e enquadra todos os IEDs">Centralizar</button>
        <span className="muted">{Math.round(view.k * 100)}%</span>
        <button onClick={() => { setPos({}); save({}); center() }} title="Volta os IEDs para a disposição em círculo">Reorganizar</button>
      </div>
      {edges.length === 0 && <p className="hint">Nenhum IED assina GOOSE de outro IED do projeto.</p>}
      <svg
        ref={svgRef}
        className={`gg-svg ${panMode ? 'pan-mode' : ''}`}
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (drag.current || !(e.button === 1 || e.button === 2 || (panMode && e.button === 0))) return
          svgRef.current?.setPointerCapture(e.pointerId)
          const p = svgPt(e.clientX, e.clientY)
          pan.current = { sx: p.x, sy: p.y, tx: view.tx, ty: view.ty }
        }}
        onPointerMove={(e) => {
          const pn = pan.current
          if (pn) {
            const p = svgPt(e.clientX, e.clientY)
            setView((v) => ({ ...v, tx: pn.tx + p.x - pn.sx, ty: pn.ty + p.y - pn.sy }))
            return
          }
          const d = drag.current
          if (!d) return
          const w = world(e)
          setPos((p) => ({ ...p, [d.name]: { x: w.x - d.dx, y: w.y - d.dy } }))
        }}
        onPointerUp={() => {
          pan.current = null
          if (drag.current) { drag.current = null; setPos((p) => { save(p); return p }) }
        }}
      >
        <defs>
          <marker id="gg-arrow-ok" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="gg-head-ok" />
          </marker>
          <marker id="gg-arrow-off" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="gg-head-off" />
          </marker>
        </defs>
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
        {edges.map((e) => {
          const a = P[e.pub]
          const b = P[e.sub]
          const both = edges.some((o) => o.pub === e.sub && o.sub === e.pub)
          // par nos dois sentidos: curva para a direita de cada sentido, para as setas não se sobreporem
          const dx = b.x - a.x
          const dy = b.y - a.y
          const len = Math.hypot(dx, dy) || 1
          const off = both ? 34 : 0
          const mid = { x: (a.x + b.x) / 2 - (dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off }
          const s = border(a, mid)
          const t = border(b, mid)
          const lbl = { x: (s.x + 2 * mid.x + t.x) / 4, y: (s.y + 2 * mid.y + t.y) / 4 }
          return (
            <g key={`${e.pub}-${e.sub}`}>
              <title>{`${e.pub} → ${e.sub}\n${e.cbs.join(', ')}\n${e.ok ? 'Comunicação ok' : `Sem comunicação: ${e.why}`}`}</title>
              <path d={`M${s.x},${s.y} Q${mid.x},${mid.y} ${t.x},${t.y}`} fill="none" className={e.ok ? 'gg-ok' : 'gg-off'}
                markerEnd={`url(#gg-arrow-${e.ok ? 'ok' : 'off'})`} />
              <text x={lbl.x} y={lbl.y - 4} className="gg-cb" textAnchor="middle">{e.cbs.length > 1 ? `${e.cbs[0]} +${e.cbs.length - 1}` : e.cbs[0]}</text>
            </g>
          )
        })}
        {project.ieds.map((ied) => {
          const p = P[ied.name]
          const st = status?.ieds.find((s) => s.name === ied.name)
          return (
            <g key={ied.name} transform={`translate(${p.x - W / 2},${p.y - H / 2})`} className="gg-node"
              onPointerDown={(e) => {
                if (panMode || e.button !== 0) return                  // Pan: o clique segue para o fundo e arrasta a vista
                (e.target as Element).setPointerCapture?.(e.pointerId)
                const w = world(e)
                drag.current = { name: ied.name, dx: w.x - p.x, dy: w.y - p.y }
              }}>
              <title>{`${ied.name}${ied.desc ? ` – ${ied.desc}` : ''}\n${ied.manufacturer} ${ied.type}${ied.ip ? `\nIP ${ied.ip}` : ''}\n${st?.sid ? 'Instanciado no DigitalRelay' : 'Sem relé do DigitalRelay associado'}`}</title>
              <rect width={W} height={H} rx={10} className={`gg-box ${st?.sid ? (st.comm_ok ? 'on' : 'warn') : ''}`} />
              <text x={W / 2} y={24} textAnchor="middle" className="gg-name">{ied.name}</text>
              <text x={W / 2} y={42} textAnchor="middle" className="gg-sub">{[ied.manufacturer, ied.type].filter(Boolean).join(' · ').slice(0, 26) || ied.source_file}</text>
            </g>
          )
        })}
        </g>
      </svg>
      <p className="hint">Cada seta vai do publicador ao assinante (blocos GOOSE no rótulo; passe o mouse para ver todos e o motivo de uma falha). Arraste os IEDs para reorganizar; zoom pelos botões −/+ ou pela roda do mouse, e Pan (mão) para mover a vista.
        A comunicação só fica ativa com os relés instanciados no DigitalRelay, associados aos IEDs e em execução.</p>
    </section>
  )
}
