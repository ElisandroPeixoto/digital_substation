import { Fragment, useRef, useState } from 'react'
import { api } from '../api'
import type { RelaySummary, UploadSummary } from '../types'
import { Empty } from './ui'

interface Props {
  upload: UploadSummary | null
  busy: boolean
  error: string | null
  onFile: (file: File) => void
  onLoad: (relay: RelaySummary) => void
  canReturn: boolean
  onReturn: () => void
}

export function UploadScreen({ upload, busy, error, onFile, onLoad, canReturn, onReturn }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null)

  const pick = (files: FileList | null) => {
    const f = files?.[0]
    if (f) onFile(f)
  }
  const showFile = async (relay: RelaySummary, path: string) => {
    if (!upload) return
    try {
      const text = await api.relayFile(upload.upload_id, relay.id, path)
      setPreview({ title: `${relay.name} / ${path}`, text })
    } catch (e) {
      setPreview({ title: path, text: String(e instanceof Error ? e.message : e) })
    }
  }

  const relays = (upload?.relays ?? []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="upload-screen">
      <div
        className={`dropzone ${drag ? 'drag' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files) }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}
      >
        <input ref={input} type="file" accept=".rdb" hidden onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
        <div className="drop-title">{busy ? 'Processando…' : 'Arraste o arquivo .rdb aqui ou clique para selecionar'}</div>
        <div className="muted">O sistema decompõe o .rdb e lista os ajustes (relés) que ele contém.</div>
        {canReturn && <button className="link" onClick={(e) => { e.stopPropagation(); onReturn() }}>← Voltar ao simulador em execução</button>}
      </div>
      {error && <div className="alert">{error}</div>}

      {upload && (
        <section className="card relays">
          <div className="row">
            <h3>{upload.filename}</h3>
            <span className="muted">{upload.relays.length} ajustes encontrados</span>
            <span className="spacer" />
            <input className="search" placeholder="Filtrar ajustes…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {relays.length === 0 ? <Empty>Nenhum ajuste corresponde ao filtro.</Empty> : (
            <table className="tbl">
              <thead><tr><th>Ajuste</th><th>Pasta no .rdb</th><th>Firmware (FID)</th><th>Arquivos de texto</th><th /></tr></thead>
              <tbody>
                {relays.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td><b>{r.name}</b></td>
                      <td className="mono muted">{r.id}</td>
                      <td className="mono">{r.fid || '–'}</td>
                      <td>
                        <button className="link" onClick={() => setOpen(open === r.id ? null : r.id)}>
                          {r.file_count} arquivos {open === r.id ? '▲' : '▼'}
                        </button>
                      </td>
                      <td className="actions">
                        <a className="btn" href={api.zipUrl(upload.upload_id, r.id)} download>Baixar .zip</a>
                        <button className="primary" disabled={busy} onClick={() => onLoad(r)}>Carregar no simulador</button>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={5} className="files">
                          {r.files.map((f) => (
                            <button key={f} className="file-chip" onClick={() => showFile(r, f)}>{f}</button>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

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
