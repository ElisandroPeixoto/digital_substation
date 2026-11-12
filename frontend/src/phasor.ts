/** Utilitários de fasores (ângulos em graus, sentido anti-horário positivo). */
export interface Cx {
  re: number
  im: number
}
export interface Polar {
  mag: number
  ang: number
}

const RAD = Math.PI / 180

export const fromPolar = (mag: number, angDeg: number): Cx => ({ re: mag * Math.cos(angDeg * RAD), im: mag * Math.sin(angDeg * RAD) })
export const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im })
export const mul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
export const scale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k })

/** Normaliza o ângulo para (-180, 180]. */
export function normAngle(a: number): number {
  let x = ((a % 360) + 360) % 360
  if (x > 180) x -= 360
  return x
}

export function toPolar(c: Cx): Polar {
  const mag = Math.hypot(c.re, c.im)
  return { mag, ang: mag < 1e-9 ? 0 : normAngle(Math.atan2(c.im, c.re) / RAD) }
}

const A1 = fromPolar(1, 120)
const A2 = fromPolar(1, 240)

/** Componentes simétricas: zero, positiva e negativa (já divididas por 3). */
export function sequence(a: Polar, b: Polar, c: Polar): { zero: Polar; pos: Polar; neg: Polar } {
  const ca = fromPolar(a.mag, a.ang)
  const cb = fromPolar(b.mag, b.ang)
  const cc = fromPolar(c.mag, c.ang)
  const zero = scale(add(add(ca, cb), cc), 1 / 3)
  const pos = scale(add(add(ca, mul(A1, cb)), mul(A2, cc)), 1 / 3)
  const neg = scale(add(add(ca, mul(A2, cb)), mul(A1, cc)), 1 / 3)
  return { zero: toPolar(zero), pos: toPolar(pos), neg: toPolar(neg) }
}

/** Menor "número redondo" (1, 2, 5 × 10^n) maior ou igual a x. */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  for (const m of [1, 2, 5, 10]) if (m * p >= x - 1e-12) return m * p
  return 10 * p
}
