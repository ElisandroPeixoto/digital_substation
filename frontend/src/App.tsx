import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { usePoll } from './hooks'
import type { RelaySummary, SessionInfo, UploadSummary } from './types'
import { DnpView } from './components/DnpView'
import { EventsView } from './components/EventsView'
import { InjectionWindow } from './components/InjectionWindow'
import { PhaseEngineApp } from './phaseengine/PhaseEngineApp'
import { SystemLabApp } from './systemlab/SystemLabApp'
import { IEC61850App } from './iec61850/IEC61850App'
import { MBitConfigApp } from './mbitconfig/MBitConfigApp'
import { OvercurrentApp } from './overcurrent/OvercurrentApp'
import { PrefsProvider } from './prefs'
import { ConfigView } from './components/ConfigView'
import { Panel2440 } from './components/Panel2440'
import { GooseView } from './components/GooseView'
import { TextsView } from './components/TextsView'
import { useCustomTexts } from './customTexts'
import { RelayFront } from './components/RelayFront'
import { SettingsView } from './components/SettingsView'
import { TestBench } from './components/TestBench'
import { TopBar } from './components/TopBar'
import { AboutView, EclipseShell, HomeView, type Route } from './eclipse/EclipseShell'
import { UploadScreen } from './components/UploadScreen'
import { VariablesView } from './components/VariablesView'

type Tab = 'panel' | 'vars' | 'dnp' | 'settings' | 'ser' | 'texts' | 'goose'
const TABS: [Tab, string][] = [
  ['panel', 'Painel frontal'],
  ['vars', 'Variáveis internas'],
  ['dnp', 'DNP3'],
  ['settings', 'Ajustes'],
  ['ser', 'Eventos (SER)'],
  ['texts', 'Textos'],
  ['goose', 'IEC 61850'],
]
const STORAGE = 'sel751.sim'

/** Lê uma chave JSON do localStorage (null se ausente ou inválida). */
function readLocal(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}

/** Exporta o IED simulado: ajustes (com as edições), arquivos originais e estado vindos do backend, mais o que só existe no
 *  navegador — textos personalizados (entradas, saídas, VB/RB/CB) e títulos dos botões do frontal. */
async function exportRelay(sid: string, relayId: string, device: string) {
  try {
    const data = await api.exportSession(sid)
    const out = {
      ...data,
      exported_at: new Date().toISOString(),
      front_panel: {
        texts: readLocal(`sel751.texts.${relayId}`) ?? {},           // textos ajustados (aba Textos / frontal)
        pb_titles: readLocal(`sel751.pbtitles.${relayId}`),          // textos centrais dos botões PB1–PB8 (null = padrão)
      },
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(device || relayId).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'ied'}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  } catch (e) {
    window.alert('Falha ao exportar: ' + (e instanceof Error ? e.message : String(e)))
  }
}

function loadSaved(): { sid?: string; uid?: string; uids?: string[]; sids?: string[] } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
  } catch {
    return {}
  }
}
function save(v: { sid?: string; uid?: string; uids?: string[]; sids?: string[] }) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(v))
  } catch {
    /* armazenamento indisponível */
  }
}

