import { useEffect, useRef, useState, type ReactNode } from 'react'
import { APPS } from './apps'
import { useTheme } from './theme'

export type Route = 'home' | 'about' | 'digitalrelay' | 'phaseengine' | 'systemlab' | 'overcurrent' | 'iec61850' | 'mbitconfig'

/** Nome exibido no header para a rota atual. */
function routeTitle(route: Route): string {
  return APPS.find((a) => a.id === route)?.name ?? ''
}

/** Menu suspenso com os apps do Eclipse (troca de módulo sem voltar à Home). */
function AppSwitcher({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="ecl-switch" ref={box}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title="Ir para outro aplicativo">Apps ▾</button>
      {open && (
        <div className="ecl-menu" role="menu">
          {APPS.map((a) => (
            <a key={a.id} role="menuitem" href={a.route} className={route === a.id ? 'active' : ''} onClick={() => setOpen(false)}>
              <img className="ecl-menu-img" src={a.icon} alt="" width={22} height={22} /> {a.name}
            </a>
          ))}
          <hr />
          <a role="menuitem" href="#/" onClick={() => setOpen(false)}>Início</a>
        </div>
      )}
    </div>
  )
}

export function EclipseHeader({ route }: { route: Route }) {
  const [theme, toggle] = useTheme()
  return (
    <header className="ecl-header">
      <a className="ecl-logo" href="#/" aria-label="Eclipse – início">
        <img src="/eclipse-logo.png" alt="Eclipse" />
      </a>
      {routeTitle(route) && <span className="ecl-current" aria-live="polite">{routeTitle(route)}</span>}
      <nav className="ecl-nav">
        <a href="#/" className={route === 'home' ? 'active' : ''}>Início</a>
        <a href="#/about" className={route === 'about' ? 'active' : ''}>Sobre</a>
      </nav>
      <AppSwitcher route={route} />
      <button className="theme-toggle" onClick={toggle} title={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'} aria-label="Alternar modo claro/escuro">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  )
}

export function EclipseShell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="ecl-shell">
      <EclipseHeader route={route} />
      <div className="ecl-body">{children}</div>
    </div>
  )
}

export function HomeView() {
  return (
    <main className="ecl-home">
      <h1 className="ecl-title logo">
        <img src="/eclipse-logo.png" alt="Eclipse" />
      </h1>
      <div className="ecl-apps">
        {APPS.map((a) => (
          <a key={a.id} className="ecl-app" href={a.route}>
            <img className="ecl-app-img" src={a.icon} alt="" width={96} height={96} />
            <b>{a.name}</b>
          </a>
        ))}
      </div>
    </main>
  )
}

export function AboutView() {
  return (
    <main className="ecl-about">
      <h1 className="ecl-title small">
        <img src="/eclipse-icon.png" alt="" />
        <span>Sobre o Eclipse</span>
      </h1>
      <p>
        O <b>Eclipse</b> é um software de simulação de sistemas elétricos de potência. Ele reúne vários aplicativos que
        podem, ou não, interagir entre si.
      </p>
      <h3>Aplicativos</h3>
      <ul>
        {APPS.map((a) => (
          <li key={a.id}><a href={a.route}>{a.name}</a> – {a.description}</li>
        ))}
      </ul>
    </main>
  )
}
