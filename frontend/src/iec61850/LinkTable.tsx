import { useMemo, useState } from 'react'
import type { IecProject } from '../types'

/** Uma linha = um dado do dataset de um bloco GOOSE, para um assinante (ou sem assinante). */
interface Row {
  pub: string; sub: string; cb: string; dataset: string; goId: string; confRev: string; mac: string; appid: string
  vlan: string; prio: string; minMs: string; maxMs: string; idx: string; fcda: string; pubBit: string; desc: string
  vb: string; statusVb: string; source: string; check: string; modified: string
}

interface Col { key: keyof Row; label: string; on: boolean; mono?: boolean }

const COLS: Col[] = [
  { key: 'pub', label: 'Publicador', on: true },
  { key: 'sub', label: 'Assinante', on: true },
  { key: 'cb', label: 'GOOSE Control Block', on: true, mono: true },
  { key: 'dataset', label: 'Dataset', on: true, mono: true },
  { key: 'idx', label: '#', on: true },
  { key: 'fcda', label: 'Dado publicado (FCDA)', on: true, mono: true },
  { key: 'pubBit', label: 'Bit no publicador', on: true, mono: true },
  { key: 'vb', label: 'Virtual Bit', on: true, mono: true },
  { key: 'statusVb', label: 'VB de status', on: true, mono: true },
  { key: 'check', label: 'Conferência', on: true },
  { key: 'goId', label: 'GoID', on: false, mono: true },
  { key: 'confRev', label: 'confRev', on: false },
  { key: 'mac', label: 'MAC', on: false, mono: true },
  { key: 'appid', label: 'APPID', on: false, mono: true },
  { key: 'vlan', label: 'VLAN-ID', on: false },
  { key: 'prio', label: 'Prioridade VLAN', on: false },
  { key: 'minMs', label: 'MinTime (ms)', on: false },
  { key: 'maxMs', label: 'MaxTime (ms)', on: false },
  { key: 'desc', label: 'Descrição do bit', on: false },
  { key: 'source', label: 'Origem da assinatura', on: false },
  { key: 'modified', label: 'Alterado na simulação', on: false },
]
const STORE = 'iec.linktable'

function buildRows(project: IecProject): Row[] {
  const rows: Row[] = []
  for (const ied of project.ieds) {
    for (const g of ied.gcbs) {
      const subs = project.ieds.flatMap((i) => i.subs.filter((s) => s.pub_ied === ied.name && s.cb_name === g.name).map((s) => ({ i, s })))
      const base = {
        pub: ied.name, cb: g.name, dataset: g.dataset, goId: g.go_id, confRev: String(g.conf_rev), mac: g.mac, appid: g.appid,
        vlan: g.vlan_id, prio: g.vlan_prio, minMs: String(g.min_ms), maxMs: String(g.max_ms),
      }
      const f = (k: number) => g.entries[k]
      const fc = (k: number) => (f(k) ? `${f(k).ld_inst}/${f(k).prefix}${f(k).ln_class}${f(k).ln_inst}.${f(k).do_name}.${f(k).da_name}` : '')
      const mod = g.modified.length ? g.modified.join(', ') : ''
      if (subs.length === 0) {
        g.entries.forEach((_, k) => rows.push({ ...base, sub: '', idx: String(k + 1), fcda: fc(k), pubBit: f(k).bit, desc: f(k).desc, vb: '', statusVb: '', source: '', check: '—', modified: mod }))
        continue
      }
      for (const { i, s } of subs) {
        const check = !s.enabled ? 'desabilitada' : s.issues.length === 0 ? 'compatível' : s.issues.filter((x) => x.level === 'error').map((x) => x.text).join('; ') || 'aviso'
        const m2 = [...g.modified, ...s.modified.map((x) => `assinatura:${x}`)].join(', ')
        g.entries.forEach((_, k) => {
          const e = s.entries.find((x) => x.index === k + 1)
          const row = { ...base, sub: i.name, idx: String(k + 1), fcda: fc(k), pubBit: f(k).bit, desc: f(k).desc, vb: e?.vb ?? '', statusVb: s.status_vb,
            source: s.source === 'SEL_GooseSubscription' ? 'SEL (privado)' : s.source, check, modified: m2 }
          if (e?.vb_hi) {                                   // Dbpos (Pos.stVal): um ponto por linha – Lo (52A = 0) e Hi (52A = 1)
            rows.push({ ...row, fcda: `${row.fcda} - Lo`, desc: `${row.desc} – Lo: 52A em 0 (aberto)` })
            rows.push({ ...row, fcda: `${row.fcda} - Hi`, desc: `${row.desc} – Hi: 52A em 1 (fechado)`, vb: e.vb_hi })
          } else rows.push(row)
        })
      }
    }
  }
  return rows
}

const ALL = COLS.map((c) => c.key as string)

/** Colunas visíveis e ordem (ordem = todas as colunas, na sequência escolhida pelo usuário). */
function load(): { cols: string[]; order: string[] } {
  try {
    const j = JSON.parse(localStorage.getItem(STORE) ?? 'null')
    if (j && Array.isArray(j.cols)) {
      const order: string[] = Array.isArray(j.order) ? j.order.filter((k: string) => ALL.includes(k)) : []
      return { cols: j.cols.filter((k: string) => ALL.includes(k)), order: [...order, ...ALL.filter((k) => !order.includes(k))] }
    }
  } catch { /* sem armazenamento */ }
  return { cols: COLS.filter((c) => c.on).map((c) => c.key), order: ALL }
}

