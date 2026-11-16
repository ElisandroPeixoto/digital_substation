export interface RelaySummary {
  id: string
  name: string
  fid: string
  file_count: number
  files: string[]
}

export interface UploadSummary {
  upload_id: string
  filename: string
  relays: RelaySummary[]
}

export interface StaticTarget {
  id: string
  label: string
  latched: boolean
  color: string
}

export interface StaticInfo {
  targets: StaticTarget[]
  pb: { n: number; label_a: string; label_b: string }[]
  enabled_color: string
  trip_color: string
}

export interface SettingClass {
  cls: string
  name: string
  count: number
}

export interface SessionInfo {
  id: string
  filename: string
  relay_id: string
  device: string
  header: Record<string, string>
  classes: SettingClass[]
  files: string[]
  static: StaticInfo
  ctr: number
  ctrn: number
  ptr: number
  vnom: number
  presets: Record<string, string>
  fault_types: string[]
}

export interface Led {
  on: boolean
  color: string
}

export interface PanelSnapshot {
  enabled: Led
  trip: Led
  targets: { id: string; on: boolean; color: string; latched: boolean }[]
  pb: { n: number; a: Led; b: Led }[]
  lcd: string[]
}

export interface SimConfig {
  ia_mag: number
  ia_ang: number
  ib_mag: number
  ib_ang: number
  ic_mag: number
  ic_ang: number
  va_mag: number
  va_ang: number
  vb_mag: number
  vb_ang: number
  vc_mag: number
  vc_ang: number
  freq: number
  vdc: number
  open_ms: number
  close_ms: number
  fault_type: string | null
  fault_current: number
  fault_persistent: boolean
  breaker_auto: boolean
  analog_off_on_output: boolean
  analog_off_outputs: string[]
  analog_on: boolean
  halarm: boolean
  linka: boolean
  linkb: boolean
  tsntpp: boolean
  tsntpb: boolean
}

export interface InputPoint {
  name: string
  label: string
  raw: boolean
  value: number
  breaker: boolean
}

export interface OutputPoint {
  name: string
  label: string
  value: number
  role: string
}

export interface PanelData {
  time: number
  running: boolean
  speed: number
  panel: PanelSnapshot
  breaker: { state: string; closed: boolean; operations: number }
  status: { group: number; trip: number; close: number; cf: number; recloser: string; shot: number; unresolved: number }
  sim: SimConfig
  inputs: InputPoint[]
  outputs: OutputPoint[]
  meter: Record<string, number>
}

// ---- estado interno ------------------------------------------------------
export interface StateInput extends InputPoint {
  debounce_ms: number
  pending: number
}
export interface StateOutput {
  name: string
  expr: string
  comment: string
  value: number
  role: string
}
export interface StateLatch {
  name: string
  value: number
  set_expr: string
  set_comment: string
  rst_expr: string
  rst_comment: string
  set_now: boolean
  rst_now: boolean
}
export interface StateTimer {
  name: string
  expr: string
  comment: string
  input: boolean
  out: boolean
  pu: number
  do: number
  pu_el: number
  do_el: number
}
export interface StateElement {
  name: string
  kind: string
  quantity: string
  pickup: number
  setting: string
  tc: string
  measured: number
  pickup_bit: string
  timed_bit: string
  pk: boolean
  timed: boolean
  progress: number
  multiple?: number          // I / pickup (50 e 51)
  t_op?: number | null       // tempo total previsto da curva (51), em s
  reset_bit?: string         // 51xR
  reset?: boolean
}
export interface StateData {
  time: number
  group: number
  pending_group: number | null
  inputs: StateInput[]
  outputs: StateOutput[]
  latches: StateLatch[]
  timers: StateTimer[]
  counters: { name: string; value: number; preset: number; q: number; cu: string; comment: string }[]
  math: { name: string; expr: string; comment: string; value: number }[]
  protection: { elements: StateElement[]; disabled: number }
  trip_close: Record<string, string | number | string[] | null>
  recloser: {
    enabled: boolean
    state: string
    shot: number
    max_shots: number
    phase: string
    open_interval_elapsed: number
    reset_elapsed: number
    last_event: string
    intervals: (number | null)[]
    reset_time: number | null
    lockout_reset_time: number | null
    dtl: string
  }
  words: [string, number][]
  analog: Record<string, number>
  unresolved: string[]
}

// ---- DNP3 ----------------------------------------------------------------
export interface DnpEvent {
  seq: number
  t: number
  w?: number
  kind: 'BI' | 'AI'
  index: number
  name: string
  value: number
  raw: number
}
export interface DnpResult {
  t: number
  w?: number
  index: number
  name: string
  code: string
  mode: string
  status: string
  message: string
}
export interface DnpData {
  map: number
  maps: number[]
  bo: { index: number; name: string; desc: string }[]
  bi: { index: number; name: string; desc: string; value: number | null; changed: number | null; changed_w?: number | null }[]
  ai: {
    index: number
    name: string
    desc: string
    scale: number
    deadband: number
    raw: number | null
    value: number | null
    quality: string
  }[]
  co: { index: number; name: string }[]
  events: DnpEvent[]
  last_seq: number
  log: DnpResult[]
  selected: { index: number; code: string; left: number } | null
  time: number
}

export interface SerEvent {
  seq: number
  t: number
  w?: number
  name: string
  value: number
  text: string
}

export interface SettingItem {
  key: string
  value: string
  comment: string
  modified: boolean
}
export interface SettingsData {
  cls: string
  name: string
  items: SettingItem[]
}
