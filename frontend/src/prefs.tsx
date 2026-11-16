import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { fmt } from './hooks'

/** Preferências de exibição (só da interface; ficam no navegador). */
export interface Prefs {
  /** Origem das estampas de tempo: tempo da simulação ou horário real (relógio do computador). */
  stampBase: 'sim' | 'real'
  /** Formato do tempo da simulação: segundos ou hh:mm:ss:mmm. */
  simFormat: 'seconds' | 'hms'
}

const KEY = 'sel751.prefs'
const DEFAULTS: Prefs = { stampBase: 'sim', simFormat: 'seconds' }

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      stampBase: raw.stampBase === 'real' ? 'real' : 'sim',
      simFormat: raw.simFormat === 'hms' ? 'hms' : 'seconds',
    }
  } catch {
    return DEFAULTS
  }
}

const Ctx = createContext<{ prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void }>({ prefs: DEFAULTS, setPrefs: () => undefined })

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Prefs>(load)
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setState((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* sem armazenamento */
      }
      return next
    })
  }, [])
  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePrefs = () => useContext(Ctx)

const p2 = (n: number) => String(n).padStart(2, '0')

/** Segundos de simulação -> "hh:mm:ss:mmm". */
export function hms(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${p2(h)}:${p2(m)}:${p2(s)}:${String(ms % 1000).padStart(3, '0')}`
}

/** Horário real (época em segundos) -> "dd/mm/aaaa hh:mm:ss:mmm" no fuso do computador. */
export function wallClock(w: number): string {
  const d = new Date(w * 1000)
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}:${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** Tempo da simulação no formato escolhido. */
export function simTime(prefs: Prefs, t: number, digits = 2): string {
  return prefs.simFormat === 'hms' ? hms(t) : `${fmt(t, digits)} s`
}

/** Estampa de tempo de um evento: horário real (se escolhido e disponível) ou tempo da simulação. */
export function stamp(prefs: Prefs, t: number, w?: number | null, digits = 2): string {
  if (prefs.stampBase === 'real' && w != null) return wallClock(w)
  return simTime(prefs, t, digits)
}

/** Atalho para componentes: devolve funções já ligadas às preferências. */
export function useStamp() {
  const { prefs } = usePrefs()
  return {
    prefs,
    stamp: (t: number, w?: number | null, digits = 2) => stamp(prefs, t, w, digits),
    simTime: (t: number, digits = 2) => simTime(prefs, t, digits),
    header: prefs.stampBase === 'real' ? 'Horário' : prefs.simFormat === 'hms' ? 't (hh:mm:ss:mmm)' : 't (s)',
  }
}