/** Tabela única de publicadores × assinantes (substitui as abas Publicadores, Assinantes e Bits virtuais). */
export function LinkTable({ project }: { project: IecProject }) {
  const [visible, setVisible] = useState<string[]>(() => load().cols)
  const [order, setOrder] = useState<string[]>(() => load().order)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<{ key: keyof Row; dir: 1 | -1 } | null>(null)
  const [menu, setMenu] = useState(false)
  const [onlyBad, setOnlyBad] = useState(false)

  const rows = useMemo(() => buildRows(project), [project])
  const byKey = new Map(COLS.map((c) => [c.key as string, c]))
  const cols = order.filter((k) => visible.includes(k)).map((k) => byKey.get(k)!)

  const persist = (c: string[], o: string[]) => {
    setVisible(c)
    setOrder(o)
    try { localStorage.setItem(STORE, JSON.stringify({ cols: c, order: o })) } catch { /* ignora */ }
  }
  const toggle = (k: string) => persist(visible.includes(k) ? visible.filter((x) => x !== k) : [...visible, k], order)
  /** Move a coluna `k` para a posição da coluna `target` (arrastar) ou uma posição acima/abaixo na lista (delta). */
  const moveTo = (k: string, target: string) => {
    if (k === target) return
    const o = order.filter((x) => x !== k)
    const at = o.indexOf(target)
    o.splice(order.indexOf(k) < order.indexOf(target) ? at + 1 : at, 0, k)
    persist(visible, o)
  }
  const nudge = (k: string, d: -1 | 1) => {
    const i = order.indexOf(k)
    const j = i + d
    if (j < 0 || j >= order.length) return
    const o = [...order]
    ;[o[i], o[j]] = [o[j], o[i]]
    persist(visible, o)
  }

  const shown = useMemo(() => {
    const ql = q.toLowerCase()
    let r = rows.filter((row) =>
      (!ql || Object.values(row).some((v) => v.toLowerCase().includes(ql))) &&
      Object.entries(filters).every(([k, v]) => !v || (row[k as keyof Row] ?? '').toLowerCase().includes(v.toLowerCase())) &&
      (!onlyBad || (row.check !== 'compatível' && row.check !== '—')))
    if (sort) r = [...r].sort((a, b) => a[sort.key].localeCompare(b[sort.key], 'pt', { numeric: true }) * sort.dir)
    return r
  }, [rows, q, filters, sort, onlyBad])

  const clickSort = (key: keyof Row) =>
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))

  return (
    <div className="link-table">
      <div className="toolbar">
        <input className="search" placeholder="Buscar em todas as colunas…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /> Só com problema</label>
        <span className="muted">{shown.length} de {rows.length} linhas</span>
        <span className="spacer" />
        {(q || Object.values(filters).some(Boolean) || sort) && <button onClick={() => { setQ(''); setFilters({}); setSort(null) }}>Limpar filtros e ordem</button>}
        <div className="col-menu">
          <button onClick={() => setMenu((m) => !m)} aria-expanded={menu}>Colunas ▾</button>
          {menu && (
            <div className="col-menu-box card">
              <small className="muted">Marque para exibir; use ▲▼ para mudar a ordem (ou arraste os títulos da tabela).</small>
              {order.map((k) => {
                const c = byKey.get(k)!
                return (
                  <div key={k} className="col-row">
                    <label className="check"><input type="checkbox" checked={visible.includes(k)} onChange={() => toggle(k)} /> {c.label}</label>
                    <span>
                      <button className="link" onClick={() => nudge(k, -1)} aria-label={`Subir ${c.label}`}>▲</button>
                      <button className="link" onClick={() => nudge(k, 1)} aria-label={`Descer ${c.label}`}>▼</button>
                    </span>
                  </div>
                )
              })}
              <button className="link" onClick={() => persist(COLS.filter((c) => c.on).map((c) => c.key), ALL)}>restaurar padrão</button>
            </div>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} draggable className={dragKey && dragKey !== c.key ? 'drop-ok' : ''}
                  onDragStart={() => setDragKey(c.key)} onDragEnd={() => setDragKey(null)}
                  onDragOver={(e) => { if (dragKey) e.preventDefault() }}
                  onDrop={() => { if (dragKey) moveTo(dragKey, c.key); setDragKey(null) }}
                  title="Arraste para mudar a posição da coluna">
                  <button className="link sort-btn" onClick={() => clickSort(c.key)} title="Ordenar por esta coluna">
                    {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
            <tr className="filter-row">
              {cols.map((c) => (
                <th key={c.key}>
                  <input className="numinput" value={filters[c.key] ?? ''} placeholder="filtrar" aria-label={`Filtro de ${c.label}`}
                    onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const v = r[c.key]
                  const bad = c.key === 'check' && v !== 'compatível' && v !== '—'
                  return <td key={c.key} className={`${c.mono ? 'mono' : ''} ${bad ? 'err-text' : ''}`}>{c.key === 'vb' && v ? <span className="chip on">{v}</span> : v || <span className="muted">—</span>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="muted">Nenhuma linha corresponde aos filtros.</p>}
      </div>
    </div>
  )
}
