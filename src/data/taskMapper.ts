import type { Task, TaskEntity } from '../types'

/**
 * 读取 pull 结果中的属性，兼容三种键名形态（实测 Logseq 会保留命名空间并带冒号）：
 * "status" / "logseq.property/status" / ":logseq.property/status"
 */
function prop(e: TaskEntity, name: string): unknown {
  const rec = e as Record<string, unknown>
  for (const k of [name, `logseq.property/${name}`, `:logseq.property/${name}`, `block/${name}`]) {
    const v = rec[k]
    if (v != null) return v
  }
  return undefined
}

/**
 * 把任意形态的日期值归一化为 'YYYY-MM-DD'。
 * DB 版 date 类型属性的值是 journal 页引用，pull 后可能形态：
 * - number：journal-day（YYYYMMDD）
 * - string：'YYYY-MM-DD' / 'YYYYMMDD'
 * - object：展开的 journal 页（{title|name|journal-day}）或未展开的 {id}
 */
export function normalizeDate(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'number') {
    const s = String(v)
    return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/)
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null
  }
  if (Array.isArray(v)) {
    return v.length > 0 ? normalizeDate(v[0]) : null
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const day = o['journal-day'] ?? o['block/journal-day'] ?? o['date'] ?? o['value']
    if (day != null) return normalizeDate(day)
    // 展开的 journal 页：标题形如 "Nov 2nd, 2026" 无法可靠解析，只认 journal-day
    return null
  }
  return null
}

/**
 * 从 :logseq.property/status 的 pull 结果中提取状态显示值。
 * 可能形态：
 * - 展开的 closed value 实体：{title: "Todo"} / {name: "Todo"} / {db/ident: ":logseq.task.status/Todo"}
 * - 未展开的引用：{id: 76} → 无法判断，返回 null（调用方回退 assumeTask）
 * - 纯字符串："Todo"
 */
function extractStatusValue(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.length > 0 ? extractStatusValue(v[0]) : null
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const val =
      o['title'] ?? o['name'] ?? o['logseq.property/value'] ?? o['value'] ?? o['block/title']
    if (typeof val === 'string' && val) return val
    const ident = o['db/ident'] ?? o['ident']
    if (typeof ident === 'string') return ident
    return null
  }
  return null
}

/** 状态显示值 → 标准 marker（大小写不敏感；中文状态同样识别；未知返回 null） */
function mapStatusToMarker(s: string): string | null {
  const v = s.toLowerCase()
  // 「未完成」含「完成」，必须先排除
  if (/未完成|未结束/.test(v)) return 'TODO'
  if (/完成|done|complete/.test(v)) return 'DONE'
  if (/取消|cancel/.test(v)) return 'CANCELED'
  if (/进行|doing|in[ -]?progress|now/.test(v)) return 'DOING'
  if (/待办|todo|backlog|review|later|wait/.test(v)) return 'TODO'
  return null
}

/** 内置 Status 取值 → Logseq 中文界面里的叫法（Backlog 在中文界面显示为「待办列表」） */
const STATUS_LABEL_ZH: Record<string, string> = {
  backlog: '待办列表',
  todo: '待办',
  doing: '进行中',
  'in review': '待审核',
  done: '已完成',
  canceled: '已取消',
}

/** 状态引用/ident → 可展示的状态文字（如 ":logseq.task.status/Todo" → "Todo"） */
function displayStatus(s: string): string {
  const tail = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s
  const trimmed = tail.trim()
  if (!trimmed) return s
  const normalized = /[a-z]-[a-z]/i.test(trimmed) ? trimmed.replace(/-/g, ' ') : trimmed
  return STATUS_LABEL_ZH[normalized.toLowerCase()] ?? normalized
}

const MARKER_RE = /^(TODO|DOING|NOW|LATER|WAITING|DONE|CANCELED)\s+/i

