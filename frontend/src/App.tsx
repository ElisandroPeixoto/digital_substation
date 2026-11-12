import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { usePoll } from './hooks'
import type { RelaySummary, SessionInfo, UploadSummary } from './types'
import { DnpView } from './components/DnpView'
import { EventsView } from './components/EventsView'
import { InjectionWindow } from './components/InjectionWindow'
import { RelayFront } from './components/RelayFront'
import { SettingsView } from './components/SettingsView'
import { TestBench } from './components/TestBench'
import { TopBar } from './components/TopBar'
import { UploadScreen } from './components/UploadScreen'
import { VariablesView } from './components/VariablesView'

type Tab = 'panel' | 'vars' | 'dnp' | 'settings' | 'ser'
const TABS: [Tab, string][] = [
  ['panel', 'Painel frontal'],
  ['vars', 'Variáveis internas'],
  ['dnp', 'DNP3'],
  ['settings', 'Ajustes'],
  ['ser', 'Eventos (SER)'],
]
const STORAGE = 'sel751.sim'

function loadSaved(): { sid?: string; uid?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? '{}')
  } catch {
    return {}
  }
}
function save(v: { sid?: string; uid?: string }) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(v))
  } catch {
    /* armazenamento indisponível */
  }
}

function MainApp() {
  const [upload, setUpload] = useState<UploadSummary | null>(null)
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [view, setView] = useState<'select' | 'sim'>('select')
  const [tab, setTab] = useState<Tab>('panel')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Restaura a sessão anterior (o backend mantém a sessão em memória).
  useEffect(() => {
    const saved = loadSaved()
    if (saved.uid) api.getUpload(saved.uid).then(setUpload).catch(() => undefined)
    if (saved.sid) {
      api
        .getSession(saved.sid)
        .then((s) => {
          setInfo(s)
          setView('sim')
        })
        .catch(() => save({ uid: saved.uid }))
    }
  }, [])

  const { data: panel, error: panelError } = usePoll(() => api.panel(info!.id), 100, view === 'sim' && !!info, info?.id)

  useEffect(() => {
    if (panelError && /Sessão não encontrada/.test(panelError)) {
      setInfo(null)
      setView('select')
      setError('A sessão do simulador foi encerrada (o backend foi reiniciado?). Carregue o ajuste novamente.')
    }
  }, [panelError])

  const onFile = useCallback(async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const up = await api.upload(file)
      setUpload(up)
      save({ uid: up.upload_id, sid: info?.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [info])

  const onLoad = useCallback(
    async (relay: RelaySummary) => {
      if (!upload) return
      setBusy(true)
      setError(null)
      try {
        const s = await api.createSession(upload.upload_id, relay.id)
        if (info) api.deleteSession(info.id).catch(() => undefined)
        setInfo(s)
        setView('sim')
        setTab('panel')
        save({ sid: s.id, uid: upload.upload_id })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [upload, info],
  )

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
        onChange={() => setView('select')}
      />
      {view === 'select' || !info ? (
        <UploadScreen
          upload={upload}
          busy={busy}
          error={error}
          onFile={onFile}
          onLoad={onLoad}
          canReturn={!!info}
          onReturn={() => setView('sim')}
        />
      ) : (
        <main>
          <nav className="tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>
          {tab === 'panel' && (
            <div className="panel-tab">
              <RelayFront info={info} panel={panel} onPb={press} onTargetReset={targetReset} />
              <TestBench sid={info.id} info={info} data={panel} />
            </div>
          )}
          {tab === 'vars' && <VariablesView sid={info.id} />}
          {tab === 'dnp' && <DnpView sid={info.id} />}
          {tab === 'settings' && <SettingsView sid={info.id} info={info} activeGroup={panel?.status.group ?? 1} />}
          {tab === 'ser' && <EventsView sid={info.id} />}
        </main>
      )}
    </div>
  )
}

/** Rota mínima por hash: #/injecao/<sessão> abre a janela de injeção (pop-up). */
export default function App() {
  const m = window.location.hash.match(/^#\/injecao\/([A-Za-z0-9]+)/)
  return m ? <InjectionWindow sid={m[1]} /> : <MainApp />
}
