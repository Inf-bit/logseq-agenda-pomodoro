import type { TaskEntity } from '../types'
import { hasStatusProp, setStatusValue, statusRefId, toTask } from './taskMapper'

/**
 * DB 版任务数据模型（据官方 db-version-changes.md / db-version.md 调研）：
 * - 任务 = 带 #Task 标签（:logseq.class/Task）的 block
 * - 状态 = :logseq.property/status（值 Todo/Doing/Done/Backlog/In Review/Canceled）
 * - 日期 = :logseq.property/scheduled / :logseq.property/deadline（date 类型，值为 journal 页引用）
 * - :block/content → :block/title；:block/journal? → :block/journal-day 或 #Journal 标签
 *
 * 查询链：显式 pull → wildcard 全拉 → status 属性 → 文件版 marker。
 * pull 中列出的属性若在 schema 中不存在，datascript 会忽略（不报错），因此可安全混写。
 */

/** 错误归一化：Logseq 桥接层 reject 的往往不是 Error 实例，String(e) 只会得到 [object Object] */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    for (const k of ['message', 'msg', 'error', 'reason', 'cause', 'ex-message']) {
      const v = o[k]
      if (typeof v === 'string' && v) return v
      if (v && typeof v === 'object') {
        const nested = errMsg(v)
        if (nested && nested !== '[object Object]') return nested
      }
    }
    try {
      const s = JSON.stringify(e)
      if (s && s !== '{}') return s
    } catch {
      /* 循环引用等无法序列化 */
    }
  }
  return String(e)
}

/**
 * 显式 pull：只列 DB 版确定存在的属性，并展开 status（closed value 页）与 date（journal 页）。
 * status 必须展开，否则只能拿到 {id: 76}，无法判断 Todo/Doing/Done。
 */
const PULL_DB = `
(pull ?b [:block/uuid :block/title
          {:logseq.property/status [:block/title]}
          {:logseq.property/scheduled [:block/journal-day]}
          {:logseq.property/deadline [:block/journal-day]}
          {:block/page [:block/name :block/title :block/journal-day]}
          :block/parent])
`

/** 策略1（DB 版主路径）：按 #Task 标签查全部任务（含 Done） */
export const QUERY_TASKS_BY_TAG = `
[:find ${PULL_DB}
 :where
 [?b :block/tags :logseq.class/Task]]
`

/** 策略2（DB 版兜底）：wildcard 全拉，避免显式属性名与 schema 不符导致失败 */
export const QUERY_TASKS_BY_TAG_WILDCARD = `
[:find (pull ?b [*])
 :where
 [?b :block/tags :logseq.class/Task]]
`

/** 策略3（DB 版备选）：按 status property 查（Task 标签 ident 变化时兜底） */
export const QUERY_TASKS_BY_STATUS = `
[:find ${PULL_DB}
 :where
 [?b :logseq.property/status ?s]]
`

/** 策略4（文件版兜底）：按旧版 marker 查 */
export const QUERY_TASKS_BY_MARKER = `
[:find (pull ?b [:block/uuid :block/content :block/marker
                 :block/scheduled :block/deadline :block/properties
                 {:block/page [:block/name :block/original-name
                               :block/journal-day :block/journal?]}])
 :where
 [?b :block/marker ?m]]
`

/** 诊断：抽样任务完整属性（* 全拉，观察真实值形态） */
export const QUERY_RAW_SAMPLE = `
[:find (pull ?b [*])
 :where
 [?b :block/tags :logseq.class/Task]]
`

/** 诊断：最小查询（与任务无关，仅验证 DB 查询通道本身是否可用） */
export const QUERY_MINIMAL = `
[:find (pull ?b [:block/uuid :block/title])
 :where
 [?b :block/uuid]]
`

export const QUERY_COUNT = `
[:find (count ?b)
 :where
 [?b :block/tags :logseq.class/Task]]
`

export const QUERY_COUNT_SCHEDULED = `
[:find (count ?b)
 :where
 [?b :block/tags :logseq.class/Task]
 [?b :logseq.property/scheduled ?d]]
`

export const QUERY_COUNT_DEADLINE = `
[:find (count ?b)
 :where
 [?b :block/tags :logseq.class/Task]
 [?b :logseq.property/deadline ?d]]
`

type QueryFn = (q: string) => Promise<unknown>

