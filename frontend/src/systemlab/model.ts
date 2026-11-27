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
  /** IED: grupos de medição exibidos na janela lateral (ver IED_MEAS). */
  mshow?: string[]
  /** Elemento Texto: conteúdo (várias linhas separadas por \n). */
  text?: string
  scPos?: { x: number; y: number }
  scOpen?: boolean
  /** IED: oculta da tela o painel flutuante de comandos DNP3 (os atalhos continuam configurados). */
  scHide?: boolean
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
  max?: number
  /** type 'select': valor numérico guardado → rótulo. */
  options?: { v: number; l: string }[]
  /** Mostra o campo só quando o parâmetro `key` vale `v` (ex.: modo de impedância da fonte). */
  when?: { key: string; v: number }
  /** Valor exibido calculado a partir dos parâmetros guardados (ex.: S e FP da carga a partir de P e Q). */
  get?: (el: El) => number | boolean
  /** Parâmetros gravados ao editar o campo (ex.: S → P e Q); sem `put` grava `key` direto. */
  put?: (el: El, v: number | boolean) => Params
}

/** Arredonda para exibição (6 algarismos significativos); os parâmetros convertidos são gravados com precisão total. */
const r6 = (x: number): number => (Number.isFinite(x) ? Number(x.toPrecision(6)) : 0)
const DEG = Math.PI / 180

// ---- Carga: P/Q (MW, Mvar com sinal: + indutiva, − capacitiva) ↔ S/FP. Guardados: p e q (o solver usa esses dois);
//      fp e cap acompanham para não perder o fator de potência quando S = 0. Diagramas antigos (só p, fp, cap) seguem valendo.
export function loadPQ(el: El): { p: number; q: number } {
  const p = Math.max(num(el, 'p'), 0)
  if (typeof el.p.q === 'number' && Number.isFinite(el.p.q)) return { p, q: el.p.q }
  const fp = Math.min(1, Math.max(num(el, 'fp'), 1e-3))
  return { p, q: p * Math.tan(Math.acos(fp)) * (flag(el, 'cap') ? -1 : 1) }
}
function loadView(el: El) {
  const { p, q } = loadPQ(el)
  const s = Math.hypot(p, q)
  const fp = s > 1e-12 ? p / s : Math.min(1, Math.max(num(el, 'fp'), 0))
  const cap = q < 0 ? true : q > 0 ? false : flag(el, 'cap')
  return { p, q, s, fp, cap }
}
const loadWrite = (p: number, q: number, fp: number, cap: boolean): Params => {
  const s = Math.hypot(p, q)
  return { p, q, fp: s > 1e-12 ? p / s : fp, cap: q < 0 || (q === 0 && cap) }
}
function loadFromS(s: number, fp: number, cap: boolean): Params {
  const f = Math.min(1, Math.max(fp, 0))
  return loadWrite(s * f, s * Math.sqrt(1 - f * f) * (cap ? -1 : 1), f, cap)
}

// ---- Linha: R/X (Ω/km) ↔ |Z| e ângulo (Ω/km, °). Guardados: r1, x1, r0, x0 (o solver usa esses); a1/a0 guardam o ângulo quando |Z| = 0.
const lineZ = (el: El, s: '1' | '0') => {
  const r = num(el, `r${s}`), x = num(el, `x${s}`)
  const z = Math.hypot(r, x)
  return { z, a: z > 1e-12 ? Math.atan2(x, r) / DEG : num(el, `a${s}`) }
}
const lineWrite = (s: '1' | '0', z: number, a: number): Params => {
  const ang = Math.min(90, Math.max(0, a))
  const tidy = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v)            // cos 90° e sin 0° não deixam resíduo (7e-17)
  return { [`r${s}`]: tidy(Math.max(z, 0) * Math.cos(ang * DEG)), [`x${s}`]: tidy(Math.max(z, 0) * Math.sin(ang * DEG)), [`a${s}`]: ang }
}

