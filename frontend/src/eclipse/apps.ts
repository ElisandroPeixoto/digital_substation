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
  {
    id: 'systemlab',
    name: 'SystemLab',
    description: 'Monte um diagrama unifilar e simule tensões, correntes e potências.',
    route: '#/systemlab',
    glyph: '⚡',
  },
  {
    id: 'overcurrent',
    name: 'Overcurrent',
    description: 'Coordenograma de sobrecorrente: curvas 51 de fase e neutro e proteção 50.',
    route: '#/overcurrent',
    glyph: '⚡',
  },
  {
    id: 'iec61850',
    name: 'IEC61850',
    description: 'Leitura de arquivos .scd/.cid: blocos GOOSE, publicadores, assinantes e bits virtuais; simula GOOSE entre relés do DigitalRelay.',
    route: '#/iec61850',
    glyph: '⚡',
  },
  {
    id: 'mbitconfig',
    name: 'MBitConfig',
    description: 'Links SEL Mirrored Bits entre relés: TMB de um chega no RMB do outro (portas 2/3 em MB8A/MB8B).',
    route: '#/mbitconfig',
    glyph: '⚡',
  },
]
