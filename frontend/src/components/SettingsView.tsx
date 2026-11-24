import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { SessionInfo, SettingsData } from '../types'
import { Empty } from './ui'

const ORDER = ['G', '1', '2', '3', '4', 'L1', 'L2', 'L3', 'L4', 'F', 'R', 'D1', 'D2', 'D3']
const NOT_SIMULATED = (cls: string) => cls === 'M' || cls === 'I' || /^E\d/.test(cls) || /^P/.test(cls)
const LIMIT = 400
const GROUPED = new Set(['1', '2', '3', '4', 'L', 'L1', 'L2', 'L3', 'L4', 'D1', 'D2', 'D3'])

type Item = SettingsData['items'][number]
interface Grp { title: string; parent?: string; test: (key: string) => boolean; first?: RegExp }

/** Agrupamento dos mapas DNP3 (classes D1 a D3): BO, BI, AI, AO e CO. */
function buildDnpGroups(): Grp[] {
  const re = (r: RegExp) => (k: string) => r.test(k)
  return [
    { title: 'Binary Inputs', test: re(/^BI_\d+$/) },
    { title: 'Binary Outputs', test: re(/^BO_\d+$/) },
    { title: 'Analog Inputs', test: re(/^AI_\d+$/) },
    { title: 'Analog Outputs', test: re(/^AO_\d+$/) },
    { title: 'Counters', test: re(/^CO_\d+$/) },
  ]
}

/** Agrupamento das equações SELogic (classes L1 a L4 e L), como na árvore do QuickSet. Os Slots são as saídas digitais (OUTsxx: s = 1 → A, 3 → C, 4 → D, 5 → E). */
function buildLogicGroups(): Grp[] {
  const re = (r: RegExp) => (k: string) => r.test(k)
  return [
    { title: 'SELogic Enables', test: re(/^E[A-Z]+$/) },
    { title: 'SELogic Latch Bits', test: re(/^(SET|RST)\d+$/) },
    { title: 'SELogic Variables and Timers', test: re(/^SV\d+(PU|DO)?$/) },
    { title: 'SELogic Counters', test: re(/^SC\d+(PV|R|LD|CU|CD)$/) },
    { title: 'Math Variables', test: re(/^MV\d+$/) },
    { title: 'Slot A', test: re(/^OUT1\d\d(FS)?$/) },
    { title: 'Slot C', test: re(/^OUT3\d\d(FS)?$/) },
    { title: 'Slot D', test: re(/^OUT4\d\d(FS)?$/) },
    { title: 'Slot E', test: re(/^OUT5\d\d(FS)?$/) },
    { title: 'Mirrored Bits Transmit SELogic Equations', test: re(/^TMB\d[AB]$/) },
  ]
}