/** DB 查询通道：datascriptQuery 与 q 双通道（不同版本 Logseq 暴露的入口不同） */
function queryRunners(): Array<[string, QueryFn]> {
  const db = logseq.DB as unknown as { q?: QueryFn; datascriptQuery?: QueryFn }
  const runners: Array<[string, QueryFn]> = []
  if (typeof db.datascriptQuery === 'function') {
    runners.push(['datascriptQuery', (q) => db.datascriptQuery!(q)])
  }
  if (typeof db.q === 'function') {
    runners.push(['q', (q) => db.q!(q)])
  }
  return runners
}

/** 执行查询并返回原始行（[?a ?b] 这类元组查询用） */
async function runRows(query: string): Promise<unknown[][]> {
  const runners = queryRunners()
  if (runners.length === 0) throw new Error('logseq.DB 上没有可用的查询方法（q / datascriptQuery 均缺失）')
  const errs: string[] = []
  for (const [name, fn] of runners) {
    try {
      const rows = (await fn(query)) as unknown
      if (Array.isArray(rows)) return rows as unknown[][]
      errs.push(`${name}: 返回非数组（${typeof rows}）`)
    } catch (e) {
      errs.push(`${name}: ${errMsg(e)}`)
    }
  }
  throw new Error(errs.join(' ｜ '))
}

/** 执行查询并取出首列 entity */
async function runQuery(query: string): Promise<TaskEntity[]> {
  const rows = await runRows(query)
  return rows
    .map((r) => (Array.isArray(r) ? r[0] : r))
    .filter((e): e is TaskEntity => Boolean(e) && typeof e === 'object')
}

/**
 * status 引用 id → 状态文字（Todo/Doing/Done/...）。
 * pull 的子属性展开会被桥接层忽略，只能再查一次：?s 是 status 引用的目标实体，
 * 依次尝试 title / value / db-ident / name 四种可能承载文字的属性。
 */
const STATUS_DICT_QUERIES = [
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :block/title ?v]]',
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :logseq.property/value ?v]]',
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :db/ident ?v]]',
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :block/name ?v]]',
]

const STATUS_DICT_TTL = 60_000
let statusDictCache: { at: number; dict: Map<number, string> } | null = null

async function loadStatusDict(): Promise<Map<number, string>> {
  if (statusDictCache && Date.now() - statusDictCache.at < STATUS_DICT_TTL) return statusDictCache.dict
  const dict = new Map<number, string>()
  for (const q of STATUS_DICT_QUERIES) {
    try {
      for (const row of await runRows(q)) {
        if (!Array.isArray(row)) continue
        const [id, value] = row
        if (typeof id !== 'number' || typeof value !== 'string' || !value) continue
        if (!dict.has(id)) dict.set(id, value)
      }
    } catch {
      /* 属性不存在即跳过，继续下一种 */
    }
  }
  if (dict.size > 0) statusDictCache = { at: Date.now(), dict }
  return dict
}

/** 把未展开的 status 引用替换成状态文字（否则历史 Done 任务会被误当成开放任务） */
async function resolveStatusLabels(entities: TaskEntity[]): Promise<TaskEntity[]> {
  const ids = new Set<number>()
  for (const e of entities) {
    const id = statusRefId(e)
    if (id != null) ids.add(id)
  }
  if (ids.size === 0) return entities
  const dict = await loadStatusDict()
  if (dict.size === 0) return entities
  for (const e of entities) {
    const id = statusRefId(e)
    const label = id != null ? dict.get(id) : undefined
    if (label) setStatusValue(e, label)
  }
  return entities
}

/**
 * 页面引用同样是未展开的 {id}（导致 pageName 为空、点击无法跳转），
 * 额外查一次 page id → 页面标题 / journal-day，供展示与跳转使用。
 */
const PAGE_DICT_QUERIES: Array<{ q: string; kind: 'name' | 'day' }> = [
  {
    kind: 'name',
    q: '[:find ?p ?n :where [?b :block/tags :logseq.class/Task] [?b :block/page ?p] [?p :block/title ?n]]',
  },
  {
    kind: 'name',
    q: '[:find ?p ?n :where [?b :block/tags :logseq.class/Task] [?b :block/page ?p] [?p :block/name ?n]]',
  },
  {
    kind: 'day',
    q: '[:find ?p ?d :where [?b :block/tags :logseq.class/Task] [?b :block/page ?p] [?p :block/journal-day ?d]]',
  },
]

interface PageInfo {
  name?: string
  journalDay?: number
}

