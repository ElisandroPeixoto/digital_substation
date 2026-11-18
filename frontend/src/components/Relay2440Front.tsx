import { useState } from 'react'
import { labelOf, type Texts } from '../customTexts'
import type { IoData } from '../types'

interface Props {
  io: IoData
  texts: Texts
  /** Alterna a entrada (clique no LED de um ponto de entrada). */
  onToggleInput: (name: string) => void
}

const COLX = (k: number) => 437 + k * 18.47          // colunas 1..16 da matriz de LEDs
const ROWY = [229, 246, 262]                           // linhas 100 / 200 / 300

/** LED vermelho (aceso) ou apagado. */
function Led({ x, y, on, color = '#ff3b2f', r = 4.2, title, onClick }: { x: number; y: number; on: boolean; color?: string; r?: number; title?: string; onClick?: () => void }) {
  return (
    <g onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {title && <title>{title}</title>}
      {onClick && <circle cx={x} cy={y} r={9} fill="transparent" />}
      {on && <circle cx={x} cy={y} r={r + 3.5} fill={color} opacity={0.28} />}
      <circle cx={x} cy={y} r={on ? r : 2.6} fill={on ? color : '#8fa3bd'} opacity={on ? 1 : 0.55} stroke={on ? '#ffc4bd' : 'none'} strokeWidth={0.7} />
    </g>
  )
}

