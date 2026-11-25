/** Modelo do diagrama unifilar do SystemLab (elementos, conexões, geometria dos terminais). */

export type Kind = 'source' | 'breaker' | 'switch' | 'transformer' | 'bus' | 'load' | 'tp' | 'tc' | 'ied' | 'fault' | 'line' | 'transformer3' | 'text' | 'battery' | 'inverter'
export type Params = Record<string, number | boolean>

export type ShortcutKind = 'cmd' | 'bit' | 'meas'
/** Atalho em tela de um IED, sempre um ponto do mapa DNP3 do relé: BO (comando), BI (valor binário) ou AI (medida). */
export interface Shortcut { id: number; kind: ShortcutKind; label: string; index: number; name: string; unit?: string; dec?: number }

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
  links?: { breaker?: number; tc?: number; tc2?: number; tc3?: number; tp?: number; tps?: number }
  /** IED: modelo do relé ('751', '787' ou '2440'); no 787 o TC (W1) e os TC2/TC3 alimentam os enrolamentos 1 a 3. */
  model?: string
  /** IED: atalhos exibidos no painel flutuante, posição do painel (px no canvas) e se está expandido. */
  sc?: Shortcut[]
  /** Elemento Texto: conteúdo (várias linhas separadas por \n). */
  text?: string
  scPos?: { x: number; y: number }
  scOpen?: boolean
}

/** Elementos de comunicação (não participam do cálculo elétrico). */
export const isComm = (k: Kind): boolean => k === 'ied'
/** Elementos desenhados como barra com terminais a cada célula. */
export const isBar = (k: Kind): boolean => k === 'bus'

/** Conexão entre dois terminais: [id do elemento, índice do terminal]. */
export type PortRef = [number, number]
export interface Wire {
  id: number
  a: PortRef
  b: PortRef
  /** Pontos intermediários do trajeto (desenho manual da ligação); vazio = trajeto automático. */
  via?: [number, number][]
  /** Ligação a um trecho de outra ligação (derivação): `b` é o terminal `a` da ligação-alvo (mesmo nó elétrico) e `tap` guarda a ligação-alvo e o ponto
   *  (mundo) onde a derivação encosta nela; o desenho reprojeta o ponto sobre o trajeto atual do alvo. */
  tap?: { w: number; x: number; y: number }
}

export interface Diagram {
  els: El[]
  wires: Wire[]
  nextId: number
  /** Título e descrição da simulação (configurações); sem título = DEFAULT_TITLE. */
  title?: string
  desc?: string
}

export const DEFAULT_TITLE = 'Sem título 1'

export const GRID = 20

export interface Field {
  key: string
  label: string
  unit?: string
  type: 'number' | 'bool' | 'select'
  min?: number
  /** type 'select': valor numérico guardado → rótulo. */
  options?: { v: number; l: string }[]
}

/** Tipos de falta (valor guardado em `type` do elemento Falta). */
export const FAULT_TYPES: { v: number; l: string; short: string }[] = [
  { v: 0, l: 'A-B-C', short: 'A-B-C' },
  { v: 1, l: 'A-N', short: 'A-N' }, { v: 2, l: 'B-N', short: 'B-N' }, { v: 3, l: 'C-N', short: 'C-N' },
  { v: 4, l: 'A-B', short: 'A-B' }, { v: 5, l: 'B-C', short: 'B-C' }, { v: 6, l: 'C-A', short: 'C-A' },
  { v: 7, l: 'A-B-N', short: 'A-B-N' }, { v: 8, l: 'B-C-N', short: 'B-C-N' }, { v: 9, l: 'C-A-N', short: 'C-A-N' },
]
/** Esquema de ligação do transformador (IEC 60076-1): maiúsculas = terminal 1 (alta), minúsculas = terminal 2; N/n = neutro aterrado;
 *  o número é o índice horário: a tensão do terminal 2 atrasa a do terminal 1 em número × 30° (sequência positiva). */
