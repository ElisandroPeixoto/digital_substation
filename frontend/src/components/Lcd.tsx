import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PanelData, SessionInfo } from '../types'

export type LcdKey = 'up' | 'down' | 'left' | 'right' | 'esc' | 'ent'
type Mode = 'splash' | 'auto' | 'manual' | 'menu'
type MenuLevel = 'main' | 'meter' | 'targets' | 'status'

const COLS = 16
const MAIN_ITEMS = ['MEDICAO', 'ALVOS', 'STATUS']

function pad(n: number, w: number, d = 1) {
  return n.toFixed(d).padStart(w)
}

function meterLines(m: Record<string, number>): string[] {
  return [
    `IA   ${pad(m.IA_MAG ?? 0, 8)} A`,
    `IB   ${pad(m.IB_MAG ?? 0, 8)} A`,
    `IC   ${pad(m.IC_MAG ?? 0, 8)} A`,
    `IG   ${pad(m.IG_MAG ?? 0, 8)} A`,
    `VAB  ${pad((m.VAB_MAG ?? 0) / 1000, 7, 2)} kV`,
    `VBC  ${pad((m.VBC_MAG ?? 0) / 1000, 7, 2)} kV`,
    `VCA  ${pad((m.VCA_MAG ?? 0) / 1000, 7, 2)} kV`,
    `FREQ ${pad(m.FREQ ?? 0, 7, 2)} Hz`,
    `P    ${pad(m.P ?? 0, 7, 0)} kW`,
    `Q    ${pad(m.Q ?? 0, 5, 0)} kVAr`,
    `FP   ${pad(m.PF ?? 0, 9, 3)}`,
    `3I2  ${pad(m['3I2'] ?? 0, 8)} A`,
    `VCC  ${pad(m.VDC ?? 0, 8)} V`,
  ]
}

function pagesOf(lines: string[]): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < lines.length; i += 2) out.push([lines[i], lines[i + 1] ?? ''])
  return out
}

/** Lógica do display 2x16 e dos botões de navegação do painel frontal. */
export function useLcd(panel: PanelData | null, info: SessionInfo) {
  const [mode, setMode] = useState<Mode>('splash')
  const [page, setPage] = useState(0)
  const [level, setLevel] = useState<MenuLevel>('main')
  const [cur, setCur] = useState(0)

  useEffect(() => {
    setMode('splash')
    setLevel('main')
    const t = window.setTimeout(() => setMode((m) => (m === 'splash' ? 'auto' : m)), 3500)
    return () => window.clearTimeout(t)
  }, [info.id])

  useEffect(() => {
    if (mode !== 'auto') return
    const id = window.setInterval(() => setPage((p) => p + 1), 2500)
    return () => window.clearInterval(id)
  }, [mode])

  const points = panel?.panel.lcd ?? []
  const meter = panel?.meter ?? {}
  const pointPages = useMemo(() => pagesOf(points), [points])

  const subPages = useMemo(() => {
    if (!panel) return []
    if (level === 'meter') return pagesOf(meterLines(meter))
    if (level === 'targets') {
      const lines: string[] = []
      if (panel.panel.trip.on) lines.push('TRIP')
      for (const t of panel.panel.targets) {
        if (t.on) lines.push(`${t.id} ${(info.static.targets.find((s) => s.id === t.id)?.label ?? '').slice(0, 12)}`)
      }
      if (!lines.length) lines.push('SEM ALVOS ATIVOS')
      return pagesOf(lines)
    }
    if (level === 'status') {
      const s = panel.status
      return pagesOf([
        `GRUPO ATIVO: ${s.group}`,
        `DISJ: ${panel.breaker.closed ? 'FECHADO' : 'ABERTO'}`,
        `79: ${s.recloser}  SH${s.shot}`,
        `TRIP: ${s.trip ? 'SIM' : 'NAO'}`,
        `OPERACOES: ${panel.breaker.operations}`,
      ])
    }
    return []
  }, [panel, level, meter, info])

  const onKey = useCallback(
    (key: LcdKey) => {
      const n = Math.max(1, pointPages.length)
      if (mode === 'splash') {
        setMode('auto')
        return
      }
      if (mode === 'auto' || mode === 'manual') {
        if (key === 'ent') {
          setMode('menu')
          setLevel('main')
          setCur(0)
        } else if (key === 'esc') {
          setMode('auto')
        } else if (key === 'up' || key === 'left') {
          setMode('manual')
          setPage((p) => (((p - 1) % n) + n) % n)
        } else {
          setMode('manual')
          setPage((p) => (p + 1) % n)
        }
        return
      }
      // menu
      if (level === 'main') {
        if (key === 'up') setCur((c) => Math.max(0, c - 1))
        else if (key === 'down') setCur((c) => Math.min(MAIN_ITEMS.length - 1, c + 1))
        else if (key === 'ent' || key === 'right') {
          setLevel((['meter', 'targets', 'status'] as MenuLevel[])[cur])
          setPage(0)
        } else if (key === 'esc' || key === 'left') setMode('auto')
      } else {
        const m = Math.max(1, subPages.length)
        if (key === 'up') setPage((p) => (((p - 1) % m) + m) % m)
        else if (key === 'down') setPage((p) => (p + 1) % m)
        else if (key === 'esc' || key === 'left') setLevel('main')
      }
    },
    [mode, level, cur, pointPages.length, subPages.length],
  )

  let lines: [string, string]
  if (mode === 'splash' || !panel) {
    lines = [info.header.RELAYTYPE ?? 'SEL-751', 'FEEDER RELAY']
  } else if (mode === 'menu') {
    if (level === 'main') {
      const start = Math.min(cur, MAIN_ITEMS.length - 2)
      const row = (i: number) => (i < MAIN_ITEMS.length ? `${i === cur ? '>' : ' '}${MAIN_ITEMS[i]}` : '')
      lines = [row(start), row(start + 1)]
    } else {
      lines = subPages[page % Math.max(1, subPages.length)] ?? ['', '']
    }
  } else if (!pointPages.length) {
    lines = [info.header.RELAYTYPE ?? 'SEL-751', 'FEEDER RELAY']
  } else {
    lines = pointPages[page % pointPages.length]
  }
  return { lines, onKey, mode }
}

/** Uma linha do LCD. Textos maiores que 16 colunas rolam (marquee). */
export function LcdLine({ text }: { text: string }) {
  const [pos, setPos] = useState(0)
  const overflow = text.length > COLS
  useEffect(() => {
    if (!overflow) {
      setPos(0)
      return
    }
    const id = window.setInterval(() => setPos((p) => (p > text.length - COLS + 3 ? 0 : p + 1)), 380)
    return () => window.clearInterval(id)
  }, [overflow, text.length])
  const shown = overflow ? text.slice(Math.min(pos, text.length - COLS), Math.min(pos, text.length - COLS) + COLS) : text
  return <div className="lcd-line">{shown.padEnd(COLS, ' ')}</div>
}
