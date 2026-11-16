import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'eclipse.theme'

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* armazenamento indisponível */
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  useEffect(() => applyTheme(theme), [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}
