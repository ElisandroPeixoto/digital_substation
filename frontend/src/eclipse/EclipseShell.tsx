import type { ReactNode } from 'react'
import { APPS } from './apps'
import { useTheme } from './theme'

export type Route = 'home' | 'about' | 'digitalrelay' | 'phaseengine' | 'systemlab'

export function EclipseHeader({ route }: { route: Route }) {
  const [theme, toggle] = useTheme()
  return (
    <header className="ecl-header">
      <a className="ecl-logo" href="#/" aria-label="Eclipse – início">
        <img src="/eclipse-logo.png" alt="Eclipse" />
      </a>
      <nav className="ecl-nav">
        <a href="#/" className={route === 'home' ? 'active' : ''}>Home</a>
        <a href="#/about" className={route === 'about' ? 'active' : ''}>About</a>
      </nav>
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
      <h1 className="ecl-title">
        <img src="/eclipse-icon.png" alt="" />
        <span>Eclipse</span>
      </h1>
      <div className="ecl-apps">
        {APPS.map((a) => (
          <a key={a.id} className="ecl-app" href={a.route}>
            <span className="ecl-app-icon" aria-hidden>{a.glyph}</span>
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
