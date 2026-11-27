import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { PanelData, SessionInfo } from '../types'

/** Réplica do frontal do SEL-311C (imagem de referência em assets/relay-front-311c-reference.webp), sem a seção de
 *  disjuntor da direita (OPEN/CLOSED, TRIP/CLOSE). Teclas de dupla função: no display rotativo valem os nomes de cima
 *  (METER, EVENTS, STATUS, OTHER, SET, CNTRL, GROUP); dentro de um menu valem os de baixo (CANCEL, SELECT, setas, EXIT). */

const DEFAULT_TITLES = ['SPT\nENABLED', 'RECLOSE\nENABLED', 'REMOTE\nENABLED', 'ALT.\nSETTINGS', 'LOCK', '', '', '', 'BREAKER\nCLOSED', 'BREAKER\nOPEN']
const KEYX = [258, 318, 373, 430, 485, 540, 595, 651]             // colunas das teclas e dos LEDs
const TOP = ['TARGET\nRESET', 'METER', 'EVENTS', 'STATUS', 'OTHER', 'SET', 'CNTRL', 'GROUP']
const COLS = 16

type Key = 'meter' | 'events' | 'status' | 'other' | 'set' | 'cntrl' | 'group'
type Mode = { kind: 'rotate' } | { kind: 'pages'; title: string; lines: string[]; page: number } | { kind: 'cntrl'; idx: number; opt: number | null }

function loadTitles(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (Array.isArray(raw) && raw.length === 10) return raw.map((t, i) => (typeof t === 'string' ? t : DEFAULT_TITLES[i]))
  } catch {
    /* padrão */
  }
  return [...DEFAULT_TITLES]
}

const fit = (s: string) => s.slice(0, COLS).padEnd(COLS)
const n0 = (x: number | undefined, w = 5) => Math.round(x ?? 0).toString().slice(0, w)
const kv = (x: number | undefined, d = 1) => ((x ?? 0) / 1000).toFixed(d)

function meterLines(m: Record<string, number>): string[] {
  return [
    `IA=${n0(m.IA_MAG)}`.padEnd(8) + `IB=${n0(m.IB_MAG)}`, `IC=${n0(m.IC_MAG)}`.padEnd(8) + `IN=${n0(m.IG_MAG)}`,
    `VA=${kv(m.VA_MAG)}`.padEnd(8) + `VB=${kv(m.VB_MAG)}`, `VC=${kv(m.VC_MAG)}`.padEnd(8) + `kV`,
    `VAB=${kv(m.VAB_MAG)}`, `VBC=${kv(m.VBC_MAG)} kV`,
    `MW=${((m.P ?? 0) / 1000).toFixed(2)}`, `MVAR=${((m.Q ?? 0) / 1000).toFixed(2)}`,
    `PF=${(m.PF ?? 0).toFixed(3)}`, `FREQ=${(m.FREQ ?? 0).toFixed(2)} Hz`,
  ]
}

function pairs(lines: string[]): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < lines.length; i += 2) out.push([lines[i], lines[i + 1] ?? ''])
  return out.length ? out : [['', '']]
}

interface Props {
  info: SessionInfo
  panel: PanelData | null
  onPb: (n: number, pressed: boolean) => void
  onTargetReset: () => void
}

function Led({ x, y, on, color, r = 5 }: { x: number; y: number; on: boolean; color: string; r?: number }) {
  return (
    <g>
      {on && <circle cx={x} cy={y} r={r + 5} fill={color} opacity={0.3} />}
      <circle cx={x} cy={y} r={r} fill={on ? color : '#9aa8bb'} opacity={on ? 1 : 0.6} stroke={on ? '#fff3' : 'none'} />
    </g>
  )
}

function Lines({ x, y, text, size = 12, fill = '#fff', anchor = 'middle', gap = 1.15, weight = 700 }:
  { x: number; y: number; text: string; size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; gap?: number; weight?: number }) {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={weight} fontFamily="Arial, Helvetica, sans-serif">
      {text.split('\n').map((t, i) => <tspan key={i} x={x} dy={i ? size * gap : 0}>{t}</tspan>)}
    </text>
  )
}

