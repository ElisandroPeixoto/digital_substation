import { busCells, flag, type El, type Kind } from './model'

interface Props {
  kind: Kind
  color: string
  /** Estado (disjuntor/seccionadora fechados) e, para o barramento, o comprimento em células. */
  closed?: boolean
  cells?: number
}

/** Símbolo unifilar na orientação original, centrado em (0,0); terminais em ±40 (ou conforme o tipo). */
export function SymbolShape({ kind, color, closed = true, cells = 8 }: Props) {
  const s = { stroke: color, fill: 'none', strokeWidth: 2, strokeLinecap: 'round' as const }
  switch (kind) {
    case 'source':
      return (
        <g {...s}>
          <circle cx={0} cy={0} r={24} />
          <path d="M -12 0 C -8 -12 -4 -12 0 0 S 8 12 12 0" />
          <line x1={24} y1={0} x2={40} y2={0} />
        </g>
      )
    case 'breaker':
      return (
        <g {...s}>
          <line x1={-40} y1={0} x2={-18} y2={0} />
          <line x1={18} y1={0} x2={40} y2={0} />
          <rect x={-18} y={-18} width={36} height={36} fill={closed ? color : 'var(--panel)'} />
        </g>
      )
    case 'switch':
      return (
        <g {...s}>
          <line x1={-40} y1={0} x2={-14} y2={0} />
          <line x1={14} y1={0} x2={40} y2={0} />
          <circle cx={-14} cy={0} r={2.5} fill="var(--panel)" />
          <circle cx={14} cy={0} r={2.5} fill="var(--panel)" />
          {closed ? <line x1={-14} y1={0} x2={14} y2={0} /> : <line x1={-14} y1={0} x2={10} y2={-15} />}
        </g>
      )
    case 'transformer':
      return (
        <g {...s}>
          <line x1={-40} y1={0} x2={-29} y2={0} />
          <line x1={29} y1={0} x2={40} y2={0} />
          <circle cx={-11} cy={0} r={18} />
          <circle cx={11} cy={0} r={18} />
        </g>
      )
    case 'bus':
      return <line x1={-cells * 10} y1={0} x2={cells * 10} y2={0} stroke={color} strokeWidth={6} strokeLinecap="round" />
    case 'load':
      return (
        <g {...s}>
          <line x1={-40} y1={0} x2={-20} y2={0} />
          <polygon points="-20,-14 -20,14 16,0" />
        </g>
      )
    case 'tp':
      // duas semicircunferências em U (primário) e duas em arco (secundário), unidas por um eixo vertical
      return (
        <g {...s}>
          <line x1={0} y1={-40} x2={0} y2={-19} />
          <path d="M -16.2 -19 A 8.1 8.1 0 0 0 0 -19 A 8.1 8.1 0 0 0 16.2 -19" />
          <path d="M -16.2 3.5 A 8.1 8.1 0 0 1 0 3.5 A 8.1 8.1 0 0 1 16.2 3.5" />
          <line x1={0} y1={3.5} x2={0} y2={24.5} />
        </g>
      )
    case 'tc':
      return (
        <g {...s}>
          <line x1={-40} y1={0} x2={40} y2={0} />
          <path d="M -15 0 A 7.5 7.5 0 0 1 0 0 A 7.5 7.5 0 0 1 15 0" strokeWidth={2.2} />
        </g>
      )
  }
}

export function ElementSymbol({ el, color }: { el: El; color: string }) {
  return <SymbolShape kind={el.kind} color={color} closed={flag(el, 'closed')} cells={el.kind === 'bus' ? busCells(el) : undefined} />
}