/** Réplica do frontal do SEL-2440 (imagem de referência): 3 linhas de 16 LEDs de E/S, LEDs de estado e das portas. */
export function Relay2440Front({ io, texts, onToggleInput }: Props) {
  const [lamp, setLamp] = useState(false)
  const st = io.status
  const lit = (v: boolean) => lamp || v

  return (
    <svg className="r2440" viewBox="0 0 1500 330" role="img" aria-label="Frontal do SEL-2440">
      <defs>
        <linearGradient id="r2440-blue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d5aa8" />
          <stop offset="1" stopColor="#083f7c" />
        </linearGradient>
        <linearGradient id="r2440-ear" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e6eaf0" />
          <stop offset="1" stopColor="#c7cdd6" />
        </linearGradient>
      </defs>

      {/* orelhas de fixação do rack e corpo */}
      <rect x={2} y={40} width={50} height={258} rx={6} fill="url(#r2440-ear)" />
      <rect x={1448} y={40} width={50} height={258} rx={6} fill="url(#r2440-ear)" />
      {[58, 100, 230, 272].map((y) => (
        <g key={y}>
          <rect x={14} y={y - 8} width={26} height={16} rx={8} fill="#7b8696" opacity={0.85} />
          <rect x={1460} y={y - 8} width={26} height={16} rx={8} fill="#7b8696" opacity={0.85} />
        </g>
      ))}
      <rect x={42} y={34} width={1416} height={266} rx={7} fill="url(#r2440-blue)" stroke="#06336a" strokeWidth={2} />
      <rect x={42} y={34} width={1416} height={5} rx={3} fill="#aeb7c4" opacity={0.7} />
      {[[66, 163], [1431, 163]].map(([x, y]) => (
        <g key={x}>
          <circle cx={x} cy={y} r={10} fill="#c7ced8" stroke="#8a94a3" strokeWidth={1.5} />
          <line x1={x - 6} y1={y - 4} x2={x + 6} y2={y + 4} stroke="#6c7686" strokeWidth={2} />
        </g>
      ))}

      {/* logotipo SEL */}
      <rect x={108} y={64} width={80} height={46} rx={11} fill="none" stroke="#fff" strokeWidth={3} />
      <text x={148} y={99} textAnchor="middle" fontSize={34} fontWeight={900} fill="#fff" fontFamily="Arial Black, Arial, sans-serif">SEL</text>
      <g fill="#fff" fontFamily="Arial, sans-serif" fontSize={13} letterSpacing={1.1}>
        <text x={204} y={73}>SCHWEITZER</text>
        <text x={204} y={88}>ENGINEERING</text>
        <text x={204} y={103}>LABORATORIES</text>
        <text x={204} y={114} fontSize={7.5} letterSpacing={0.6}>PULLMAN, WASHINGTON USA</text>
      </g>

      {/* identificação do produto */}
      <g transform="translate(1230 82)" fill="#fff">
        <path d="M0 -12 L-6 -4 L-2 -4 L-2 -2 L-12 -2 L-12 -6 L-20 0 L-12 6 L-12 2 L-2 2 L-2 12 L-6 12 L0 20 L6 12 L2 12 L2 2 L12 2 L12 6 L20 0 L12 -6 L12 -2 L2 -2 L2 -4 L6 -4 Z" />
      </g>
      <g fill="#fff" fontFamily="Arial, sans-serif" fontWeight={700}>
        <text x={1259} y={77} fontSize={20}>DPAC</text>
        <text x={1259} y={99} fontSize={19}>SEL-2440</text>
        <text x={1259} y={116} fontSize={12.5}>DISCRETE PROGRAMMABLE</text>
        <text x={1259} y={131} fontSize={12.5}>AUTOMATION CONTROLLER</text>
      </g>

      {/* painel de controle e indicação */}
      <rect x={58} y={198} width={706} height={90} rx={9} fill="#0a4a92" stroke="#fff" strokeWidth={1.6} />
      {[140, 200, 295, 423].map((x) => <line key={x} x1={x} y1={198} x2={x} y2={288} stroke="#fff" strokeWidth={1.4} />)}

      {/* USB */}
      <rect x={78} y={214} width={34} height={32} rx={3} fill="#e8ecf2" stroke="#fff" />
      <rect x={85} y={222} width={20} height={17} fill="#26324a" />
      <path d="M85 222 h20 v5 h-20 z" fill="#3b4a6a" />
      <g stroke="#fff" fill="#fff" strokeWidth={1.6}>
        <line x1={84} y1={270} x2={108} y2={270} />
        <circle cx={84} cy={270} r={2.4} />
        <rect x={104} y={267} width={5} height={5} />
        <path d="M92 270 l5 -7 M95 270 l5 6" fill="none" />
      </g>

      {/* LAMP TEST */}
      <g
        onPointerDown={() => setLamp(true)} onPointerUp={() => setLamp(false)} onPointerLeave={() => setLamp(false)}
        style={{ cursor: 'pointer' }}
      >
        <title>Teste de lâmpadas: mantenha pressionado para acender todos os LEDs</title>
        <rect x={152} y={218} width={37} height={42} rx={7} fill={lamp ? '#1a6ec7' : '#08437f'} stroke="#fff" strokeWidth={2} />
        <text x={170.5} y={236} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" fontFamily="Arial, sans-serif">LAMP</text>
        <text x={170.5} y={248} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" fontFamily="Arial, sans-serif">TEST</text>
      </g>

      {/* LEDs de estado */}
      <g fontFamily="Arial, sans-serif" fontSize={11.5} fontWeight={700} fill="#fff">
        <Led x={213} y={231} on={lit(st.enabled)} color="#3ddc5a" r={3.6} />
        <text x={229} y={235}>ENABLED</text>
        <Led x={213} y={247} on={lit(st.alarm)} color="#ff3b2f" r={3.6} />
        <text x={229} y={251}>ALARM</text>
        <Led x={213} y={263} on={lit(st.mode)} color="#ffc21a" r={3.6} />
        <text x={229} y={267}>MODE</text>
      </g>

      {/* portas */}
      <g fontFamily="Arial, sans-serif" fill="#fff" fontWeight={700}>
        {['1A', '1B', '2', '3'].map((p, k) => <text key={p} x={311 + k * 21} y={217} fontSize={11.5} textAnchor="middle">{p}</text>)}
        <text x={389} y={233} fontSize={11.5}>LNK</text>
        <text x={389} y={250} fontSize={11.5}>TX</text>
        <text x={389} y={266} fontSize={11.5}>RX</text>
      </g>
      {(['1A', '1B', '2', '3'] as const).map((p, k) => {
        const link = !!st.ports[p]
        const x = 311 + k * 21
        return (
          <g key={p}>
            <Led x={x} y={229} on={lit(link && (p === '1A' || p === '1B'))} color="#ffc21a" r={3.4} />
            <Led x={x} y={246} on={lit(link && p !== '3')} color="#3ddc5a" r={3.4} />
            <Led x={x} y={262} on={lit(p === '3')} color="#ff3b2f" r={3.4} />
          </g>
        )
      })}
      <g stroke="#fff" fill="none" strokeWidth={1.4}>
        <rect x={314} y={274} width={8} height={6} />
        <rect x={307} y={282} width={7} height={5} /><rect x={322} y={282} width={7} height={5} />
        <path d="M318 280 v2 M310.5 282 v-2 h15 v2" />
      </g>
      <text x={352} y={284} fontSize={12} fontWeight={700} fill="#fff" fontFamily="Arial, sans-serif" letterSpacing={0.5}>10101</text>

      {/* matriz de LEDs de E/S: linhas 100, 200 e 300 */}
      <g fontFamily="Arial, sans-serif" fontSize={11} fontWeight={700} fill="#fff" textAnchor="middle">
        {Array.from({ length: 16 }, (_, k) => <text key={k} x={COLX(k)} y={217}>{k + 1}</text>)}
      </g>
      {io.slots.map((slot, r) => (
        <g key={slot.slot}>
          <text x={737} y={ROWY[r] + 4} fontSize={12} fontWeight={700} fill="#fff" fontFamily="Arial, sans-serif">{slot.slot}00</text>
          {slot.points.map((p, k) => {
            const isIn = slot.kind === 'in' || slot.kind === 'mixed' || slot.kind === 'empty'
            const on = slot.kind === 'out' ? p.out_on : slot.kind === 'mixed' ? p.in_on || p.out_on : p.in_on
            const clickable = isIn && (p.in_used || slot.kind === 'empty')
            const il = labelOf(texts, p.in, p.in_label)
            const ol = labelOf(texts, p.out, p.out_label)
            const t = slot.kind === 'out'
              ? `${p.out}${ol ? ` – ${ol}` : ''}: ${p.out_on ? 'ligada' : 'desligada'}`
              : `${p.in}${il ? ` – ${il}` : ''}: ${p.in_on ? 'ativa' : 'inativa'}${clickable ? ' (clique para alternar)' : ''}${slot.kind === 'mixed' && p.out_used ? ` | ${p.out}: ${p.out_on ? 'ligada' : 'desligada'}` : ''}`
            return <Led key={k} x={COLX(k)} y={ROWY[r]} on={lit(on)} title={t} onClick={clickable ? () => onToggleInput(p.in) : undefined} />
          })}
        </g>
      ))}
    </svg>
  )
}