export function Relay311CFront({ info, panel, onPb, onTargetReset }: Props) {
  const p = panel?.panel
  const [lamp, setLamp] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: 'rotate' })
  const [page, setPage] = useState(0)
  const storageKey = `sel751.pbtitles.${info.relay_id}`
  const [titles, setTitles] = useState<string[]>(() => loadTitles(storageKey))
  const [editing, setEditing] = useState(false)
  const down = useRef<number | null>(null)

  useEffect(() => { setTitles(loadTitles(storageKey)); setEditing(false); setMode({ kind: 'rotate' }) }, [storageKey])
  useEffect(() => {
    if (mode.kind !== 'rotate') return
    const id = window.setInterval(() => setPage((x) => x + 1), 2500)
    return () => window.clearInterval(id)
  }, [mode.kind])

  const meter = panel?.meter ?? {}
  const rotPages = useMemo(() => [...pairs(meterLines(meter).slice(0, 2)), ...pairs(p?.lcd ?? [])], [meter, p?.lcd])
  const lbs = p?.local_bits ?? []
  const lit = (on: boolean) => lamp || on

  // ------------------------------------------------------------------ display
  let l1 = '', l2 = ''
  if (mode.kind === 'rotate') {
    ;[l1, l2] = rotPages[page % rotPages.length]
  } else if (mode.kind === 'pages') {
    const pg = pairs(mode.lines)
    ;[l1, l2] = pg[Math.min(mode.page, pg.length - 1)]
  } else {
    const lb = lbs[mode.idx]
    if (!lb) {
      l1 = 'SEM BITS LOCAIS'
      l2 = ''
    } else if (mode.opt == null) {
      l1 = lb.name
      l2 = `LB${lb.n}=${lb.on ? 1 : 0}  ${mode.idx + 1}/${lbs.length}`
    } else {
      const opts = optsOf(lb)
      l1 = lb.name
      l2 = opts.map((o, i) => (i === mode.opt ? `>${o.label}` : ` ${o.label}`)).join(' ')
    }
  }

  function optsOf(lb: { set: string; clear: string; pulse: string }) {
    return ([[lb.clear, 'clear'], [lb.set, 'set'], [lb.pulse, 'pulse']] as const).filter(([l]) => l).map(([label, m]) => ({ label, mode: m }))
  }

  const status = (): string[] => {
    if (!panel) return []
    const s = panel.status
    return ['RELAY ENABLED', `GROUP ${s.group}`, `52A ${panel.breaker.closed ? 'FECHADO' : 'ABERTO'}`, `79 ${s.recloser} SH${s.shot}`,
      p?.enabled.on ? 'SELF TEST OK' : 'HALARM', `T=${panel.time.toFixed(1)} s`]
  }
  const events = (): string[] => {
    if (!p) return []
    const t = info.static.targets
    const on = p.targets.filter((x) => x.on).map((x) => t.find((y) => y.id === x.id)?.label ?? x.id)
    const ft = (p.fault_type ?? []).filter((x) => x.on).map((x) => x.id).join('')
    return on.length ? [`TRIP ${ft}`.trim(), on.join(' ').slice(0, 16), ...(on.join(' ').length > 16 ? [on.join(' ').slice(16)] : [])] : ['NO EVENTS', '']
  }

  const topKey = (k: Key) => {
    if (k === 'meter') setMode({ kind: 'pages', title: 'METER', lines: meterLines(meter), page: 0 })
    else if (k === 'events') setMode({ kind: 'pages', title: 'EVENTS', lines: events(), page: 0 })
    else if (k === 'status') setMode({ kind: 'pages', title: 'STATUS', lines: status(), page: 0 })
    else if (k === 'other') setMode({ kind: 'pages', title: 'OTHER', lines: ['DATE/TIME', new Date().toLocaleTimeString('pt-BR')], page: 0 })
    else if (k === 'set') setMode({ kind: 'pages', title: 'SET', lines: ['SET: USE A ABA', 'AJUSTES'], page: 0 })
    else if (k === 'group') setMode({ kind: 'pages', title: 'GROUP', lines: [`ACTIVE GROUP=${panel?.status.group ?? 1}`, ''], page: 0 })
    else setMode({ kind: 'cntrl', idx: 0, opt: null })
  }

  /** Teclas de navegação (nomes de baixo). */
  const navKey = (k: 'cancel' | 'select' | 'left' | 'right' | 'up' | 'down' | 'exit') => {
    if (k === 'exit') { setMode({ kind: 'rotate' }); return }
    if (mode.kind === 'pages') {
      const n = pairs(mode.lines).length
      if (k === 'cancel') setMode({ kind: 'rotate' })
      else if (k === 'down' || k === 'right') setMode({ ...mode, page: Math.min(n - 1, mode.page + 1) })
      else if (k === 'up' || k === 'left') setMode({ ...mode, page: Math.max(0, mode.page - 1) })
      return
    }
    if (mode.kind === 'cntrl') {
      const lb = lbs[mode.idx]
      if (mode.opt == null) {
        if (k === 'cancel') setMode({ kind: 'rotate' })
        else if (k === 'down' || k === 'right') setMode({ ...mode, idx: Math.min(lbs.length - 1, mode.idx + 1) })
        else if (k === 'up' || k === 'left') setMode({ ...mode, idx: Math.max(0, mode.idx - 1) })
        else if (k === 'select' && lb) setMode({ ...mode, opt: 0 })
        return
      }
      const opts = lb ? optsOf(lb) : []
      if (k === 'cancel') setMode({ ...mode, opt: null })
      else if (k === 'right' || k === 'down') setMode({ ...mode, opt: Math.min(opts.length - 1, mode.opt + 1) })
      else if (k === 'left' || k === 'up') setMode({ ...mode, opt: Math.max(0, mode.opt - 1) })
      else if (k === 'select' && lb && opts[mode.opt]) {
        void api.bit(info.id, `LB${lb.n}`, opts[mode.opt].mode)
        setMode({ ...mode, opt: null })
      }
    }
  }

  const keyPress = (i: number) => {
    if (i === 0) return
    const inMenu = mode.kind !== 'rotate'
    const nav = (['cancel', 'select', 'left', 'right', 'up', 'down', 'exit'] as const)[i - 1]
    if (inMenu) navKey(nav)
    else topKey((['meter', 'events', 'status', 'other', 'set', 'cntrl', 'group'] as const)[i - 1])
  }

  const persist = (next: string[]) => {
    setTitles(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* sem armazenamento */ }
  }

  // ------------------------------------------------------------------ desenho
  const targets = info.static.targets
  const tOn = (id: string) => !!p?.targets.find((x) => x.id === id)?.on
  const tLabel = (id: string, d: string) => targets.find((x) => x.id === id)?.label || d
  const ftOn = (id: string) => !!p?.fault_type?.find((x) => x.id === id)?.on
  const row1: [string, boolean, string][] = [
    ['ENABLED', !!p?.enabled.on, '#3bea5a'], [tLabel('T12', 'TRIP'), tOn('T12'), '#ff4538'], [tLabel('T13', 'TIME'), tOn('T13'), '#ff4538'],
    [tLabel('T14', 'COMM'), tOn('T14'), '#ff4538'], [tLabel('T15', 'SOTF'), tOn('T15'), '#ff4538'], [tLabel('T16', 'RS'), tOn('T16'), '#ff4538'],
    [tLabel('T17', 'LO'), tOn('T17'), '#ff4538'], [tLabel('T18', '51'), tOn('T18'), '#ff4538'],
  ]
  const row2: [string, boolean][] = [
    ['A', ftOn('A')], ['B', ftOn('B')], ['C', ftOn('C')], ['G', ftOn('G')],
    ['1', tOn('T23')], ['2', tOn('T24')], ['3', tOn('T25')], ['4', tOn('T26')],
  ]
  const pbPos = (n: number) => ({ x: n <= 5 ? 718 : 950, y: 58 + ((n - 1) % 5) * 60 })
  const pbLed = (n: number) => !!p?.pb.find((x) => x.n === n)?.a.on

  const pbDown = (n: number) => (e: React.PointerEvent) => {
    if (down.current != null) return
    down.current = n
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    onPb(n, true)
  }
  const pbUp = () => {
    if (down.current == null) return
    const n = down.current
    down.current = null
    onPb(n, false)
  }

  return (
    <div className="r311-wrap">
      <svg className="r311" viewBox="0 0 1240 420" role="img" aria-label="Frontal do SEL-311C">
        <defs>
          <linearGradient id="r311-blue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b4f8f" />
            <stop offset="1" stopColor="#123d73" />
          </linearGradient>
          <linearGradient id="r311-ear" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#e9edf2" />
            <stop offset="1" stopColor="#c5ccd6" />
          </linearGradient>
          <radialGradient id="r311-key" cx="0.4" cy="0.35" r="0.8">
            <stop offset="0" stopColor="#2c5a9a" />
            <stop offset="1" stopColor="#0f2c57" />
          </radialGradient>
          <linearGradient id="r311-lcd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b9d65a" />
            <stop offset="1" stopColor="#9fc23e" />
          </linearGradient>
        </defs>

        {/* orelhas do rack e corpo */}
        <rect x={0} y={14} width={60} height={392} rx={8} fill="url(#r311-ear)" />
        <rect x={1180} y={14} width={60} height={392} rx={8} fill="url(#r311-ear)" />
        {[40, 120, 300, 380].map((y) => (
          <g key={y}>
            <rect x={10} y={y - 9} width={36} height={18} rx={9} fill="#7b8696" />
            <rect x={1194} y={y - 9} width={36} height={18} rx={9} fill="#7b8696" />
          </g>
        ))}
        <rect x={52} y={8} width={1136} height={404} rx={8} fill="url(#r311-blue)" stroke="#0b2b55" strokeWidth={2} />
        {[[95, 20], [745, 20], [1150, 20], [95, 400], [745, 400], [1150, 400]].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r={8} fill="#cfd5de" stroke="#8a94a3" />
            <line x1={x - 5} y1={y - 3} x2={x + 5} y2={y + 3} stroke="#6c7686" strokeWidth={2} />
          </g>
        ))}

        {/* PORT F, USB, modelo e logo */}
        <rect x={118} y={38} width={84} height={28} rx={10} fill="#c9ced6" stroke="#77808d" />
        <rect x={130} y={44} width={60} height={16} rx={6} fill="#2a3340" />
        <Lines x={160} y={84} text="PORT F" size={11} />
        <rect x={142} y={96} width={36} height={32} rx={3} fill="#d9dde3" stroke="#77808d" />
        <rect x={151} y={104} width={18} height={14} fill="#3a4350" />
        <Lines x={160} y={148} text="⭠⭢" size={12} />
        <Lines x={74} y={198} text="SEL-311C" size={22} anchor="start" />
        <Lines x={74} y={220} text={'TRANSMISSION\nPROTECTION\nSYSTEM'} size={11.5} anchor="start" />
        <rect x={74} y={300} width={56} height={32} rx={5} fill="none" stroke="#fff" strokeWidth={2.5} />
        <Lines x={102} y={324} text="SEL" size={20} />

        {/* moldura do display e das teclas */}
        <rect x={230} y={40} width={456} height={322} rx={6} fill="none" stroke="#e8eef6" strokeWidth={2} />
        <line x1={230} y1={232} x2={686} y2={232} stroke="#e8eef6" strokeWidth={1.5} />
        <line x1={230} y1={296} x2={686} y2={296} stroke="#e8eef6" strokeWidth={1.5} />
        <line x1={294} y1={232} x2={294} y2={296} stroke="#e8eef6" strokeWidth={1.2} />
        <line x1={512} y1={232} x2={512} y2={296} stroke="#e8eef6" strokeWidth={1.2} />
        <line x1={622} y1={232} x2={622} y2={296} stroke="#e8eef6" strokeWidth={1.2} />
        <line x1={458} y1={296} x2={458} y2={362} stroke="#e8eef6" strokeWidth={1.2} />
        <line x1={686} y1={40} x2={686} y2={362} stroke="#e8eef6" strokeWidth={1.5} />

        {/* display 2x16 */}
        <rect x={298} y={48} width={288} height={58} rx={3} fill="#0d2240" />
        <rect x={304} y={52} width={276} height={50} rx={2} fill={lamp ? '#d8f07a' : 'url(#r311-lcd)'} />
        {[l1, l2].map((t, i) => (
          <text key={i} x={311} y={73 + i * 22} fontSize={19} fontFamily="'Courier New', Consolas, monospace" fontWeight={700} fill="#26360c"
            style={{ whiteSpace: 'pre' }} textLength={262} lengthAdjust="spacingAndGlyphs">{lamp ? '█'.repeat(COLS) : fit(t)}</text>
        ))}

        {/* teclas (nome de cima no display rotativo, de baixo nos menus) */}
        {TOP.map((t, i) => <Lines key={t} x={KEYX[i]} y={i === 0 ? 140 : 152} text={t} size={10.5} />)}
        {KEYX.map((x, i) => (
          <g key={x} className="r311-key" onPointerDown={i === 0 ? () => { setLamp(true); onTargetReset() } : undefined}
            onPointerUp={i === 0 ? () => setLamp(false) : undefined} onPointerLeave={i === 0 ? () => setLamp(false) : undefined}
            onClick={() => keyPress(i)} style={{ cursor: 'pointer' }}>
            <title>{i === 0 ? 'TARGET RESET (segure: LAMP TEST)' : `${TOP[i]} / ${['CANCEL', 'SELECT', '◀', '▶', '▲', '▼', 'EXIT'][i - 1]}`}</title>
            <rect x={x - 22} y={164} width={44} height={44} rx={7} fill="url(#r311-key)" stroke="#dfe8f3" strokeWidth={1.6} />
            <Lines x={x} y={i === 0 ? 182 : 190} text={['LAMP\nTEST', 'CANCEL', 'SELECT', '◀', '▶', '▲', '▼', 'EXIT'][i]} size={i >= 3 && i <= 6 ? 18 : 9.5} />
          </g>
        ))}

        {/* LEDs de alvo */}
        {row1.map(([t, on, c], i) => (
          <g key={i}>
            <Lines x={KEYX[i]} y={248} text={t.length > 7 ? t.slice(0, 7) : t} size={10} />
            <Led x={KEYX[i]} y={270} on={lit(on)} color={c} />
          </g>
        ))}
        <Lines x={567} y={290} text="RECLOSER" size={9.5} />
        {row2.map(([t, on], i) => (
          <g key={i}>
            <Lines x={KEYX[i]} y={312} text={t} size={10} />
            <Led x={KEYX[i]} y={330} on={lit(on)} color="#ff4538" />
          </g>
        ))}
        <Lines x={344} y={352} text="FAULT TYPE" size={9.5} />
        <Lines x={567} y={352} text="ZONE/LEVEL" size={9.5} />

        {/* botões programáveis PB1–PB10 (LED1–LED10) */}
        {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => {
          const { x, y } = pbPos(n)
          return (
            <g key={n}>
              <rect x={x} y={y} width={190} height={44} rx={8} fill="#f3f5f8" stroke="#c8ced8" />
              <g onPointerDown={pbDown(n)} onPointerUp={pbUp} onPointerCancel={pbUp} style={{ cursor: 'pointer' }}>
                <title>{`PB${n} – LED${n}: ${info.static.pb.find((x2) => x2.n === n)?.label_a || '0'}`}</title>
                <circle cx={x + 24} cy={y + 22} r={22} fill="#123d73" stroke="#0a2547" strokeWidth={2} />
                <circle cx={x + 24} cy={y + 22} r={17} fill="url(#r311-key)" />
              </g>
              <Led x={x + 56} y={y + 9} on={lit(pbLed(n))} color="#ffd21f" r={3.6} />
              <Lines x={x + 122} y={titles[n - 1].includes('\n') ? y + 19 : y + 27} text={titles[n - 1] || ' '} size={13.5} fill="#123d73" />
            </g>
          )
        })}
      </svg>
      <div className="relay-tools">
        <span className="muted">Modo do display: {mode.kind === 'rotate' ? 'rotativo (teclas = nomes de cima)' : mode.kind === 'cntrl' ? 'CNTRL – bits locais (teclas = nomes de baixo)' : `${mode.title} (teclas = nomes de baixo; EXIT volta)`}</span>
        <span className="spacer" />
        <button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>{editing ? '✔ Concluir' : '✎ Editar texto dos botões'}</button>
        {editing && <button onClick={() => persist([...DEFAULT_TITLES])}>Restaurar padrão</button>}
      </div>
      {editing && (
        <div className="r311-titles">
          {titles.map((t, i) => (
            <label key={i} className="check">PB{i + 1}
              <input value={t.replace(/\n/g, ' / ')} maxLength={24} onChange={(e) => persist(titles.map((x, j) => (j === i ? e.target.value.replace(/\s*\/\s*/g, '\n') : x)))} />
            </label>
          ))}
          <span className="hint">Use “/” para quebrar a linha. Os textos ficam salvos neste navegador.</span>
        </div>
      )}
    </div>
  )
}