/** Agrupamento dos ajustes de grupo (classes 1 a 4), na ordem e com os nomes da árvore de ajustes do AcSELerator QuickSet. */
function buildGroups(items: Item[]): Grp[] {
  const idx = new Map(items.map((it, i) => [it.key, i]))
  const between = (a: string, b: string) => (k: string) => {
    const ia = idx.get(a), ib = idx.get(b), ik = idx.get(k)
    return ia != null && ib != null && ik != null && ik >= ia && ik <= ib
  }
  const re = (r: RegExp) => (k: string) => r.test(k)
  const OC = 'Overcurrent Elements'
  const TOC = 'Time Overcurrent Elements'
  const UOV = 'Under/Over Voltage Elements'
  const FRQ = 'Frequency Elements'
  return [
    { title: 'Main', test: between('RID', 'VNOM') },
    { title: 'Line Parameter', test: between('Z1MAG', 'LL') },
    { title: 'Fault Locator', test: (k) => k === 'EFLOC' },
    { title: 'Maximum Phase Overcurrent', parent: OC, test: re(/^50P\d/) },
    { title: 'Neutral Overcurrent', parent: OC, test: re(/^50N\d/) },
    { title: 'Residual Overcurrent', parent: OC, test: re(/^50G\d/) },
    { title: 'Negative Sequence Overcurrent', parent: OC, test: re(/^50Q\d/) },
    { title: 'Incipient Fault Overcurrent', parent: OC, test: re(/^(E50INC|50I(ALC|TRC|NTC|NCRST))$/) },
    { title: 'Phase TOC', parent: TOC, test: re(/^51[ABC](P|C|TD|RS|CT|MR|TC)$/) },
    { title: 'Maximum Phase TOC', parent: TOC, test: re(/^51P\d/) },
    { title: 'Negative Sequence TOC', parent: TOC, test: re(/^51Q/) },
    { title: 'Neutral TOC', parent: TOC, test: re(/^51N\d/) },
    { title: 'Residual TOC', parent: TOC, test: re(/^51G\d/) },
    { title: 'Directional Elements', test: between('EDIR', 'DIRWD') },
    { title: 'Harmonic Blocking', test: re(/^E?HBL\d/) },
    { title: 'Load Encroachment', test: between('ELOAD', 'NLAR') },
    { title: 'High Impedance Fault Detection', test: between('EHIF', 'HIFITUNE') },
    { title: 'Phase Discontinuity Detection', test: between('EPDDET', 'PDUBTHR') },
    { title: 'Broken Conductor Detection', test: between('EBCDET', 'BCUBTHR') },
    { title: 'Cold Load Pickup', test: between('ECLPU', 'CLRST') },
    { title: 'RTD', test: between('E49RTD', 'EBRGV') },
    { title: 'Thermal Element', test: between('E49IEC', 'RSTTH3') },
    { title: 'Undervoltage Elements', parent: UOV, test: re(/^27(P|PP|S|N)\d(P|D)$/) },
    { title: 'Inverse Time Undervoltage', parent: UOV, test: re(/^(E27I\d|27I\d.*)$/) },
    { title: 'Overvoltage Elements', parent: UOV, test: re(/^59(P|PP|G|Q|S|N)\d(P|D)$/) },
    { title: 'Inverse Time Overvoltage', parent: UOV, test: re(/^(E59I\d|59I\d.*)$/) },
    { title: 'Synchronism Check', test: (k) => between('E25', 'BSYNCH')(k) || /^(27|59)(LP|BP)$/.test(k) },
    { title: 'Loss of Potential (LOP)', test: (k) => k === 'LOPBLK' },
    { title: 'Power Factor', test: re(/^55/) },
    { title: 'Vector Shift Elements', test: re(/^(E78VS|78VS.*)$/) },
    { title: 'Frequency Set', parent: FRQ, test: re(/^(81D\d|81R?[VI]?SUP)/), first: /^81R?[VI]?SUP$/ },
    { title: 'Rate-of-Change of Frequency', parent: FRQ, test: between('E81R', '81R4TC') },
    { title: 'Fast Rate-of-Change of Frequency', parent: FRQ, test: between('E81RF', '81RFBLDO') },
    { title: '97 Frequency Component Magnitude Settings', parent: FRQ, test: re(/^E?97/) },
    { title: 'Demand Meter', test: between('EDEM', '3I2DEMP') },
    { title: 'Power Elements', test: between('EPWR', 'PWR2D') },
    { title: 'Trip and Close Logic', test: (k) => k === '52B' || between('TDURD', 'ULCL')(k) },
    { title: 'Reclosing Control', test: between('E79', '79CLS') },
  ]
}

function SettingRow({ sid, cls, item, onSaved }: { sid: string; cls: string; item: SettingsData['items'][number]; onSaved: () => void }) {
  const [text, setText] = useState(item.value)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setText(item.value), [item.value])
  const save = async () => {
    if (text === item.value) return
    try {
      await api.patchSetting(sid, cls, item.key, text)
      setErr(null)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setText(item.value)
    }
  }
  return (
    <tr className={item.modified ? 'hl' : ''}>
      <td className="mono">{item.key}</td>
      <td>
        <input
          className="setting-input mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setText(item.value)
          }}
        />
        {err && <div className="err-text">{err}</div>}
      </td>
      <td>{item.modified && <span className="tag">alterado</span>}</td>
    </tr>
  )
}

function SettingsTable({ sid, cls, items, onSaved }: { sid: string; cls: string; items: Item[]; onSaved: () => void }) {
  return (
    <table className="tbl">
      <thead><tr><th style={{ width: 150 }}>Ajuste</th><th>Valor / equação</th><th style={{ width: 80 }} /></tr></thead>
      <tbody>
        {items.map((it) => <SettingRow key={cls + it.key} sid={sid} cls={cls} item={it} onSaved={onSaved} />)}
      </tbody>
    </table>
  )
}

