import { useEffect, useRef, useState } from 'react'
import type { Led as LedState, PanelData, SessionInfo } from '../types'
import { LcdLine, useLcd } from './Lcd'
import type { LcdKey } from './Lcd'

export function Led({ led }: { led: LedState }) {
  return <span className={`led ${led.on ? 'on ' + led.color : ''}`} />
}

const DEFAULT_TARGETS = ['INST OC', 'PHASE OC', 'GND/NEU OC', 'NEG SEQ OC', 'O/U FREQ', 'BRKR FAIL']
const DEFAULT_TITLES = ['AUX 1', 'AUX 2', 'AUX 3', 'AUX 4', 'AUX', 'LOCK', 'CLOSE', 'TRIP']
// Coluna esquerda: botões 5 a 8; coluna direita: botões 1 a 4.
const PB_ORDER = [5, 6, 7, 8, 1, 2, 3, 4]
const OFF: LedState = { on: false, color: 'off' }

function loadTitles(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (Array.isArray(raw) && raw.length === 8) return raw.map((t, i) => (typeof t === 'string' ? t : DEFAULT_TITLES[i]))
  } catch {
    /* usa o padrão */
  }
  return [...DEFAULT_TITLES]
}

interface Props {
  info: SessionInfo
  panel: PanelData | null
  onPb: (n: number, pressed: boolean) => void
  onTargetReset: () => void
}

function NavButton({ children, className = '', onClick, title }: { children: React.ReactNode; className?: string; onClick: () => void; title: string }) {
  return (
    <button className={`nav-btn ${className}`} onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  )
}

function PbButton({
  n,
  title,
  editing,
  onTitle,
  labelA,
  labelB,
  a,
  b,
  onPb,
}: {
  n: number
  title: string
  editing: boolean
  onTitle: (t: string) => void
  labelA: string
  labelB: string
  a: LedState
  b: LedState
  onPb: (n: number, pressed: boolean) => void
}) {
  const down = useRef(false)
  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (down.current) return
    down.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onPb(n, true)
  }
  const release = () => {
    if (!down.current) return
    down.current = false
    onPb(n, false)
  }
  return (
    <div className="pb">
      <button
        className="pb-btn"
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        title={`Pressionar PB${n}${labelA || labelB ? ` – ${labelA} / ${labelB}` : ''}`}
        aria-label={`PB${n}`}
      />
      <div className="pb-leds">
        <Led led={a} />
        <Led led={b} />
      </div>
      <div className="pb-label">
        <span className="pb-sub" title={labelA}>{labelA}</span>
        {editing ? (
          <input
            className="pb-title-input"
            value={title}
            maxLength={12}
            aria-label={`Texto do botão PB${n}`}
            onChange={(e) => onTitle(e.target.value)}
          />
        ) : (
          <span className="pb-title">{title}</span>
        )}
        <span className="pb-sub" title={labelB}>{labelB}</span>
      </div>
    </div>
  )
}

export function RelayFront({ info, panel, onPb, onTargetReset }: Props) {
  const { lines, onKey } = useLcd(panel, info)
  const p = panel?.panel
  const key = (k: LcdKey) => () => onKey(k)
  const targets = info.static.targets
  const storageKey = `sel751.pbtitles.${info.relay_id}`
  const [titles, setTitles] = useState<string[]>(() => loadTitles(storageKey))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setTitles(loadTitles(storageKey))
    setEditing(false)
  }, [storageKey])

  const persist = (next: string[]) => {
    setTitles(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* sem armazenamento */
    }
  }
  const setTitle = (n: number, t: string) => persist(titles.map((x, i) => (i === n - 1 ? t : x)))

  return (
    <div className="relay-wrap">
      <div className="relay" aria-label="Painel frontal do relé">
        <div className="relay-head">
          <div className="sel-brand">
            <div className="sel-logo">SEL</div>
            <div className="sel-name">SCHWEITZER<br />ENGINEERING<br />LABORATORIES</div>
          </div>
          <div className="relay-model">
            <div className="model-name">{info.header.RELAYTYPE ?? 'SEL-751'}</div>
            <div className="model-sub">FEEDER PROTECTION RELAY</div>
          </div>
        </div>

        <div className="lcd" role="status" aria-label="Display do relé">
          <LcdLine text={lines[0]} />
          <LcdLine text={lines[1]} />
        </div>

        <div className="nav">
          <NavButton className="tr" onClick={onTargetReset} title="Target reset (limpa LEDs retidos)">
            TARGET<br />RESET
          </NavButton>
          <NavButton className="esc" onClick={key('esc')} title="ESC">ESC</NavButton>
          <div className="arrows">
            <button className="arrow up" onClick={key('up')} aria-label="Cima">▲</button>
            <button className="arrow left" onClick={key('left')} aria-label="Esquerda">◀</button>
            <button className="arrow right" onClick={key('right')} aria-label="Direita">▶</button>
            <button className="arrow down" onClick={key('down')} aria-label="Baixo">▼</button>
          </div>
          <NavButton className="ent" onClick={key('ent')} title="ENT (menu)">↵<br />ENT</NavButton>
        </div>

        <div className="lower">
          <div className="led-strip">
            <div className="led-row">
              <Led led={p?.enabled ?? OFF} />
              <span>ENABLED</span>
            </div>
            <div className="led-row">
              <Led led={p?.trip ?? OFF} />
              <span>TRIP</span>
            </div>
            {targets.map((t, i) => {
              const st = p?.targets.find((x) => x.id === t.id)
              return (
                <div className="led-row" key={t.id} title={`${t.id}: ${t.label}${t.latched ? ' (retido)' : ''}`}>
                  <Led led={st ? { on: st.on, color: st.color } : OFF} />
                  <span>{t.label || DEFAULT_TARGETS[i] || t.id}</span>
                </div>
              )
            })}
          </div>
          <div className="pb-grid">
            {PB_ORDER.map((n) => {
              const st = p?.pb.find((x) => x.n === n)
              const sinfo = info.static.pb.find((x) => x.n === n)
              return (
                <PbButton
                  key={n}
                  n={n}
                  title={titles[n - 1]}
                  editing={editing}
                  onTitle={(t) => setTitle(n, t)}
                  labelA={sinfo?.label_a ?? ''}
                  labelB={sinfo?.label_b ?? ''}
                  a={st?.a ?? OFF}
                  b={st?.b ?? OFF}
                  onPb={onPb}
                />
              )
            })}
          </div>
        </div>

        <div className="relay-foot">
          <div className="portf">
            <div className="db9" />
            <span>PORT F</span>
          </div>
        </div>
      </div>

      <div className="relay-tools">
        <button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)} title="Edita o texto grande no centro de cada botão">
          {editing ? '✔ Concluir edição' : '✎ Editar texto dos botões'}
        </button>
        {editing && (
          <button onClick={() => persist([...DEFAULT_TITLES])}>Restaurar padrão</button>
        )}
        <span className="muted">{editing ? 'Digite no centro de cada botão (até 12 caracteres).' : 'Os textos ficam salvos neste navegador.'}</span>
      </div>
    </div>
  )
}
