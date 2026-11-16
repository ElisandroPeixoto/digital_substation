import { add, fromPolar, mul, normAngle, type Cx, type Polar } from '../phasor'

export interface PhasePower {
  p: number // W
  q: number // var (+ = corrente atrasada / carga indutiva)
  s: number // VA
  pf: number // |P|/S
  kind: '' | 'ind' | 'cap'
}

const conj = (a: Cx): Cx => ({ re: a.re, im: -a.im })

function mk(p: number, q: number): PhasePower {
  const s = Math.hypot(p, q)
  return { p, q, s, pf: s > 1e-12 ? Math.abs(p) / s : 0, kind: Math.abs(q) < 1e-9 * Math.max(1, s) ? '' : q > 0 ? 'ind' : 'cap' }
}

/** Potência complexa por fase (S = V·I*) e total (soma complexa; S trifásica = |P + jQ|). */
export function powers(v: Polar[], i: Polar[]): { phases: PhasePower[]; total: PhasePower } {
  let sum: Cx = { re: 0, im: 0 }
  const phases = v.map((vp, k) => {
    const s = mul(fromPolar(vp.mag, vp.ang), conj(fromPolar(i[k].mag, i[k].ang)))
    sum = add(sum, s)
    return mk(s.re, s.im)
  })
  return { phases, total: mk(sum.re, sum.im) }
}

/** Referencia os fasores: o fasor escolhido vai a 0° e os demais giram o mesmo ângulo. */
export function referenced(all: Polar[], refIndex: number | null): Polar[] {
  const r = refIndex == null ? 0 : all[refIndex].ang
  return all.map((p) => ({ mag: p.mag, ang: normAngle(p.ang - r) }))
}