/** Ajustes do grupo (1 a 4) agrupados como na árvore do QuickSet; pastas "pai" (ex.: Overcurrent Elements) agrupam subgrupos. */
function GroupedSettings({ sid, cls, all, items, filtering, onSaved }: { sid: string; cls: string; all: Item[]; items: Item[]; filtering: boolean; onSaved: () => void }) {
  const groups = useMemo(() => (/^L/.test(cls) ? buildLogicGroups() : /^D\d/.test(cls) ? buildDnpGroups() : buildGroups(all)), [all, cls])
  const buckets = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const it of items) {
      const g = groups.find((x) => x.test(it.key))
      const t = g ? g.title : 'Outros ajustes'
      if (!m.has(t)) m.set(t, [])
      if (g?.first?.test(it.key)) m.get(t)!.unshift(it)
      else m.get(t)!.push(it)
    }
    return m
  }, [groups, items])
  const section = (title: string, nested: boolean) => {
    const list = buckets.get(title)
    if (!list || list.length === 0) return null
    return (
      <details key={title + (filtering ? '-f' : '')} className={`set-group ${nested ? 'nested' : ''}`} open={filtering || title === 'Main'}>
        <summary><b>{title}</b> <span className="muted">({list.length})</span></summary>
        <SettingsTable sid={sid} cls={cls} items={list} onSaved={onSaved} />
      </details>
    )
  }
  const done = new Set<string>()
  const blocks: React.ReactNode[] = []
  for (const g of groups) {
    if (g.parent) {
      if (done.has(g.parent)) continue
      done.add(g.parent)
      const kids = groups.filter((x) => x.parent === g.parent)
      const total = kids.reduce((a, k) => a + (buckets.get(k.title)?.length ?? 0), 0)
      if (total === 0) continue
      blocks.push(
        <details key={g.parent + (filtering ? '-f' : '')} className="set-group parent" open={filtering}>
          <summary><b>{g.parent}</b> <span className="muted">({total})</span></summary>
          {kids.map((k) => section(k.title, true))}
        </details>,
      )
    } else {
      blocks.push(section(g.title, false))
    }
  }
  blocks.push(section('Outros ajustes', false))
  return <div className="set-groups">{blocks}</div>
}

export function SettingsView({ sid, info, activeGroup }: { sid: string; info: SessionInfo; activeGroup: number }) {
  const classes = useMemo(
    () =>
      [...info.classes].sort((a, b) => {
        const ia = ORDER.indexOf(a.cls), ib = ORDER.indexOf(b.cls)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.cls.localeCompare(b.cls)
      }),
    [info.classes],
  )
  const [cls, setCls] = useState('1')
  const [q, setQ] = useState('')
  const [data, setData] = useState<SettingsData | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.settings(sid, cls).then((d) => { setData(d); setError(null) }).catch((e) => setError(String(e.message ?? e)))
  }, [sid, cls])
  useEffect(() => { setData(null); load() }, [load])
  useEffect(() => {
    if (showRaw) api.settingsRaw(sid, cls).then(setRaw).catch(() => setRaw(null))
  }, [showRaw, sid, cls])

  const filtered = (data?.items ?? []).filter((i) => !q || i.key.toLowerCase().includes(q.toLowerCase()) || i.value.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="settings">
      <aside className="classes">
        {classes.map((c) => (
          <button key={c.cls} className={cls === c.cls ? 'active' : ''} onClick={() => setCls(c.cls)}>
            <b>{c.cls}</b>
            <span>{c.name}</span>
            <small>{c.count}{String(activeGroup) === c.cls || `L${activeGroup}` === c.cls ? ' · ativo' : ''}{NOT_SIMULATED(c.cls) ? ' · não simulado' : ''}</small>
          </button>
        ))}
      </aside>
      <div className="settings-main">
        <div className="toolbar">
          <input className="search" placeholder="Filtrar por nome ou valor…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> Texto original do arquivo</label>
          <span className="muted">{filtered.length} de {data?.items.length ?? 0} ajustes</span>
        </div>
        <div className="notice">
          Edite um valor e pressione Enter: o relé simulado recompila as equações imediatamente. Use <code>OFF</code> para desabilitar um pickup.
          As alterações valem só para esta sessão (o .rdb original não é modificado).
        </div>
        {error && <div className="alert">{error}</div>}
        {showRaw ? (
          <pre className="raw">{raw ?? 'Carregando…'}</pre>
        ) : !data ? (
          <Empty>Carregando ajustes…</Empty>
        ) : (
          GROUPED.has(cls) ? (
            <GroupedSettings sid={sid} cls={cls} all={data.items} items={filtered} filtering={!!q} onSaved={load} />
          ) : (
            <>
              <SettingsTable sid={sid} cls={cls} items={filtered.slice(0, LIMIT)} onSaved={load} />
              {filtered.length > LIMIT && <div className="muted pad">Mostrando {LIMIT} primeiros. Refine o filtro para ver os demais.</div>}
            </>
          )
        )}
      </div>
    </div>
  )
}