function DigitalRelayApp() {
  const [uploads, setUploads] = useState<UploadSummary[]>([])      // arquivos .rdb carregados
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [list, setList] = useState<SessionInfo[]>([])      // relés instanciados (várias sessões)
  const [adding, setAdding] = useState(false)               // próximo carregamento acrescenta um relé
  const [view, setView] = useState<'select' | 'sim'>('select')
  const [tab, setTab] = useState<Tab>('panel')
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Restaura a sessão anterior (o backend mantém a sessão em memória).
  useEffect(() => {
    const saved = loadSaved()
    const uids = [...new Set([...(saved.uids ?? []), ...(saved.uid ? [saved.uid] : [])])]
    Promise.all(uids.map((u) => api.getUpload(u).catch(() => null))).then((all) => setUploads(all.filter((x): x is UploadSummary => !!x)))
    const sids = [...new Set([...(saved.sids ?? []), ...(saved.sid ? [saved.sid] : [])])]
    Promise.all(sids.map((id) => api.getSession(id).catch(() => null))).then((all) => {
      const ok = all.filter((x): x is SessionInfo => !!x)
      setList(ok)
      const cur = ok.find((x) => x.id === saved.sid) ?? ok[0]
      if (cur) {
        setInfo(cur)
        setView('sim')
      } else save({ uid: saved.uid })
    })
  }, [])

  const { texts, setText, clearAll } = useCustomTexts(info?.relay_id)
  const { data: panel, error: panelError } = usePoll(() => api.panel(info!.id), 100, view === 'sim' && !!info, info?.id)

  useEffect(() => {
    if (panelError && /Sessão não encontrada/.test(panelError)) {
      const rest = list.filter((x) => x.id !== info?.id)
      setList(rest)
      if (rest.length) { setInfo(rest[0]); return }
      setInfo(null)
      setView('select')
      setError('A sessão do simulador foi encerrada (o backend foi reiniciado?). Carregue o ajuste novamente.')
    }
  }, [panelError]) // eslint-disable-line react-hooks/exhaustive-deps

  const uidsOf = (l: UploadSummary[]) => l.map((u) => u.upload_id)
  const onFiles = useCallback(async (files: File[]) => {
    setBusy(true)
    setError(null)
    try {
      let next = uploads
      for (const f of files) {
        const up = await api.upload(f)
        next = [...next.filter((u) => u.upload_id !== up.upload_id), up]
      }
      setUploads(next)
      save({ uid: next[next.length - 1]?.upload_id, uids: uidsOf(next), sid: info?.id, sids: list.map((x) => x.id) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [uploads, info, list])

  const onRemoveUpload = (uid: string) => {
    const next = uploads.filter((u) => u.upload_id !== uid)
    setUploads(next)
    save({ uid: next[next.length - 1]?.upload_id, uids: uidsOf(next), sid: info?.id, sids: list.map((x) => x.id) })
  }

  const onLoad = useCallback(
    async (upload: UploadSummary, relay: RelaySummary) => {
      setBusy(true)
      setError(null)
      try {
        const s = await api.createSession(upload.upload_id, relay.id)
        let next = list
        if (info && !adding) {
          api.deleteSession(info.id).catch(() => undefined)
          next = list.filter((x) => x.id !== info.id)
        }
        next = [...next, s]
        setList(next)
        setAdding(false)
        setInfo(s)
        setView('sim')
        setTab('panel')
        save({ sid: s.id, uid: upload.upload_id, uids: uidsOf(uploads), sids: next.map((x) => x.id) })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [uploads, info, list, adding],
  )

  /** Importa um IED exportado em JSON: o backend recria a sessão; os textos do frontal voltam para o localStorage do relé. */
  const onImport = useCallback(async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      let data: { front_panel?: { texts?: unknown; pb_titles?: unknown } }
      try { data = JSON.parse(await file.text()) } catch { throw new Error('O arquivo não é um JSON válido.') }
      const s = await api.importSession(data)
      const fp = data.front_panel
      try {
        if (fp?.texts && typeof fp.texts === 'object') localStorage.setItem(`sel751.texts.${s.relay_id}`, JSON.stringify(fp.texts))
        if (Array.isArray(fp?.pb_titles) && fp.pb_titles.length === 8) localStorage.setItem(`sel751.pbtitles.${s.relay_id}`, JSON.stringify(fp.pb_titles))
      } catch { /* armazenamento indisponível */ }
      const next = [...list, s]
      setList(next)
      setAdding(false)
      setInfo(s)
      setView('sim')
      setTab('panel')
      save({ sid: s.id, uid: uploads[uploads.length - 1]?.upload_id, uids: uidsOf(uploads), sids: next.map((x) => x.id) })
      if (s.warnings?.length) window.alert('IED importado com avisos:\n- ' + s.warnings.join('\n- '))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [list, uploads])

  const select = (s: SessionInfo) => { setInfo(s); setView('sim'); save({ sid: s.id, uid: uploads[uploads.length - 1]?.upload_id, uids: uidsOf(uploads), sids: list.map((x) => x.id) }) }
  const refreshInfo = () => { if (info) api.getSession(info.id).then((s) => { setInfo(s); setList((l) => l.map((x) => (x.id === s.id ? s : x))) }).catch(() => undefined) }
  const remove = (s: SessionInfo) => {
    api.iecBind(s.id, null).catch(() => undefined)
    api.deleteSession(s.id).catch(() => undefined)
    const rest = list.filter((x) => x.id !== s.id)
    setList(rest)
    save({ sid: rest[0]?.id, uid: uploads[uploads.length - 1]?.upload_id, uids: uidsOf(uploads), sids: rest.map((x) => x.id) })
    if (info?.id === s.id) { if (rest.length) setInfo(rest[0]); else { setInfo(null); setView('select') } }
  }

  const press = useCallback((n: number, pressed: boolean) => info && api.button(info.id, `PB${n}`, pressed), [info])
  const targetReset = useCallback(() => {
    if (info) {
      api.button(info.id, 'TARGET_RESET', true)
    }
  }, [info])

  return (
    <div className="app">
      <TopBar
        info={view === 'sim' ? info : null}
        data={panel}
        onPlayPause={() => info && api.control(info.id, { running: !(panel?.running ?? true) })}
        onSpeed={(s) => info && api.control(info.id, { speed: s })}
        onRestart={() => info && api.restart(info.id)}
        onChange={() => { setConfig(false); setAdding(false); setView('select') }}
        onConfig={() => setConfig((c) => !c)}
        onExport={() => { if (info) exportRelay(info.id, info.relay_id, info.device) }}
        configOpen={config}
      />
      {config ? (
        <ConfigView onClose={() => setConfig(false)} />
      ) : view === 'select' || !info ? (
        <UploadScreen
          uploads={uploads}
          busy={busy}
          error={error}
          onFiles={onFiles}
          onLoad={onLoad}
          onRemove={onRemoveUpload}
          canReturn={!!info}
          onReturn={() => setView('sim')}
          onImport={onImport}
        />
      ) : (
        <main>
          <div className="inst-bar">
            {list.map((s) => (
              <span key={s.id}>
                <button className={`chip-btn ${s.id === info.id ? 'active' : ''}`} onClick={() => select(s)} title={s.device}>
                  {(s.relay_id || s.device).slice(0, 34)}{s.ied ? ` · ${s.ied}` : ''}
                </button>
                <button className="link" onClick={() => remove(s)} title="Encerrar este relé" aria-label="Encerrar relé">×</button>
              </span>
            ))}
            <button className="chip-btn" onClick={() => { setAdding(true); setView('select') }} disabled={list.length >= 8} title="Instancia outro relé (até 8)">＋ Relé</button>
          </div>
          <nav className="tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>
          {tab === 'panel' && (info.model === '2440' ? <Panel2440 sid={info.id} data={panel} texts={texts} /> : (
            <div className="panel-tab">
              <RelayFront info={info} panel={panel} onPb={press} onTargetReset={targetReset} />
              <TestBench sid={info.id} info={info} data={panel} texts={texts} />
            </div>
          ))}
          {tab === 'vars' && <VariablesView sid={info.id} model={info.model} />}
          {tab === 'dnp' && <DnpView sid={info.id} />}
          {tab === 'settings' && <SettingsView sid={info.id} info={info} activeGroup={panel?.status.group ?? 1} />}
          {tab === 'ser' && <EventsView sid={info.id} />}
          {tab === 'goose' && <GooseView info={info} onChanged={refreshInfo} />}
          {tab === 'texts' && <TextsView sid={info.id} data={panel} texts={texts} setText={setText} clearAll={clearAll} />}
        </main>
      )}
    </div>
  )
}

function useHash(): string {
  const [h, setH] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setH(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return h
}

/** Roteamento por hash: #/ (Home), #/about, #/digitalrelay; #/injecao/<sessão> abre a janela de injeção (pop-up). */
export default function App() {
  const hash = useHash()
  const m = hash.match(/^#\/injecao\/([A-Za-z0-9]+)/)
  if (m) return <InjectionWindow sid={m[1]} />
  const route: Route = hash.startsWith('#/digitalrelay') ? 'digitalrelay' : hash.startsWith('#/phaseengine') ? 'phaseengine' : hash.startsWith('#/systemlab') ? 'systemlab' : hash.startsWith('#/overcurrent') ? 'overcurrent' : hash.startsWith('#/iec61850') ? 'iec61850' : hash.startsWith('#/mbitconfig') ? 'mbitconfig' : hash.startsWith('#/about') ? 'about' : 'home'
  return (
    <EclipseShell route={route}>
      {route === 'home' && <HomeView />}
      {route === 'about' && <AboutView />}
      {route === 'phaseengine' && <PhaseEngineApp />}
      {route === 'systemlab' && <PrefsProvider><SystemLabApp /></PrefsProvider>}
      {route === 'overcurrent' && <OvercurrentApp />}
      {route === 'iec61850' && <IEC61850App />}
      {route === 'mbitconfig' && <MBitConfigApp />}
      {route === 'digitalrelay' && <PrefsProvider><DigitalRelayApp /></PrefsProvider>}
    </EclipseShell>
  )
}
