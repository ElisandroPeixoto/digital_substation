// Controle de versão do Eclipse (versionamento semântico MAIOR.MENOR.CORREÇÃO).
// A versão vem do package.json (injetada pelo Vite); ao lançar uma versão nova, atualize o package.json,
// backend/app/version.py, o CHANGELOG.md da raiz, docs/historico-versoes.md e a lista VERSION_HISTORY abaixo.
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string
declare const __GIT_COMMIT__: string

export const APP_VERSION: string = __APP_VERSION__
export const BUILD_DATE: string = __BUILD_DATE__
export const GIT_COMMIT: string = __GIT_COMMIT__

export interface VersionEntry { version: string; date: string; notes: string[] }

/** Histórico de versões (mais recente primeiro), mostrado na página #/about/versoes. */
export const VERSION_HISTORY: VersionEntry[] = [
  {
    version: '1.0.0',
    date: '2026-11-26',
    notes: [
      'Primeira versão numerada do Eclipse.',
      'Aplicativos: DigitalRelay (SEL-751, SEL-787 e SEL-2440), PhaseEngine, SystemLab, Overcurrent, IEC61850, MBitConfig e SCADA.',
      'SystemLab: marca de polaridade do TC e inversão da polaridade sem alterar o desenho.',
    ],
  },
]
