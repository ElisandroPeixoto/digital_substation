import { useState } from 'react'
import { api } from '../api'
import type { IecProject } from '../types'

type Setter = (p: IecProject) => void

/** Campo de texto que grava ao sair (blur/Enter); realça quando o valor difere do arquivo. */
function Field({ value, changed, onSave, width = 90, mono = true }: { value: string | number; changed: boolean; onSave: (v: string) => void; width?: number; mono?: boolean }) {
  return (
    <input
      key={String(value)} defaultValue={String(value)} className={`numinput ${mono ? 'mono' : ''} ${changed ? 'mod' : ''}`} style={{ width }}
      onBlur={(e) => { if (e.target.value !== String(value)) onSave(e.target.value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
    />
  )
}

/** Edição dos parâmetros dos blocos GOOSE e das assinaturas, só na simulação (não altera o arquivo nem o relé). */
const HIDE_KEY = 'iec.params.hidden'

function loadHidden(): string[] {
  try {
    const j = JSON.parse(localStorage.getItem(HIDE_KEY) ?? '[]')
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

/** Edição dos parâmetros dos blocos GOOSE e das assinaturas, só na simulação (não altera o arquivo nem o relé). */
export function GooseParams({ project, setProject, vlanAware, onVlan }: { project: IecProject; setProject: Setter; vlanAware: boolean; onVlan: (v: boolean) => void }) {
  const [err, setErr] = useState<string | null>(null)
  const [hidden, setHidden] = useState<string[]>(loadHidden)
  const run = async (f: () => Promise<IecProject>) => {
    try { setErr(null); setProject(await f()) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  const setHide = (next: string[]) => {
    setHidden(next)
    try { localStorage.setItem(HIDE_KEY, JSON.stringify(next)) } catch { /* ignora */ }
  }
  const toggleHide = (name: string) => setHide(hidden.includes(name) ? hidden.filter((x) => x !== name) : [...hidden, name])
  const anyMod = project.ieds.some((i) => i.gcbs.some((g) => g.modified.length) || i.subs.some((s) => s.modified.length))
  const shown = project.ieds.filter((i) => !hidden.includes(i.name))
  const pubIeds = shown.filter((i) => i.gcbs.length > 0)
  const subIeds = shown.filter((i) => i.subs.length > 0)

  return (
    <>
      <section className="card">
        <h3>Parâmetros GOOSE para teste</h3>
        <p className="hint">
          Altere MAC, APPID, VLAN, confRev, tempos, GoID, bit de status e os bits virtuais recebidos para ver como a comunicação se comporta, antes de mudar o projeto no software do relé.
          Vale só na simulação; os campos alterados ficam destacados. Pressione Enter ou saia do campo para aplicar.
        </p>
        {err && <p className="err-text">{err}</p>}
        <label className="check" title="Desmarcado: VLAN-ID e prioridade VLAN deixam de ser comparados entre publicador e assinante">
          <input type="checkbox" checked={vlanAware} onChange={(e) => onVlan(e.target.checked)} /> <b>VLAN Aware</b>
          <span className="muted"> – desmarque para a simulação desconsiderar os parâmetros de VLAN na comunicação entre os relés</span>
        </label>
        <div className="chips param-ieds">
          <span className="muted">Relés exibidos:</span>
          {project.ieds.map((i) => {
            const off = hidden.includes(i.name)
            return (
              <button key={i.name} className={`chip chip-toggle ${off ? '' : 'on'}`} onClick={() => toggleHide(i.name)} aria-pressed={!off}
                title={off ? 'Oculto: clique para exibir' : 'Exibido: clique para ocultar'}>
                {off ? '🚫' : '👁'} {i.name}
              </button>
            )
          })}
          {hidden.length > 0 && <button className="link" onClick={() => setHide([])}>exibir todos</button>}
        </div>
        <button disabled={!anyMod} onClick={() => run(() => api.iecReset())}>Restaurar tudo ao valor do arquivo</button>
      </section>

      <section className="card">
        <h3>Publicação <span className="muted">(GOOSE Control Blocks)</span></h3>
        {pubIeds.length === 0 ? <p className="muted">Nenhum relé exibido publica GOOSE.</p> : (
          <div className="table-scroll">
            <table className="tbl">
              <thead><tr><th>IED</th><th>Ativo</th><th>Bloco</th><th>GoID</th><th>confRev</th><th>MAC</th><th>APPID</th><th>VLAN</th><th>Prior.</th><th>Min (ms)</th><th>Max (ms)</th><th /></tr></thead>
              <tbody>
                {pubIeds.flatMap((ied) => ied.gcbs.map((g, gi) => {
                  const set = (fields: Record<string, unknown>) => run(() => api.iecEditGcb(ied.name, g.name, fields))
                  const m = (k: string) => g.modified.includes(k)
                  return (
                    <tr key={`${ied.name}/${g.name}`}>
                      <td><b>{gi === 0 ? ied.name : ''}</b></td>
                      <td><input type="checkbox" checked={g.enabled} onChange={(e) => set({ enabled: e.target.checked })} title="Habilita/desabilita a publicação" /></td>
                      <td className="mono">{g.name}</td>
                      <td><Field value={g.go_id} changed={m('go_id')} width={110} onSave={(v) => set({ go_id: v })} /></td>
                      <td><Field value={g.conf_rev} changed={m('conf_rev')} width={60} onSave={(v) => set({ conf_rev: v })} /></td>
                      <td><Field value={g.mac} changed={m('mac')} width={150} onSave={(v) => set({ mac: v })} /></td>
                      <td><Field value={g.appid} changed={m('appid')} width={60} onSave={(v) => set({ appid: v })} /></td>
                      <td><Field value={g.vlan_id} changed={m('vlan_id')} width={55} onSave={(v) => set({ vlan_id: v })} /></td>
                      <td><Field value={g.vlan_prio} changed={m('vlan_prio')} width={45} onSave={(v) => set({ vlan_prio: v })} /></td>
                      <td><Field value={g.min_ms} changed={m('min_ms')} width={65} onSave={(v) => set({ min_ms: v })} /></td>
                      <td><Field value={g.max_ms} changed={m('max_ms')} width={65} onSave={(v) => set({ max_ms: v })} /></td>
                      <td>{gi === 0 && <button className="link" onClick={() => run(() => api.iecReset(ied.name))} title="Restaura os parâmetros deste IED">restaurar</button>}</td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Assinatura <span className="muted">(GOOSE assinado)</span></h3>
        {subIeds.length === 0 ? <p className="muted">Nenhum relé exibido assina GOOSE.</p> : (
          <div className="table-scroll">
            <table className="tbl">
              <thead><tr><th>Assinante</th><th>Ativo</th><th>De</th><th>Bloco</th><th>GoID</th><th>confRev</th><th>MAC</th><th>APPID</th><th>VLAN</th><th>VB status</th><th>VBs recebidos (dado → VB)</th><th>Conferência</th></tr></thead>
              <tbody>
                {subIeds.flatMap((ied) => ied.subs.map((s, si) => {
                  const set = (fields: Record<string, unknown>) => run(() => api.iecEditSub(ied.name, s.pub_ied, s.cb_name, fields))
                  const m = (k: string) => s.modified.includes(k)
                  return (
                    <tr key={`${ied.name}/${s.pub_ied}/${s.cb_name}`}>
                      <td><b>{si === 0 ? ied.name : ''}</b></td>
                      <td><input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} title="Habilita/desabilita a assinatura" /></td>
                      <td>{s.pub_ied}</td>
                      <td className="mono">{s.cb_name}</td>
                      <td><Field value={s.go_id} changed={m('go_id')} width={110} onSave={(v) => set({ go_id: v })} /></td>
                      <td><Field value={s.conf_rev} changed={m('conf_rev')} width={60} onSave={(v) => set({ conf_rev: v })} /></td>
                      <td><Field value={s.mac} changed={m('mac')} width={150} onSave={(v) => set({ mac: v })} /></td>
                      <td><Field value={s.appid} changed={m('appid')} width={60} onSave={(v) => set({ appid: v })} /></td>
                      <td><Field value={s.vlan_id} changed={m('vlan_id')} width={55} onSave={(v) => set({ vlan_id: v })} /></td>
                      <td><Field value={s.status_vb} changed={m('status_vb')} width={70} onSave={(v) => set({ status_vb: v })} /></td>
                      <td>
                        <div className="vb-edit">
                          {s.entries.map((e) => (
                            <label key={e.index} title={e.fcda?.desc ?? ''}>
                              <small className="muted">{e.fcda?.bit || `#${e.index}`}→</small>
                              <Field value={e.vb} changed={m('vbs')} width={64} onSave={(v) => run(() => api.iecEditSub(ied.name, s.pub_ied, s.cb_name, {}, { [e.index]: v }))} />
                            </label>
                          ))}
                        </div>
                      </td>
                      <td>
                        {s.issues.length === 0 ? <span className="pill on">compatível</span> : (
                          <ul className="iec-issues">{s.issues.map((i, k) => <li key={k} className={i.level === 'error' ? 'err-text' : 'muted'}>{i.text}</li>)}</ul>
                        )}
                      </td>
                    </tr>
                  )
                }))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
