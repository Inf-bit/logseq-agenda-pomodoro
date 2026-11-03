import type { Task } from '../types'
import { errMsg } from './queries'

/**
 * DB 版写入约定（源码级确认）：
 * - 属性名必须带命名空间：不带 `/` 的名字会被加上 `:plugin.property.<id>/` 前缀，
 *   写 'status' 会落到插件私有属性（与内置 "Status" 标题冲突直接报错）
 * - closed value 属性（Status）的值必须是 closed value 实体的数字 :db/id，不能传 "Done" 字符串
 * - date 属性（Scheduled/Deadline）的值必须是 journal 页实体的 :db/id
 * - entity-id? 传 true，让桥接层按实体 id 处理（官方 closed value 写入同样如此）
 */
const STATUS_PROP = 'logseq.property/status'
const SCHEDULED_PROP = 'logseq.property/scheduled'

const STATUS_TITLE: Record<string, string> = {
  TODO: 'Todo',
  DOING: 'Doing',
  DONE: 'Done',
}

/** 状态名的各种写法（英文 / 中文）→ marker 匹配用 */
const STATUS_ALIASES: Record<string, string[]> = {
  TODO: ['todo', '待办'],
  DOING: ['doing', '进行中'],
  DONE: ['done', '已完成'],
}

/**
 * 状态选项收集：?s 是 closed value 实体，?v 是可能承载名字的属性。
 * 前两条走 :block/closed-value-property（完整列出该属性的全部选项，含从未使用过的），
 * 后四条与 queries.ts 的状态字典一致（只含已在任务上用过的选项）。
 */
const STATUS_OPTION_QUERIES = [
  '[:find ?s ?v :where [?p :db/ident :logseq.property/status] [?s :block/closed-value-property ?p] [?s :block/title ?v]]',
  '[:find ?s ?v :where [?p :db/ident :logseq.property/status] [?s :block/closed-value-property ?p] [?s :db/ident ?v]]',
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :block/title ?v]]',
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :logseq.property/value ?v]]',
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :db/ident ?v]]',
  '[:find ?s ?v :where [?b :logseq.property/status ?s] [?s :block/name ?v]]',
]

/** upsertBlockProperty 的第四参数（SDK 类型未声明 entity-id?，运行时支持） */
type PropertyOptions = Parameters<typeof logseq.Editor.upsertBlockProperty>[3]
const ENTITY_ID_OPT = { 'entity-id?': true } as unknown as PropertyOptions

/** 双通道执行 datalog（datascriptQuery / q），任一路成功即返回行 */
async function queryRows(query: string): Promise<unknown[][]> {
  const runners: Array<() => Promise<unknown>> = []
  if (logseq.DB?.datascriptQuery) runners.push(() => logseq.DB.datascriptQuery(query))
  if (logseq.DB?.q) runners.push(() => logseq.DB.q(query))
  const errs: string[] = []
  for (const run of runners) {
    try {
      const rows = await run()
      if (Array.isArray(rows)) return rows as unknown[][]
      errs.push(`返回非数组（${typeof rows}）`)
    } catch (e) {
      errs.push(errMsg(e))
    }
  }
  throw new Error(errs.length > 0 ? errs.join(' ｜ ') : 'logseq.DB 上没有可用的查询方法')
}

/** 从结果行里取第一个数字 id（兼容 [[n]] / [{id:n}]） */
function firstId(rows: unknown[][]): number | null {
  for (const row of rows) {
    const v = Array.isArray(row) ? row[0] : row
    if (typeof v === 'number') return v
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const id = o['id'] ?? o['db/id'] ?? o[':db/id']
      if (typeof id === 'number') return id
    }
  }
  return null
}

/** 一个状态选项的所有可比较写法（去命名空间、取小数点后的段、转小写） */
function candidateNames(label: string): string[] {
  const tail = label.includes('/') ? label.slice(label.lastIndexOf('/') + 1) : label
  const cleaned = tail.replace(/^:+/, '').trim().toLowerCase()
  const dot = cleaned.includes('.') ? cleaned.slice(cleaned.lastIndexOf('.') + 1) : ''
  return [...new Set([dot, cleaned].filter(Boolean))]
}

