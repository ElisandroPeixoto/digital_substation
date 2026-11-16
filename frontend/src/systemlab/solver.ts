/**
 * Solver de regime permanente do SystemLab: sistema trifásico equilibrado, em por unidade (Sbase = 100 MVA),
 * análise nodal com impedâncias constantes.
 *
 * - Fonte: tensão atrás da impedância de curto-circuito (Zs = V²/Scc, com X/R).
 * - Transformador: impedância série (z% na própria base), sem derivação; a base de tensão muda pela relação nominal.
 * - Carga: impedância constante, calculada na tensão nominal da zona (P, FP).
 * - Disjuntor/seccionadora/TC fechados: impedância desprezível; abertos: sem ligação. TP: sem influência (medição).
 * - Partes sem caminho fechado até uma fonte ficam desenergizadas (V = 0).
 */
import { busCells, flag, num, type El, type Wire } from './model'

export const SBASE = 100 // MVA
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
}

export interface Solution {
  res: Map<number, ElResult>
  /** Nó elétrico de cada terminal (`id:índice`) e se está energizado, para colorir as ligações. */
  nodeEnergized: Map<string, boolean>
  totals: { gen: number; genQ: number; load: number; loadQ: number; loss: number }
}

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

interface Branch { a: number; b: number; y: Cx }

export function solve(els: El[], wires: Wire[]): Solution {
  // ---- nós elétricos: terminais ligados por fios (e todos os terminais de um barramento) formam um nó
  const idx = new Map<string, number>()
  const elById = new Map<number, El>()
  let count = 0
  const nPorts = (e: El) => (e.kind === 'source' || e.kind === 'load' || e.kind === 'tp' ? 1 : e.kind === 'bus' ? busCells(e) + 1 : 2)
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
    if (e.kind === 'breaker' || e.kind === 'switch' || e.kind === 'tc') link(node(e, 0), node(e, 1), 1)
    if (e.kind === 'transformer') {
      const v1 = Math.max(num(e, 'v1'), 1e-6)
      link(node(e, 0), node(e, 1), Math.max(num(e, 'v2'), 1e-6) / v1)
    }
  }
  const queue: number[] = []
  for (const e of els) {
    if (e.kind !== 'source') continue
    const n = node(e, 0)
    if (!base.has(n)) { base.set(n, Math.max(num(e, 'vkv'), 1e-6)); queue.push(n) }
  }
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
      branches.push({ a, b: node(e, 1), y })
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

  // ---- componentes conexos que contêm alguma fonte são resolvidos; o resto fica desenergizado
  const uc = new UF(count)
  for (const b of branches) uc.union(b.a, b.b)
  const srcRoots = new Set(sources.map((s) => uc.find(s.n)))
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
  for (const nodes of groups.values()) {
    const pos = new Map(nodes.map((n, i) => [n, i]))
    const m = nodes.length
    const Y: Cx[][] = Array.from({ length: m }, () => Array.from({ length: m }, () => cx()))
    const I: Cx[] = Array.from({ length: m }, () => cx())
    for (const n of nodes) {
      const i = pos.get(n)!
      Y[i][i] = add(Y[i][i], shunt.get(n) ?? cx())
      I[i] = add(I[i], inj.get(n) ?? cx())
    }
    for (const b of branches) {
      const i = pos.get(b.a)
      const j = pos.get(b.b)
      if (i == null || j == null) continue
      Y[i][i] = add(Y[i][i], b.y)
      Y[j][j] = add(Y[j][j], b.y)
      Y[i][j] = sub(Y[i][j], b.y)
      Y[j][i] = sub(Y[j][i], b.y)
    }
    const x = gauss(Y, I)
    nodes.forEach((n, i) => V.set(n, x[i]))
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

  for (const e of els) {
    const r: ElResult = { energized: false, v: [], i: [], p: [], q: [], extra: {} }
    const n0 = node(e, 0)
    r.energized = abs(vOf(n0)) > 1e-6 || (nPorts(e) > 1 && abs(vOf(node(e, 1))) > 1e-6)
    if (e.kind === 'bus') {
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
    } else if (e.kind === 'tp') {
      r.v = [kv(n0)]
      const vp = Math.max(num(e, 'vp'), 1e-9)
      r.extra = { vsec: (r.v[0].mag / vp) * num(e, 'vs'), ratio: (vp * 1000) / Math.max(num(e, 'vs'), 1e-9) }
    } else {
      // dois terminais em série: breaker, switch, tc, transformer
      const n1 = node(e, 1)
      const closed = e.kind === 'tc' || e.kind === 'transformer' || flag(e, 'closed')
      let y = e.kind === 'transformer' ? trafoY.get(e.id)! : cx(closed ? Y_SWITCH : 0)
      if (e.kind === 'transformer' && abs(vOf(n0)) < 1e-9 && abs(vOf(n1)) < 1e-9) y = cx()
      const i1 = mul(sub(vOf(n0), vOf(n1)), y) // entrando pelo terminal 1
      const i2 = cx(-i1.re, -i1.im)
      r.v = [kv(n0), kv(n1)]
      r.i = [amps(n0, i1), amps(n1, i2)]
      const [p1, q1] = sFlow(n0, i1)
      const [p2, q2] = sFlow(n1, i2)
      r.p = [p1, p2]; r.q = [q1, q2]
      if (e.kind === 'tc') {
        const ratio = Math.max(num(e, 'ip'), 1e-9) / Math.max(num(e, 'is'), 1e-9)
        r.extra = { isec: r.i[0].mag / ratio, ratio }
      } else if (e.kind === 'transformer') {
        r.extra = { loading: (Math.hypot(p1, q1) / Math.max(num(e, 'sn'), 1e-9)) * 100, loss: p1 + p2 }
        totals.loss += p1 + p2
      }
    }
    res.set(e.id, r)
  }
  return { res, nodeEnergized, totals }
}
