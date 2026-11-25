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
  model?: string          // 'SEL-751' (padrão) ou '2440'
  ied?: string | null     // IED do módulo IEC61850 associado
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
  ptrs?: number           // relação do TP de sincronismo (PTRS)
  ctrs?: number[]         // SEL-787: relações de TC dos enrolamentos 1 a 4 (CTR1..CTR4)
  windings?: number[]     // SEL-787: enrolamentos no diferencial (E87Wn = Y)
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
  vs_mag: number
  vs_ang: number
  vs_freq: number
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
  lop: boolean
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

export interface IoPoint {
  n: number
  in: string
  out: string
  in_used: boolean
  out_used: boolean
  in_on: boolean
  out_on: boolean
  in_raw: boolean
  in_label: string
  out_label: string
}
export interface IoSlot { slot: number; kind: 'in' | 'out' | 'mixed' | 'empty'; points: IoPoint[] }
export interface IoBit { name: string; on: boolean; held: boolean | null; label: string; used?: boolean }
export interface IoBits { vb: IoBit[]; cb: IoBit[]; rb: IoBit[] }
export interface IoData {
  slots: IoSlot[]
  bits: IoBits
  status: { enabled: boolean; alarm: boolean; mode: boolean; ports: Record<string, boolean> }
}

export interface PanelData {
  model?: string
  io?: IoData | null
  bits?: IoBits
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
  dir_bit?: string           // bit de controle direcional do nível (ex.: P1DIR)
  dir_ok?: boolean
  diff?: DiffInfo            // SEL-787: elemento diferencial 87
  ref?: { in: number; ig: number; torque: number; enable: boolean; bypass: boolean; fwd: boolean; rev: boolean }   // SEL-787: REF1
}
export interface DiffPhase { phase: string; iop: number; irt: number; threshold: number; h2: number; h4: number; h5: number; inr: boolean; r: boolean; hr: boolean; u: boolean; bl: boolean }
export interface DiffInfo { phases: DiffPhase[]; alarm: boolean; alarm_t: boolean; th5: boolean; th5_t: boolean; slp1: number; slp2: number; irs1: number; o87p: number; u87p: number }
export interface DirectionalInfo {
  enabled: boolean
  edir?: string
  order?: string
  selected?: string
  vnom_off?: boolean
  efwdlop?: boolean
  dir?: string[]
  levels?: Record<string, boolean[]>
  bits?: Record<string, boolean>
  settings?: Record<string, number | string>
  quantities?: Record<string, number | null>
}
export interface StateData {
  forced?: Record<string, number>
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
  directional: DirectionalInfo
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

// ------------------------------------------------------------------ IEC 61850
export interface IecFcda { ld_inst: string; prefix: string; ln_class: string; ln_inst: string; do_name: string; da_name: string; fc: string; bit: string; desc: string }
export interface IecGcb {
  name: string; ld_inst: string; go_id: string; dataset: string; conf_rev: number; desc: string
  mac: string; appid: string; vlan_id: string; vlan_prio: string; min_ms: number; max_ms: number
  enabled: boolean; modified: string[]
  entries: IecFcda[]; subscribers: { ied: string; status_vb: string; vbs: string[] }[]
}
export interface IecSubEntry { index: number; vb: string; vb_hi?: string; fcda: IecFcda | null }   // vb_hi: Dbpos (Pos.stVal) → vb = Lo (52A = 0), vb_hi = Hi (52A = 1)
export interface IecSub {
  pub_ied: string; cb_name: string; ld_inst: string; dataset: string; go_id: string; conf_rev: number
  mac: string; appid: string; vlan_id: string; vlan_prio: string; status_vb: string; source: string
  enabled: boolean; modified: string[]
  entries: IecSubEntry[]; issues: { level: 'error' | 'warn'; text: string }[]
}
export interface IecIed {
  name: string; type: string; manufacturer: string; desc: string; config_version: string; model: string
  ip: string; subnet: string; gateway: string; subnet_name: string; source_file: string; vb_max: number
  is_sel: boolean; gcbs: IecGcb[]; subs: IecSub[]
}
export interface IecProject { files: string[]; ieds: IecIed[] }
export interface IecIedStatus {
  name: string; sid: string | null; comm_ok: boolean; reason: string; cut: boolean; rdb_e61850: boolean; rdb_egse: boolean
  pubs: { cb_name: string; st_num: number; sq_num: number; sent: number; values: number[] }[]
  subs: { pub_ied: string; cb_name: string; valid: boolean; reason: string; st_num: number; sq_num: number; rx_count: number; values: number[]; status_vb: string }[]
}
export interface IecStatus {
  bindings: Record<string, string>; vlan_aware: boolean; latency_ms: number; loss_pct: number; status_on_loss: boolean; sent: number; lost: number
  ieds: IecIedStatus[]
}
export interface SessionBrief { id: string; model: string; relay_id: string; device: string; filename: string; running: boolean; ied: string | null; breaker_closed: boolean | null }

// ------------------------------------------------------------------ Mirrored Bits (MBitConfig)
export interface MbPortInfo { port: number; proto: string; eligible: boolean; family: string; channel: string; txid: number; rxid: number; speed: number; rxdflt: string }
export interface MbRelay {
  sid: string; relay_id: string; device: string; model: string; running: boolean
  ports: MbPortInfo[]; bits: Record<string, number>; status: Record<string, number>
}
export interface MbDir { tx: number; rx: number; lost: number; rok: boolean; rbad: boolean; cbad: boolean; state: number[] }
export interface MbLinkS {
  id: string; a: { sid: string; port: number }; b: { sid: string; port: number }; cut: boolean; loss_pct: number
  closed: boolean; issues: string[]; phys: string[]; ab: Partial<MbDir>; ba: Partial<MbDir>
}
export interface MbStatus { relays: MbRelay[]; links: MbLinkS[] }
