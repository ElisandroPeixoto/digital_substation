import { APPS } from './apps'

/** Ícone do app (o mesmo da Home) para o cabeçalho de cada app; sem imagem, usa o glifo de reserva. */
export function AppMark({ id }: { id: string }) {
  const app = APPS.find((a) => a.id === id)
  if (!app) return <span className="brand-mark">⚡</span>
  return <img className="brand-icon" src={app.icon} alt="" width={36} height={36} onError={(e) => { e.currentTarget.style.display = 'none' }} />
}
