/** Curvas de sobrecorrente temporizada do SEL-751 (manual, tabelas 4.20 a 4.22) – mesmas constantes de backend/app/curves.py. */
export interface CurveDef {
  code: string
  name: string
  a: number
  p: number
  b: number
}

export const CURVES: CurveDef[] = [
  { code: 'U1', name: 'US moderadamente inversa', a: 0.0104, p: 0.02, b: 0.0226 },
  { code: 'U2', name: 'US inversa', a: 5.95, p: 2.0, b: 0.18 },
  { code: 'U3', name: 'US muito inversa', a: 3.88, p: 2.0, b: 0.0963 },
  { code: 'U4', name: 'US extremamente inversa', a: 5.67, p: 2.0, b: 0.0352 },
  { code: 'U5', name: 'US tempo curto', a: 0.00342, p: 0.02, b: 0.00262 },
  { code: 'C1', name: 'IEC normal inversa', a: 0.14, p: 0.02, b: 0 },
  { code: 'C2', name: 'IEC muito inversa', a: 13.5, p: 1.0, b: 0 },
  { code: 'C3', name: 'IEC extremamente inversa', a: 80, p: 2.0, b: 0 },
  { code: 'C4', name: 'IEC tempo longo', a: 120, p: 1.0, b: 0 },
  { code: 'C5', name: 'IEC tempo curto', a: 0.05, p: 0.04, b: 0 },
  { code: 'E1', name: 'IEEE moderadamente inversa', a: 0.0515, p: 0.02, b: 0.114 },
  { code: 'E2', name: 'IEEE muito inversa', a: 19.61, p: 2.0, b: 0.491 },
  { code: 'E3', name: 'IEEE extremamente inversa', a: 28.2, p: 2.0, b: 0.1217 },
]

export const SAT_MULTIPLE = 30 // com 51SAT = Y o múltiplo é limitado a 30

const byCode = new Map(CURVES.map((c) => [c.code, c]))

/** Tempo de operação do 51 (s) para o múltiplo M = I / pickup: t = máx(TD·(A/(M^P − 1) + B), MR) + CT. Infinito se M ≤ 1. */
export function time51(code: string, m: number, td: number, ct: number, mr: number, saturate: boolean): number {
  if (!(m > 1)) return Infinity
  const c = byCode.get(code) ?? byCode.get('C1')!
  const mm = saturate ? Math.min(m, SAT_MULTIPLE) : m
  const t = td * (c.a / (mm ** c.p - 1) + c.b)
  return Math.max(t, mr) + ct
}
