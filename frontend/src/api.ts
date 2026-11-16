import type {
  DnpData,
  DnpResult,
  PanelData,
  SerEvent,
  SessionInfo,
  SettingsData,
  SimConfig,
  StateData,
  UploadSummary,
} from './types'

const BASE = '/api'

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const j = await res.json()
      detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* corpo sem JSON */
    }
    throw new Error(detail)
  }
  const ct = res.headers.get('content-type') ?? ''
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>
}

// Eventos de botão precisam chegar em ordem (pressionar -> soltar).
let buttonChain: Promise<unknown> = Promise.resolve()

export const api = {
  async upload(file: File): Promise<UploadSummary> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(BASE + '/uploads', { method: 'POST', body: form })
    if (!res.ok) {
      const j = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(j.detail ?? res.statusText)
    }
    return res.json()
  },
  getUpload: (uid: string) => req<UploadSummary>('GET', `/uploads/${uid}`),
  relayFile: (uid: string, rid: string, path: string) =>
    req<string>('GET', `/uploads/${uid}/relays/${encodeURIComponent(rid)}/files/${path.split('/').map(encodeURIComponent).join('/')}`),
  zipUrl: (uid: string, rid: string) => `${BASE}/uploads/${uid}/relays/${encodeURIComponent(rid)}/zip`,

  createSession: (upload_id: string, relay_id: string) => req<SessionInfo>('POST', '/sessions', { upload_id, relay_id }),
  getSession: (sid: string) => req<SessionInfo>('GET', `/sessions/${sid}`),
  deleteSession: (sid: string) => req<unknown>('DELETE', `/sessions/${sid}`),
  restart: (sid: string) => req<unknown>('POST', `/sessions/${sid}/restart`),
  control: (sid: string, body: { running?: boolean; speed?: number }) =>
    req<{ running: boolean; speed: number }>('POST', `/sessions/${sid}/control`, body),

  panel: (sid: string) => req<PanelData>('GET', `/sessions/${sid}/panel`),
  state: (sid: string) => req<StateData>('GET', `/sessions/${sid}/state`),
  ser: (sid: string, since: number) => req<{ events: SerEvent[]; last_seq: number }>('GET', `/sessions/${sid}/ser?since=${since}`),
  clearSer: (sid: string) => req<unknown>('DELETE', `/sessions/${sid}/ser`),

  button(sid: string, button: string, pressed: boolean) {
    buttonChain = buttonChain
      .then(() => req('POST', `/sessions/${sid}/button`, { button, pressed }))
      .catch(() => undefined)
    return buttonChain
  },
  forceBreaker: (sid: string, closed: boolean) => req('POST', `/sessions/${sid}/breaker`, { closed }),
  setInput: (sid: string, name: string, value: boolean) => req('POST', `/sessions/${sid}/inputs`, { name, value }),
  sim: (sid: string, patch: Partial<SimConfig>) => req<SimConfig>('POST', `/sessions/${sid}/sim`, { patch }),
  fault: (sid: string, type: string, current?: number, persistent?: boolean) =>
    req<SimConfig>('POST', `/sessions/${sid}/fault`, { type, current, persistent }),
  clearFault: (sid: string) => req<SimConfig>('DELETE', `/sessions/${sid}/fault`),
  preset: (sid: string, name: string) => req<SimConfig>('POST', `/sessions/${sid}/preset`, { name }),

  dnp: (sid: string, since: number) => req<DnpData>('GET', `/sessions/${sid}/dnp?since=${since}`),
  dnpCommand: (sid: string, index: number, code: string, mode: string) =>
    req<DnpResult>('POST', `/sessions/${sid}/dnp/command`, { index, code, mode }),
  clearDnpEvents: (sid: string) => req<unknown>('DELETE', `/sessions/${sid}/dnp/events`),
  dnpMap: (sid: string, map: number) => req<unknown>('POST', `/sessions/${sid}/dnp/map`, { map }),

  settings: (sid: string, cls: string) => req<SettingsData>('GET', `/sessions/${sid}/settings/${cls}`),
  settingsRaw: (sid: string, cls: string) => req<string>('GET', `/sessions/${sid}/settings/${cls}/raw`),
  patchSetting: (sid: string, cls: string, key: string, value: string) =>
    req<unknown>('PATCH', `/sessions/${sid}/settings`, { cls, key, value }),
}
