/** Registro dos aplicativos do Eclipse. Para adicionar um app: acrescente uma entrada aqui e uma rota em App.tsx. */
export interface EclipseApp {
  id: string
  name: string
  description: string
  /** Rota (hash) do app. */
  route: string
  /** Emoji/glifo usado como ícone no launcher. */
  glyph: string
}

export const APPS: EclipseApp[] = [
  {
    id: 'digitalrelay',
    name: 'DigitalRelay',
    description: 'Simulador de relés SEL-751 a partir de arquivos .rdb do AcSELerator QuickSet.',
    route: '#/digitalrelay',
    glyph: '⚡',
  },
  {
    id: 'phaseengine',
    name: 'PhaseEngine',
    description: 'Diagrama fasorial, potências e componentes de sequência a partir de tensões e correntes.',
    route: '#/phaseengine',
    glyph: '⚡',
  },
]
