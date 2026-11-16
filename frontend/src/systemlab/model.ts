/** Modelo do diagrama unifilar do SystemLab (elementos, conexões, geometria dos terminais). */

export type Kind = 'source' | 'breaker' | 'switch' | 'transformer' | 'bus' | 'load' | 'tp' | 'tc'
export type Params = Record<string, number | boolean>

export interface El {
  id: number
  kind: Kind
  x: number
  y: number
  /** Rotação em passos de 90° (sentido horário). */
  rot: number
  name: string
  p: Params
}

/** Conexão entre dois terminais: [id do elemento, índice do terminal]. */
export type PortRef = [number, number]
export interface Wire {
  id: number
  a: PortRef
  b: PortRef
}

export interface Diagram {
  els: El[]
  wires: Wire[]
  nextId: number
}

export const GRID = 20

export interface Field {
  key: string
  label: string
  unit?: string
  type: 'number' | 'bool'
  min?: number
}

export interface KindInfo {
  label: string
  prefix: string
  defaults: Params
  fields: Field[]
}

export const KINDS: Record<Kind, KindInfo> = {
  source: {
    label: 'Fonte',
    prefix: 'G',
    defaults: { vkv: 69, ang: 0, ssc: 500, xr: 10 },
    fields: [
      { key: 'vkv', label: 'Tensão nominal (fase-fase)', unit: 'kV', type: 'number', min: 0 },
      { key: 'ang', label: 'Ângulo da tensão', unit: '°', type: 'number' },
      { key: 'ssc', label: 'Potência de curto-circuito', unit: 'MVA', type: 'number', min: 0 },
      { key: 'xr', label: 'Relação X/R', type: 'number', min: 0 },
    ],
  },
  breaker: {
    label: 'Disjuntor',
    prefix: 'DJ',
    defaults: { closed: true },
    fields: [{ key: 'closed', label: 'Fechado', type: 'bool' }],
  },
  switch: {
    label: 'Chave seccionadora',
    prefix: 'SC',
    defaults: { closed: true },
    fields: [{ key: 'closed', label: 'Fechada', type: 'bool' }],
  },
  transformer: {
    label: 'Transformador',
    prefix: 'TR',
    defaults: { sn: 20, v1: 69, v2: 13.8, z: 8, xr: 10 },
    fields: [
      { key: 'sn', label: 'Potência nominal', unit: 'MVA', type: 'number', min: 0 },
      { key: 'v1', label: 'Tensão nominal – terminal 1', unit: 'kV', type: 'number', min: 0 },
      { key: 'v2', label: 'Tensão nominal – terminal 2', unit: 'kV', type: 'number', min: 0 },
      { key: 'z', label: 'Impedância', unit: '%', type: 'number', min: 0 },
      { key: 'xr', label: 'Relação X/R', type: 'number', min: 0 },
    ],
  },
  bus: {
    label: 'Barramento',
    prefix: 'BA',
    defaults: { cells: 8 },
    fields: [{ key: 'cells', label: 'Comprimento (células de 20 px, par)', type: 'number', min: 2 }],
  },
  load: {
    label: 'Carga',
    prefix: 'CG',
    defaults: { p: 10, fp: 0.92, cap: false },
    fields: [
      { key: 'p', label: 'Potência ativa', unit: 'MW', type: 'number', min: 0 },
      { key: 'fp', label: 'Fator de potência', type: 'number', min: 0 },
      { key: 'cap', label: 'Capacitiva (adiantada)', type: 'bool' },
    ],
  },
  tp: {
    label: 'TP',
    prefix: 'TP',
    defaults: { vp: 13.8, vs: 115 },
    fields: [
      { key: 'vp', label: 'Primário (fase-fase)', unit: 'kV', type: 'number', min: 0 },
      { key: 'vs', label: 'Secundário (fase-fase)', unit: 'V', type: 'number', min: 0 },
    ],
  },
  tc: {
    label: 'TC',
    prefix: 'TC',
    defaults: { ip: 600, is: 5 },
    fields: [
      { key: 'ip', label: 'Primário', unit: 'A', type: 'number', min: 0 },
      { key: 'is', label: 'Secundário', unit: 'A', type: 'number', min: 0 },
    ],
  },
}

export const KIND_ORDER: Kind[] = ['source', 'bus', 'breaker', 'switch', 'transformer', 'load', 'tp', 'tc']

export function num(el: El, key: string): number {
  const v = el.p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
export const flag = (el: El, key: string): boolean => el.p[key] === true

/** Terminais no referencial local (elemento na orientação original, centro em 0,0). */
export function localPorts(el: El): [number, number][] {
  switch (el.kind) {
    case 'source': return [[40, 0]]
    case 'load': return [[-40, 0]]
    case 'tp': return [[0, -40]]
    case 'bus': {
      const n = busCells(el)
      return Array.from({ length: n + 1 }, (_, i) => [(i - n / 2) * GRID, 0] as [number, number])
    }
    default: return [[-40, 0], [40, 0]] // breaker, switch, transformer, tc
  }
}

export function busCells(el: El): number {
  const n = Math.round(num(el, 'cells') / 2) * 2
  return Math.min(40, Math.max(2, n || 8))
}

export function rotate(x: number, y: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-y, x]
    case 2: return [-x, -y]
    case 3: return [y, -x]
    default: return [x, y]
  }
}

export function worldPorts(el: El): [number, number][] {
  return localPorts(el).map(([x, y]) => {
    const [rx, ry] = rotate(x, y, el.rot)
    return [el.x + rx, el.y + ry] as [number, number]
  })
}

/** Retângulo de captura (referencial local): [x, y, largura, altura]. */
export function hitRect(el: El): [number, number, number, number] {
  switch (el.kind) {
    case 'source': return [-26, -26, 52, 52]
    case 'breaker': return [-22, -22, 44, 44]
    case 'switch': return [-40, -16, 80, 32]
    case 'transformer': return [-32, -22, 64, 44]
    case 'bus': { const h = busCells(el) * 10; return [-h - 6, -9, 2 * h + 12, 18] }
    case 'load': return [-40, -18, 60, 36]
    case 'tp': return [-20, -40, 40, 68]
    case 'tc': return [-40, -18, 80, 28]
  }
}

export function makeElement(kind: Kind, id: number, x: number, y: number, existing: El[]): El {
  const info = KINDS[kind]
  const n = existing.filter((e) => e.kind === kind).length + 1
  let name = `${info.prefix}${n}`
  while (existing.some((e) => e.name === name)) name = `${info.prefix}${(Number(name.slice(info.prefix.length)) || n) + 1}`
  return { id, kind, x, y, rot: 0, name, p: { ...info.defaults } }
}