/** 选项与目标 marker 的匹配分：ident 精确段 100，名字精确 100，中文别名 80 */
function scoreLabels(labels: string[], marker: string): number {
  const aliases = STATUS_ALIASES[marker] ?? []
  let best = 0
  for (const label of labels) {
    for (const cand of candidateNames(label)) {
      if (cand === marker.toLowerCase()) best = Math.max(best, 100)
      else if (aliases.includes(cand)) best = Math.max(best, 80)
    }
  }
  return best
}

/** 收集图谱里的状态选项（id → 所有已知写法），用于写状态时反查实体 id */
async function collectStatusOptions(): Promise<Array<{ id: number; labels: string[] }>> {
  const map = new Map<number, string[]>()
  const errs: string[] = []
  for (const query of STATUS_OPTION_QUERIES) {
    let rows: unknown[][]
    try {
      rows = await queryRows(query)
    } catch (e) {
      errs.push(errMsg(e))
      continue
    }
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      const [id, label] = row
      if (typeof id !== 'number' || typeof label !== 'string' || !label) continue
      const labels = map.get(id) ?? []
      if (!labels.includes(label)) labels.push(label)
      map.set(id, labels)
    }
  }
  if (map.size === 0 && errs.length > 0) throw new Error(`状态选项查询失败：${errs[0]}`)
  return [...map.entries()].map(([id, labels]) => ({ id, labels }))
}

/** 解析内置状态 closed value 的实体 id（写 DB 属性必须传实体 id，不能传 "Done" 字符串） */
async function resolveStatusId(marker: 'TODO' | 'DOING' | 'DONE'): Promise<number> {
  const options = await collectStatusOptions()
  let bestId: number | null = null
  let bestScore = 0
  for (const { id, labels } of options) {
    const score = scoreLabels(labels, marker)
    if (score > bestScore) {
      bestScore = score
      bestId = id
    }
  }
  if (bestId !== null) return bestId
  const dump = options.map((o) => `${o.id}=${o.labels.join('|')}`).join('、') || '（没查到任何状态选项）'
  throw new Error(`无法解析状态「${STATUS_TITLE[marker]}」；图谱里的状态选项：${dump}`)
}

/** 解析日志页实体 id；不存在时创建该日期日志页再回查 */
async function resolveJournalPageId(date: string): Promise<number> {
  const day = Number(date.replace(/-/g, ''))
  const query = `[:find ?p :where [?p :block/journal-day ${day}]]`
  let id: number | null = null
  try {
    id = firstId(await queryRows(query))
  } catch {
    id = null
  }
  if (id !== null) return id
  const page = (await logseq.Editor.createJournalPage(date)) as unknown as Record<string, unknown> | null
  const direct = page?.['id']
  if (typeof direct === 'number') return direct
  id = firstId(await queryRows(query))
  if (id !== null) return id
  throw new Error(`无法创建 ${date} 的日志页`)
}

/** 改期：写内置 Scheduled property（值为 journal 页实体 id） */
export async function setScheduledViaProperty(uuid: string, date: string): Promise<string> {
  const pageId = await resolveJournalPageId(date)
  await logseq.Editor.upsertBlockProperty(uuid, SCHEDULED_PROP, pageId, ENTITY_ID_OPT)
  return `upsertBlockProperty('${uuid}', '${SCHEDULED_PROP}', ${pageId})`
}

/** 改期对照实验：追加 SCHEDULED: 内容行（验证 DB 图是否解析内容行；DB 版内容在 title） */
export async function setScheduledViaContent(uuid: string, date: string): Promise<string> {
  const block = await logseq.Editor.getBlock(uuid)
  if (!block) throw new Error(`block ${uuid} not found`)
  const raw = (block as { title?: string; content?: string }).title ?? block.content ?? ''
  const lines = raw.split('\n').filter((l) => !/^\s*SCHEDULED:</.test(l))
  lines.push(`SCHEDULED: <${date}>`)
  await logseq.Editor.updateBlock(uuid, lines.join('\n'))
  return `updateBlock(SCHEDULED: <${date}>)`
}

