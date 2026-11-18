import { time51 } from './curves'

export interface Elem51 {
  on: boolean
  pickup: number // A secundários
  curve: string
  td: number
  ct: number
  mr: number
}
export interface Elem50 {
  on: boolean
  pickup: number // A secundários
  delay: number // s
}
export interface Relay {
  id: number
  name: string
  ctr: number
  ctrn: number
  /** Cor base das curvas do relé (padrão: paleta por posição). */
  color?: string
  p51: Elem51
  n51: Elem51
  p50: Elem50
  n50: Elem50
}

const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export const COLORS = ['#3182ce', '#e53e3e', '#38a169', '#d69e2e', '#805ad5', '#dd6b20', '#319795', '#d53f8c']

export type Kind = '51P' | '51N' | '50P' | '50N'
export const KIND_INFO: Record<Kind, { label: string; dash: string; width: number }> = {
  '51P': { label: '51 Fase', dash: '', width: 2.4 },
  '51N': { label: '51 Neutro', dash: '8 4', width: 2.4 },
  '50P': { label: '50 Fase', dash: '2 3', width: 3 },
  '50N': { label: '50 Neutro', dash: '10 3 2 3', width: 3 },
}

export function newRelay(id: number, name: string, over: Partial<Relay> = {}): Relay {
  return {
    id, name, ctr: 120, ctrn: 120,
    p51: { on: true, pickup: 5, curve: 'C1', td: 0.3, ct: 0, mr: 0 },
    n51: { on: true, pickup: 1, curve: 'C1', td: 0.2, ct: 0, mr: 0 },
    p50: { on: true, pickup: 40, delay: 0 },
    n50: { on: true, pickup: 6, delay: 0 },
    ...over,
  }
}

export interface Curve {
  key: string
  relayId: number
  relayName: string
  kind: Kind
  label: string
  color: string
  ipk: number // pickup em A primários
  pickupSec: number
  /** Tempo de atuação para a corrente primária I; null = não atua. */
  time: (i: number) => number | null
  /** Corrente secundária equivalente (para exibição). */
  sec: (i: number) => number
  delay?: number
  info: string
}

/** Constrói as curvas ativas de todos os relés (em A primários). */
export function buildCurves(relays: Relay[], saturate: boolean): Curve[] {
  const out: Curve[] = []
  relays.forEach((r, idx) => {
    const color = r.color ?? COLORS[idx % COLORS.length]
    const add = (kind: Kind, ct: number, e: Elem51 | Elem50) => {
      if (!e.on || !(e.pickup > 0) || !(ct > 0)) return
      const ipk = e.pickup * ct
      const base = { key: `${r.id}:${kind}`, relayId: r.id, relayName: r.name, kind, label: `${r.name} – ${kind}`, color, ipk, pickupSec: e.pickup, sec: (i: number) => i / ct }
      if (kind === '51P' || kind === '51N') {
        const x = e as Elem51
        out.push({ ...base, time: (i) => { const t = time51(x.curve, i / ipk, x.td, x.ct, x.mr, saturate); return Number.isFinite(t) ? t : null },
          info: `${x.curve}, TD ${num(x.td)}${x.ct ? `, CT ${num(x.ct)} s` : ''}${x.mr ? `, MR ${num(x.mr)} s` : ''}` })
      } else {
        const x = e as Elem50
        out.push({ ...base, delay: x.delay, time: (i) => (i >= ipk ? x.delay : null), info: `atraso ${num(x.delay)} s` })
      }
    }
    add('51P', r.ctr, r.p51)
    add('51N', r.ctrn, r.n51)
    add('50P', r.ctr, r.p50)
    add('50N', r.ctrn, r.n50)
  })
  return out
}
