import type {
  DnpData,
  MbStatus,
  IecProject,
  IecStatus,
  SessionBrief,
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
  exportSession: (sid: string) => req<Record<string, unknown>>('GET', `/sessions/${sid}/export`),
  importSession: (data: unknown) => req<SessionInfo & { warnings?: string[] }>('POST', '/sessions/import', data),
  deleteSession: (sid: string) => req<unknown>('DELETE', `/sessions/${sid}`),
  renameSession: (sid: string, name: string) => req<{ device: string }>('PATCH', `/sessions/${sid}`, { name }),
  restart: (sid: string) => req<unknown>('POST', `/sessions/${sid}/restart`),
  control: (sid: string, body: { running?: boolean; speed?: number }) =>
    req<{ running: boolean; speed: number }>('POST', `/sessions/${sid}/control`, body),

  panel: (sid: string) => req<PanelData>('GET', `/sessions/${sid}/panel`),
  state: (sid: string) => req<StateData>('GET', `/sessions/${sid}/state`),
  ser: (sid: string, since: number) => req<{ events: SerEvent[]; last_seq: number; epoch?: number }>('GET', `/sessions/${sid}/ser?since=${since}`),
  clearSer: (sid: string) => req<unknown>('DELETE', `/sessions/${sid}/ser`),

  button(sid: string, button: string, pressed: boolean) {
    buttonChain = buttonChain
      .then(() => req('POST', `/sessions/${sid}/button`, { button, pressed }))
      .catch(() => undefined)
    return buttonChain
  },
  forceBreaker: (sid: string, closed: boolean) => req('POST', `/sessions/${sid}/breaker`, { closed }),
  bit: (sid: string, name: string, mode: 'set' | 'clear' | 'toggle' | 'pulse' | 'watch') => req('POST', `/sessions/${sid}/bits`, { name, mode }),
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
  revertSetting: (sid: string, cls: string, key: string) => req<{ value: string }>('DELETE', `/sessions/${sid}/settings/${encodeURIComponent(cls)}/${encodeURIComponent(key)}`),
  systemlab: (sid: string, patch: Record<string, number | boolean>) => req<{ isolated: boolean }>('POST', `/sessions/${sid}/systemlab`, { patch }),
  patchSetting: (sid: string, cls: string, key: string, value: string) =>
    req<unknown>('PATCH', `/sessions/${sid}/settings`, { cls, key, value }),

  force: (sid: string, name: string, value: number | null) => req<{ forced: Record<string, number> }>('POST', `/sessions/${sid}/force`, { name, value }),
  clearForces: (sid: string) => req<unknown>('DELETE', `/sessions/${sid}/force`),

  // Mirrored Bits
  mbStatus: () => req<MbStatus>('GET', '/mbits'),
  mbAddLink: (a: { sid: string; port: number }, b: { sid: string; port: number }) => req<{ id: string }>('POST', '/mbits/links', { a, b }),
  mbPatchLink: (id: string, body: { cut?: boolean; loss_pct?: number }) => req<unknown>('PATCH', `/mbits/links/${id}`, body),
  mbDeleteLink: (id: string) => req<unknown>('DELETE', `/mbits/links/${id}`),
  mbClear: () => req<unknown>('POST', '/mbits/clear'),

  sessions: () => req<SessionBrief[]>('GET', '/sessions'),

  // SCADA: planilha de mapa (.xlsx/.csv) cruzada com o mapa DNP3 ativo do relé
  async scadaMap(sid: string, file: File): Promise<{
    relay_id: string; device: string; map: number; filename: string
    accepted: { line: number; tipo: 'BI' | 'AI' | 'BO'; index: number; wordbit: string; desc?: string; v0?: string; v1?: string; note?: string }[]
    rejected: { line: number; tipo: string; wordbit: string; reason: string }[]
  }> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(BASE + `/scada/map/${sid}`, { method: 'POST', body: form })
    if (!res.ok) {
      const j = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(j.detail ?? res.statusText)
    }
    return res.json()
  },

  // IEC 61850
  async iecUpload(file: File): Promise<IecProject> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(BASE + '/iec61850/files', { method: 'POST', body: form })
    if (!res.ok) {
      const j = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(j.detail ?? res.statusText)
    }
    return res.json()
  },
  iecProject: () => req<IecProject>('GET', '/iec61850'),
  iecStatus: () => req<IecStatus>('GET', '/iec61850/status'),
  iecClear: () => req<unknown>('DELETE', '/iec61850'),
  iecRemove: (name: string) => req<unknown>('DELETE', `/iec61850/ieds/${encodeURIComponent(name)}`),
  iecEditGcb: (ied: string, cb: string, fields: Record<string, unknown>) => req<IecProject>('POST', '/iec61850/gcb', { ied, cb, fields }),
  iecEditSub: (ied: string, pub: string, cb: string, fields: Record<string, unknown>, vbs?: Record<string, string>) =>
    req<IecProject>('POST', '/iec61850/sub', { ied, pub, cb, fields, vbs }),
  iecReset: (ied?: string) => req<IecProject>('POST', '/iec61850/reset', { ied: ied ?? null }),
  iecBind: (sid: string, ied: string | null) => req<unknown>('POST', '/iec61850/bind', { sid, ied }),
  iecNetwork: (body: { vlan_aware?: boolean; latency_ms?: number; loss_pct?: number; status_on_loss?: boolean; cut?: string[] }) =>
    req<unknown>('POST', '/iec61850/network', body),
}
