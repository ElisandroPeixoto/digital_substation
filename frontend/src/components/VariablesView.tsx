import { useState } from 'react'
import { api } from '../api'
import { fmt, usePoll } from '../hooks'
import type { StateData } from '../types'
import { Bar, Empty, Pill, Section } from './ui'

const REC_LABEL: Record<string, string> = { RS: 'Repouso (79RS)', CY: 'Em ciclo (79CY)', LO: 'Bloqueio (79LO)' }

export function VariablesView({ sid }: { sid: string }) {
  const { data, error } = usePoll(() => api.state(sid), 400, true, sid)
  const [q, setQ] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)
  if (!data) return <Empty>{error ?? 'Carregando estado interno…'}</Empty>
  const s: StateData = data
  const match = (...texts: (string | undefined)[]) => !q || texts.some((t) => (t ?? '').toLowerCase().includes(q.toLowerCase()))
  const active = (v: boolean | number) => !onlyActive || Boolean(v)

  const inputs = s.inputs.filter((i) => match(i.name, i.label) && active(i.value))
  const outputs = s.outputs.filter((o) => match(o.name, o.comment, o.expr) && active(o.value))
  const latches = s.latches.filter((l) => match(l.name, l.set_comment, l.rst_comment, l.set_expr, l.rst_expr) && active(l.value))
  const timers = s.timers.filter((t) => match(t.name, t.comment, t.expr) && active(t.out || t.input))
  const words = s.words.filter(([n, v]) => match(n) && active(v))
  const analog = Object.entries(s.analog).filter(([n]) => match(n))
  const rc = s.recloser
  const tc = s.trip_close

  return (
    <div className="vars">
      <div className="toolbar">
        <input className="search" placeholder="Filtrar por nome, comentário ou equação…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Só ativos (=1)</label>
        <span className="muted">Tempo simulado: {fmt(s.time, 2)} s</span>
      </div>

      {s.unresolved.length > 0 && (
        <div className="alert">
          A lógica referencia {s.unresolved.length} bit(s) que o simulador não conhece (valem 0): {s.unresolved.join(', ')}
        </div>
      )}

      <div className="summary-cards">
        <div className="mini"><span>Grupo ativo</span><b>{s.group}{s.pending_group ? ` → ${s.pending_group}` : ''}</b></div>
        <div className="mini"><span>TRIP</span><Pill on={tc.TRIP as number} /></div>
        <div className="mini"><span>CLOSE</span><Pill on={tc.CLOSE as number} /></div>
        <div className="mini"><span>52A</span><Pill on={tc['52A'] as number} onLabel="FECHADO" offLabel="ABERTO" /></div>
        <div className="mini"><span>Religamento</span><b>{rc.enabled ? REC_LABEL[rc.state] : 'desabilitado'}</b></div>
        <div className="mini"><span>Tentativa</span><b>{rc.shot} / {rc.max_shots}</b></div>
      </div>

      <Section title="Disparo e fechamento" open={!q}>
        <table className="tbl">
          <tbody>
            <tr><td>TR</td><td><Pill on={tc.TR as number} /></td><td className="mono wrap">{String(tc.TR_expr)}</td></tr>
            <tr><td>ULTRIP</td><td><Pill on={tc.ULTRIP as number} /></td><td className="muted">Desbloqueio do TRIP após TDURD = {String(tc.TDURD)} s</td></tr>
            <tr><td>CL</td><td><Pill on={tc.CL as number} /></td><td className="mono wrap">{String(tc.CL_expr)}</td></tr>
            <tr><td>CF</td><td><Pill on={tc.CF as number} /></td><td className="muted">Falha de fechamento</td></tr>
            <tr><td>Bobinas de abertura</td><td colSpan={2} className="mono">{(tc.trip_outputs as string[]).join(', ') || '–'}</td></tr>
            <tr><td>Bobinas de fechamento</td><td colSpan={2} className="mono">{(tc.close_outputs as string[]).join(', ') || '–'}</td></tr>
          </tbody>
        </table>
      </Section>

      <Section title="Elementos de proteção" count={s.protection.elements.length} right={<span className="muted">{s.protection.disabled} desabilitados (OFF)</span>}>
        {s.protection.elements.length === 0 ? (
          <Empty>Todos os pickups estão em OFF. Habilite elementos na aba “Ajustes” (grupo ativo) para testar a proteção.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Elemento</th><th>Função</th><th>Ajuste</th><th>Medido</th><th>Controle de torque</th><th>Partida</th><th>Atuação</th><th>Avanço</th></tr>
            </thead>
            <tbody>
              {s.protection.elements
                .filter((e) => match(e.name, e.kind) && active(e.pk || e.timed))
                .map((e) => (
                  <tr key={e.name} className={e.timed ? 'hl-red' : e.pk ? 'hl' : ''}>
                    <td className="mono">{e.name}</td>
                    <td>{e.kind}</td>
                    <td className="mono">{e.setting}</td>
                    <td className="mono">{fmt(e.measured, 2)}</td>
                    <td className="mono">{e.tc || '1'}</td>
                    <td><Pill on={e.pk} title={e.pickup_bit} /></td>
                    <td><Pill on={e.timed} title={e.timed_bit} /></td>
                    <td><Bar pct={e.progress} tone={e.timed ? 'red' : 'blue'} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Religamento automático (79)" open={rc.enabled}>
        {!rc.enabled ? (
          <Empty>Religamento desabilitado neste ajuste (E79 = 0).</Empty>
        ) : (
          <table className="tbl">
            <tbody>
              <tr><td>Estado</td><td><b>{REC_LABEL[rc.state]}</b></td></tr>
              <tr><td>Tentativa (SH)</td><td>{rc.shot} de {rc.max_shots}</td></tr>
              <tr><td>Tempos mortos</td><td className="mono">{rc.intervals.map((v) => (v ? `${v}s` : '–')).join(' / ')}</td></tr>
              <tr><td>Tempo morto em curso</td><td>{rc.state === 'CY' && rc.phase === 'open' ? `${fmt(rc.open_interval_elapsed, 1)} s` : '–'}</td></tr>
              <tr><td>Reset em curso</td><td>{fmt(rc.reset_elapsed, 1)} s (limite {rc.state === 'LO' ? rc.lockout_reset_time : rc.reset_time} s)</td></tr>
              <tr><td>Condição de bloqueio (79DTL)</td><td className="mono wrap">{rc.dtl}</td></tr>
              <tr><td>Último evento</td><td className="muted">{rc.last_event || '–'}</td></tr>
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Entradas digitais" count={inputs.length}>
        <table className="tbl">
          <thead><tr><th>Entrada</th><th>Descrição</th><th>Físico</th><th>Filtrado</th><th>Debounce</th></tr></thead>
          <tbody>
            {inputs.map((i) => (
              <tr key={i.name} className={i.value ? 'hl' : ''}>
                <td className="mono">{i.name}{i.breaker ? ' (52A)' : ''}</td>
                <td>{i.label}</td>
                <td><Pill on={i.raw} /></td>
                <td><Pill on={i.value} /></td>
                <td className="mono">{i.debounce_ms} ms{i.pending > 0 ? ` · ${fmt(i.pending, 1)} s` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Saídas digitais" count={outputs.length}>
        <table className="tbl">
          <thead><tr><th>Saída</th><th>Estado</th><th>Equação</th><th>Descrição</th></tr></thead>
          <tbody>
            {outputs.map((o) => (
              <tr key={o.name} className={o.value ? 'hl' : ''}>
                <td className="mono">{o.name}</td>
                <td><Pill on={o.value} /></td>
                <td className="mono wrap">{o.expr}</td>
                <td>{o.comment}{o.role ? <span className="tag">{`bobina de ${o.role}`}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Latches (LT)" count={latches.length}>
        <table className="tbl">
          <thead><tr><th>Latch</th><th>Estado</th><th>Função</th><th>SET</th><th></th><th>RESET</th><th></th></tr></thead>
          <tbody>
            {latches.map((l) => (
              <tr key={l.name} className={l.value ? 'hl' : ''}>
                <td className="mono">{l.name}</td>
                <td><Pill on={l.value} /></td>
                <td>{l.set_comment}</td>
                <td className="mono wrap">{l.set_expr}</td>
                <td><Pill on={l.set_now} /></td>
                <td className="mono wrap">{l.rst_expr}</td>
                <td><Pill on={l.rst_now} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Variáveis SELogic temporizadas (SV)" count={timers.length}>
        <table className="tbl">
          <thead><tr><th>Var.</th><th>Entrada</th><th>Saída (T)</th><th>PU / DO</th><th>Contagem</th><th>Equação</th><th>Descrição</th></tr></thead>
          <tbody>
            {timers.map((t) => (
              <tr key={t.name} className={t.out ? 'hl' : ''}>
                <td className="mono">{t.name}</td>
                <td><Pill on={t.input} /></td>
                <td><Pill on={t.out} /></td>
                <td className="mono">{t.pu} / {t.do} s</td>
                <td className="mono">{t.input && !t.out ? `PU ${fmt(t.pu_el, 2)}` : !t.input && t.out ? `DO ${fmt(t.do_el, 2)}` : '–'}</td>
                <td className="mono wrap">{t.expr}</td>
                <td>{t.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Contadores e variáveis matemáticas" count={s.counters.length + s.math.length}>
        <table className="tbl">
          <thead><tr><th>Nome</th><th>Valor</th><th>Equação</th><th>Descrição</th></tr></thead>
          <tbody>
            {s.counters.map((c) => (
              <tr key={c.name}>
                <td className="mono">{c.name}</td>
                <td className="mono">{c.value} / {c.preset} <Pill on={c.q} onLabel="Q" offLabel="Q" /></td>
                <td className="mono wrap">CU: {c.cu}</td>
                <td>{c.comment}</td>
              </tr>
            ))}
            {s.math.map((m) => (
              <tr key={m.name}>
                <td className="mono">{m.name}</td>
                <td className="mono">{fmt(m.value, 3)}</td>
                <td className="mono wrap">{m.expr}</td>
                <td>{m.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Grandezas analógicas" count={analog.length} open={false}>
        <div className="chips">
          {analog.map(([n, v]) => (
            <span key={n} className="chip"><b>{n}</b> {fmt(v, 3)}</span>
          ))}
        </div>
      </Section>

      <Section title="Relay Word (todos os bits)" count={words.length} open={false}>
        <div className="chips">
          {words.map(([n, v]) => (
            <span key={n} className={`chip ${v ? 'on' : ''}`}>{n}</span>
          ))}
        </div>
      </Section>
    </div>
  )
}
