import { useState } from 'react'
import type { ReactNode } from 'react'

export function Pill({ on, onLabel = '1', offLabel = '0', title }: { on: boolean | number | null; onLabel?: string; offLabel?: string; title?: string }) {
  if (on === null) return <span className="pill na">–</span>
  const v = Boolean(on)
  return (
    <span className={`pill ${v ? 'on' : 'off'}`} title={title}>
      {v ? onLabel : offLabel}
    </span>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      <span className="toggle-label">{label}</span>
    </label>
  )
}

export function NumField({
  label,
  value,
  onCommit,
  unit,
  step = 1,
  min,
  width,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  unit?: string
  step?: number
  min?: number
  width?: number
}) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text !== null) {
      const n = Number(text.replace(',', '.'))
      if (Number.isFinite(n) && (min === undefined || n >= min)) onCommit(n)
      setText(null)
    }
  }
  return (
    <label className="numfield">
      <span>{label}</span>
      <span className="numfield-box">
        <input
          type="number"
          step={step}
          min={min}
          style={width ? { width } : undefined}
          value={text ?? String(Math.round(value * 1000) / 1000)}
          onFocus={() => setText(String(value))}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setText(null)
          }}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  )
}

/** Campo numérico compacto (sem rótulo) que só aplica o valor ao sair do campo ou com Enter. */
export function NumInput({
  value,
  onCommit,
  step = 1,
  min,
  width = 84,
  digits = 3,
  label,
}: {
  value: number
  onCommit: (v: number) => void
  step?: number
  min?: number
  width?: number
  digits?: number
  label?: string
}) {
  const [text, setText] = useState<string | null>(null)
  const f = Math.pow(10, digits)
  const commit = () => {
    if (text !== null) {
      const n = Number(text.replace(',', '.'))
      if (Number.isFinite(n) && (min === undefined || n >= min)) onCommit(n)
      setText(null)
    }
  }
  return (
    <input
      type="number"
      className="numinput"
      aria-label={label}
      step={step}
      min={min}
      style={{ width }}
      value={text ?? String(Math.round(value * f) / f)}
      onFocus={() => setText(String(Math.round(value * f) / f))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(null)
      }}
    />
  )
}

export function Section({ title, children, right, open = true, count }: { title: string; children: ReactNode; right?: ReactNode; open?: boolean; count?: number }) {
  return (
    <details className="section" open={open}>
      <summary>
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
        {right && <span className="section-right" onClick={(e) => e.stopPropagation()}>{right}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  )
}

export function Bar({ pct, tone = 'blue' }: { pct: number; tone?: 'blue' | 'red' }) {
  return (
    <div className="bar" title={`${pct.toFixed(0)}%`}>
      <div className={`bar-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
