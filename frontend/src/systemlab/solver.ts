/**
 * Solver de regime permanente do SystemLab: sistema trifásico equilibrado, em por unidade (Sbase = 100 MVA),
 * análise nodal com impedâncias constantes.
 *
 * - Fonte: tensão atrás da impedância de curto-circuito (Zs = V²/Scc, com X/R).
 * - Transformador: impedância série (z% na própria base), sem derivação; a base de tensão muda pela relação nominal.
 * - Carga: impedância constante, calculada na tensão nominal da zona (P, FP).
 * - Disjuntor/seccionadora/TC fechados: impedância desprezível; abertos: sem ligação. TP: sem influência (medição).
 * - Partes sem caminho fechado até uma fonte ficam desenergizadas (V = 0).
 * - Inversor (BESS): potência constante P/Q no lado CA (resolvida por iteração), limitada pela potência nominal e pelo SOC da(s)
 *   bateria(s) ligadas ao seu lado CC; segue a rede (desliga com tensão CA < 0,1 pu). Se a ilha CA não tem fonte, o primeiro
 *   inversor apto (SOC acima do mínimo) forma a rede: fonte de tensão de 1 pu (tensão CA nominal) com 5 % de impedância interna.
 *   A bateria é estática: o SOC é um parâmetro (não evolui no tempo); o resultado mostra a corrente CC e o tempo até o limite de SOC.
 * - Falta (opcional, `withFault`): estudo por componentes simétricas (redes de seq. positiva, negativa e zero) com a falta no terminal do
 *   elemento Falta; ver `faultStudy` no fim do arquivo.
 */
import { FAULT_TYPES, busCells, flag, isComm, num, t3group, vgroup, type El, type Wire } from './model'

export const DEFAULT_SBASE = 100 // MVA
/** Potência de base (MVA) da última chamada de `solve` (módulo síncrono: ajustada no início de cada cálculo). */
let SBASE = DEFAULT_SBASE
const Y_SWITCH = 1e4 // pu (Z = 1e-4 pu)

interface Cx { re: number; im: number }
const cx = (re = 0, im = 0): Cx => ({ re, im })
const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im)
const sub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im)
const mul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
const conj = (a: Cx): Cx => cx(a.re, -a.im)
const abs = (a: Cx): number => Math.hypot(a.re, a.im)
const polar = (m: number, deg: number): Cx => cx(m * Math.cos((deg * Math.PI) / 180), m * Math.sin((deg * Math.PI) / 180))
const deg = (a: Cx): number => (abs(a) < 1e-12 ? 0 : (Math.atan2(a.im, a.re) * 180) / Math.PI)

export interface Ph { mag: number; ang: number }

/** Resultado por elemento. Grandezas por terminal, na ordem dos terminais; positivas ENTRANDO no elemento. */
export interface ElResult {
  energized: boolean
  /** Tensão fase-fase por terminal (kV) */
  v: Ph[]
  /** Corrente de linha por terminal (A) */
  i: Ph[]
  /** Potência ativa/reativa por terminal (MW / Mvar) */
  p: number[]
  q: number[]
  /** Fonte/carga: potência entregue/consumida; TP: tensão secundária; TC: corrente secundária; trafo: carregamento */
  extra: Record<string, number>
  /** Observação de estado (ex.: inversor limitado pelo SOC). */
  note?: string
  /** Tensão de base (kV, fase-fase) de cada terminal, para exibir em pu. */
  kvb?: number[]
}

export interface Solution {
  res: Map<number, ElResult>
  /** Nó elétrico de cada terminal (`id:índice`) e se está energizado, para colorir as ligações. */
  nodeEnergized: Map<string, boolean>
  totals: { gen: number; genQ: number; load: number; loadQ: number; loss: number }
  /** Estudo de falta (só com `withFault` e uma Falta aplicada em ponto energizado); `res` já traz as grandezas em falta. */
  fault?: FaultStudy | null
}

/** Fasores por fase (A, B, C) e componentes de sequência (1 = positiva, 2 = negativa, 0 = zero; valor da componente, não 3×). */
export interface PhasorSet { a: Ph; b: Ph; c: Ph; s1: Ph; s2: Ph; s0: Ph }
/** Em falta, por terminal do elemento: tensão fase-neutro (kV) e corrente (A, entrando no elemento; fonte: entregue). */
export interface FaultTerm { v: PhasorSet; i: PhasorSet; kvb: number }
export interface FaultInfo {
  elId: number; type: number; label: string; rf: number
  /** Corrente de falta (A) e tensão fase-neutro no ponto da falta (kV). */
  i: PhasorSet; v: PhasorSet
  /** Impedâncias de Thévenin vistas do ponto (Ω); z0 = null quando não há caminho de seq. zero (sem aterramento). */
  z1: Ph; z2: Ph; z0: Ph | null
  /** Falta em linha: nome da linha e posição (% do comprimento a partir do terminal 1). */
  line?: { name: string; pos: number }
}
export interface FaultStudy { info: FaultInfo; terms: Map<number, FaultTerm[]>; warns: string[] }

function zUnit(zAbs: number, xr: number): Cx {
  const r = zAbs / Math.sqrt(1 + xr * xr)
  return cx(r, r * xr)
}

/** Resolve Y·V = I (eliminação de Gauss com pivoteamento parcial). */
function gauss(Y: Cx[][], I: Cx[]): Cx[] {
  const n = I.length
  const a = Y.map((row, i) => [...row.map((c) => ({ ...c })), { ...I[i] }])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (abs(a[r][c]) > abs(a[p][c])) p = r
    ;[a[c], a[p]] = [a[p], a[c]]
    const piv = a[c][c]
    if (abs(piv) < 1e-18) continue
    for (let r = c + 1; r < n; r++) {
      const f = div(a[r][c], piv)
      if (abs(f) === 0) continue
      for (let k = c; k <= n; k++) a[r][k] = sub(a[r][k], mul(f, a[c][k]))
    }
  }
  const x: Cx[] = Array.from({ length: n }, () => cx())
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n]
    for (let k = r + 1; k < n; k++) s = sub(s, mul(a[r][k], x[k]))
    x[r] = abs(a[r][r]) < 1e-18 ? cx() : div(s, a[r][r])
  }
  return x
}

class UF {
  p: number[]
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i) }
  find(x: number): number { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x] } return x }
  union(a: number, b: number) { this.p[this.find(a)] = this.find(b) }
}

/** Pares de terminais do transformador de 3 enrolamentos: P–S, P–T, S–T. */
const T3_PAIRS: [number, number][] = [[0, 1], [0, 2], [1, 2]]
interface T3Info { z: [Cx, Cx, Cx]; y: [Cx, Cx, Cx]; ph: [number, number, number]; w: [number, number, number] }

