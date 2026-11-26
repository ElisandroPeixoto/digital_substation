/** Registro dos aplicativos do Eclipse. Para adicionar um app: acrescente uma entrada aqui e uma rota em App.tsx. */
export interface EclipseApp {
  id: string
  name: string
  description: string
  /** Rota (hash) do app. */
  route: string
  /** Emoji/glifo usado como ícone no launcher (reserva, se a imagem não carregar). */
  glyph: string
  /** Ícone (PNG em `assets/app-icons/`, servido na raiz). */
  icon: string
}

export const APPS: EclipseApp[] = [
  {
    id: 'digitalrelay',
    name: 'DigitalRelay',
    description: 'Simulador de relés SEL-751 a partir de arquivos .rdb do AcSELerator QuickSet.',
    route: '#/digitalrelay',
    glyph: '⚡',
    icon: '/app-icons/digitalrelay.png',
  },
  {
    id: 'phaseengine',
    name: 'PhaseEngine',
    description: 'Diagrama fasorial, potências e componentes de sequência a partir de tensões e correntes.',
    route: '#/phaseengine',
    glyph: '⚡',
    icon: '/app-icons/phaseengine.png',
  },
  {
    id: 'systemlab',
    name: 'SystemLab',
    description: 'Monte um diagrama unifilar e simule tensões, correntes e potências.',
    route: '#/systemlab',
    glyph: '⚡',
    icon: '/app-icons/systemlab.png',
  },
  {
    id: 'overcurrent',
    name: 'Overcurrent',
    description: 'Coordenograma de sobrecorrente: curvas 51 de fase e neutro e proteção 50.',
    route: '#/overcurrent',
    glyph: '⚡',
    icon: '/app-icons/overcurrent.png',
  },
  {
    id: 'iec61850',
    name: 'IEC61850',
    description: 'Leitura de arquivos .scd/.cid: blocos GOOSE, publicadores, assinantes e bits virtuais; simula GOOSE entre relés do DigitalRelay.',
    route: '#/iec61850',
    glyph: '⚡',
    icon: '/app-icons/iec61850.png',
  },
  {
    id: 'mbitconfig',
    name: 'MBitConfig',
    description: 'Links SEL Mirrored Bits entre relés: TMB de um chega no RMB do outro (portas 2/3 em MB8A/MB8B).',
    route: '#/mbitconfig',
    glyph: '⚡',
    icon: '/app-icons/mbitconfig.png',
  },
  {
    id: 'scada',
    name: 'SCADA',
    description: 'Supervisório dos IEDs do DigitalRelay: eventos binários, medidas analógicas e comandos pelo mapa DNP3, com textos de uma planilha de mapa.',
    route: '#/scada',
    glyph: '📟',
    icon: '/app-icons/scada.png',
  },
]
