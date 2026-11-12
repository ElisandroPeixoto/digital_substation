import { fromPolar, niceCeil } from '../phasor'

export interface PhasorItem {
  label: string
  mag: number
  ang: number
  color: string
}

const S = 300
const C = S / 2
const R = 112

function fmtScale(v: number): string {
  return v >= 1000 ? `${v / 1000}k` : String(v)
}

export function PhasorDiagram({ id, title, unit, items }: { id: string; title: string; unit: string; items: PhasorItem[] }) {
  const max = niceCeil(Math.max(0, ...items.map((i) => i.mag)))
  const px = (m: number) => (m / max) * R
  return (
    <figure className="phasor">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Diagrama fasorial de ${title}`}>
        <defs>
          {items.map((it, i) => (
            <marker key={i} id={`${id}-a${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={it.color} />
            </marker>
          ))}
        </defs>
        <circle cx={C} cy={C} r={R} className="ph-ring" />
        <circle cx={C} cy={C} r={R / 2} className="ph-ring dashed" />
        <line x1={C - R - 8} y1={C} x2={C + R + 8} y2={C} className="ph-axis" />
        <line x1={C} y1={C - R - 8} x2={C} y2={C + R + 8} className="ph-axis" />
        <text x={C + R + 4} y={C - 4} className="ph-tick" textAnchor="end">0°</text>
        <text x={C + 4} y={C - R - 2} className="ph-tick">90°</text>
        <text x={C - R - 4} y={C - 4} className="ph-tick">180°</text>
        <text x={C + 4} y={C + R + 12} className="ph-tick">-90°</text>
        <text x={C + 3} y={C - R / 2 + 10} className="ph-tick">{fmtScale(max / 2)}</text>
        <text x={C + 3} y={C - R + 10} className="ph-tick">{fmtScale(max)} {unit}</text>
        {items.map((it, i) => {
          if (it.mag <= 1e-9) return null
          const tip = fromPolar(px(it.mag), it.ang)
          const x = C + tip.re
          const y = C - tip.im
          const lab = fromPolar(px(it.mag) + 12, it.ang)
          return (
            <g key={it.label}>
              <line x1={C} y1={C} x2={x} y2={y} stroke={it.color} strokeWidth={2.4} markerEnd={`url(#${id}-a${i})`} />
              <text x={C + lab.re} y={C - lab.im + 4} fill={it.color} className="ph-label" textAnchor="middle">{it.label}</text>
            </g>
          )
        })}
        <circle cx={C} cy={C} r={2.5} fill="#44506b" />
      </svg>
    </figure>
  )
}
