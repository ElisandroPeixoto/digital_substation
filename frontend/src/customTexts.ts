import { useCallback, useEffect, useState } from 'react'

/** Textos personalizados (por relé) para entradas, saídas, bits virtuais e remotos. Ficam só no navegador. */
export type Texts = Record<string, string>

const key = (relayId?: string) => (relayId ? `sel751.texts.${relayId}` : '')

function load(k: string): Texts {
  if (!k) return {}
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function useCustomTexts(relayId?: string) {
  const k = key(relayId)
  const [texts, setTexts] = useState<Texts>(() => load(k))
  useEffect(() => setTexts(load(k)), [k])

  const persist = (t: Texts) => {
    if (!k) return
    try { localStorage.setItem(k, JSON.stringify(t)) } catch { /* armazenamento indisponível */ }
  }
  const setText = useCallback((name: string, text: string) => {
    setTexts((cur) => {
      const next = { ...cur }
      if (text.trim()) next[name] = text
      else delete next[name]
      persist(next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])
  const clearAll = useCallback(() => {
    setTexts({})
    persist({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])
  return { texts, setText, clearAll }
}

/** Texto a exibir: o personalizado, se houver, senão o descrito nos ajustes. */
export const labelOf = (texts: Texts, name: string, original: string): string => texts[name]?.trim() || original
