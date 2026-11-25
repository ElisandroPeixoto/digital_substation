import { useState } from 'react'
import { api } from '../api'
import { fmt, usePoll } from '../hooks'
import type { DirectionalInfo, StateData, StateElement } from '../types'
import { useStamp } from '../prefs'
import { Bar, Empty, Pill, Section } from './ui'

/** Controle de forçamento de uma variável lógica: 0/1 (ou valor numérico) ou liberar. */
function ForceCtl({ sid, name, forced, numeric }: { sid: string; name: string; forced: Record<string, number>; numeric?: boolean }) {
  const [txt, setTxt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const go = (v: number | null) => api.force(sid, name, v).then(() => setErr(null)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  if (name in forced) {
    return <button className="danger force-btn" onClick={() => go(null)} title={`${name} forçado em ${forced[name]}. Clique para liberar`}>FORÇADO = {forced[name]} ✕</button>
  }
  return (
    <span className="force-ctl" title={err ?? `Forçar ${name}`}>
      {numeric ? (
        <>
          <input className="numinput force-num" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="valor" aria-label={`Valor para forçar ${name}`} />
          <button className="force-btn" disabled={txt.trim() === '' || Number.isNaN(Number(txt))} onClick={() => go(Number(txt))}>Forçar</button>
        </>
      ) : (
        <>
          <button className="force-btn" onClick={() => go(0)}>0</button>
          <button className="force-btn" onClick={() => go(1)}>1</button>
        </>
      )}
      {err && <span className="err-text">!</span>}
    </span>
  )
}

const REC_LABEL: Record<string, string> = { RS: 'Repouso (79RS)', CY: 'Em ciclo (79CY)', LO: 'Bloqueio (79LO)' }

export function VariablesView({ sid, model }: { sid: string; model?: string }) {
  const is2440 = model === '2440'
  const { data, error } = usePoll(() => api.state(sid), 400, true, sid)
  const [q, setQ] = useState('')
  const ts = useStamp()
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
  const forced = s.forced ?? {}
  const fnames = Object.keys(forced)

  return (
    <div className="vars">
      <div className="toolbar">
        <input className="search" placeholder="Filtrar por nome, comentário ou equação…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Só ativos (=1)</label>
        <span className="muted">Tempo simulado: {ts.simTime(s.time)}</span>
      </div>

      <section className="card force-card">
        <h3>Forçar variável lógica {fnames.length > 0 && <span className="tag">{fnames.length} forçada(s)</span>}</h3>
        <p className="hint">Mantém o valor da variável (SV, SVT, LT, SCnn/SCnnQ, MV, OUT…) fixo, ignorando a lógica, até ser liberada. Também há botões "Forçar" nas tabelas abaixo.</p>
        <ForceAny sid={sid} forced={forced} />
      </section>

      {s.unresolved.length > 0 && (
        <div className="alert">
          A lógica referencia {s.unresolved.length} bit(s) que o simulador não conhece (valem 0): {s.unresolved.join(', ')}
        </div>
      )}

      {!is2440 && <div className="summary-cards">
        <div className="mini"><span>Grupo ativo</span><b>{s.group}{s.pending_group ? ` → ${s.pending_group}` : ''}</b></div>
        <div className="mini"><span>TRIP</span><Pill on={tc.TRIP as number} /></div>
        <div className="mini"><span>CLOSE</span><Pill on={tc.CLOSE as number} /></div>
        <div className="mini"><span>52A</span><Pill on={tc['52A'] as number} onLabel="FECHADO" offLabel="ABERTO" /></div>
        <div className="mini"><span>Religamento</span><b>{rc.enabled ? REC_LABEL[rc.state] : 'desabilitado'}</b></div>
        <div className="mini"><span>Tentativa</span><b>{rc.shot} / {rc.max_shots}</b></div>
      </div>}

      {!is2440 && (
        <>
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
              <tr><th>Elemento</th><th>Função</th><th>Ajuste</th><th>Medido</th><th>× pickup</th><th>Tempo previsto</th><th>Controle de torque</th><th>Sentido</th><th>Partida</th><th>Atuação</th><th>Reset</th><th>Avanço</th></tr>
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
                    <td className="mono">{e.measured && e.pickup ? fmt(e.measured / e.pickup, 2) : '–'}</td>
                    <td className="mono">{e.t_op != null ? `${fmt(e.t_op, 2)} s` : '–'}</td>
                    <td className="mono">{e.tc || '1'}</td>
                    <td>{e.dir_bit ? <Pill on={!!e.dir_ok} onLabel="LIBERA" offLabel="BLOQUEIA" title={e.dir_bit} /> : '–'}</td>
                    <td><Pill on={e.pk} title={e.pickup_bit} /></td>
                    <td><Pill on={e.timed} title={e.timed_bit} /></td>
                    <td>{e.reset_bit ? <Pill on={!!e.reset} title={e.reset_bit} /> : '–'}</td>
                    <td><Bar pct={e.progress} tone={e.timed ? 'red' : 'blue'} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Section>

      <DiffSection elements={s.protection.elements} />

      <DirectionalSection d={s.directional} />

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

        </>
      )}

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
          <thead><tr><th>Saída</th><th>Estado</th><th>Forçar</th><th>Equação</th><th>Descrição</th></tr></thead>
          <tbody>
            {outputs.map((o) => (
              <tr key={o.name} className={o.value ? 'hl' : ''}>
                <td className="mono">{o.name}</td>
                <td><Pill on={o.value} /></td>
                <td><ForceCtl sid={sid} name={o.name} forced={forced} /></td>
                <td className="mono wrap">{o.expr}</td>
                <td>{o.comment}{o.role ? <span className="tag">{`bobina de ${o.role}`}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Latches (LT)" count={latches.length}>
        <table className="tbl">
          <thead><tr><th>Latch</th><th>Estado</th><th>Forçar</th><th>Função</th><th>SET</th><th></th><th>RESET</th><th></th></tr></thead>
          <tbody>
            {latches.map((l) => (
              <tr key={l.name} className={l.value ? 'hl' : ''}>
                <td className="mono">{l.name}</td>
                <td><Pill on={l.value} /></td>
                <td><ForceCtl sid={sid} name={l.name} forced={forced} /></td>
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
          <thead><tr><th>Var.</th><th>Entrada</th><th>Forçar entrada</th><th>Saída (T)</th><th>Forçar saída (T)</th><th>PU / DO</th><th>Contagem</th><th>Equação</th><th>Descrição</th></tr></thead>
          <tbody>
            {timers.map((t) => (
              <tr key={t.name} className={t.out ? 'hl' : ''}>
                <td className="mono">{t.name}</td>
                <td><Pill on={t.input} /></td>
                <td><ForceCtl sid={sid} name={t.name} forced={forced} /></td>
                <td><Pill on={t.out} /></td>
                <td><ForceCtl sid={sid} name={`${t.name}T`} forced={forced} /></td>
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
          <thead><tr><th>Nome</th><th>Valor</th><th>Forçar</th><th>Equação</th><th>Descrição</th></tr></thead>
          <tbody>
            {s.counters.map((c) => (
              <tr key={c.name}>
                <td className="mono">{c.name}</td>
                <td className="mono">{c.value} / {c.preset} <Pill on={c.q} onLabel="Q" offLabel="Q" /></td>
                <td><ForceCtl sid={sid} name={c.name} forced={forced} numeric /> <ForceCtl sid={sid} name={`${c.name}Q`} forced={forced} /> <small className="muted">Q</small></td>
                <td className="mono wrap">CU: {c.cu}</td>
                <td>{c.comment}</td>
              </tr>
            ))}
            {s.math.map((m) => (
              <tr key={m.name}>
                <td className="mono">{m.name}</td>
                <td className="mono">{fmt(m.value, 3)}</td>
                <td><ForceCtl sid={sid} name={m.name} forced={forced} numeric /></td>
                <td className="mono wrap">{m.expr}</td>
                <td>{m.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {!is2440 && <Section title="Grandezas analógicas" count={analog.length} open={false}>
        <div className="chips">
          {analog.map(([n, v]) => (
            <span key={n} className="chip"><b>{n}</b> {fmt(v, 3)}</span>
          ))}
        </div>
      </Section>}

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

const DIR_NAME: Record<string, string> = { F: 'Frente', R: 'Reverso', N: 'Não direcional' }
const KIND_LABEL: [string, string][] = [['P', 'Fase'], ['Q', 'Seq. negativa'], ['N', 'Neutro'], ['G', 'Residual']]
const SEL_LABEL: Record<string, string> = {
  Q: 'Q – seq. negativa', V: 'V – seq. zero (tensão)', I: 'I – canal IN (corrente)', S: 'S – seq. zero, baixa impedância',
  P: 'P – wattmétrico (Petersen)', U: 'U – isolado/alta impedância',
}
const BIT_GROUPS: [string, string[]][] = [
  ['Habilitações', ['DIRQE', 'DIRQGE', 'DIRVE', 'DIRNE', '50QF', '50QR', '50GF', '50GR', '50NF', '50NR', '50PDIR', 'ZLOAD', 'DIRSTAB', 'LOP']],
  ['Elementos', ['FDIRQ', 'RDIRQ', 'FDIRP', 'RDIRP', 'FDIRQG', 'RDIRQG', 'FDIRV', 'RDIRV', 'FDIRN', 'RDIRN', 'PHIFWD1', 'PHIREV1', 'PHIFWD2', 'PHIREV2']],
  ['Sentido (roteamento)', ['DIRPF', 'DIRPR', 'DIRQF', 'DIRQR', 'DIRNF', 'DIRNR', 'DIRGF', 'DIRGR']],
]
const SHOWN_SETTINGS = ['50QFP', '50QRP', 'Z2F', 'Z2R', 'a2', 'k2', '50GFP', '50GRP', 'Z0F', 'Z0R', 'a0', 'Z0MTA']

function DirectionalSection({ d }: { d: DirectionalInfo }) {
  const q = d.quantities ?? {}
  const n = (k: string, digits = 3) => (q[k] == null ? '–' : fmt(q[k] as number, digits))
  return (
    <Section title="Elementos direcionais (controle direcional)" open={!!d.enabled} right={<span className="muted">{d.enabled ? `EDIR = ${d.edir}` : 'EDIR = N'}</span>}>
      {!d.enabled ? (
        <Empty>Controle direcional desabilitado (EDIR = N): todos os níveis são não direcionais. Habilite na aba “Ajustes” (grupo ativo): EDIR = Y, AUTO ou AUTO2, com DIR1…DIR4 e ORDER.</Empty>
      ) : (
        <>
          <div className="summary-cards">
            <div className="mini"><span>Elemento de terra</span><b>{d.selected && d.selected !== '–' ? SEL_LABEL[d.selected] ?? d.selected : 'nenhum habilitado'}</b></div>
            <div className="mini"><span>ORDER</span><b className="mono">{d.order}</b></div>
            <div className="mini"><span>Níveis (DIR1…DIR4)</span><b className="mono">{(d.dir ?? []).join(' · ')}</b></div>
            <div className="mini"><span>VNOM = OFF / EFWDLOP</span><b>{d.vnom_off ? 'sim' : 'não'} / {d.efwdlop ? 'Y' : 'N'}</b></div>
          </div>
          <table className="tbl">
            <thead><tr><th>Controle por nível</th><th>Nível 1</th><th>Nível 2</th><th>Nível 3</th><th>Nível 4</th></tr></thead>
            <tbody>
              {KIND_LABEL.map(([k, label]) => (
                <tr key={k}>
                  <td>{label} ({k}nDIR)</td>
                  {(d.levels?.[k] ?? []).map((on, i) => (
                    <td key={i}><Pill on={on} onLabel="LIBERA" offLabel="BLOQUEIA" title={`${k}${i + 1}DIR — DIR${i + 1} = ${DIR_NAME[(d.dir ?? [])[i]] ?? ''}`} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {BIT_GROUPS.map(([title, names]) => (
            <div key={title}>
              <h4>{title}</h4>
              <div className="chips">
                {names.map((b) => <span key={b} className={`chip ${d.bits?.[b] ? 'on' : ''}`} title={b}>{b}</span>)}
              </div>
            </div>
          ))}
          <h4>Grandezas (secundárias)</h4>
          <table className="tbl">
            <tbody>
              <tr><td>|I1| / |I2| / 3I0 / 3I2</td><td className="mono">{n('I1')} · {n('I2')} · {n('3I0')} · {n('3I2')} A</td></tr>
              <tr><td>|V1| / |V2| / 3V0</td><td className="mono">{n('V1', 2)} · {n('V2', 2)} · {n('3V0', 2)} V</td></tr>
              <tr><td>IN (canal de neutro)</td><td className="mono">{n('IN', 4)} A</td></tr>
              <tr><td>Z2 (seq. negativa)</td><td className="mono">{n('Z2')} Ω</td></tr>
              <tr><td>Z0 (seq. zero)</td><td className="mono">{n('Z0')} Ω</td></tr>
              <tr><td>P0 = Re(3V0·IN*) (wattmétrico)</td><td className="mono">{n('W0')} W</td></tr>
            </tbody>
          </table>
          <p className="hint">
            Ajustes efetivos (inclui os calculados por EDIR = AUTO/AUTO2):{' '}
            <span className="mono">{Object.entries(d.settings ?? {}).filter(([k]) => SHOWN_SETTINGS.includes(k)).map(([k, v]) => `${k}=${v}`).join('  ')}</span>
          </p>
        </>
      )}
    </Section>
  )
}

function ForceAny({ sid, forced }: { sid: string; forced: Record<string, number> }) {
  const [name, setName] = useState('')
  const [val, setVal] = useState('1')
  const [err, setErr] = useState<string | null>(null)
  const apply = () => api.force(sid, name, Number(val)).then(() => setErr(null)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  const names = Object.keys(forced)
  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="Nome (ex.: LT04, SV03T, SC01Q, OUT101)" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} />
        <select value={val} onChange={(e) => setVal(e.target.value)}><option value="1">1 (ligado)</option><option value="0">0 (desligado)</option></select>
        <input className="numinput force-num" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Valor" />
        <button className="primary" disabled={!name || Number.isNaN(Number(val))} onClick={apply}>Forçar</button>
        {names.length > 0 && <button onClick={() => api.clearForces(sid)}>Liberar todas</button>}
      </div>
      {err && <p className="err-text">{err}</p>}
      {names.length > 0 && (
        <div className="chips">
          {names.map((n) => <button key={n} className="chip on force-chip" onClick={() => api.force(sid, n, null)} title="Clique para liberar">{n} = {forced[n]} ✕</button>)}
        </div>
      )}
    </>
  )
}


/** SEL-787: detalhe do diferencial (87) por fase e do REF1. */
export function DiffSection({ elements }: { elements: StateElement[] }) {
  const d = elements.find((e) => e.diff)
  const r = elements.find((e) => e.ref)
  if (!d?.diff && !r?.ref) return null
  const df = d?.diff
  return (
    <Section title="Diferencial (87) e REF" count={(d ? 1 : 0) + (r ? 1 : 0)}>
      {df && d && (
        <>
          <p className="hint">{d.setting}</p>
          <table className="tbl">
            <thead>
              <tr><th>Fase</th><th>IOP (pu TAP)</th><th>IRT (pu TAP)</th><th>Limiar f(IRT)</th><th>2ª / 4ª / 5ª harm. (pu)</th><th>INR</th><th>87R</th><th>87HR</th><th>87BL</th><th>87U</th></tr>
            </thead>
            <tbody>
              {df.phases.map((p) => (
                <tr key={p.phase} className={p.u || p.r ? 'hl-red' : p.hr ? 'hl' : ''}>
                  <td><b>{p.phase}</b></td>
                  <td className="mono">{fmt(p.iop, 3)}</td>
                  <td className="mono">{fmt(p.irt, 3)}</td>
                  <td className="mono">{fmt(p.threshold, 3)}</td>
                  <td className="mono">{fmt(p.h2, 3)} / {fmt(p.h4, 3)} / {fmt(p.h5, 3)}</td>
                  <td><Pill on={p.inr} title="Alta segurança (energização)" /></td>
                  <td><Pill on={p.r} /></td>
                  <td><Pill on={p.hr} /></td>
                  <td><Pill on={p.bl} /></td>
                  <td><Pill on={p.u} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Alarme de corrente diferencial 87AP <Pill on={df.alarm} /> · 87AT <Pill on={df.alarm_t} /> · Alarme de 5ª harmônica TH5P <Pill on={df.th5} /> · TH5T <Pill on={df.th5_t} /></p>
        </>
      )}
      {r?.ref && (
        <table className="tbl">
          <thead><tr><th>REF1</th><th>|IN1| (pu)</th><th>|IG pol.| (pu)</th><th>Torque REFTQ1</th><th>Habilitado</th><th>Bypass</th><th>REF1F</th><th>REF1R</th><th>REF1P</th></tr></thead>
          <tbody>
            <tr className={r.timed ? 'hl-red' : r.pk ? 'hl' : ''}>
              <td className="mono">{r.setting}</td>
              <td className="mono">{fmt(r.ref.in, 3)}</td>
              <td className="mono">{fmt(r.ref.ig, 3)}</td>
              <td className="mono">{fmt(r.ref.torque, 4)}</td>
              <td><Pill on={r.ref.enable} /></td>
              <td><Pill on={r.ref.bypass} /></td>
              <td><Pill on={r.ref.fwd} /></td>
              <td><Pill on={r.ref.rev} /></td>
              <td><Pill on={r.timed} /></td>
            </tr>
          </tbody>
        </table>
      )}
    </Section>
  )
}