/** Equivalente do transformador de 3 enrolamentos. `zscale` converte (% ÷ 100) da base do primário para o pu do sistema. */
function t3Info(e: El, zscale: number): T3Info {
  const xr = Math.max(num(e, 'xr'), 0)
  const z = (k: string) => zUnit(Math.max((num(e, k) / 100) * zscale, 1e-6), xr)
  const zps = z('zps')
  const zpt = z('zpt')
  const zst = z('zst')
  const half = (a: Cx, b: Cx, c: Cx): Cx => { const t = sub(add(a, b), c); const h = cx(t.re / 2, t.im / 2); return abs(h) < 1e-5 ? cx(1e-5, 0) : h }
  const zp = half(zps, zpt, zst)
  const zs = half(zps, zst, zpt)
  const zt = half(zpt, zst, zps)
  const yp = div(cx(1), zp)
  const ys = div(cx(1), zs)
  const yt = div(cx(1), zt)
  const sum = add(add(yp, ys), yt)
  const g = t3group(e)
  const al = [0, g.clk[1] * 30, g.clk[2] * 30]
  return {
    z: [zp, zs, zt],
    y: [div(mul(yp, ys), sum), div(mul(yp, yt), sum), div(mul(ys, yt), sum)],
    ph: [al[1] - al[0], al[2] - al[0], al[2] - al[1]],
    w: g.w,
  }
}

/** `ph`: defasagem (°) do transformador (a corrente em a é y·(Va − e^{jph}·Vb)). */
interface Branch { a: number; b: number; y: Cx; ph?: number }

