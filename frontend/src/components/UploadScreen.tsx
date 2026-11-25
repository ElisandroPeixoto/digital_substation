import { Fragment, useState } from 'react'
import { api } from '../api'
import type { RelaySummary, UploadSummary } from '../types'
import { Empty } from './ui'

interface Props {
  uploads: UploadSummary[]
  busy: boolean
  error: string | null
  onFiles: (files: File[]) => void
  onLoad: (upload: UploadSummary, relay: RelaySummary) => void
  onRemove: (uploadId: string) => void
  canReturn: boolean
  onImport: (file: File) => void
  onReturn: () => void
}

/** Tela de carga de arquivos .rdb (mesmo padrão do app IEC61850: botão "Adicionar arquivo(s)" e um cartão por arquivo). */
export function UploadScreen({ uploads, busy, error, onFiles, onLoad, onRemove, canReturn, onReturn, onImport }: Props) {
  const [drag, setDrag] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null)

  const pick = (files: FileList | null) => {
    if (files && files.length) onFiles(Array.from(files))
  }
  const showFile = async (upload: UploadSummary, relay: RelaySummary, path: string) => {
    try {
      const text = await api.relayFile(upload.upload_id, relay.id, path)
      setPreview({ title: `${relay.name} / ${path}`, text })
    } catch (e) {
      setPreview({ title: path, text: String(e instanceof Error ? e.message : e) })
    }
  }
  const ql = q.toLowerCase()

  return (
    <div
      className={`upload-screen ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files) }}
    >
      <div className="upload-bar">
        <label className="btn primary">
          {busy ? 'Processando…' : 'Adicionar arquivo(s)'}
          <input type="file" accept=".rdb" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
        </label>
        <label className="btn" title="Recria um IED a partir de um JSON exportado pelo DigitalRelay (ajustes, edições, injeção e textos do frontal)">
          ⬆ Importar JSON
          <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImport(f) }} />
        </label>
        {canReturn && <button onClick={onReturn}>← Voltar ao simulador em execução</button>}
        {uploads.length > 0 && <input className="search" placeholder="Filtrar ajustes…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <span className="muted">{uploads.length > 0 ? uploads.map((u) => u.filename).join(' · ') : 'Arquivos .rdb do AcSELerator QuickSet'}</span>
      </div>
      {error && <div className="alert">{error}</div>}

      {uploads.length === 0 && (
        <section className="card">
          <h3>Nenhum arquivo carregado</h3>
          <p className="hint">Envie um ou vários arquivos .rdb (ou arraste-os para cá). O sistema decompõe cada .rdb e lista os ajustes (relés) que ele contém; carregue quantos relés quiser no simulador.</p>
        </section>
      )}

      {uploads.map((upload) => {
        const relays = upload.relays.filter((r) => !ql || r.name.toLowerCase().includes(ql))
        return (
          <section className="card relays" key={upload.upload_id}>
            <div className="row">
              <h3>{upload.filename}</h3>
              <span className="muted">{upload.relays.length} ajustes encontrados</span>
              <span className="spacer" />
              <button className="link" onClick={() => onRemove(upload.upload_id)}>remover da lista</button>
            </div>
            {relays.length === 0 ? <Empty>Nenhum ajuste corresponde ao filtro.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Ajuste</th><th>Pasta no .rdb</th><th>Firmware (FID)</th><th>Arquivos de texto</th><th /></tr></thead>
                <tbody>
                  {relays.map((r) => {
                    const key = `${upload.upload_id}/${r.id}`
                    return (
                      <Fragment key={key}>
                        <tr>
                          <td><b>{r.name}</b></td>
                          <td className="mono muted">{r.id}</td>
                          <td className="mono">{r.fid || '–'}</td>
                          <td>
                            <button className="link" onClick={() => setOpen(open === key ? null : key)}>
                              {r.file_count} arquivos {open === key ? '▲' : '▼'}
                            </button>
                          </td>
                          <td className="actions">
                            <a className="btn" href={api.zipUrl(upload.upload_id, r.id)} download>Baixar .zip</a>
                            <button className="primary" disabled={busy} onClick={() => onLoad(upload, r)}>Carregar no simulador</button>
                          </td>
                        </tr>
                        {open === key && (
                          <tr>
                            <td colSpan={5} className="files">
                              {r.files.map((f) => (
                                <button key={f} className="file-chip" onClick={() => showFile(upload, r, f)}>{f}</button>
                              ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        )
      })}

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3>{preview.title}</h3>
              <span className="spacer" />
              <button onClick={() => setPreview(null)}>Fechar</button>
            </div>
            <pre className="raw">{preview.text}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