/** 状态流转：写内置 Status property（值为状态 closed value 的实体 id） */
export async function setMarker(
  uuid: string,
  marker: 'TODO' | 'DOING' | 'DONE',
): Promise<string> {
  if (!uuid) throw new Error('未选择目标任务')
  const statusId = await resolveStatusId(marker)
  await logseq.Editor.upsertBlockProperty(uuid, STATUS_PROP, statusId, ENTITY_ID_OPT)
  return `upsertBlockProperty('${uuid}', '${STATUS_PROP}', ${statusId})`
}

/**
 * 把页面引用解析成页面名。
 * DB 版 pull / getBlock 返回的 :block/page 往往只有 {id}，必须再用 getPage(id) 换取名称。
 */
async function resolvePageName(ref: unknown): Promise<string> {
  if (typeof ref === 'string' && ref) return ref
  if (!ref || typeof ref !== 'object') return ''
  const o = ref as Record<string, unknown>
  const direct = o['originalName'] ?? o['original-name'] ?? o['name'] ?? o['title']
  if (typeof direct === 'string' && direct) return direct
  const id = o['id']
  if (typeof id !== 'number') return ''
  try {
    const page = (await logseq.Editor.getPage(id)) as unknown as Record<string, unknown> | null
    if (!page) return ''
    const name = page['originalName'] ?? page['original-name'] ?? page['name'] ?? page['title']
    return typeof name === 'string' ? name : ''
  } catch {
    return ''
  }
}

/** 跳转到任务所在 block 并关闭主 UI */
export async function jumpToBlock(task: Task): Promise<void> {
  // 优先用 getBlock + getPage 拿到的权威页面名，查询层的 pageName 仅作兜底
  let pageName = ''
  try {
    const block = (await logseq.Editor.getBlock(task.uuid)) as unknown as Record<string, unknown> | null
    pageName = await resolvePageName(block?.['page'])
  } catch {
    /* 读取失败时退回任务自带页面名 */
  }
  if (!pageName) pageName = task.pageName
  if (!pageName) throw new Error(`无法定位任务所在页面（uuid=${task.uuid}）`)
  await logseq.Editor.scrollToBlockInPage(pageName, task.uuid)
  logseq.hideMainUI()
}

/** 番茄记录条目（D2：写入任务 block 的 pomodoro-log property） */
export interface PomodoroEntry {
  ts: number
  minutes: number
  status: 'done' | 'interrupted'
}

/** 追加番茄记录到任务 block（读-改-写，容忍既有值为 JSON 字符串或数组） */
export async function appendPomodoroLog(
  uuid: string,
  entry: PomodoroEntry,
): Promise<void> {
  const block = (await logseq.Editor.getBlock(uuid)) as unknown as
    | { properties?: Record<string, unknown> }
    | null
  if (!block) throw new Error(`block ${uuid} not found`)
  const existing = block.properties?.['pomodoro-log']
  let list: unknown[] = []
  if (Array.isArray(existing)) list = existing
  else if (typeof existing === 'string' && existing.trim()) {
    try {
      const parsed = JSON.parse(existing)
      if (Array.isArray(parsed)) list = parsed
    } catch {
      /* 损坏数据从空列表重建 */
    }
  }
  list = [...list, entry]
  await logseq.Editor.upsertBlockProperty(
    uuid,
    'pomodoro-log',
    JSON.stringify(list),
  )
}

/** 读取 block 当前状态（写入验证用；DB 版含 title/status，文件版含 content/marker） */
export async function readBlock(uuid: string): Promise<Record<string, unknown> | null> {
  if (!uuid) throw new Error('未选择目标任务')
  const b = (await logseq.Editor.getBlock(uuid)) as unknown as Record<string, unknown> | null
  if (!b) return null
  return {
    uuid: b['uuid'],
    title: b['title'],
    content: b['content'],
    status: b['status'],
    marker: b['marker'],
    scheduled: b['scheduled'],
    deadline: b['deadline'],
    'logseq.property/scheduled': b['logseq.property/scheduled'],
    properties: b['properties'],
  }
}
