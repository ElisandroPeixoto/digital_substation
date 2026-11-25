import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { usePoll } from '../hooks'
import { GooseParams } from './GooseParams'
import { LinkTable } from './LinkTable'
import type { IecGcb, IecIed, IecProject, IecStatus, SessionBrief } from '../types'

type Tab = 'ieds' | 'gcb' | 'links' | 'params' | 'sim'
const TABS: [Tab, string][] = [
  ['ieds', 'IEDs'],
  ['gcb', 'Blocos de controle GOOSE'],
  ['links', 'Publicadores e assinantes'],
  ['params', 'Parâmetros de teste'],
  ['sim', 'Simulação'],
]

const fcdaText = (f: { ld_inst: string; prefix: string; ln_class: string; ln_inst: string; do_name: string; da_name: string }) =>
  `${f.ld_inst}/${f.prefix}${f.ln_class}${f.ln_inst}.${f.do_name}.${f.da_name}`

function GcbCard({ ied, g }: { ied: IecIed; g: IecGcb }) {
  return (
    <section className="card">
      <h3>{ied.name} · {g.name} <span className="muted">dataset {g.dataset} · confRev {g.conf_rev} · GoID {g.go_id || '—'}</span></h3>
      <p className="hint">
        MAC <b className="mono">{g.mac || '—'}</b> · APPID <b className="mono">{g.appid || '—'}</b> · VLAN {g.vlan_id || '—'} (prioridade {g.vlan_prio || '—'}) ·
        MinTime {g.min_ms} ms · MaxTime {g.max_ms} ms
      </p>
      <table className="tbl">
        <thead><tr><th>#</th><th>Dado (FCDA)</th><th>Bit do relé</th></tr></thead>
        <tbody>
          {g.entries.map((f, i) => (
            <tr key={i}><td>{i + 1}</td><td className="mono">{fcdaText(f)}</td><td>{f.bit ? <span className="chip">{f.bit}</span> : <span className="muted">—</span>} <small className="muted">{f.desc.split('–')[1] ?? ''}</small></td></tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Overview({ project, onRemove }: { project: IecProject; onRemove: (n: string) => void }) {
  return (
    <div className="iec-grid">
      {project.ieds.map((i) => (
        <section className="card" key={i.name}>
          <h3>{i.name} <span className="muted">{i.type}{i.model ? ` · ${i.model}` : ''}</span></h3>
          <p className="hint">{i.manufacturer || '—'} · {i.ip || 'sem IP'}{i.subnet_name ? ` · ${i.subnet_name}` : ''} · arquivo {i.source_file}</p>
          <div className="chips">
            <span className="chip">{i.gcbs.length} GCB</span>
            <span className="chip">{i.subs.length} assinatura(s)</span>
            {i.is_sel && i.vb_max > 0 && <span className="chip">VB 1–{i.vb_max}</span>}
          </div>
          <p><button className="link" onClick={() => onRemove(i.name)}>remover do projeto</button></p>
        </section>
      ))}
    </div>
  )
}

function Simulation({ project, status, sessions, reload }: { project: IecProject; status: IecStatus | null; sessions: SessionBrief[]; reload: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const run = async (f: () => Promise<unknown>) => {
    try { setErr(null); await f(); reload() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  const cut = new Set(status?.ieds.filter((s) => s.cut).map((s) => s.name))
  return (
    <>
      {err && <p className="err-text">{err}</p>}
      <section className="card">
        <h3>Instâncias: IED × relé do DigitalRelay</h3>
        <p className="hint">Cada IED do arquivo é associado a um relé simulado no DigitalRelay (abra o app, carregue os .rdb e use a aba "IEC 61850" para associar). Também é possível associar aqui.</p>
        <table className="tbl">
          <thead><tr><th>IED</th><th>Relé associado</th><th>Comunicação</th><th>E61850 / EGSE</th><th>Cabo</th></tr></thead>
          <tbody>
            {project.ieds.map((i) => {
              const st = status?.ieds.find((s) => s.name === i.name)
              const cur = sessions.find((s) => s.ied === i.name)
              return (
                <tr key={i.name}>
                  <td><b>{i.name}</b></td>
                  <td>
                    <select value={cur?.id ?? ''} onChange={(e) => {
                      const sid = e.target.value
                      run(async () => { if (cur) await api.iecBind(cur.id, null); if (sid) await api.iecBind(sid, i.name) })
                    }}>
                      <option value="">— nenhum —</option>
                      {sessions.map((s) => <option key={s.id} value={s.id}>{s.device || s.relay_id}{s.ied && s.ied !== i.name ? ` (em ${s.ied})` : ''}</option>)}
                    </select>
                  </td>
                  <td>{st ? <span className={`pill ${st.comm_ok ? 'on' : 'off'}`}>{st.comm_ok ? 'OK' : 'inativa'}</span> : null} <small className="muted">{st && !st.comm_ok ? st.reason : ''}</small></td>
                  <td>{st?.sid ? <>{st.rdb_e61850 ? 'Y' : 'N'} / {st.rdb_egse ? 'Y' : 'N'}</> : <span className="muted">—</span>}</td>
                  <td><label><input type="checkbox" checked={cut.has(i.name)} onChange={(e) => {
                    const n = new Set(cut); if (e.target.checked) n.add(i.name); else n.delete(i.name)
                    run(() => api.iecNetwork({ cut: [...n] }))
                  }} /> desconectado</label></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Rede</h3>
        <div className="iec-net">
          <label>Latência (ms) <input type="number" className="numinput" min={0} max={5000} defaultValue={status?.latency_ms ?? 2} key={`l${status?.latency_ms}`}
            onBlur={(e) => run(() => api.iecNetwork({ latency_ms: Number(e.target.value) }))} /></label>
          <label>Perda (%) <input type="number" className="numinput" min={0} max={100} defaultValue={status?.loss_pct ?? 0} key={`p${status?.loss_pct}`}
            onBlur={(e) => run(() => api.iecNetwork({ loss_pct: Number(e.target.value) }))} /></label>
          <label><input type="checkbox" checked={status?.status_on_loss ?? true} onChange={(e) => run(() => api.iecNetwork({ status_on_loss: e.target.checked }))} /> pubRxStatus = 1 quando a assinatura cai</label>
          <span className="muted">enviadas {status?.sent ?? 0} · perdidas {status?.lost ?? 0}</span>
        </div>
      </section>

      {status?.ieds.filter((s) => s.sid).map((s) => (
        <section className="card" key={s.name}>
          <h3>{s.name} <span className={`pill ${s.comm_ok ? 'on' : 'off'}`}>{s.comm_ok ? 'comunicando' : 'inativo'}</span></h3>
          <table className="tbl">
            <thead><tr><th>Direção</th><th>Bloco</th><th>stNum/sqNum</th><th>Valores</th><th>Estado</th></tr></thead>
            <tbody>
              {s.pubs.map((p) => (
                <tr key={`p${p.cb_name}`}><td>publica</td><td className="mono">{p.cb_name}</td><td>{p.st_num}/{p.sq_num}</td>
                  <td>{p.values.map((v, k) => <span key={k} className={`chip ${v ? 'on' : ''}`}>{v}</span>)}</td><td className="muted">{p.sent} enviadas</td></tr>
              ))}
              {s.subs.map((r) => (
                <tr key={`s${r.pub_ied}${r.cb_name}`}><td>assina de {r.pub_ied}</td><td className="mono">{r.cb_name}</td><td>{r.st_num}/{r.sq_num}</td>
                  <td>{r.values.map((v, k) => <span key={k} className={`chip ${v ? 'on' : ''}`}>{v}</span>)}</td>
                  <td><span className={`pill ${r.valid ? 'on' : 'off'}`}>{r.valid ? 'válida' : 'inválida'}</span> <small className="muted">{r.valid ? `${r.rx_count} recebidas` : r.reason}</small></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}

export function IEC61850App() {
  const [tab, setTab] = useState<Tab>('ieds')
  const [project, setProject] = useState<IecProject>({ files: [], ieds: [] })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: status } = usePoll(() => api.iecStatus(), 500, tab === 'sim' || tab === 'params', 'iec-status')
  const { data: sessions } = usePoll(() => api.sessions(), 1500, tab === 'sim', 'iec-sessions')

  const reload = useCallback(() => { api.iecProject().then(setProject).catch(() => undefined) }, [])
  useEffect(reload, [reload])

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    setBusy(true); setErr(null)
    try {
      let last = project
      for (const f of Array.from(files)) last = await api.iecUpload(f)
      setProject(last)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const empty = project.ieds.length === 0
  return (
    <div className="app iec">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">⚡</span><div><b>IEC61850</b><small>{empty ? 'Carregue arquivos .scd / .cid / .icd' : project.files.join(' · ')}</small></div></div>
      </header>
      <main>
        {/* mesmo padrão da tela de carga do DigitalRelay: barra com "Adicionar arquivo(s)" e, abaixo, o cartão "Nenhum arquivo carregado" */}
        <div className="upload-bar">
          <label className="btn primary">{busy ? 'Lendo…' : 'Adicionar arquivo(s)'}
            <input type="file" accept=".scd,.cid,.icd,.xml" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
          </label>
          {!empty && <button onClick={() => api.iecClear().then(reload)}>Limpar projeto</button>}
          <span className="muted">{empty ? 'Arquivos SCL (.scd / .cid / .icd)' : project.files.join(' · ')}</span>
        </div>
        {err && <div className="alert">{err}</div>}
        {empty ? (
          <section className="card"><h3>Nenhum arquivo carregado</h3>
            <p className="hint">Envie um ou vários arquivos SCL (.scd de subestação ou .cid de cada relé). O Eclipse mostra os blocos GOOSE, publicadores, assinantes e, em arquivos da SEL, os bits virtuais assinados, e permite simular a troca de mensagens entre relés instanciados no DigitalRelay.</p>
          </section>
        ) : (
          <>
            <nav className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
            {tab === 'ieds' && <Overview project={project} onRemove={(n) => api.iecRemove(n).then(reload)} />}
            {tab === 'gcb' && project.ieds.flatMap((i) => i.gcbs.map((g) => <GcbCard key={`${i.name}/${g.name}`} ied={i} g={g} />))}
            {tab === 'links' && <LinkTable project={project} />}
            {tab === 'params' && <GooseParams project={project} setProject={setProject} vlanAware={status?.vlan_aware ?? true} onVlan={(v) => api.iecNetwork({ vlan_aware: v }).then(reload)} />}
            {tab === 'sim' && <Simulation project={project} status={status} sessions={sessions ?? []} reload={reload} />}
          </>
        )}
      </main>
    </div>
  )
}