export interface VGroup { v: number; l: string; hv: 'D' | 'Y' | 'YN'; lv: 'd' | 'y' | 'yn'; clock: number }
const VG: [string, VGroup['hv'], VGroup['lv'], number][] = [
  ['Dyn1', 'D', 'yn', 1], ['Dyn11', 'D', 'yn', 11], ['Dyn5', 'D', 'yn', 5], ['Dyn7', 'D', 'yn', 7],
  ['Dy1', 'D', 'y', 1], ['Dy11', 'D', 'y', 11],
  ['YNd1', 'YN', 'd', 1], ['YNd11', 'YN', 'd', 11], ['YNd5', 'YN', 'd', 5], ['YNd7', 'YN', 'd', 7],
  ['Yd1', 'Y', 'd', 1], ['Yd11', 'Y', 'd', 11],
  ['YNyn0', 'YN', 'yn', 0], ['Yyn0', 'Y', 'yn', 0], ['YNy0', 'YN', 'y', 0], ['Yy0', 'Y', 'y', 0],
  ['Dd0', 'D', 'd', 0], ['Dd6', 'D', 'd', 6],
]
const wTxt = (w: string) => (w.toUpperCase() === 'D' ? 'Δ' : w.toUpperCase().startsWith('YN') ? 'Y aterrado' : 'Y isolado')
export const VGROUPS: VGroup[] = VG.map(([l, hv, lv, clock], v) => ({ v, l, hv, lv, clock }))
export const VGROUP_OPTIONS = VGROUPS.map((g) => ({ v: g.v, l: `${g.l} – ${wTxt(g.hv)} / ${wTxt(g.lv)}, ${g.clock * 30}°` }))
/** Esquema de ligação do transformador de 3 enrolamentos: tipos (0 = Y isolado, 1 = Δ, 2 = Y aterrado) de P, S e T e índices horários de S e T em relação a P. */
export interface T3Group { v: number; l: string; w: [number, number, number]; clk: [number, number, number] }
const T3G: [string, number, number, number, number, number][] = [
  ['YNyn0d1', 2, 2, 1, 0, 1], ['YNyn0d11', 2, 2, 1, 0, 11], ['YNyn0yn0', 2, 2, 2, 0, 0], ['YNyn0y0', 2, 2, 0, 0, 0],
  ['YNd1d1', 2, 1, 1, 1, 1], ['YNd11d11', 2, 1, 1, 11, 11], ['Dyn1yn1', 1, 2, 2, 1, 1], ['Dyn11yn11', 1, 2, 2, 11, 11], ['Dd0d0', 1, 1, 1, 0, 0], ['Dy11y11', 1, 0, 0, 11, 11],
]
const wName = (w: number) => (w === 1 ? 'Δ' : w === 2 ? 'Y aterrado' : 'Y')
export const T3GROUPS: T3Group[] = T3G.map(([l, a, b, c, s2, t2], v) => ({ v, l, w: [a, b, c], clk: [0, s2, t2] }))
export const T3GROUP_OPTIONS = T3GROUPS.map((g) => ({ v: g.v, l: `${g.l} – ${g.w.map(wName).join(' / ')}` }))
export const t3group = (el: El): T3Group => T3GROUPS.find((g) => g.v === Math.round(num(el, 'tgrp'))) ?? T3GROUPS[0]
export const vgroup = (el: El): VGroup => VGROUPS.find((g) => g.v === Math.round(num(el, 'grp'))) ?? VGROUPS[0]

export interface KindInfo {
  label: string
  prefix: string
  defaults: Params
  fields: Field[]
}

/** Modo do inversor: 0 = automático (comportamento original: segue a rede; sem fonte na ilha, o primeiro inversor apto forma a rede),
 *  1 = seguidor de rede (P/Q constantes, nunca forma a rede), 2 = formador de rede (fonte de tensão; vários formadores na mesma ilha dividem a carga em paralelo). */
export const INVERTER_MODES = [{ v: 0, l: 'Automático (padrão)' }, { v: 1, l: 'Seguidor de rede (P/Q)' }, { v: 2, l: 'Formador de rede (tensão)' }]

/** Cores do elemento Texto (variáveis de tema). */
export const TEXT_COLORS = [{ v: 0, l: 'Padrão' }, { v: 1, l: 'Azul' }, { v: 2, l: 'Verde-água' }, { v: 3, l: 'Vermelho' }, { v: 4, l: 'Cinza' }]
export const TEXT_COLOR_VAR = ['var(--ink)', 'var(--accent)', 'var(--accent-2)', 'var(--err)', 'var(--muted)']

/** Fase medida por um TP monofásico (fase-neutro): índice guardado em `ph`. */
export const TP_PHASES = ['A', 'B', 'C']
/** Índice da fase do TP monofásico, limitado a A/B/C (diagramas antigos podiam ter fase-fase). */
export const tpPhase = (el: El): number => Math.min(2, Math.max(0, Math.round(num(el, 'ph'))))
/** Rótulo do TP no unifilar: "3φ" ou "1φ A". */
export const tpTag = (el: El): string => (num(el, 'phases') === 1 ? `1φ ${TP_PHASES[tpPhase(el)]}` : '3φ')