/** `energize` falso (simulação parada): fontes e inversores desligados, nada é energizado. */
export function solve(allEls: El[], allWires: Wire[], energize = true, withFault = false, sbase = DEFAULT_SBASE): Solution {
  SBASE = Number.isFinite(sbase) && sbase > 0 ? sbase : DEFAULT_SBASE
  // elementos de comunicação (IED, Rede) e suas ligações não participam do cálculo elétrico
  const comm = new Set(allEls.filter((e) => isComm(e.kind)).map((e) => e.id))
  const els = allEls.filter((e) => !comm.has(e.id) && (energize || e.kind !== 'source'))
  const wires = allWires.filter((w) => !comm.has(w.a[0]) && !comm.has(w.b[0]))
  // ---- nós elétricos: terminais ligados por fios (e todos os terminais de um barramento) formam um nó
  const idx = new Map<string, number>()
  const elById = new Map<number, El>()
  let count = 0
  const nPorts = (e: El) => (e.kind === 'source' || e.kind === 'load' || e.kind === 'tp' || e.kind === 'battery' || e.kind === 'fault' ? 1 : e.kind === 'bus' ? busCells(e) + 1 : e.kind === 'transformer3' ? 3 : 2)
  for (const e of els) {
    elById.set(e.id, e)
    for (let k = 0; k < nPorts(e); k++) idx.set(`${e.id}:${k}`, count++)
  }
  const uf = new UF(count)
  for (const e of els) if (e.kind === 'bus') for (let k = 1; k < nPorts(e); k++) uf.union(idx.get(`${e.id}:0`)!, idx.get(`${e.id}:${k}`)!)
  for (const w of wires) {
    const a = idx.get(`${w.a[0]}:${w.a[1]}`)
    const b = idx.get(`${w.b[0]}:${w.b[1]}`)
    if (a != null && b != null) uf.union(a, b)
  }
  const node = (e: El, k: number) => uf.find(idx.get(`${e.id}:${k}`)!)

  // ---- conectividade por ramos fechados (disjuntor/chave fechados, TC, transformador): ilhas CA e CC
  const uc = new UF(count)
  for (const e of els) {
    if ((e.kind === 'breaker' || e.kind === 'switch') ? flag(e, 'closed') : (e.kind === 'tc' || e.kind === 'transformer' || e.kind === 'line')) uc.union(node(e, 0), node(e, 1))
    if (e.kind === 'transformer3') { uc.union(node(e, 0), node(e, 1)); uc.union(node(e, 0), node(e, 2)) }
  }

  // ---- BESS: inversores alimentados pelas baterias da mesma ilha CC (nós ligados por disjuntores/chaves fechados).
  // Com fonte na ilha CA o inversor segue a rede (P/Q constantes); sem fonte, o primeiro inversor habilitado forma a rede (tensão fixa).
  interface Inv {
    e: El; nDc: number; nAc: number; p: number; q: number; active: boolean; note: string; pdc: number; eff: number
    forming: boolean; canForm: boolean; vac: number; ys: Cx; E: Cx; iInj: Cx
  }
  const bats = els.filter((e) => e.kind === 'battery')
  const invs: Inv[] = els.filter((e) => e.kind === 'inverter').map((e) => {
    const nDc = node(e, 0)
    const nAc = node(e, 1)
    const inv: Inv = {
      e, nDc, nAc, p: 0, q: 0, active: false, note: '', pdc: 0, eff: Math.min(1, Math.max(num(e, 'eff') / 100, 0.01)),
      forming: false, canForm: false, vac: Math.max(num(e, 'vac') || 0.48, 1e-6), ys: cx(), E: cx(1, 0), iInj: cx(),
    }
    const bs = bats.filter((b) => uc.find(node(b, 0)) === uc.find(nDc))
    if (!energize) { inv.note = 'simulação parada'; return inv }
    if (!flag(e, 'on')) { inv.note = 'desligado'; return inv }
    if (bs.length === 0) { inv.note = 'sem bateria no lado CC'; return inv }
    let p = num(e, 'p')
    let q = num(e, 'q')
    const sn = Math.max(num(e, 'sn'), 1e-6)
    const sAbs = Math.hypot(p, q)
    if (sAbs > sn) { p *= sn / sAbs; q *= sn / sAbs; inv.note = 'limitado pela potência nominal' }
    const cap = bs.reduce((a, b) => a + num(b, 'cap'), 0)
    const soc = cap > 0 ? bs.reduce((a, b) => a + num(b, 'soc') * num(b, 'cap'), 0) / cap : num(bs[0], 'soc')
    const socMin = Math.max(...bs.map((b) => num(b, 'socmin')))
    inv.canForm = soc > socMin
    if (p > 0 && soc <= socMin) { p = 0; inv.note = 'SOC no mínimo: sem descarga' }
    if (p < 0 && soc >= Math.min(...bs.map((b) => num(b, 'socmax')))) { p = 0; inv.note = 'SOC no máximo: sem carga' }
    inv.p = p; inv.q = q; inv.active = true
    return inv
  })
  // ilhas CA sem fonte: o primeiro inversor apto forma a rede
  {
    const srcIslands = new Set(els.filter((e) => e.kind === 'source').map((e) => uc.find(node(e, 0))))
    const formed = new Set<number>()
    for (const v of invs) {
      const root = uc.find(v.nAc)
      if (!v.active || !v.canForm || srcIslands.has(root) || formed.has(root)) continue
      formed.add(root)
      v.forming = true
      v.note = 'formando rede (ilhado)'
      const sn = Math.max(num(v.e, 'sn'), 1e-6)
      v.ys = div(cx(1), zUnit((0.05 * SBASE) / sn, 10))        // impedância interna de 5 % na base do inversor
    }
  }


  // ---- bases de tensão (kV) por nó: a partir das fontes, trocando de base nos transformadores
  const base = new Map<number, number>()
  const adj = new Map<number, { to: number; ratio: number }[]>()
  const link = (a: number, b: number, ratio: number) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push({ to: b, ratio })
    adj.get(b)!.push({ to: a, ratio: 1 / ratio })
  }
  for (const e of els) {
    if (e.kind === 'breaker' || e.kind === 'switch' || e.kind === 'tc' || e.kind === 'line') link(node(e, 0), node(e, 1), 1)
    if (e.kind === 'transformer') {
      const v1 = Math.max(num(e, 'v1'), 1e-6)
      link(node(e, 0), node(e, 1), Math.max(num(e, 'v2'), 1e-6) / v1)
    }
    if (e.kind === 'transformer3') {
      const v1 = Math.max(num(e, 'v1'), 1e-6)
      link(node(e, 0), node(e, 1), Math.max(num(e, 'v2'), 1e-6) / v1)
      link(node(e, 0), node(e, 2), Math.max(num(e, 'v3'), 1e-6) / v1)
    }
  }
  const queue: number[] = []
  for (const e of els) {
    if (e.kind !== 'source') continue
    const n = node(e, 0)
    if (!base.has(n)) { base.set(n, Math.max(num(e, 'vkv'), 1e-6)); queue.push(n) }
  }
  for (const v of invs) if (v.forming && !base.has(v.nAc)) { base.set(v.nAc, v.vac); queue.push(v.nAc) }
  while (queue.length) {
    const n = queue.shift()!
    for (const { to, ratio } of adj.get(n) ?? []) {
      if (!base.has(to)) { base.set(to, base.get(n)! * ratio); queue.push(to) }
    }
  }
  const bk = (n: number) => base.get(n) ?? 0

  // ---- ramos e injeções
  const branches: Branch[] = []
  const shunt = new Map<number, Cx>() // admitância para a referência
  const inj = new Map<number, Cx>() // injeção de corrente (Norton)
  const addShunt = (n: number, y: Cx) => shunt.set(n, add(shunt.get(n) ?? cx(), y))
  const addInj = (n: number, i: Cx) => inj.set(n, add(inj.get(n) ?? cx(), i))
  const sources: { e: El; n: number; ys: Cx; E: Cx }[] = []
  const trafoY = new Map<number, Cx>()
  /** Linha: impedâncias série (pu) de sequência positiva/negativa (z1) e zero (z0). */
  const lineZ = new Map<number, { z1: Cx; z0: Cx }>()
  /** Transformador de 3 enrolamentos: impedâncias do equivalente em estrela (z: P, S, T), admitâncias do equivalente em delta (y: P–S, P–T, S–T), defasagens (°) e tipos de enrolamento. */
  const t3Z = new Map<number, T3Info>()
  const loadY = new Map<number, Cx>()

  for (const e of els) {
    if (e.kind === 'breaker' || e.kind === 'switch') {
      if (flag(e, 'closed')) branches.push({ a: node(e, 0), b: node(e, 1), y: cx(Y_SWITCH) })
    } else if (e.kind === 'tc') {
      branches.push({ a: node(e, 0), b: node(e, 1), y: cx(Y_SWITCH) })
    } else if (e.kind === 'transformer') {
      const a = node(e, 0)
      const ba = bk(a) || Math.max(num(e, 'v1'), 1e-6)
      const zAbs = (Math.max(num(e, 'z'), 1e-4) / 100) * (SBASE / Math.max(num(e, 'sn'), 1e-6)) * Math.pow(Math.max(num(e, 'v1'), 1e-6) / ba, 2)
      const y = div(cx(1), zUnit(zAbs, Math.max(num(e, 'xr'), 0)))
      trafoY.set(e.id, y)
      branches.push({ a, b: node(e, 1), y, ph: trafoShift(e) })
    } else if (e.kind === 'transformer3') {
      const a = node(e, 0)
      const ba = bk(a) || Math.max(num(e, 'v1'), 1e-6)
      const info = t3Info(e, (SBASE / Math.max(num(e, 'sn'), 1e-6)) * Math.pow(Math.max(num(e, 'v1'), 1e-6) / ba, 2))
      t3Z.set(e.id, info)
      const ns = [a, node(e, 1), node(e, 2)]
      T3_PAIRS.forEach(([i, j], k) => branches.push({ a: ns[i], b: ns[j], y: info.y[k], ph: info.ph[k] }))
    } else if (e.kind === 'line') {
      const a = node(e, 0)
      const zb = (bk(a) * bk(a)) / SBASE
      if (zb > 0) {
        const len = Math.max(num(e, 'len'), 1e-6)
        const z1 = cx((len * num(e, 'r1')) / zb, (len * num(e, 'x1')) / zb)
        const z0 = cx((len * num(e, 'r0')) / zb, (len * num(e, 'x0')) / zb)
        const zmin = (z: Cx) => (abs(z) < 1e-9 ? cx(1e-6, 0) : z)
        lineZ.set(e.id, { z1: zmin(z1), z0: zmin(z0) })
        branches.push({ a, b: node(e, 1), y: div(cx(1), zmin(z1)) })
      }
    } else if (e.kind === 'source') {
      const n = node(e, 0)
      const vkv = Math.max(num(e, 'vkv'), 1e-6)
      const zAbs = (SBASE / Math.max(num(e, 'ssc'), 1e-6)) * Math.pow(vkv / bk(n), 2)
      const ys = div(cx(1), zUnit(zAbs, Math.max(num(e, 'xr'), 0)))
      const E = polar(vkv / bk(n), num(e, 'ang'))
      sources.push({ e, n, ys, E })
      addShunt(n, ys)
      addInj(n, mul(E, ys))
    } else if (e.kind === 'load') {
      const n = node(e, 0)
      const p = Math.max(num(e, 'p'), 0)
      const fp = Math.min(1, Math.max(num(e, 'fp'), 1e-3))
      const q = p * Math.tan(Math.acos(fp)) * (flag(e, 'cap') ? -1 : 1)
      const y = conj(cx(p / SBASE, q / SBASE))
      loadY.set(e.id, y)
      addShunt(n, y)
    }
  }

  for (const v of invs) if (v.forming) { addShunt(v.nAc, v.ys); addInj(v.nAc, mul(v.E, v.ys)) }

  // ---- componentes conexos que contêm alguma fonte (ou inversor formador) são resolvidos; o resto fica desenergizado
  const srcRoots = new Set([...sources.map((s) => uc.find(s.n)), ...invs.filter((v) => v.forming).map((v) => uc.find(v.nAc))])
  const V = new Map<number, Cx>()
  const groups = new Map<number, number[]>()
  const allNodes = new Set<number>()
  for (let i = 0; i < count; i++) allNodes.add(uf.find(i))
  for (const n of allNodes) {
    const r = uc.find(n)
    if (!srcRoots.has(r)) { V.set(n, cx()); continue }
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(n)
  }
  const solveGroups = (pq: Map<number, Cx>) => {
  for (const nodes of groups.values()) {
    const pos = new Map(nodes.map((n, i) => [n, i]))
    const m = nodes.length
    const Y: Cx[][] = Array.from({ length: m }, () => Array.from({ length: m }, () => cx()))
    const I: Cx[] = Array.from({ length: m }, () => cx())
    for (const n of nodes) {
      const i = pos.get(n)!
      Y[i][i] = add(Y[i][i], shunt.get(n) ?? cx())
      I[i] = add(add(I[i], inj.get(n) ?? cx()), pq.get(n) ?? cx())
    }
    for (const b of branches) {
      const i = pos.get(b.a)
      const j = pos.get(b.b)
      if (i == null || j == null) continue
      const sh = b.ph ? polar(1, b.ph) : cx(1)
      Y[i][i] = add(Y[i][i], b.y)
      Y[j][j] = add(Y[j][j], b.y)
      Y[i][j] = sub(Y[i][j], mul(b.y, sh))
      Y[j][i] = sub(Y[j][i], mul(b.y, conj(sh)))
    }
    const x = gauss(Y, I)
    nodes.forEach((n, i) => V.set(n, x[i]))
  }
  }

  // inversores seguidores: injeção de corrente I = conj(S/V), iterada até convergir (potência constante)
  const pq = new Map<number, Cx>()
  const hasInv = invs.some((v) => v.active && !v.forming)
  for (let it = 0; it < (hasInv ? 30 : 1); it++) {
    pq.clear()
    let changed = false
    for (const v of invs) {
      if (!v.active || v.forming) continue
      const Vn = V.get(v.nAc) ?? cx(1, 0)
      if (abs(Vn) < 0.1) { v.active = false; v.note = 'sem tensão CA (sem fonte nem inversor formador de rede)'; changed = true; continue }
      pq.set(v.nAc, add(pq.get(v.nAc) ?? cx(), conj(div(cx(v.p / SBASE, v.q / SBASE), Vn))))
    }
    const prev = invs.filter((v) => v.active && !v.forming).map((v) => V.get(v.nAc) ?? cx(1, 0))
    solveGroups(pq)
    if (!hasInv) break
    const cur = invs.filter((v) => v.active && !v.forming).map((v) => V.get(v.nAc) ?? cx(1, 0))
    if (!changed && prev.length === cur.length && prev.every((p, k) => abs(sub(p, cur[k])) < 1e-8)) break
  }
  for (const v of invs) {
    if (!v.active) continue
    const Vn = V.get(v.nAc) ?? cx()
    if (v.forming) {
      v.iInj = mul(sub(v.E, Vn), v.ys)                   // o formador entrega o que a ilha consome
      const S = mul(Vn, conj(v.iInj))
      v.p = S.re * SBASE
      v.q = S.im * SBASE
    } else {
      v.iInj = conj(div(cx(v.p / SBASE, v.q / SBASE), abs(Vn) < 0.1 ? cx(1, 0) : Vn))
    }
    v.pdc = v.p >= 0 ? v.p / v.eff : v.p * v.eff        // + descarga da bateria; − carga (a bateria recebe menos que a rede entrega)
  }

  // ---- resultados por elemento
  const vOf = (n: number) => V.get(n) ?? cx()
  const kv = (n: number): Ph => ({ mag: abs(vOf(n)) * bk(n), ang: deg(vOf(n)) })
  const iBase = (n: number) => (bk(n) > 0 ? (SBASE * 1000) / (Math.sqrt(3) * bk(n)) : 0) // A por pu
  const amps = (n: number, i: Cx): Ph => ({ mag: abs(i) * iBase(n), ang: deg(i) })
  const sFlow = (n: number, i: Cx) => { const s = mul(vOf(n), conj(i)); return [s.re * SBASE, s.im * SBASE] as const }

  const res = new Map<number, ElResult>()
  const nodeEnergized = new Map<string, boolean>()
  for (const e of els) {
    const ports = nPorts(e)
    for (let k = 0; k < ports; k++) nodeEnergized.set(`${e.id}:${k}`, abs(vOf(node(e, k))) > 1e-6)
  }
  const totals = { gen: 0, genQ: 0, load: 0, loadQ: 0, loss: 0 }
  // ilhas CC energizadas (bateria + inversor ativo); tudo que está nelas (fios, disjuntores) fica energizado
  const dcActive = new Set(invs.filter((v) => v.active).map((v) => uc.find(v.nDc)))
  const acNode = (n: number) => abs(vOf(n)) > 1e-6
  for (const e of els) {
    for (let k = 0; k < nPorts(e); k++) {
      const n = node(e, k)
      if (!acNode(n) && dcActive.has(uc.find(n)) && e.kind !== 'bus') nodeEnergized.set(`${e.id}:${k}`, true)
    }
  }
  const dcInfo = (root: number) => {
    const bs = bats.filter((b) => uc.find(node(b, 0)) === root)
    const vdc = bs.length ? Math.max(num(bs[0], 'vdc'), 1e-9) : 0
    const pdc = invs.filter((v) => v.active && uc.find(v.nDc) === root).reduce((a, v) => a + v.pdc, 0)
    return { vdc, idc: vdc > 0 ? (pdc * 1e6) / vdc : 0, pdc }
  }

  for (const e of els) {
    const r: ElResult = { energized: false, v: [], i: [], p: [], q: [], extra: {} }
    const n0 = node(e, 0)
    r.energized = abs(vOf(n0)) > 1e-6 || (nPorts(e) > 1 && abs(vOf(node(e, 1))) > 1e-6)
    if (e.kind === 'bus' || e.kind === 'fault') {
      r.v = [kv(n0)]
    } else if (e.kind === 'source') {
      const s = sources.find((x) => x.e.id === e.id)!
      const iOut = mul(sub(s.E, vOf(n0)), s.ys)
      const [p, q] = sFlow(n0, iOut)
      r.v = [kv(n0)]
      r.i = [amps(n0, iOut)]
      r.p = [-p]; r.q = [-q] // entrando no elemento: negativo = entrega
      r.extra = { p, q }
      totals.gen += p; totals.genQ += q
    } else if (e.kind === 'load') {
      const y = loadY.get(e.id)!
      const iIn = mul(vOf(n0), y)
      const [p, q] = sFlow(n0, iIn)
      r.v = [kv(n0)]
      r.i = [amps(n0, iIn)]
      r.p = [p]; r.q = [q]
      r.extra = { p, q }
      if (r.energized) { totals.load += p; totals.loadQ += q }
    } else if (e.kind === 'inverter') {
      const v = invs.find((x) => x.e.id === e.id)!
      const injI = v.active ? v.iInj : cx()
      const iIn = cx(-injI.re, -injI.im)
      const [p, q] = sFlow(v.nAc, iIn)                    // entrando no elemento (negativo = injeta na rede)
      r.energized = v.active
      r.v = [{ mag: 0, ang: 0 }, kv(v.nAc)]
      r.i = [{ mag: 0, ang: 0 }, amps(v.nAc, iIn)]
      r.p = [v.active ? v.pdc : 0, p]; r.q = [0, q]
      r.extra = { p: -p, q: -q, pdc: v.pdc, eff: v.eff * 100, loading: (Math.hypot(p, q) / Math.max(num(e, 'sn'), 1e-9)) * 100 }
      r.note = v.note || (v.active ? (v.p >= 0 ? 'descarregando' : 'carregando') : '')
      if (v.forming && r.extra.loading > 100) r.note = 'sobrecarga: acima da potência nominal'
      if (v.active) {
        if (-p >= 0) totals.gen += -p; else totals.load += p
        totals.genQ += -q
      }
    } else if (e.kind === 'battery') {
      const at = invs.filter((v) => v.active && uc.find(v.nDc) === uc.find(n0))
      const mates = bats.filter((b) => uc.find(node(b, 0)) === uc.find(n0))
      const capSum = mates.reduce((a, b) => a + num(b, 'cap'), 0)
      const pdcAll = at.reduce((a, v) => a + v.pdc, 0)
      const pb = capSum > 0 ? pdcAll * (num(e, 'cap') / capSum) : pdcAll / Math.max(mates.length, 1)
      const cap = num(e, 'cap')
      const soc = num(e, 'soc')
      const hours = pb > 1e-9 ? (cap * Math.max(soc - num(e, 'socmin'), 0)) / 100 / (pb * 1000)
        : pb < -1e-9 ? (cap * Math.max(num(e, 'socmax') - soc, 0)) / 100 / (-pb * 1000) : -1
      r.energized = at.length > 0
      r.p = [pb]; r.q = [0]
      r.extra = { pdc: pb, idc: (pb * 1e6) / Math.max(num(e, 'vdc'), 1e-9), soc, hours, energy: (cap * soc) / 100 }
      r.note = at.length === 0 ? 'sem inversor ativo no lado CC' : pb > 0 ? 'descarregando' : pb < 0 ? 'carregando' : 'em espera'
    } else if (e.kind === 'tp') {
      r.v = [kv(n0)]
      const vp = Math.max(num(e, 'vp'), 1e-9)
      r.extra = { vsec: (r.v[0].mag / vp) * num(e, 'vs'), ratio: (vp * 1000) / Math.max(num(e, 'vs'), 1e-9) }
    } else if (e.kind === 'transformer3') {
      const t = t3Z.get(e.id)
      const ns = [n0, node(e, 1), node(e, 2)]
      const iin = [cx(), cx(), cx()]
      if (t && ns.some((n) => abs(vOf(n)) > 1e-9)) {
        T3_PAIRS.forEach(([i, j], k) => {
          const sh = polar(1, t.ph[k])
          const ii = mul(sub(vOf(ns[i]), mul(sh, vOf(ns[j]))), t.y[k])
          iin[i] = add(iin[i], ii)
          iin[j] = sub(iin[j], mul(ii, conj(sh)))
        })
      }
      r.energized = ns.some((n) => abs(vOf(n)) > 1e-6)
      r.v = ns.map((n) => kv(n))
      r.i = ns.map((n, k) => amps(n, iin[k]))
      const pq = ns.map((n, k) => sFlow(n, iin[k]))
      r.p = pq.map((x) => x[0])
      r.q = pq.map((x) => x[1])
      const loss = r.p.reduce((a, b) => a + b, 0)
      r.extra = { loading: (Math.hypot(r.p[0], r.q[0]) / Math.max(num(e, 'sn'), 1e-9)) * 100, loss }
      totals.loss += loss
    } else {
      // dois terminais em série: breaker, switch, tc, transformer
      const n1 = node(e, 1)
      const closed = e.kind === 'tc' || e.kind === 'transformer' || e.kind === 'line' || flag(e, 'closed')
      let y = e.kind === 'transformer' ? trafoY.get(e.id)! : e.kind === 'line' ? (lineZ.has(e.id) ? div(cx(1), lineZ.get(e.id)!.z1) : cx()) : cx(closed ? Y_SWITCH : 0)
      if ((e.kind === 'transformer' || e.kind === 'line') && abs(vOf(n0)) < 1e-9 && abs(vOf(n1)) < 1e-9) y = cx()
      const sh = e.kind === 'transformer' ? polar(1, trafoShift(e)) : cx(1)
      const i1 = mul(sub(vOf(n0), mul(sh, vOf(n1))), y) // entrando pelo terminal 1
      const i2 = e.kind === 'transformer' ? sub(cx(), mul(i1, conj(sh))) : cx(-i1.re, -i1.im)
      r.v = [kv(n0), kv(n1)]
      r.i = [amps(n0, i1), amps(n1, i2)]
      const [p1, q1] = sFlow(n0, i1)
      const [p2, q2] = sFlow(n1, i2)
      r.p = [p1, p2]; r.q = [q1, q2]
      if (e.kind === 'tc') {
        const ratio = Math.max(num(e, 'ip'), 1e-9) / Math.max(num(e, 'is'), 1e-9)
        r.extra = { isec: r.i[0].mag / ratio, ratio }
      } else if (e.kind === 'line') {
        const len = Math.max(num(e, 'len'), 1e-6)
        r.extra = { len, rt: len * num(e, 'r1'), xt: len * num(e, 'x1'), loss: p1 + p2 }
        totals.loss += p1 + p2
      } else if (e.kind === 'transformer') {
        r.extra = { loading: (Math.hypot(p1, q1) / Math.max(num(e, 'sn'), 1e-9)) * 100, loss: p1 + p2 }
        totals.loss += p1 + p2
      }
    }
    if ((e.kind === 'breaker' || e.kind === 'switch' || e.kind === 'tc') && !r.energized) {
      const roots = [uc.find(n0), uc.find(node(e, 1))]
      const root = roots.find((x) => dcActive.has(x))
      if (root !== undefined) {
        const d = dcInfo(root)
        r.energized = true
        r.v = []; r.i = []; r.p = []; r.q = []
        r.extra = { dc: 1, vdc: d.vdc, idc: d.idc, pdc: d.pdc, ...(e.kind === 'tc' ? { isec: Math.abs(d.idc) / Math.max(num(e, 'ip') / Math.max(num(e, 'is'), 1e-9), 1e-9), ratio: 1 } : {}) }
      }
    }
    if (e.kind === 'breaker' || e.kind === 'switch') {
      const dcDeclared = flag(e, 'dc')
      if (r.extra.dc && !dcDeclared) r.note = `${e.kind === 'breaker' ? 'disjuntor' : 'chave'} marcado como CA em circuito CC`
      else if (!r.extra.dc && r.energized && dcDeclared) r.note = `${e.kind === 'breaker' ? 'disjuntor' : 'chave'} marcado como CC em circuito CA`
    }
    r.kvb = Array.from({ length: nPorts(e) }, (_, k) => bk(node(e, k)))
    res.set(e.id, r)
  }
  const out: Solution = { res, nodeEnergized, totals }
  if (withFault && energize) {
    const fr = faultStudy({ els, node, nodes: [...allNodes], bk, sources, loadY, trafoY, lineZ, t3Z, invs, iBase }, res)
    if (fr) {
      out.res = new Map([...res, ...fr.over])
      // totais do sistema em falta
      const t = { gen: 0, genQ: 0, load: 0, loadQ: 0, loss: 0 }
      for (const e of els) {
        const r = out.res.get(e.id)
        if (!r) continue
        if (e.kind === 'source') { t.gen += r.extra.p; t.genQ += r.extra.q }
        else if (e.kind === 'load' && r.energized) { t.load += r.extra.p; t.loadQ += r.extra.q }
        else if (e.kind === 'transformer') t.loss += r.extra.loss ?? 0
        else if (e.kind === 'inverter' && r.energized) { if (r.extra.p >= 0) t.gen += r.extra.p; else t.load += -r.extra.p; t.genQ += r.extra.q }
      }
      out.totals = t
      out.fault = { info: fr.info, terms: fr.terms, warns: fr.warns }
    } else out.fault = null
  }
  return out
}

