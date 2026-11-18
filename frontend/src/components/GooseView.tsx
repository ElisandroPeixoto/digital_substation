import { useState } from 'react'
import { api } from '../api'
import { usePoll } from '../hooks'
import type { SessionInfo } from '../types'

/** Aba "IEC 61850": associa o relé simulado a um IED do módulo IEC61850 e mostra a troca de mensagens GOOSE dele. */
export function GooseView({ info, onChanged }: { info: SessionInfo; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const { data: project } = usePoll(() => api.iecProject(), 1500, true, 'goose-project')
  const { data: status } = usePoll(() => api.iecStatus(), 500, true, 'goose-status')
  const ieds = project?.ieds ?? []
  const mine = status?.ieds.find((s) => s.sid === info.id)
  const iedDef = ieds.find((i) => i.name === mine?.name)

  const bind = async (name: string) => {
    try { setErr(null); await api.iecBind(info.id, name || null); onChanged() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  const bitOf = (cb: string, k: number) => iedDef?.gcbs.find((g) => g.name === cb)?.entries[k]?.bit ?? ''
  const vbOf = (pub: string, cb: string, k: number) => iedDef?.subs.find((s) => s.pub_ied === pub && s.cb_name === cb)?.entries[k]?.vb ?? ''

  return (
    <div className="goose">
      <section className="card">
        <h3>Associação com o módulo IEC61850</h3>
        {ieds.length === 0 ? (
          <p className="hint">Nenhum IED carregado. Abra o app <a href="#/iec61850">IEC61850</a> e envie o arquivo .scd/.cid.</p>
        ) : (
          <p>
            IED simulado por este relé:{' '}
            <select value={mine?.name ?? ''} onChange={(e) => bind(e.target.value)}>
              <option value="">— nenhum —</option>
              {ieds.map((i) => <option key={i.name} value={i.name}>{i.name}{status?.bindings && Object.values(status.bindings).includes(i.name) && mine?.name !== i.name ? ' (em uso)' : ''}</option>)}
            </select>
          </p>
        )}
        {err && <p className="err-text">{err}</p>}
        {mine && (
          <>
            <p>
              Comunicação GOOSE: <span className={`pill ${mine.comm_ok ? 'on' : 'off'}`}>{mine.comm_ok ? 'ativa' : 'inativa'}</span>{' '}
              {!mine.comm_ok && <small className="muted">{mine.reason}</small>}
            </p>
            <p className="hint">
              Ajustes da porta 1 (RDB): E61850 = <b>{mine.rdb_e61850 ? 'Y' : 'N'}</b>, EGSE = <b>{mine.rdb_egse ? 'Y' : 'N'}</b>. Se estiverem em Y, o 61850 já nasce habilitado;
              altere em <i>Ajustes → P1</i>. Também interferem: HALARM, enlaces LINKA/LINKB, pausa da simulação, cabo e rede no app IEC61850.
            </p>
          </>
        )}
      </section>
      {mine && (
        <section className="card">
          <h3>Mensagens GOOSE de {mine.name}</h3>
          <table className="tbl">
            <thead><tr><th>Direção</th><th>Bloco</th><th>stNum/sqNum</th><th>Valores</th><th>Estado</th></tr></thead>
            <tbody>
              {mine.pubs.map((p) => (
                <tr key={`p${p.cb_name}`}><td>publica</td><td className="mono">{p.cb_name}</td><td>{p.st_num}/{p.sq_num}</td>
                  <td>{p.values.map((v, k) => <span key={k} className={`chip ${v ? 'on' : ''}`} title={bitOf(p.cb_name, k)}>{bitOf(p.cb_name, k) || k + 1}={v}</span>)}</td>
                  <td className="muted">{p.sent} enviadas</td></tr>
              ))}
              {mine.subs.map((r) => (
                <tr key={`s${r.pub_ied}${r.cb_name}`}><td>assina de {r.pub_ied}</td><td className="mono">{r.cb_name}</td><td>{r.st_num}/{r.sq_num}</td>
                  <td>{r.values.map((v, k) => vbOf(r.pub_ied, r.cb_name, k) ? <span key={k} className={`chip ${v ? 'on' : ''}`}>{vbOf(r.pub_ied, r.cb_name, k)}={v}</span> : null)}
                    {r.status_vb && <span className="chip" title="status da assinatura">{r.status_vb}</span>}</td>
                  <td><span className={`pill ${r.valid ? 'on' : 'off'}`}>{r.valid ? 'válida' : 'inválida'}</span> <small className="muted">{r.valid ? `${r.rx_count} recebidas` : r.reason}</small></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
