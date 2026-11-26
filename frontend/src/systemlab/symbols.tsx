import { TEXT_COLOR_VAR, busCells, flag, isBar, num, tpTag, type El, type Kind, hitRect } from './model'

interface Props {
  kind: Kind
  color: string
  /** Estado (disjuntor/seccionadora fechados) e, para o barramento, o comprimento em células. */
  closed?: boolean
  cells?: number
  /** Disjuntor/seccionadora de circuito CC: mostra a marca "CC". */
  dc?: boolean
  /** TP: rótulo "3φ" / "1φ A". */
  tag?: string
}

/** Símbolo unifilar na orientação original, centrado em (0,0); terminais em ±40 (ou conforme o tipo). */
export function SymbolShape({ kind, color, closed = true, cells = 8, dc = false, tag }: Props) {
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
          {dc && <text x={0} y={-23} textAnchor="middle" fontSize={10} fontWeight={700} fill={color} stroke="none">CC</text>}
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
          {dc && <text x={0} y={-20} textAnchor="middle" fontSize={10} fontWeight={700} fill={color} stroke="none">CC</text>}
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
    case 'transformer3':
      // três círculos entrelaçados: P à esquerda, S à direita (acima) e T à direita (abaixo)
      return (
        <g {...s}>
          <line x1={-60} y1={0} x2={-44} y2={0} />
          <line x1={44} y1={-20} x2={60} y2={-20} />
          <line x1={44} y1={20} x2={60} y2={20} />
          <circle cx={-18} cy={0} r={26} />
          <circle cx={18} cy={-20} r={26} />
          <circle cx={18} cy={20} r={26} />
        </g>
      )
    case 'line':
      // trecho de linha alongado, com marcas diagonais; o ponto central (topo) recebe uma falta
      return (
        <g {...s}>
          <line x1={-60} y1={0} x2={-44} y2={0} />
          <line x1={44} y1={0} x2={60} y2={0} />
          <rect x={-44} y={-8} width={88} height={16} rx={2} />
          <path d="M -32 6 L -24 -6 M -12 6 L -4 -6 M 8 6 L 16 -6 M 28 6 L 36 -6" />
        </g>
      )
    case 'bus':
      return <line x1={-cells * 10} y1={0} x2={cells * 10} y2={0} stroke={color} strokeWidth={6} strokeLinecap="round" />
    case 'text':
      // ícone da barra de elementos
      return <text x={0} y={12} textAnchor="middle" fontSize={34} fontWeight={700} fill={color} stroke="none" fontFamily="Montserrat, Segoe UI, sans-serif">Aa</text>
    case 'ied':
      // frontal de relé: corpo azul, display e dois botões (sem nome do modelo)
      return (
        <g>
          <rect x={-26} y={-34} width={52} height={64} rx={3} fill="#12406b" stroke={color} strokeWidth={2} />
          <rect x={-19} y={-27} width={38} height={28} rx={1.5} fill="none" stroke="#8fb0d4" strokeWidth={3} />
          {[-19, 2].map((x) => (
            <g key={x}>
              <rect x={x} y={8} width={17} height={9} rx={4.5} fill="#8fb0d4" />
              <circle cx={x + 5} cy={12.5} r={3.2} fill="#12406b" stroke="#8fb0d4" strokeWidth={1.2} />
            </g>
          ))}
        </g>
      )
    case 'battery':
      // símbolo de bateria: placas longas (+) e curtas (−) alternadas; terminal CC à direita
      return (
        <g {...s}>
          {[-30, -12, 6].map((x) => (
            <g key={x}>
              <line x1={x} y1={-18} x2={x} y2={18} strokeWidth={3} />
              <line x1={x + 9} y1={-9} x2={x + 9} y2={9} strokeWidth={5} />
            </g>
          ))}
          <line x1={-38} y1={0} x2={-30} y2={0} />
          <line x1={15} y1={0} x2={40} y2={0} />
          <text x={-27} y={-21} fontSize={10} fontWeight={700} fill={color} stroke="none">+</text>
        </g>
      )
    case 'inverter':
      // conversor CC/CA: caixa com diagonal; CC (=) no canto superior esquerdo e CA (~) no inferior direito
      return (
        <g {...s}>
          <line x1={-40} y1={0} x2={-28} y2={0} />
          <line x1={28} y1={0} x2={40} y2={0} />
          <rect x={-28} y={-22} width={56} height={44} />
          <line x1={-28} y1={22} x2={28} y2={-22} />
          <line x1={-20} y1={-13} x2={-6} y2={-13} strokeWidth={1.8} />
          <line x1={-20} y1={-8} x2={-6} y2={-8} strokeWidth={1.8} strokeDasharray="3 2" />
          <path d="M 6 11 C 9 5 12 5 15 11 S 21 17 24 11" strokeWidth={1.8} />
        </g>
      )
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
          {tag && <text x={22} y={-24} fontSize={11} fontWeight={700} fill={color} stroke="none" fontFamily="Montserrat, Segoe UI, sans-serif">{tag}</text>}
        </g>
      )
    case 'fault':
      // raio de cima para baixo; a seta (ponta) do raio liga ao ponto da falta pelo terminal inferior
      return (
        <g {...s}>
          <path d="M 6 -36 L -6 -8 L 6 -8 L 0 22" strokeWidth={3} stroke="var(--err)" strokeLinejoin="round" />
          <path d="M -7 14 L 0 26 L 7 14 Z" fill="var(--err)" stroke="var(--err)" strokeLinejoin="round" />
          <line x1={0} y1={26} x2={0} y2={40} />
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

/** Elemento Texto: várias linhas centradas, com tamanho, negrito e cor. */
let measureCtx: CanvasRenderingContext2D | null = null
/** Largura (px) de um texto na fonte dada, medida num canvas (usada no texto justificado). */
function textWidth(t: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return t.length * 8
  measureCtx.font = font
  return measureCtx.measureText(t).width
}

/** Alinhamento do elemento Texto (`align`): 0 = esquerda, 1 = centralizado (padrão), 2 = direita, 3 = justificado. */
function TextShape({ el }: { el: El }) {
  const lines = (el.text ?? 'Texto').split('\n')
  const size = Math.max(6, num(el, 'size'))
  const fill = TEXT_COLOR_VAR[Math.round(num(el, 'color'))] ?? TEXT_COLOR_VAR[0]
  const y0 = -((lines.length - 1) * size * 1.25) / 2 + size * 0.35
  const align = el.p.align == null ? 1 : Math.round(num(el, 'align'))
  const [bx, , bw] = hitRect(el)
  const left = bx + 5
  const width = bw - 10
  const x = align === 1 ? 0 : align === 2 ? left + width : left
  const anchor = align === 1 ? 'middle' : align === 2 ? 'end' : 'start'
  // justificado: distribui a sobra entre as palavras (word-spacing), exceto na última linha de cada parágrafo (seguida de linha vazia ou fim)
  const font = `${flag(el, 'bold') ? 700 : 400} ${size}px Montserrat, Segoe UI, sans-serif`
  const justify = (i: number): { wordSpacing: number } | Record<string, never> => {
    if (align !== 3 || i >= lines.length - 1 || lines[i + 1].trim() === '') return {}
    const l = lines[i]
    const spaces = (l.trim().match(/ +/g) ?? []).length
    const free = width - textWidth(l, font)
    return spaces > 0 && free > 0 ? { wordSpacing: free / spaces } : {}
  }
  return (
    <text x={x} y={y0} textAnchor={anchor} fontSize={size} fontWeight={flag(el, 'bold') ? 700 : 400} fill={fill} stroke="none" fontFamily="Montserrat, Segoe UI, sans-serif" pointerEvents="none">
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : size * 1.25} {...justify(i)}>{l || ' '}</tspan>
      ))}
    </text>
  )
}

export function ElementSymbol({ el, color }: { el: El; color: string }) {
  if (el.kind === 'text') return <TextShape el={el} />
  return <SymbolShape kind={el.kind} color={color} closed={flag(el, 'closed')} dc={flag(el, 'dc')} cells={isBar(el.kind) ? busCells(el) : undefined} tag={el.kind === 'tp' ? tpTag(el) : undefined} />
}
