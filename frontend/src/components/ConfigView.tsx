import { hms, usePrefs, wallClock } from '../prefs'

function Choice<T extends string>({ name, value, options, onChange, disabled }: {
  name: string
  value: T
  options: { v: T; label: string; hint: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className={`choices ${disabled ? 'disabled' : ''}`}>
      {options.map((o) => (
        <label key={o.v} className={`choice ${value === o.v ? 'sel' : ''}`}>
          <input type="radio" name={name} checked={value === o.v} disabled={disabled} onChange={() => onChange(o.v)} />
          <span><b>{o.label}</b><small>{o.hint}</small></span>
        </label>
      ))}
    </div>
  )
}

/** Aba "Configurações" (ícone de engrenagem): preferências de exibição. */
export function ConfigView({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs } = usePrefs()
  const sample = 3723.456
  return (
    <main className="config">
      <div className="row">
        <h2>Configurações</h2>
        <span className="spacer" />
        <button onClick={onClose}>← Voltar</button>
      </div>

      <section className="card">
        <h3>Estampas de tempo</h3>
        <p className="hint">Define como as estampas de tempo dos eventos (aba Eventos/SER, eventos e comandos DNP3, última mudança dos pontos) são mostradas.</p>
        <Choice
          name="base"
          value={prefs.stampBase}
          onChange={(v) => setPrefs({ stampBase: v })}
          options={[
            { v: 'sim', label: 'Tempo da simulação', hint: 'Conta a partir do início da simulação; para quando você pausa e acompanha a velocidade escolhida.' },
            { v: 'real', label: 'Horário real', hint: `Relógio do computador no instante do evento (ex.: ${wallClock(Date.now() / 1000)}).` },
          ]}
        />
      </section>

      <section className="card">
        <h3>Formato do tempo da simulação</h3>
        <p className="hint">
          Vale para o relógio da barra superior, o tempo simulado das Variáveis internas e as estampas quando a opção acima é
          “Tempo da simulação”. Com “Horário real” as estampas usam sempre data e hora.
        </p>
        <Choice
          name="fmt"
          value={prefs.simFormat}
          onChange={(v) => setPrefs({ simFormat: v })}
          options={[
            { v: 'seconds', label: 'Segundos', hint: `Ex.: ${sample.toFixed(2).replace('.', ',')} s` },
            { v: 'hms', label: 'hh:mm:ss:mmm', hint: `Ex.: ${hms(sample)} (horas, minutos, segundos e milissegundos)` },
          ]}
        />
      </section>
      <p className="hint">As preferências ficam salvas neste navegador.</p>
    </main>
  )
}