// ---- Fonte: ao trocar o modo de impedância, os campos do novo modo recebem os valores equivalentes aos do modo anterior
//      (mesmas equações do solver, em Ω na tensão nominal da fonte, percentual de 100 %).
function sourceSwitch(el: El, mode: number): Params {
  const old = num(el, 'zmode')
  if (mode === old) return { zmode: mode }
  const vkv = Math.max(num(el, 'vkv'), 1e-6)
  const E = vkv / Math.sqrt(3)                                     // kV fase-neutro (kV/Ω = kA)
  if (mode === 1) {                                                // Ssc, X/R → Isc
    const zm = (vkv * vkv) / Math.max(num(el, 'ssc'), 1e-6)
    const th = Math.atan(Math.max(num(el, 'xr'), 0))
    const r1 = zm * Math.cos(th), x1 = zm * Math.sin(th)
    const legacy = el.p.r0r1 == null && el.p.x0x1 == null && typeof el.p.z0r === 'number'
    const r0 = r1 * (legacy ? (el.p.z0r as number) : Math.max(num(el, 'r0r1'), 0))
    const x0 = x1 * (legacy ? (el.p.z0r as number) : Math.max(num(el, 'x0x1'), 0))
    const zr = 2 * r1 + r0, zx = 2 * x1 + x0
    return { zmode: 1, isc3: E / zm, isc3ang: -th / DEG, isc1: (3 * E) / Math.max(Math.hypot(zr, zx), 1e-9), isc1ang: -Math.atan2(zx, zr) / DEG }
  }
  // Isc → Ssc, X/R: Z1 = E / I3φ ; Z0 = 3E / I1φ − 2·Z1
  const i3 = Math.max(num(el, 'isc3'), 1e-6), t3 = num(el, 'isc3ang') * DEG
  const i1 = Math.max(num(el, 'isc1'), 1e-6), t1 = num(el, 'isc1ang') * DEG
  const z1m = E / i3, r1 = z1m * Math.cos(-t3), x1 = z1m * Math.sin(-t3)
  const z0m = (3 * E) / i1, r0 = z0m * Math.cos(-t1) - 2 * r1, x0 = z0m * Math.sin(-t1) - 2 * x1
  return {
    zmode: 0, ssc: (vkv * vkv) / z1m, xr: r1 > 1e-12 ? Math.max(x1, 0) / r1 : 999,
    r0r1: r1 > 1e-12 ? Math.max(r0 / r1, 0) : 1, x0x1: x1 > 1e-12 ? Math.max(x0 / x1, 0) : 1,
  }
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
    defaults: { vkv: 69, ang: 0, pct: 100, zmode: 0, ssc: 500, xr: 10, r0r1: 1, x0x1: 1, isc3: 4, isc3ang: -85, isc1: 3, isc1ang: -80, gnd: true },
    fields: [
      { key: 'vkv', label: 'Tensão nominal (fase-fase)', unit: 'kV', type: 'number', min: 0 },
      { key: 'ang', label: 'Ângulo da tensão', unit: '°', type: 'number' },
      { key: 'freq', label: 'Frequência', type: 'number', min: 0 },
      { key: 'gnd', label: 'Neutro aterrado', type: 'bool' },
      { key: 'pct', label: 'Percentual da fonte (0 a 1000)', type: 'number', min: 0, max: 1000 },
      { key: 'zmode', label: 'Impedância da fonte', type: 'select', options: [{ v: 0, l: 'Potência de curto e relações X/R' }, { v: 1, l: 'Isc máx (trifásica e monofásica)' }],
        put: (el, v) => sourceSwitch(el, Number(v)) },
      { key: 'ssc', label: 'Potência de curto-circuito', unit: 'MVA', type: 'number', min: 0, when: { key: 'zmode', v: 0 } },
      { key: 'xr', label: 'X1/R1', type: 'number', min: 0, when: { key: 'zmode', v: 0 } },
      { key: 'r0r1', label: 'R0/R1', type: 'number', min: 0, when: { key: 'zmode', v: 0 } },
      { key: 'x0x1', label: 'X0/X1', type: 'number', min: 0, when: { key: 'zmode', v: 0 } },
      { key: 'isc3', label: 'Isc trifásica – módulo', unit: 'kA', type: 'number', min: 0, when: { key: 'zmode', v: 1 } },
      { key: 'isc3ang', label: 'Isc trifásica – ângulo', unit: '°', type: 'number', when: { key: 'zmode', v: 1 } },
      { key: 'isc1', label: 'Isc monofásica – módulo', unit: 'kA', type: 'number', min: 0, when: { key: 'zmode', v: 1 } },
      { key: 'isc1ang', label: 'Isc monofásica – ângulo', unit: '°', type: 'number', when: { key: 'zmode', v: 1 } },
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
    defaults: { p: 10, fp: 0.92, cap: false, lmode: 0 },
    fields: [
      { key: 'lmode', label: 'Ajuste da potência', type: 'select', options: [{ v: 0, l: 'P e Q nominais' }, { v: 1, l: 'S e fator de potência' }] },
      { key: 'p', label: 'Potência ativa P', unit: 'MW', type: 'number', min: 0, when: { key: 'lmode', v: 0 },
        get: (el) => r6(loadView(el).p), put: (el, v) => { const w = loadView(el); return loadWrite(Math.max(Number(v), 0), w.q, w.fp, w.cap) } },
      { key: 'q', label: 'Potência reativa Q (+ indutiva / − capacitiva)', unit: 'Mvar', type: 'number', when: { key: 'lmode', v: 0 },
        get: (el) => r6(loadView(el).q), put: (el, v) => { const w = loadView(el); return loadWrite(w.p, Number(v), w.fp, w.cap) } },
      { key: 's', label: 'Potência aparente S', unit: 'MVA', type: 'number', min: 0, when: { key: 'lmode', v: 1 },
        get: (el) => r6(loadView(el).s), put: (el, v) => { const w = loadView(el); return loadFromS(Math.max(Number(v), 0), w.fp, w.cap) } },
      { key: 'fp', label: 'Fator de potência', type: 'number', min: 0, max: 1, when: { key: 'lmode', v: 1 },
        get: (el) => r6(loadView(el).fp), put: (el, v) => { const w = loadView(el); return loadFromS(w.s, Number(v), w.cap) } },
      { key: 'cap', label: 'Capacitiva (adiantada)', type: 'bool', when: { key: 'lmode', v: 1 },
        get: (el) => loadView(el).cap, put: (el, v) => { const w = loadView(el); return loadFromS(w.s, w.fp, v === true) } },
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
    defaults: { size: 16, bold: false, color: 0, align: 1 },
    fields: [
      { key: 'size', label: 'Tamanho da fonte', unit: 'px', type: 'number', min: 6 },
      { key: 'bold', label: 'Negrito', type: 'bool' },
      { key: 'color', label: 'Cor', type: 'select', options: TEXT_COLORS },
    ],
  },
  line: {
    label: 'Linha',
    prefix: 'LT',
    defaults: { len: 20, r1: 0.1, x1: 0.4, r0: 0.3, x0: 1.2, zm: 0 },
    fields: [
      { key: 'len', label: 'Comprimento', unit: 'km', type: 'number', min: 0.001 },
      { key: 'zm', label: 'Ajuste da impedância', type: 'select', options: [{ v: 0, l: 'Resistência e reatância (Ω/km)' }, { v: 1, l: 'Z1 e Z0: módulo (Ω/km) e ângulo (°)' }] },
      { key: 'r1', label: 'Resistência R (seq. + e −)', unit: 'Ω/km', type: 'number', min: 0, when: { key: 'zm', v: 0 } },
      { key: 'x1', label: 'Reatância indutiva Xl (seq. + e −)', unit: 'Ω/km', type: 'number', min: 0, when: { key: 'zm', v: 0 } },
      { key: 'r0', label: 'Resistência R0 (seq. zero)', unit: 'Ω/km', type: 'number', min: 0, when: { key: 'zm', v: 0 } },
      { key: 'x0', label: 'Reatância Xl0 (seq. zero)', unit: 'Ω/km', type: 'number', min: 0, when: { key: 'zm', v: 0 } },
      { key: 'z1', label: 'Z1 – módulo (seq. + e −)', unit: 'Ω/km', type: 'number', min: 0, when: { key: 'zm', v: 1 },
        get: (el) => r6(lineZ(el, '1').z), put: (el, v) => lineWrite('1', Number(v), lineZ(el, '1').a) },
      { key: 'a1', label: 'Z1 – ângulo', unit: '°', type: 'number', min: 0, max: 90, when: { key: 'zm', v: 1 },
        get: (el) => r6(lineZ(el, '1').a), put: (el, v) => lineWrite('1', lineZ(el, '1').z, Number(v)) },
      { key: 'z0', label: 'Z0 – módulo (seq. zero)', unit: 'Ω/km', type: 'number', min: 0, when: { key: 'zm', v: 1 },
        get: (el) => r6(lineZ(el, '0').z), put: (el, v) => lineWrite('0', Number(v), lineZ(el, '0').a) },
      { key: 'a0', label: 'Z0 – ângulo', unit: '°', type: 'number', min: 0, max: 90, when: { key: 'zm', v: 1 },
        get: (el) => r6(lineZ(el, '0').a), put: (el, v) => lineWrite('0', lineZ(el, '0').z, Number(v)) },
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
    defaults: { ip: 600, is: 5, pol: 0 },
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
