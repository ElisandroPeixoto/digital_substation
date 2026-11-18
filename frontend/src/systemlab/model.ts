/** Modelo do diagrama unifilar do SystemLab (elementos, conexões, geometria dos terminais). */

export type Kind = 'source' | 'breaker' | 'switch' | 'transformer' | 'bus' | 'load' | 'tp' | 'tc' | 'ied' | 'network' | 'battery' | 'inverter'
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
  /** Oculta o nome e os dados do elemento na tela de edição. */
  hide?: boolean
  /** IED: sessão do DigitalRelay associada (id) e rótulo do relé. */
  sid?: string
  rname?: string
  /** IED: elementos do diagrama monitorados/alimentando o relé (ids): disjuntor, TC (correntes) e TP (tensões). */
  links?: { breaker?: number; tc?: number; tp?: number }
}

/** Elementos de comunicação (não participam do cálculo elétrico). */
export const isComm = (k: Kind): boolean => k === 'ied' || k === 'network'
/** Elementos desenhados como barra com terminais a cada célula. */
export const isBar = (k: Kind): boolean => k === 'bus'

/** Terminais da Rede: extremidades dos 8 raios (raio de 38 px). */
export const NET_PORTS = 8
export const NET_R = 38

/** Conexão entre dois terminais: [id do elemento, índice do terminal]. */
export type PortRef = [number, number]
export interface Wire {
  id: number
  a: PortRef
  b: PortRef
  /** Pontos intermediários do trajeto (desenho manual da ligação); vazio = trajeto automático. */
  via?: [number, number][]
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
    defaults: { closed: true, dc: false },
    fields: [
      { key: 'closed', label: 'Fechado', type: 'bool' },
      { key: 'dc', label: 'Circuito CC (desmarcado = CA)', type: 'bool' },
    ],
  },
  switch: {
    label: 'Chave seccionadora',
    prefix: 'SC',
    defaults: { closed: true, dc: false },
    fields: [
      { key: 'closed', label: 'Fechada', type: 'bool' },
      { key: 'dc', label: 'Circuito CC (desmarcado = CA)', type: 'bool' },
    ],
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
    fields: [{ key: 'cells', label: 'Comprimento (células de 20 px, par, até 200)', type: 'number', min: 2 }],
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
  battery: {
    label: 'Bateria',
    prefix: 'BT',
    defaults: { vdc: 1000, cap: 2000, soc: 80, socmin: 10, socmax: 100 },
    fields: [
      { key: 'vdc', label: 'Tensão CC nominal', unit: 'V', type: 'number', min: 1 },
      { key: 'cap', label: 'Capacidade', unit: 'kWh', type: 'number', min: 0 },
      { key: 'soc', label: 'Estado de carga (SOC)', unit: '%', type: 'number', min: 0 },
      { key: 'socmin', label: 'SOC mínimo', unit: '%', type: 'number', min: 0 },
      { key: 'socmax', label: 'SOC máximo', unit: '%', type: 'number', min: 0 },
    ],
  },
  inverter: {
    label: 'Inversor',
    prefix: 'INV',
    defaults: { sn: 2, p: 1, q: 0, eff: 98, vac: 0.48, on: true },
    fields: [
      { key: 'on', label: 'Habilitado', type: 'bool' },
      { key: 'sn', label: 'Potência nominal', unit: 'MVA', type: 'number', min: 0 },
      { key: 'p', label: 'P (+ descarrega / − carrega)', unit: 'MW', type: 'number' },
      { key: 'q', label: 'Q (+ injeta reativo)', unit: 'Mvar', type: 'number' },
      { key: 'eff', label: 'Rendimento', unit: '%', type: 'number', min: 1 },
      { key: 'vac', label: 'Tensão CA nominal (fase-fase; usada ao formar rede ilhada)', unit: 'kV', type: 'number', min: 0.001 },
    ],
  },
  ied: {
    label: 'IED',
    prefix: 'IED',
    defaults: {},
    fields: [],
  },
  network: {
    label: 'Rede',
    prefix: 'RD',
    defaults: {},
    fields: [],
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

export const KIND_ORDER: Kind[] = ['source', 'bus', 'breaker', 'switch', 'transformer', 'load', 'battery', 'inverter', 'tp', 'tc', 'ied', 'network']

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
    case 'ied': return [[0, 30]]
    case 'battery': return [[40, 0]]              // terminal CC
    case 'inverter': return [[-40, 0], [40, 0]]   // 0 = CC (bateria), 1 = CA (rede)
    case 'network': return Array.from({ length: NET_PORTS }, (_, k) => [Math.round(NET_R * Math.cos((k * Math.PI) / 4) * 100) / 100, Math.round(NET_R * Math.sin((k * Math.PI) / 4) * 100) / 100] as [number, number])
    case 'bus': {
      const n = busCells(el)
      return Array.from({ length: n + 1 }, (_, i) => [(i - n / 2) * GRID, 0] as [number, number])
    }
    default: return [[-40, 0], [40, 0]] // breaker, switch, transformer, tc
  }
}

/** Comprimento máximo do barramento (células de GRID px). */
export const BUS_MAX_CELLS = 200

export function busCells(el: El): number {
  const n = Math.round(num(el, 'cells') / 2) * 2
  return Math.min(BUS_MAX_CELLS, Math.max(2, n || 8))
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
    case 'network': return [-46, -46, 92, 92]
    case 'battery': return [-40, -24, 80, 48]
    case 'inverter': return [-40, -24, 80, 48]
    case 'ied': return [-28, -36, 56, 72]
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