// ===================================================================== estudo de falta (componentes simétricas)

interface FaultCtx {
  els: El[]
  node: (e: El, k: number) => number
  nodes: number[]
  bk: (n: number) => number
  sources: { e: El; n: number; ys: Cx; E: Cx }[]
  loadY: Map<number, Cx>
  trafoY: Map<number, Cx>
  lineZ: Map<number, { z1: Cx; z0: Cx }>
  t3Z: Map<number, T3Info>
  invs: { e: El; nAc: number; active: boolean; forming: boolean; ys: Cx; E: Cx; p: number; q: number }[]
  iBase: (n: number) => number
}

const A1 = polar(1, 120) // operador a
const A2 = polar(1, 240) // a²
const LEAK = 1e-9        // admitância de fuga à terra: mantém a matriz inversível em partes sem referência (ex.: sem aterramento)

/** Defasagem (°) da sequência positiva do terminal 2 em relação ao 1 (índice horário × 30°; a tensão do terminal 2 atrasa); a negativa tem o sinal oposto. */
function trafoShift(e: El): number {
  return vgroup(e).clock * 30
}
/** Tipo de enrolamento de cada terminal pelo esquema de ligação: 0 = Y isolado, 1 = Δ, 2 = Y aterrado. */
function windings(e: El): [number, number] {
  const g = vgroup(e)
  const t = (w: string) => (w.toUpperCase() === 'D' ? 1 : w.toUpperCase().startsWith('YN') ? 2 : 0)
  return [t(g.hv), t(g.lv)]
}
const srcGrounded = (e: El): boolean => flag(e, 'gnd')
const z0Ratio = (e: El): number => Math.max(num(e, 'z0r') || 1, 1e-3)
const rot3 = (k: number): Cx => { const m = ((k % 3) + 3) % 3; return m === 0 ? cx(1) : m === 1 ? A1 : A2 }

