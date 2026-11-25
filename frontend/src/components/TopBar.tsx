import type { PanelData, SessionInfo } from '../types'
import { simTime, usePrefs } from '../prefs'

const SPEEDS = [0.5, 1, 2, 5, 10]

interface Props {
  info: SessionInfo | null
  data: PanelData | null
  onPlayPause: () => void
  onSpeed: (s: number) => void
  onRestart: () => void
  onChange: () => void
  onConfig: () => void
  onExport: () => void
  configOpen: boolean
}

export function TopBar({ info, data, onPlayPause, onSpeed, onRestart, onChange, onConfig, onExport, configOpen }: Props) {
  const { prefs } = usePrefs()
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">⚡</span>
        <div>
          <b>DigitalRelay</b>
          <small>{info ? `${info.device} · ${info.filename}` : 'Carregue um arquivo .rdb'}</small>
        </div>
      </div>
      {info && (
        <div className="controls">
          {data && info.model !== '2440' && (
            <>
              {info.model !== '787' && <span className={`chip-state bk-${data.breaker.state}`}>DJ {data.breaker.closed ? 'FECHADO' : 'ABERTO'}</span>}
              <span className="chip-state">Grupo {data.status.group}</span>
              {info.model !== '787' && <span className="chip-state">79: {data.status.recloser}</span>}
              {data.status.trip === 1 && <span className="chip-state trip">TRIP</span>}
            </>
          )}
          <span className="clock" title="Tempo simulado">{data ? simTime(prefs, data.time) : '--'}</span>
          <button onClick={onPlayPause} title="Pausar/continuar a simulação">{data?.running === false ? '▶ Continuar' : '⏸ Pausar'}</button>
          <label className="speed">
            Velocidade
            <select value={data?.speed ?? 1} onChange={(e) => onSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <button onClick={onRestart} title="Reinicia o relé com os ajustes originais">↻ Reiniciar</button>
          <button onClick={onChange}>Trocar ajuste</button>
          <button onClick={onExport} title="Baixa um JSON com todos os ajustes do .rdb (incluindo os editados no simulador), a injeção e os textos do frontal">⬇ Exportar JSON</button>
        </div>
      )}
      <button className={`gear ${configOpen ? 'active' : ''}`} onClick={onConfig} title="Configurações" aria-label="Configurações">⚙</button>
    </header>
  )
}