export const KINDS: Record<Kind, KindInfo> = {
  source: {
    label: 'Fonte',
    prefix: 'G',
    defaults: { vkv: 69, ang: 0, ssc: 500, xr: 10, gnd: true, z0r: 1 },
    fields: [
      { key: 'vkv', label: 'Tensão nominal (fase-fase)', unit: 'kV', type: 'number', min: 0 },
      { key: 'ang', label: 'Ângulo da tensão', unit: '°', type: 'number' },
      { key: 'ssc', label: 'Potência de curto-circuito', unit: 'MVA', type: 'number', min: 0 },
      { key: 'xr', label: 'Relação X/R', type: 'number', min: 0 },
      { key: 'gnd', label: 'Neutro aterrado', type: 'bool' },
      { key: 'z0r', label: 'Z0/Z1 (seq. zero; só se aterrado)', type: 'number', min: 0.01 },
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
    defaults: { sn: 20, v1: 69, v2: 13.8, z: 8, xr: 10, grp: 0 },
    fields: [
      { key: 'sn', label: 'Potência nominal', unit: 'MVA', type: 'number', min: 0 },
      { key: 'v1', label: 'Tensão nominal – terminal 1', unit: 'kV', type: 'number', min: 0 },
      { key: 'v2', label: 'Tensão nominal – terminal 2', unit: 'kV', type: 'number', min: 0 },
      { key: 'z', label: 'Impedância', unit: '%', type: 'number', min: 0 },
      { key: 'xr', label: 'Relação X/R', type: 'number', min: 0 },
      { key: 'grp', label: 'Esquema de ligação (terminal 1 = maiúsculas)', type: 'select', options: VGROUP_OPTIONS },
    ],
  },
  transformer3: {
    label: 'Transformador de 3 enrolamentos',
    prefix: 'T3',
    defaults: { sn: 30, ss: 30, st: 10, v1: 138, v2: 69, v3: 13.8, zps: 10, zpt: 17, zst: 6, xr: 10, tgrp: 0 },
    fields: [
      { key: 'sn', label: 'Potência – primário (P)', unit: 'MVA', type: 'number', min: 0 },
      { key: 'ss', label: 'Potência – secundário (S)', unit: 'MVA', type: 'number', min: 0 },
      { key: 'st', label: 'Potência – terciário (T)', unit: 'MVA', type: 'number', min: 0 },
      { key: 'v1', label: 'Tensão nominal – P', unit: 'kV', type: 'number', min: 0 },
      { key: 'v2', label: 'Tensão nominal – S', unit: 'kV', type: 'number', min: 0 },
      { key: 'v3', label: 'Tensão nominal – T', unit: 'kV', type: 'number', min: 0 },
      { key: 'zps', label: 'Impedância P–S (base = potência de P)', unit: '%', type: 'number', min: 0 },
      { key: 'zpt', label: 'Impedância P–T (base = potência de P)', unit: '%', type: 'number', min: 0 },
      { key: 'zst', label: 'Impedância S–T (base = potência de P)', unit: '%', type: 'number', min: 0 },
      { key: 'xr', label: 'Relação X/R', type: 'number', min: 0 },
      { key: 'tgrp', label: 'Esquema de ligação (P, S, T)', type: 'select', options: T3GROUP_OPTIONS },
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
    defaults: { vp: 13.8, vs: 115, phases: 3, ph: 0 },
    fields: [
      { key: 'phases', label: 'Tipo do TP', type: 'select', options: [{ v: 3, l: 'Trifásico' }, { v: 1, l: 'Monofásico' }] },
      { key: 'ph', label: 'Fase utilizada (monofásico)', type: 'select', options: TP_PHASES.map((l, v) => ({ v, l })) },
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
    defaults: { sn: 2, p: 1, q: 0, eff: 98, vac: 0.48, on: true, mode: 0 },
    fields: [
      { key: 'on', label: 'Habilitado', type: 'bool' },
      { key: 'mode', label: 'Modo de operação', type: 'select', options: INVERTER_MODES },
      { key: 'sn', label: 'Potência nominal', unit: 'MVA', type: 'number', min: 0 },
      { key: 'p', label: 'P (+ descarrega / − carrega)', unit: 'MW', type: 'number' },
      { key: 'q', label: 'Q (+ injeta reativo)', unit: 'Mvar', type: 'number' },
      { key: 'eff', label: 'Rendimento', unit: '%', type: 'number', min: 1 },
      { key: 'vac', label: 'Tensão CA nominal (fase-fase; usada ao formar rede ilhada)', unit: 'kV', type: 'number', min: 0.001 },
    ],
  },
  text: {
    label: 'Texto',
    prefix: 'TX',
    defaults: { size: 16, bold: false, color: 0 },
    fields: [
      { key: 'size', label: 'Tamanho da fonte', unit: 'px', type: 'number', min: 6 },
      { key: 'bold', label: 'Negrito', type: 'bool' },
      { key: 'color', label: 'Cor', type: 'select', options: TEXT_COLORS },
    ],
  },
  line: {
    label: 'Linha',
    prefix: 'LT',
    defaults: { len: 20, r1: 0.1, x1: 0.4, r0: 0.3, x0: 1.2 },
    fields: [
      { key: 'len', label: 'Comprimento', unit: 'km', type: 'number', min: 0.001 },
      { key: 'r1', label: 'Resistência R (seq. + e −)', unit: 'Ω/km', type: 'number', min: 0 },
      { key: 'x1', label: 'Reatância indutiva Xl (seq. + e −)', unit: 'Ω/km', type: 'number', min: 0 },
      { key: 'r0', label: 'Resistência R0 (seq. zero)', unit: 'Ω/km', type: 'number', min: 0 },
      { key: 'x0', label: 'Reatância Xl0 (seq. zero)', unit: 'Ω/km', type: 'number', min: 0 },
    ],
  },
  fault: {
    label: 'Falta',
    prefix: 'F',
    defaults: { type: 1, rf: 0, on: true, pos: 50 },
    fields: [
      { key: 'on', label: 'Falta aplicada', type: 'bool' },
      { key: 'type', label: 'Tipo de falta', type: 'select', options: FAULT_TYPES.map((t) => ({ v: t.v, l: t.l })) },
      { key: 'rf', label: 'Resistência de falta', unit: 'Ω', type: 'number', min: 0 },
    ],
  },
  ied: {
    label: 'IED',
    prefix: 'IED',
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

export const KIND_ORDER: Kind[] = ['source', 'bus', 'breaker', 'switch', 'transformer', 'transformer3', 'line', 'load', 'battery', 'inverter', 'tp', 'tc', 'fault', 'ied', 'text']

/** Parâmetro numérico; ausente (diagrama salvo antes do parâmetro existir) = valor padrão do tipo. */
export function num(el: El, key: string): number {
  const v = el.p[key] ?? KINDS[el.kind].defaults[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
export const flag = (el: El, key: string): boolean => (el.p[key] ?? KINDS[el.kind].defaults[key]) === true

/** Terminais no referencial local (elemento na orientação original, centro em 0,0). */
export function localPorts(el: El): [number, number][] {
  switch (el.kind) {
    case 'source': return [[40, 0]]
    case 'load': return [[-40, 0]]
    case 'tp': return [[0, -40]]
    case 'line': return [[-60, 0], [60, 0], [0, -8]]              // 0 e 1 = extremos; 2 = ponto central (derivação para uma falta)
    case 'transformer3': return [[-60, 0], [60, -20], [60, 20]]   // 0 = P (esquerda), 1 = S (direita, acima), 2 = T (direita, abaixo)
    case 'fault': return [[0, 40]]               // ponto de ligação sai da ponta (seta) do raio, de cima para baixo
    case 'text': return []                         // sem terminais
    case 'ied': return []                          // sem terminais: relés do mesmo projeto IEC61850 se comunicam
    case 'battery': return [[40, 0]]              // terminal CC
    case 'inverter': return [[-40, 0], [40, 0]]   // 0 = CC (bateria), 1 = CA (rede)
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
    case 'line': return [-62, -16, 124, 32]
    case 'transformer3': return [-62, -48, 124, 96]
    case 'bus': { const h = busCells(el) * 10; return [-h - 6, -9, 2 * h + 12, 18] }
    case 'battery': return [-40, -24, 80, 48]
    case 'inverter': return [-40, -24, 80, 48]
    case 'ied': return [-28, -36, 56, 72]
    case 'text': {
      const lines = (el.text ?? 'Texto').split('\n')
      const size = Math.max(6, num(el, 'size'))
      const w = Math.max(30, Math.max(...lines.map((l) => l.length)) * size * 0.62 + 10)
      const h = lines.length * size * 1.25 + 6
      return [-w / 2, -h / 2, w, h]
    }
    case 'load': return [-40, -18, 60, 36]
    case 'tp': return [-20, -40, 40, 68]
    case 'fault': return [-20, -40, 40, 80]
    case 'tc': return [-40, -18, 80, 28]
  }
}

export function makeElement(kind: Kind, id: number, x: number, y: number, existing: El[]): El {
  const info = KINDS[kind]
  const n = existing.filter((e) => e.kind === kind).length + 1
  let name = `${info.prefix}${n}`
  while (existing.some((e) => e.name === name)) name = `${info.prefix}${(Number(name.slice(info.prefix.length)) || n) + 1}`
  return { id, kind, x, y, rot: 0, name, p: { ...info.defaults }, ...(kind === 'text' ? { text: 'Texto' } : {}) }
}