interface SeqI { i1: Cx; i2: Cx; i0: Cx }

function faultStudy(ctx: FaultCtx, base: Map<number, ElResult>): { info: FaultInfo; terms: Map<number, FaultTerm[]>; warns: string[]; over: Map<number, ElResult> } | null {
  const { els, node, bk: bk0, sources, loadY, trafoY, lineZ, t3Z, invs, iBase: iBase0 } = ctx
  const faults = els.filter((e) => e.kind === 'fault' && flag(e, 'on'))
  if (faults.length === 0) return null
  const warns: string[] = []
  const fe = faults[0]
  if (faults.length > 1) warns.push(`Mais de uma falta aplicada: só a primeira (${fe.name}) é calculada.`)
  // falta em uma linha: o ponto fica a `pos`% do terminal 1; a linha é dividida em dois trechos por um nó interno
  const fl = els.find((e) => e.kind === 'line' && e.id === Math.round(num(fe, 'lid')))
  const posFrac = Math.min(0.9999, Math.max(0.0001, num(fe, 'pos') / 100))
  let nx = ctx.nodes.length ? Math.max(...ctx.nodes) + 1 : 0
  const mid = fl ? nx++ : -1
  const cn = new Map<number, number>()                                   // nó comum (seq. zero) de cada transformador de 3 enrolamentos
  for (const e of els) if (e.kind === 'transformer3') cn.set(e.id, nx++)
  const nodes = [...ctx.nodes, ...(fl ? [mid] : []), ...cn.values()]
  const f = fl ? mid : node(fe, 0)
  const bk = (n: number) => (n === mid && fl ? bk0(node(fl, 0)) : bk0(n))
  const iBase = (n: number) => (n === mid && fl ? iBase0(node(fl, 0)) : iBase0(n))
  if (!(bk(f) > 0)) return null
  const N = nodes.length
  const pos = new Map(nodes.map((n, i) => [n, i]))
  const fi = pos.get(f)!

  /** Rede de sequência `seq` (1, 2 ou 0): matriz Y e injeções de Norton (só a positiva tem fontes). */
  const net = (seq: 1 | 2 | 0) => {
    const Y: Cx[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => cx()))
    const I: Cx[] = Array.from({ length: N }, () => cx())
    for (let i = 0; i < N; i++) Y[i][i] = cx(LEAK)
    const stamp = (a: number, b: number, y: Cx, alphaDeg = 0) => {
      const i = pos.get(a)!
      const j = pos.get(b)!
      const ph = polar(1, alphaDeg)
      Y[i][i] = add(Y[i][i], y)
      Y[j][j] = add(Y[j][j], y)
      Y[i][j] = sub(Y[i][j], mul(y, ph))
      Y[j][i] = sub(Y[j][i], mul(y, conj(ph)))
    }
    const shunt = (n: number, y: Cx) => { const i = pos.get(n)!; Y[i][i] = add(Y[i][i], y) }
    const inject = (n: number, c: Cx) => { const i = pos.get(n)!; I[i] = add(I[i], c) }
    for (const e of els) {
      if (e.kind === 'breaker' || e.kind === 'switch') {
        if (flag(e, 'closed')) stamp(node(e, 0), node(e, 1), cx(Y_SWITCH))
      } else if (e.kind === 'tc') {
        stamp(node(e, 0), node(e, 1), cx(Y_SWITCH))
      } else if (e.kind === 'transformer') {
        const y = trafoY.get(e.id)!
        const a = node(e, 0)
        const b = node(e, 1)
        if (seq === 0) {
          const [wa, wb] = windings(e)
          const ga = wa === 2
          const gb = wb === 2
          const da = wa === 1
          const db = wb === 1
          if (ga && gb) stamp(a, b, y)
          else if (ga && db) shunt(a, y)
          else if (gb && da) shunt(b, y)
        } else stamp(a, b, y, seq === 1 ? trafoShift(e) : -trafoShift(e))
      } else if (e.kind === 'transformer3') {
        const t = t3Z.get(e.id)
        if (t) {
          const ns = [node(e, 0), node(e, 1), node(e, 2)]
          if (seq === 0) {
            const c = cn.get(e.id)!
            t.w.forEach((w, k) => {
              const y0 = div(cx(1), t.z[k])
              if (w === 2) stamp(ns[k], c, y0)        // Y aterrado: caminho da seq. zero até o ponto comum
              else if (w === 1) shunt(c, y0)           // Δ: o ponto comum é aterrado pela malha do delta
            })
          } else T3_PAIRS.forEach(([i, j], k) => stamp(ns[i], ns[j], t.y[k], seq === 1 ? t.ph[k] : -t.ph[k]))
        }
      } else if (e.kind === 'load' && seq !== 0) {
        shunt(node(e, 0), loadY.get(e.id)!)
      } else if (e.kind === 'line') {
        const lz = lineZ.get(e.id)
        if (lz) {
          const z = seq === 0 ? lz.z0 : lz.z1
          const a = node(e, 0)
          const b = node(e, 1)
          if (e === fl) {
            stamp(a, mid, div(cx(1), mul(z, cx(posFrac))))
            stamp(mid, b, div(cx(1), mul(z, cx(1 - posFrac))))
          } else stamp(a, b, div(cx(1), z))
        }
      }
    }
    for (const s of sources) {
      if (seq === 0) {
        if (srcGrounded(s.e)) shunt(s.n, div(s.ys, cx(z0Ratio(s.e))))
      } else {
        shunt(s.n, s.ys)
        if (seq === 1) inject(s.n, mul(s.E, s.ys))
      }
    }
    for (const v of invs) {
      if (v.forming && seq !== 0) {
        shunt(v.nAc, v.ys)
        if (seq === 1) inject(v.nAc, mul(v.E, v.ys))
      }
    }
    return { Y, I }
  }
  const n1 = net(1)
  const n2 = net(2)
  const n0 = net(0)

  // ---- seq. positiva pré-falta; inversores seguidores = corrente constante (iterada)
  const inj = new Map<number, Cx>()
  const solvePos = () => {
    const I = n1.I.map((c) => ({ ...c }))
    for (const [n, c] of inj) { const i = pos.get(n)!; I[i] = add(I[i], c) }
    return gauss(n1.Y, I)
  }
  let V1 = solvePos()
  const followers = invs.filter((v) => v.active && !v.forming)
  for (let it = 0; it < 20 && followers.length; it++) {
    inj.clear()
    for (const v of followers) {
      const Vn = V1[pos.get(v.nAc)!]
      if (abs(Vn) < 0.1) continue
      inj.set(v.nAc, add(inj.get(v.nAc) ?? cx(), conj(div(cx(v.p / SBASE, v.q / SBASE), Vn))))
    }
    const nv = solvePos()
    const done = nv.every((x, k) => abs(sub(x, V1[k])) < 1e-9)
    V1 = nv
    if (done) break
  }
  const vpre = V1[fi]
  if (abs(vpre) < 1e-6) return null

  // ---- impedâncias de Thévenin e colunas Z (resposta a 1 pu injetado no ponto da falta)
  const unit = Array.from({ length: N }, (_, i) => (i === fi ? cx(1) : cx()))
  const X1 = gauss(n1.Y, unit)
  const X2 = gauss(n2.Y, unit)
  const X0 = gauss(n0.Y, unit)
  const Z1 = X1[fi]
  const Z2 = X2[fi]
  const Z0 = X0[fi]
  const z0open = abs(Z0) > 1e4
  const zBase = (bk(f) * bk(f)) / SBASE
  const rf = Math.max(num(fe, 'rf'), 0)
  const zf = rf / zBase
  const ftype = Math.round(num(fe, 'type'))
  const label = FAULT_TYPES.find((t) => t.v === ftype)?.l ?? 'Falta'
  // fase de referência (s): falta à terra = a faltada (A,B,C = 0,1,2); entre fases e bifásica-terra = a não envolvida (AB → C, BC → A, CA → B)
  const sIdx = ftype === 0 ? 0 : ftype <= 3 ? ftype - 1 : ftype <= 6 ? [2, 0, 1][ftype - 4] : [2, 0, 1][ftype - 7]
  let I1: Cx = cx()
  let c2: Cx = cx()
  let c0: Cx = cx()
  const Z0f = add(Z0, cx(3 * zf))
  if (ftype === 0) {
    I1 = div(vpre, add(Z1, cx(zf)))
  } else if (ftype <= 3) {
    I1 = div(vpre, add(add(Z1, Z2), Z0f))
    c2 = cx(1)
    c0 = cx(1)
  } else if (ftype <= 6) {
    I1 = div(vpre, add(add(Z1, Z2), cx(zf)))
    c2 = cx(-1)
  } else {
    const den = add(Z2, Z0f)
    I1 = div(vpre, add(Z1, div(mul(Z2, Z0f), den)))
    c2 = sub(cx(), div(Z0f, den))
    c0 = sub(cx(), div(Z2, den))
  }
  const I2 = mul(mul(c2, I1), rot3(sIdx))
  const I0 = mul(mul(c0, I1), rot3(-sIdx))
  if (z0open && ftype >= 1 && ftype <= 3) warns.push('Sem caminho de sequência zero (sem aterramento até o ponto): a falta monofásica não produz corrente.')
  else if (z0open && ftype >= 7) warns.push('Sem caminho de sequência zero: a falta bifásica com neutro se comporta como bifásica.')

  // ---- tensões de sequência em todos os nós (superposição) e correntes dos elementos
  const vs = (n: number) => {
    const i = pos.get(n)!
    return { v1: sub(V1[i], mul(X1[i], I1)), v2: sub(cx(), mul(X2[i], I2)), v0: sub(cx(), mul(X0[i], I0)) }
  }
  const toPh = (v1: Cx, v2: Cx, v0: Cx) => ({
    a: add(add(v0, v1), v2),
    b: add(add(v0, mul(A2, v1)), mul(A1, v2)),
    c: add(add(v0, mul(A1, v1)), mul(A2, v2)),
  })
  const mk = (c: Cx, k: number): Ph => ({ mag: abs(c) * k, ang: deg(c) })
  const setOf = (q1: Cx, q2: Cx, q0: Cx, k: number): PhasorSet => {
    const p = toPh(q1, q2, q0)
    return { a: mk(p.a, k), b: mk(p.b, k), c: mk(p.c, k), s1: mk(q1, k), s2: mk(q2, k), s0: mk(q0, k) }
  }
  const llMin = (q1: Cx, q2: Cx, q0: Cx): number => {
    const p = toPh(q1, q2, q0)
    return Math.min(abs(sub(p.a, p.b)), abs(sub(p.b, p.c)), abs(sub(p.c, p.a)))
  }
  const maxI = (s: PhasorSet): Ph => [s.a, s.b, s.c].reduce((m, x) => (x.mag > m.mag ? x : m))
  /** S trifásica (MW, Mvar) = Σ V_seq · conj(I_seq) em pu × Sbase. */
  const sMW = (v: { v1: Cx; v2: Cx; v0: Cx }, i: SeqI): [number, number] => {
    const s = add(add(mul(v.v1, conj(i.i1)), mul(v.v2, conj(i.i2))), mul(v.v0, conj(i.i0)))
    return [s.re * SBASE, s.im * SBASE]
  }

  const terms = new Map<number, FaultTerm[]>()
  const over = new Map<number, ElResult>()
  const zero: SeqI = { i1: cx(), i2: cx(), i0: cx() }
  for (const e of els) {
    const b0 = base.get(e.id)
    if (!b0 || e.kind === 'battery' || e.kind === 'ied') continue
    const ports = e.kind === 'source' || e.kind === 'load' || e.kind === 'tp' || e.kind === 'fault' || e.kind === 'bus' ? 1 : e.kind === 'transformer3' ? 3 : 2
    const nodesOf = e.id === fe.id && fl ? [mid] : Array.from({ length: ports }, (_, k) => node(e, k))
    const V = nodesOf.map((n) => vs(n))
    let I: SeqI[] = V.map(() => zero)
    if (e.kind === 'breaker' || e.kind === 'switch' || e.kind === 'tc') {
      if (e.kind === 'tc' || flag(e, 'closed')) {
        const y = cx(Y_SWITCH)
        const ia: SeqI = { i1: mul(sub(V[0].v1, V[1].v1), y), i2: mul(sub(V[0].v2, V[1].v2), y), i0: mul(sub(V[0].v0, V[1].v0), y) }
        I = [ia, { i1: sub(cx(), ia.i1), i2: sub(cx(), ia.i2), i0: sub(cx(), ia.i0) }]
      }
    } else if (e.kind === 'transformer') {
      const y = trafoY.get(e.id)!
      const al = trafoShift(e)
      const a = V[0]
      const b = V[1]
      const ejp = polar(1, al)
      const ejn = polar(1, -al)
      const p1 = mul(y, sub(a.v1, mul(ejp, b.v1)))
      const p2 = mul(y, sub(a.v2, mul(ejn, b.v2)))
      const [wa, wb] = windings(e)
      const ga = wa === 2
      const gb = wb === 2
      const da = wa === 1
      const db = wb === 1
      let z0a = cx()
      let z0b = cx()
      if (ga && gb) { z0a = mul(y, sub(a.v0, b.v0)); z0b = sub(cx(), z0a) }
      else if (ga && db) z0a = mul(y, a.v0)
      else if (gb && da) z0b = mul(y, b.v0)
      I = [{ i1: p1, i2: p2, i0: z0a }, { i1: sub(cx(), mul(p1, ejn)), i2: sub(cx(), mul(p2, ejp)), i0: z0b }]
    } else if (e.kind === 'source') {
      const s = sources.find((x) => x.e.id === e.id)!
      const v = V[0]
      I = [{
        i1: mul(sub(s.E, v.v1), s.ys),
        i2: sub(cx(), mul(v.v2, s.ys)),
        i0: srcGrounded(e) ? sub(cx(), mul(v.v0, div(s.ys, cx(z0Ratio(e))))) : cx(),
      }]
    } else if (e.kind === 'load') {
      const y = loadY.get(e.id)!
      I = [{ i1: mul(V[0].v1, y), i2: mul(V[0].v2, y), i0: cx() }]
    } else if (e.kind === 'transformer3') {
      const t = t3Z.get(e.id)
      if (t) {
        const acc: SeqI[] = [{ ...zero }, { ...zero }, { ...zero }]
        T3_PAIRS.forEach(([i, j], k) => {
          for (const q of [1, 2] as const) {
            const sh = polar(1, q === 1 ? t.ph[k] : -t.ph[k])
            const vi = q === 1 ? V[i].v1 : V[i].v2
            const vj = q === 1 ? V[j].v1 : V[j].v2
            const ii = mul(sub(vi, mul(sh, vj)), t.y[k])
            const key = q === 1 ? 'i1' : 'i2'
            acc[i][key] = add(acc[i][key], ii)
            acc[j][key] = sub(acc[j][key], mul(ii, conj(sh)))
          }
        })
        const vc = vs(cn.get(e.id)!).v0
        t.w.forEach((w, k) => { if (w === 2) acc[k].i0 = mul(sub(V[k].v0, vc), div(cx(1), t.z[k])) })
        I = acc
      }
    } else if (e.kind === 'line') {
      const lz = lineZ.get(e.id)
      if (lz) {
        const ya = (z: Cx) => div(cx(1), e === fl ? mul(z, cx(posFrac)) : z)
        const yb = (z: Cx) => div(cx(1), e === fl ? mul(z, cx(1 - posFrac)) : z)
        const vm = e === fl ? vs(mid) : null
        const sec = (z: Cx, qa: Cx, qb: Cx, qm: Cx | undefined): [Cx, Cx] => {
          if (qm) return [mul(ya(z), sub(qa, qm)), mul(yb(z), sub(qb, qm))]
          const i = mul(ya(z), sub(qa, qb))
          return [i, sub(cx(), i)]
        }
        const [a1, b1] = sec(lz.z1, V[0].v1, V[1].v1, vm?.v1)
        const [a2, b2] = sec(lz.z1, V[0].v2, V[1].v2, vm?.v2)
        const [a0, b0] = sec(lz.z0, V[0].v0, V[1].v0, vm?.v0)
        I = [{ i1: a1, i2: a2, i0: a0 }, { i1: b1, i2: b2, i0: b0 }]
      }
    } else if (e.kind === 'fault') {
      I = [e.id === fe.id ? { i1: I1, i2: I2, i0: I0 } : zero]
    } else if (e.kind === 'inverter') {
      const v = invs.find((x) => x.e.id === e.id)!
      const ac = V[1]
      let i1 = cx()
      let i2 = cx()
      if (v.active && v.forming) { i1 = sub(cx(), mul(sub(v.E, ac.v1), v.ys)); i2 = mul(ac.v2, v.ys) }
      else if (v.active) i1 = sub(cx(), inj.get(v.nAc) ?? cx())
      I = [zero, { i1, i2, i0: cx() }]
    }
    const ts: FaultTerm[] = nodesOf.map((n, k) => ({
      v: setOf(V[k].v1, V[k].v2, V[k].v0, bk(n) / Math.sqrt(3)),
      i: setOf(I[k].i1, I[k].i2, I[k].i0, iBase(n)),
      kvb: bk(n),
    }))
    terms.set(e.id, ts)
    // ---- ElResult compatível com painel/diagrama: tensão = menor fase-fase; corrente = maior fase
    const r: ElResult = { ...b0, v: [...b0.v], i: [...b0.i], p: [...b0.p], q: [...b0.q], extra: { ...b0.extra } }
    r.v = nodesOf.map((n, k) => ({ mag: llMin(V[k].v1, V[k].v2, V[k].v0) * bk(n), ang: ts[k].v.a.ang }))
    r.i = ts.map((t) => maxI(t.i))
    if (e.kind === 'inverter') r.i = [{ mag: 0, ang: 0 }, maxI(ts[1].i)]
    if (e.kind !== 'bus' && e.kind !== 'tp' && e.kind !== 'fault') {
      const pq = nodesOf.map((_, k) => sMW(V[k], I[k]))
      if (e.kind === 'source') {
        r.p = [-pq[0][0]]; r.q = [-pq[0][1]]
        r.extra = { ...r.extra, p: pq[0][0], q: pq[0][1] }
      } else if (e.kind === 'inverter') {
        r.p = [r.p[0] ?? 0, pq[1][0]]; r.q = [0, pq[1][1]]
        r.extra = { ...r.extra, p: -pq[1][0], q: -pq[1][1] }
      } else {
        r.p = pq.map((x) => x[0]); r.q = pq.map((x) => x[1])
      }
      if (e.kind === 'load') r.extra = { ...r.extra, p: pq[0][0], q: pq[0][1] }
      if (e.kind === 'transformer') r.extra = { ...r.extra, loading: (Math.hypot(pq[0][0], pq[0][1]) / Math.max(num(e, 'sn'), 1e-9)) * 100, loss: pq[0][0] + pq[1][0] }
    }
    if (e.kind === 'line') r.extra = { ...r.extra, loss: r.p[0] + r.p[1] }
    if (e.kind === 'transformer3') r.extra = { ...r.extra, loading: (Math.hypot(r.p[0], r.q[0]) / Math.max(num(e, 'sn'), 1e-9)) * 100, loss: r.p.reduce((a, b) => a + b, 0) }
    if (e.kind === 'tc') {
      const ratio = Math.max(num(e, 'ip'), 1e-9) / Math.max(num(e, 'is'), 1e-9)
      r.extra = { ...r.extra, isec: r.i[0].mag / ratio, ratio }
    }
    if (e.kind === 'tp') {
      const vp = Math.max(num(e, 'vp'), 1e-9)
      r.extra = { ...r.extra, vsec: (r.v[0].mag / vp) * num(e, 'vs') }
    }
    if (e.kind === 'fault') {
      r.extra = { ...r.extra, ifault: e.id === fe.id ? maxI(ts[0].i).mag : 0 }
      r.energized = true
      if (e.id === fe.id) r.note = label
    }
    over.set(e.id, r)
  }
  const fterm = terms.get(fe.id)![0]
  const zOhm = (z: Cx): Ph => ({ mag: abs(z) * zBase, ang: deg(z) })
  const info: FaultInfo = { elId: fe.id, type: ftype, label, rf, i: fterm.i, v: fterm.v, z1: zOhm(Z1), z2: zOhm(Z2), z0: z0open ? null : zOhm(Z0), ...(fl ? { line: { name: fl.name, pos: Math.min(100, Math.max(0, num(fe, 'pos'))) } } : {}) }
  return { info, terms, warns, over }
}