let pageDictCache: { at: number; dict: Map<number, PageInfo> } | null = null

async function loadPageDict(): Promise<Map<number, PageInfo>> {
  if (pageDictCache && Date.now() - pageDictCache.at < STATUS_DICT_TTL) return pageDictCache.dict
  const dict = new Map<number, PageInfo>()
  for (const { q, kind } of PAGE_DICT_QUERIES) {
    try {
      for (const row of await runRows(q)) {
        if (!Array.isArray(row)) continue
        const [pid, val] = row
        if (typeof pid !== 'number') continue
        const info = dict.get(pid) ?? {}
        if (kind === 'day') {
          if (typeof val === 'number') info.journalDay = val
        } else if (typeof val === 'string' && val && !info.name) {
          info.name = val
        }
        dict.set(pid, info)
      }
    } catch {
      /* 属性不存在即跳过 */
    }
  }
  if (dict.size > 0) pageDictCache = { at: Date.now(), dict }
  return dict
}

async function resolvePageRefs(entities: TaskEntity[]): Promise<TaskEntity[]> {
  const ids = new Set<number>()
  for (const e of entities) {
    const p = e.page as unknown
    if (!p || typeof p !== 'object') continue
    const id = (p as Record<string, unknown>)['id']
    if (typeof id === 'number') ids.add(id)
  }
  if (ids.size === 0) return entities
  const dict = await loadPageDict()
  if (dict.size === 0) return entities
  for (const e of entities) {
    const p = e.page as unknown
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    const id = o['id']
    if (typeof id !== 'number') continue
    const info = dict.get(id)
    if (!info) continue
    if (info.name && !(o['name'] || o['original-name'] || o['title'])) {
      o['name'] = info.name
      o['original-name'] = info.name
    }
    if (o['journal-day'] == null && info.journalDay != null) o['journal-day'] = info.journalDay
  }
  return entities
}

/**
 * 父 block 引用同样是未展开的 {id}。子任务要折叠到所属「待办列表」下，
 * 必须先把父 block 的 id 换成 uuid / 标题。
 */
const PARENT_DICT_QUERIES: Array<{ q: string; kind: 'uuid' | 'title' }> = [
  {
    kind: 'uuid',
    q: '[:find ?p ?u :where [?b :block/tags :logseq.class/Task] [?b :block/parent ?p] [?p :block/uuid ?u]]',
  },
  {
    kind: 'uuid',
    q: '[:find ?p ?u :where [?b :logseq.property/status ?s] [?b :block/parent ?p] [?p :block/uuid ?u]]',
  },
  {
    kind: 'title',
    q: '[:find ?p ?n :where [?b :block/tags :logseq.class/Task] [?b :block/parent ?p] [?p :block/title ?n]]',
  },
]

interface ParentInfo {
  uuid?: string
  title?: string
}

let parentDictCache: { at: number; dict: Map<number, ParentInfo> } | null = null

async function loadParentDict(): Promise<Map<number, ParentInfo>> {
  if (parentDictCache && Date.now() - parentDictCache.at < STATUS_DICT_TTL) return parentDictCache.dict
  const dict = new Map<number, ParentInfo>()
  for (const { q, kind } of PARENT_DICT_QUERIES) {
    try {
      for (const row of await runRows(q)) {
        if (!Array.isArray(row)) continue
        const [pid, val] = row
        if (typeof pid !== 'number' || typeof val !== 'string' || !val) continue
        const info = dict.get(pid) ?? {}
        if (kind === 'uuid') info.uuid = val
        else info.title = val
        dict.set(pid, info)
      }
    } catch {
      /* 属性不存在即跳过 */
    }
  }
  if (dict.size > 0) parentDictCache = { at: Date.now(), dict }
  return dict
}