/** 毫秒/秒级时间戳 → 'YYYY-MM-DD'（本地时区） */
function dateFromTs(v: unknown): string | null {
  const raw = typeof v === 'string' ? Number(v) : v
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null
  const ms = raw < 1e12 ? raw * 1000 : raw
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface ToTaskOptions {
  /** 查询已保证是任务（如按 #Task 标签查询）时，status 解析失败默认 TODO 而非丢弃 */
  assumeTask?: boolean
}

export function toTask(e: TaskEntity, opts: ToTaskOptions = {}): Task | null {
  if (!e) return null
  const firstLine = (e.title ?? e.content ?? '').split('\n')[0] ?? ''
  const rawStatus = extractStatusValue(prop(e, 'status'))
  // status 引用存在但解析不出文字（字典未命中）：仍算开放任务，避免被当成已完成
  const unresolvedStatus = rawStatus == null && statusRefId(e) != null
  // marker 三级归一化：DB status property → 文件版 marker 属性 → 内容前缀
  const marker =
    ((): string | null => {
      if (rawStatus != null) {
        const m = mapStatusToMarker(rawStatus)
        if (m) return m
      }
      if (unresolvedStatus) return 'TODO'
      if (e.marker != null && String(e.marker).trim() !== '') return String(e.marker).toUpperCase()
      const fromContent = firstLine.match(/^(TODO|DOING|NOW|LATER|WAITING|DONE|CANCELED)\s/i)?.[1]
      return fromContent ? fromContent.toUpperCase() : null
    })() ?? (opts.assumeTask ? 'TODO' : null)
  if (!e.uuid || !marker) return null

  const props = (e.properties ?? {}) as Record<string, unknown>
  // DB 版：scheduled/deadline 为 journal 页引用；文件版：顶层或 properties map 内
  const scheduled = normalizeDate(prop(e, 'scheduled') ?? props['scheduled'])
  const deadline = normalizeDate(prop(e, 'deadline') ?? props['deadline'])

  const content = firstLine.replace(MARKER_RE, '').trim()
  const page = (e.page ?? {}) as Record<string, unknown>
  const rec = e as Record<string, unknown>
  const isDone = marker === 'DONE' || marker === 'CANCELED'
  // 完成日期：DB 版没有完成时间属性，用 updated-at 近似；缺失时退回 block 所在 journal 页日期
  const completedAt = isDone
    ? dateFromTs(rec['updated-at'] ?? rec['updatedAt']) ?? normalizeDate(page['journal-day'])
    : null
  return {
    uuid: e.uuid,
    content: content || '(untitled)',
    marker,
    /** 原始状态文字（待办 / 待办列表 / Doing…），用于界面区分同一状态属性的不同取值 */
    statusLabel: rawStatus != null ? displayStatus(rawStatus) : null,
    scheduled,
    deadline,
    completedAt,
    pageName: String(page['original-name'] ?? page['name'] ?? page['title'] ?? ''),
    isJournalPage: page['journal-day'] != null || page['journal?'] === true,
    parentUuid: typeof e.parentUuid === 'string' ? e.parentUuid : null,
    parentTitle: typeof e.parentTitle === 'string' ? e.parentTitle : null,
  }
}

/** 对外暴露：判断 entity 是否带任务状态（供查询层过滤用） */
export function hasStatusProp(e: TaskEntity): boolean {
  return prop(e, 'status') != null
}

const STATUS_KEYS = ['status', 'logseq.property/status', ':logseq.property/status', 'block/status']

/**
 * status 若是未展开的引用（{id: N}），返回该 id。
 * 实测 Logseq 桥接层会忽略 pull 的子属性展开（page/tags 同样只有 {id}），
 * 因此 status 必须再走一次 Datalog join 才能拿到 Todo/Doing/Done 文字。
 */
export function statusRefId(e: TaskEntity): number | null {
  const rec = e as Record<string, unknown>
  for (const k of STATUS_KEYS) {
    const v = rec[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const id = (v as Record<string, unknown>).id
      if (typeof id === 'number') return id
    }
  }
  return null
}

/** 把解析出的状态文字写回 entity，替换掉原来的未展开引用 */
export function setStatusValue(e: TaskEntity, value: string): void {
  const rec = e as Record<string, unknown>
  for (const k of STATUS_KEYS) {
    if (rec[k] != null) {
      rec[k] = value
      return
    }
  }
  rec.status = value
}
