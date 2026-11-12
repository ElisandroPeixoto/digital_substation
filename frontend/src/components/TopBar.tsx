import type { PanelData, SessionInfo } from '../types'

const SPEEDS = [0.5, 1, 2, 5, 10]

interface Props {
  info: SessionInfo | null
  data: PanelData | null
  onPlayPause: () => void
  onSpeed: (s: number) => void
  onRestart: () => void
  onChange: () => void
}

function clock(t: number) {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

export function TopBar({ info, data, onPlayPause, onSpeed, onRestart, onChange }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">⚡</span>
        <div>
          <b>Simulador SEL-751</b>
          <small>{info ? `${info.device} · ${info.filename}` : 'Carregue um arquivo .rdb'}</small>
        </div>
      </div>
      {info && (
        <div className="controls">
          {data && (
            <>
              <span className={`chip-state bk-${data.breaker.state}`}>DJ {data.breaker.closed ? 'FECHADO' : 'ABERTO'}</span>
              <span className="chip-state">Grupo {data.status.group}</span>
              <span className="chip-state">79: {data.status.recloser}</span>
              {data.status.trip === 1 && <span className="chip-state trip">TRIP</span>}
            </>
          )}
          <span className="clock" title="Tempo simulado">{data ? clock(data.time) : '--:--'}</span>
          <button onClick={onPlayPause} title="Pausar/continuar a simulação">{data?.running === false ? '▶ Continuar' : '⏸ Pausar'}</button>
          <label className="speed">
            Velocidade
            <select value={data?.speed ?? 1} onChange={(e) => onSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
          <button onClick={onRestart} title="Reinicia o relé com os ajustes originais">↻ Reiniciar</button>
          <button onClick={onChange}>Trocar ajuste</button>
        </div>
      )}
    </header>
  )
}