/** 把任务的 parent {id} 补成 parentUuid / parentTitle */
async function resolveParentRefs(entities: TaskEntity[]): Promise<TaskEntity[]> {
  const ids = new Set<number>()
  for (const e of entities) {
    const p = e.parent as unknown
    if (!p || typeof p !== 'object') continue
    const id = (p as Record<string, unknown>)['id']
    if (typeof id === 'number') ids.add(id)
  }
  if (ids.size === 0) return entities
  const dict = await loadParentDict()
  if (dict.size === 0) return entities
  for (const e of entities) {
    const p = e.parent as unknown
    if (!p || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    // 若桥接层恰好展开了 parent，直接用；否则查字典
    if (typeof o['uuid'] === 'string') {
      e.parentUuid = o['uuid']
      e.parentTitle = typeof o['title'] === 'string' ? o['title'] : null
      continue
    }
    const id = o['id']
    if (typeof id !== 'number') continue
    const info = dict.get(id)
    if (!info) continue
    e.parentUuid = info.uuid ?? null
    e.parentTitle = info.title ?? null
  }
  return entities
}

/** 引用补全：status / page / parent 各查一次字典，三件事互不依赖 */
async function resolveRefs(rows: TaskEntity[]): Promise<TaskEntity[]> {
  await Promise.all([resolveStatusLabels(rows), resolvePageRefs(rows), resolveParentRefs(rows)])
  return rows
}

export function fetchTaskEntities(): Promise<TaskEntity[]> {
  return fetchTaskEntitiesAdaptive()
}

/** 该 entity 是否像任务（DB status property / 文件版 marker / 内容状态前缀） */
const looksLikeTask = (e: TaskEntity): boolean => {
  const text = e.title ?? e.content ?? ''
  return (
    hasStatusProp(e) ||
    (e.marker != null && String(e.marker).trim() !== '') ||
    /^(TODO|DOING|NOW|LATER|WAITING|DONE|CANCELED)\s/i.test(text.split('\n')[0] ?? '')
  )
}

/**
 * 自适应查询链：任一策略返回非空即采用。
 * 全部为空且无错误 → 返回 []（界面提示 0 任务）；
 * 有错误且全部为空 → 抛出合并错误（诊断页可见具体通道与原因）。
 */
async function fetchTaskEntitiesAdaptive(): Promise<TaskEntity[]> {
  const strategies = [
    QUERY_TASKS_BY_TAG,
    QUERY_TASKS_BY_TAG_WILDCARD,
    QUERY_TASKS_BY_STATUS,
    QUERY_TASKS_BY_MARKER,
  ]
  const errors: string[] = []
  let anySuccess = false
  // 并集而非短路：Logseq 状态菜单里的「待办列表」等条目可能不带 #Task 标签，只带 status，
  // 只走 #Task 查询会漏掉它们，因此四条策略全部执行并按 uuid 去重合并。
  const merged = new Map<string, TaskEntity>()
  for (const q of strategies) {
    try {
      const rows = await resolveRefs(await runQuery(q))
      anySuccess = true
      for (const e of rows) {
        if (!looksLikeTask(e)) continue
        const key = e.uuid ?? String((e as Record<string, unknown>)['id'] ?? '')
        if (key && !merged.has(key)) merged.set(key, e)
      }
    } catch (e) {
      errors.push(errMsg(e))
    }
  }
  if (merged.size > 0) return [...merged.values()]
  if (!anySuccess && errors.length > 0) throw new Error(errors.join(' ｜ '))
  return []
}

/** 按 uuid 或数字实体 id 读取单个实体全属性（诊断⑩：对比「待办」与「待办列表」的字段差异） */
export async function fetchBlockByUuid(ref: string): Promise<TaskEntity[]> {
  const safe = String(ref).trim().replace(/[()"]/g, '')
  if (!safe) throw new Error('ref 为空')
  if (/^\d+$/.test(safe)) {
    return runQuery(`[:find (pull ?e [*]) :where [?e :db/id ${Number(safe)}]]`)
  }
  return runQuery(`[:find (pull ?b [*]) :where [?b :block/uuid #uuid "${safe}"]]`)
}

/** 今日已完成改为在 stores 侧按 completedAt 归档，不再单独查 journal 页 */

export function fetchRawSample(n = 3): Promise<TaskEntity[]> {
  return runQuery(QUERY_RAW_SAMPLE).then((rows) => rows.slice(0, n))
}

/** 诊断②兜底：Task 标签为空时的 status 属性抽样（定位 Task ident 是否变化） */
export const QUERY_RAW_SAMPLE_STATUS = `
[:find (pull ?b [:block/uuid :block/title {:logseq.property/status [:block/title :db/ident]}])
 :where
 [?b :logseq.property/status ?s]]
`

export interface RawSampleDiag {
  /** 通道探测：DB 查询是否可用、暴露了哪些方法 */
  channel: string
  /** 最小查询（不涉及任务），验证查询通道本身 */
  minimal: { ok: boolean; count?: number; sample?: TaskEntity[]; error?: string }
  /** #Task 标签抽样 */
  filtered: TaskEntity[]
  /** Task 标签为空时的 status 属性抽样（null = 过滤有结果，无需兜底） */
  unfiltered: TaskEntity[] | null
  /** 各策略的错误（空数组 = 未报错） */
  errors: string[]
}

/** ② 原始抽样（诊断增强）：一次点击定位「0 任务」根因 */
export async function fetchRawSampleDiag(n = 3): Promise<RawSampleDiag> {
  const runners = queryRunners()
  const channel =
    runners.length > 0 ? runners.map(([name]) => name).join(' / ') : '（无可用查询方法）'

  const errors: string[] = []

  let minimal: RawSampleDiag['minimal']
  try {
    const rows = await runQuery(QUERY_MINIMAL)
    minimal = { ok: true, count: rows.length, sample: rows.slice(0, n) }
  } catch (e) {
    minimal = { ok: false, error: errMsg(e) }
    errors.push(`minimal: ${errMsg(e)}`)
  }

  let filtered: TaskEntity[] = []
  try {
    filtered = (await runQuery(QUERY_RAW_SAMPLE)).slice(0, n)
  } catch (e) {
    errors.push(`Task 标签抽样: ${errMsg(e)}`)
  }

  let unfiltered: TaskEntity[] | null = null
  if (filtered.length === 0) {
    try {
      unfiltered = (await runQuery(QUERY_RAW_SAMPLE_STATUS)).slice(0, n)
    } catch (e) {
      errors.push(`status 属性抽样: ${errMsg(e)}`)
    }
  }

  return { channel, minimal, filtered, unfiltered, errors }
}

/** 探查关键词：待办 / 列表 / 完成时间 / 任务状态 */
const MODEL_KEYWORD_RE = /待办|列表|任务|完成|todo|task|done|complet|status|schedul|deadline/i

export interface ModelProbe {
  /** 与任务/待办/完成相关的 tag（class）及其 ident */
  tags: Array<Record<string, unknown>>
  /** 与任务/待办/完成相关的属性及其 ident（重点看是否有完成时间属性） */
  properties: Array<Record<string, unknown>>
  /** 已完成任务的完整属性样本（看真实字段名） */
  doneSamples: TaskEntity[]
  /** Status 属性的全部取值（id → 文字），用于确认「待办列表」这类自定义状态 */
  statusValues: Array<[number, string]>
  /** 任务实际引用的 status 实体全属性（id 76 这类字典里查不到的值会在这里现形） */
  statusEntities: TaskEntity[]
  /** status 实体的原始三元组 [实体id, 属性, 值]，用于定位 76 到底挂在哪里 */
  statusTriples: unknown[][]
  /** 分组诊断：parent 引用是否补全成功（折叠功能依赖） */
  grouping: unknown
  /** 上述各块各自的错误 */
  errors: string[]
}

function brief(list: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return list
    .map((x) => ({
      id: x['id'],
      name: x['name'],
      title: x['title'],
      ident: x['ident'],
    }))
    .filter((x) => MODEL_KEYWORD_RE.test(String(x.name ?? '') + String(x.title ?? '') + String(x.ident ?? '')))
}

/** ⑨ 模型探查：列出待办相关 tag / 完成时间属性，并给已完成任务的字段样本 */
export async function probeTaskModel(): Promise<ModelProbe> {
  const errors: string[] = []
  let tags: Array<Record<string, unknown>> = []
  let properties: Array<Record<string, unknown>> = []

  try {
    const all = ((await logseq.Editor.getAllTags()) ?? []) as unknown as Array<Record<string, unknown>>
    tags = brief(all)
  } catch (e) {
    errors.push(`getAllTags: ${errMsg(e)}`)
  }
  try {
    const all = ((await logseq.Editor.getAllProperties()) ?? []) as unknown as Array<Record<string, unknown>>
    properties = brief(all)
  } catch (e) {
    errors.push(`getAllProperties: ${errMsg(e)}`)
  }

  let doneSamples: TaskEntity[] = []
  try {
    const rows = await runQuery(QUERY_DONE_WITH_STATUS)
    const resolved = await resolveRefs(rows)
    doneSamples = resolved
      .map((e) => ({ e, t: toTaskBrief(e) }))
      .filter((x) => x.t === 'DONE' || x.t === 'CANCELED')
      .slice(0, 3)
      .map((x) => x.e)
  } catch (e) {
    errors.push(`done 样本: ${errMsg(e)}`)
  }

  let statusEntities: TaskEntity[] = []
  try {
    const rows = await runQuery(QUERY_STATUS_ENTITIES)
    const seen = new Set<string>()
    statusEntities = rows.filter((e) => {
      const id = String((e as Record<string, unknown>)['id'] ?? '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  } catch (e) {
    errors.push(`status 实体: ${errMsg(e)}`)
  }

  let statusTriples: unknown[][] = []
  try {
    const rows = await runRows(QUERY_STATUS_TRIPLES)
    // 只保留 76 与其它未解析 id 的三元组，避免输出过大
    const dict = await loadStatusDict()
    statusTriples = rows
      .filter((r) => Array.isArray(r) && typeof r[0] === 'number' && !dict.has(r[0]))
      .slice(0, 40)
  } catch (e) {
    errors.push(`status 三元组: ${errMsg(e)}`)
  }

  /** 分组诊断：父子关系是否成功补全（折叠功能依赖它） */
  let grouping: unknown = null
  try {
    const ents = await fetchTaskEntitiesAdaptive()
    const mapped = ents
      .map((e) => toTask(e, { assumeTask: true }))
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const lists = mapped.filter((x) => x.uuid && mapped.some((c) => c.parentUuid === x.uuid))
    const withParent = mapped.filter((x) => x.parentUuid)
    const rawParentSample = ents
      .slice(0, 3)
      .map((e) => ({
        title: e.title,
        parent: e.parent ?? null,
        parentUuid: e.parentUuid ?? null,
        parentTitle: e.parentTitle ?? null,
        statusLabel: toTask(e, { assumeTask: true })?.statusLabel ?? null,
      }))
    grouping = {
      mapped: mapped.length,
      lists: lists.map((x) => ({ uuid: x.uuid, content: x.content, children: mapped.filter((c) => c.parentUuid === x.uuid).length })),
      withParentUuid: withParent.length,
      matchedChildren: mapped.filter((x) => x.parentUuid && lists.some((l) => l.uuid === x.parentUuid)).length,
      rawParentSample,
    }
  } catch (e) {
    errors.push(`分组诊断: ${errMsg(e)}`)
  }

  return {
    tags,
    properties,
    doneSamples,
    statusValues: [...(await loadStatusDict()).entries()],
    statusEntities,
    statusTriples,
    grouping,
    errors,
  }
}

/** status 实体的原始三元组（定位字典查不到的 id，比如 76） */
const QUERY_STATUS_TRIPLES = `
[:find ?s ?a ?v
 :where
 [?b :logseq.property/status ?s]
 [?s ?a ?v]]
`

/** 任务实际引用的 status 实体（* 全拉：看清 id 76 到底是什么） */
const QUERY_STATUS_ENTITIES = `
[:find (pull ?v [*])
 :where
 [?b :logseq.property/status ?v]]
`

/** 探查用：已完成任务全属性（* 全拉，观察有无完成时间字段） */
const QUERY_DONE_WITH_STATUS = `
[:find (pull ?b [*])
 :where
 [?b :block/tags :logseq.class/Task]
 [?b :logseq.property/status ?s]]
`

function toTaskBrief(e: TaskEntity): string {
  const rec = e as Record<string, unknown>
  const keys = ['status', 'logseq.property/status', ':logseq.property/status']
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string') return v.toUpperCase()
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const s = o['title'] ?? o['name'] ?? o['logseq.property/value']
      if (typeof s === 'string') return s.toUpperCase()
    }
  }
  return ''
}

export async function fetchTaskCount(): Promise<{
  total: number
  scheduled: number
  deadline: number
}> {
  const runners = queryRunners()
  /** count 查询返回 [[N]]，需单独取首行首列（不能走 entity 解析） */
  const countOf = async (q: string): Promise<number> => {
    for (const [, fn] of runners) {
      try {
        const rows = (await fn(q)) as unknown
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0] as unknown[]
          return Number(Array.isArray(row) ? row[0] : row) || 0
        }
        return 0
      } catch {
        /* 换下一个通道 */
      }
    }
    return -1
  }
  const [total, scheduled, deadline] = await Promise.all([
    countOf(QUERY_COUNT),
    countOf(QUERY_COUNT_SCHEDULED),
    countOf(QUERY_COUNT_DEADLINE),
  ])
  return { total, scheduled, deadline }
}
