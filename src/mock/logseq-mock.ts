/**
 * 浏览器开发模式的 logseq API mock（DB 版任务模型，2026-10 调研对齐）：
 * - 任务 = #Task 标签 block，状态在 status（Status property）
 * - status 刻意混合三种 pull 形态（closed value map / ident 字符串 / 纯字符串），
 *   scheduled/deadline 混合 journal 页 map / number / properties 内 object，
 *   用于验证 taskMapper 的防御式归一化
 * - Editor 写操作真实变更内存库（upsertBlockProperty 写 status/scheduled）
 * - window.__mock 暴露测试钩子（setTheme / emitDbChange）
 * 仅由 dev-main.tsx 引入，不进入生产构建。
 */
import type { TaskEntity } from '../types'

interface MockBlock extends TaskEntity {
  title?: string
  content?: string
  status?: unknown
  /** 真实 pull 会保留命名空间并带前导冒号 */
  ':logseq.property/status'?: unknown
  marker?: string
  tags?: string[]
}

const today = new Date()
const fmt = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (days: number): string => fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days))
const num = (dateStr: string): number => Number(dateStr.replace(/-/g, ''))

const T = shift(0)
const TN = num(T)
/** journal 页引用形态（date 类型属性的值） */
const jpage = (dateStr: string): Record<string, unknown> => ({
  'journal-day': num(dateStr),
  name: 'mock journal',
})

function page(name: string, journal = false): TaskEntity['page'] {
  return {
    name,
    'original-name': name,
    'journal-day': journal ? TN : undefined,
    'journal?': journal,
  }
}

/** closed value 实体形态（:logseq.property/status 的 pull 结果之一） */
const cv = (v: string): Record<string, unknown> => ({
  'db/ident': `:logseq.task.status/${v}`,
  'logseq.property/value': v,
})

/** 真实环境里 status 引用常只有 {id}：模拟 id → 状态文字字典 */
const MOCK_STATUS_BY_ID = new Map<number, string>([
  // 76 = Backlog（中文界面叫「待办列表」）
  [76, 'Backlog'],
  [77, 'Doing'],
  [78, 'Backlog'],
  [79, 'In Review'],
  [80, 'Done'],
  [81, 'Canceled'],
  [82, '待办列表'],
])

// 内存任务库：形态刻意混合
const blocks: MockBlock[] = [
  {
    uuid: 'mock-uuid-1',
    title: '写周报\n一些细节',
    status: cv('Doing'), // closed value map 形态
    tags: ['Task'],
    scheduled: jpage(T), // journal 页 map 形态，今日
    page: page('work', true),
  },
  {
    uuid: 'mock-uuid-2',
    title: '修复登录 bug',
    status: 'Todo', // 纯字符串形态
    tags: ['Task'],
    scheduled: num(shift(-2)), // number 形态，逾期
    page: page('projects/app'),
  },
  {
    uuid: 'mock-uuid-3',
    title: '给老板发汇报邮件',
    status: ':logseq.task.status/Todo', // ident 字符串形态
    tags: ['Task'],
    deadline: jpage(T), // 今日 deadline
    page: { id: 914 }, // 未展开页面引用：验证 page 字典补全
  },
  {
    uuid: 'mock-uuid-4',
    title: '预约牙医',
    status: 'Backlog',
    tags: ['Task'],
    properties: { scheduled: shift(1) }, // properties 内 string，明天
    page: page('private'),
  },
  {
    uuid: 'mock-uuid-5',
    title: '读书笔记：《卡片笔记》',
    ':logseq.property/status': 'In Review', // 真实键名形态（带命名空间+冒号）
    tags: ['Task'],
    scheduled: jpage(shift(3)),
    page: page('reading'),
  },
  {
    uuid: 'mock-uuid-6',
    title: '续费域名',
    ':logseq.property/status': { title: 'Todo' }, // 展开的 closed value
    tags: ['Task'],
    scheduled: jpage(shift(12)),
    page: page('private'),
  },
  {
    uuid: 'mock-uuid-7',
    title: '调研 websocket 库',
    status: 'Todo',
    tags: ['Task'],
    page: page('projects/app'),
  },
  {
    uuid: 'mock-uuid-8',
    title: '等设计稿',
    status: '待办列表', // 同一 Status 属性的另一种中文取值
    tags: ['Task'],
    page: page('projects/app'),
  },
  {
    uuid: 'mock-uuid-9',
    title: '提交报销单',
    status: 'Todo',
    tags: ['Task'],
    deadline: num(shift(-9)), // number 形态，逾期 deadline
    page: page('work', true),
  },
  {
    uuid: 'mock-uuid-10',
    title: '计划下个月 sprint',
    status: 'Todo',
    tags: ['Task'],
    properties: { scheduled: { date: shift(4) } }, // properties 内 object
    page: page('work'),
  },
  // 今日已完成（今日 journal 页上）：status 只有 {id}，只能靠状态字典补全
  {
    uuid: 'mock-uuid-11',
    title: '晨间回顾',
    ':logseq.property/status': { id: 80 },
    tags: ['Task'],
    page: page('work', true),
    'updated-at': today.getTime(), // 完成日期 = 今天
  },
  {
    uuid: 'mock-uuid-12',
    title: '回复客户邮件',
    status: { id: 81 },
    tags: ['Task'],
    page: page('work', true),
    'updated-at': today.getTime() - 3 * 86400_000, // 完成于 3 天前：应归到那一天
  },
  // status 引用未展开（{id}）的形态：应通过状态字典解析（缺失时才回退 TODO）
  {
    uuid: 'mock-uuid-14',
    title: '验证未展开状态引用',
    ':logseq.property/status': { id: 76 },
    tags: ['Task'],
    page: page('private'),
  },
  // 只有 status、没有 #Task 标签的条目（模拟状态菜单里的「待办列表」）
  {
    uuid: 'mock-uuid-15',
    title: '本周要跟进的三件事',
    ':logseq.property/status': { id: 82 },
    page: page('work'),
  },
  // 「待办列表」mock-uuid-14 的两个子任务（parent 指向列表 block 的数字 id 900）
  {
    uuid: 'mock-uuid-16',
    title: '调研实时流式识别的原理',
    status: 'Todo',
    tags: ['Task'],
    parent: { id: 900 },
    page: page('work'),
  },
  {
    uuid: 'mock-uuid-17',
    title: '整理识别结果对比表',
    status: 'Todo',
    tags: ['Task'],
    parent: { id: 900 },
    page: page('work'),
  },
  // 今日 journal 页上的非任务 block（fetchDoneToday 应过滤掉）
  {
    uuid: 'mock-uuid-13',
    title: '只是普通笔记',
    page: page('work', true),
  },
]

/** mock 内部状态归一化：取 status 显示值（兼容普通键、真实键名与未展开的 {id}） */
function statusValue(b: MockBlock): string | null {
  const s = b.status ?? b[':logseq.property/status']
  if (s == null) return null
  if (typeof s === 'string') return s
  if (typeof s === 'object' && !Array.isArray(s)) {
    const o = s as Record<string, unknown>
    const v = o['logseq.property/value'] ?? o['title']
    if (typeof v === 'string') return v
    const id = o['id']
    if (typeof id === 'number') return MOCK_STATUS_BY_ID.get(id) ?? null
    return null
  }
  return null
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

const dbChangedCbs: Array<() => void> = []
const themeCb: { cb?: (e: { mode: 'dark' | 'light' }) => void } = {}
const eventCbs = new Map<string, Array<(payload: unknown) => void>>()
let dbGraphFlag = true

const settingsStore: Record<string, unknown> = {}

const logseqMock = {
  settings: settingsStore,
  ready(cb: () => void): Promise<void> {
    return Promise.resolve().then(cb)
  },
  showMainUI(): void {
    console.log('[mock] showMainUI')
  },
  hideMainUI(): void {
    console.log('[mock] hideMainUI')
  },
  provideModel(): void {
    /* noop */
  },
  useSettingsSchema(): void {
    /* noop */
  },
  updateSettings(attrs: Record<string, unknown>): void {
    Object.assign(settingsStore, attrs)
    console.log('[mock] updateSettings', attrs)
  },
  on(name: string, cb: (payload: unknown) => void): void {
    const list = eventCbs.get(name) ?? []
    list.push(cb)
    eventCbs.set(name, list)
  },
  App: {
    registerUIItem(): void {
      /* noop */
    },
    // registerCommandPalette 属于 App 命名空间（与 src/main.tsx 对齐）
    registerCommandPalette(): void {
      /* noop */
    },
    checkCurrentIsDbGraph(): Promise<boolean> {
      return Promise.resolve(dbGraphFlag)
    },
    onThemeModeChanged(cb: (e: { mode: 'dark' | 'light' }) => void): void {
      themeCb.cb = cb
    },
  },
  Editor: {
    getBlock(uuid: string): Promise<MockBlock | null> {
      return Promise.resolve(clone(blocks.find((b) => b.uuid === uuid) ?? null))
    },
    getCurrentBlock(): Promise<MockBlock | null> {
      return Promise.resolve(clone(blocks[1] ?? null))
    },
    updateBlock(uuid: string, content: string): Promise<void> {
      const b = blocks.find((x) => x.uuid === uuid)
      if (!b) return Promise.reject(new Error(`block ${uuid} not found`))
      b.title = content
      console.log('[mock] updateBlock', uuid)
      return Promise.resolve()
    },
    upsertBlockProperty(uuid: string, key: string, value: unknown): Promise<void> {
      const b = blocks.find((x) => x.uuid === uuid)
      if (!b) return Promise.reject(new Error(`block ${uuid} not found`))
      if (key === 'logseq.property/status') {
        // DB 版真实写法：值为 closed value 实体 id；mock 转回状态文字
        const text = typeof value === 'number' ? (MOCK_STATUS_BY_ID.get(value) ?? String(value)) : String(value)
        if (':logseq.property/status' in b) b[':logseq.property/status'] = text
        else b.status = text
      } else if (key === 'logseq.property/scheduled') {
        // DB 版真实写法：值为 journal 页实体 id；mock 只知道今天的日志页
        b.scheduled = typeof value === 'number' ? jpage(T) : value
      } else {
        b.properties = { ...(b.properties ?? {}), [key]: value }
        if (key === 'scheduled' || key === 'deadline') {
          ;(b as unknown as Record<string, unknown>)[key] = value
        }
      }
      console.log('[mock] upsertBlockProperty', uuid, key, value)
      return Promise.resolve()
    },
    getPage(id: number | string): Promise<Record<string, unknown> | null> {
      if (id === 914) {
        return Promise.resolve({ id: 914, name: 'work', originalName: 'work', title: 'work', journalDay: TN })
      }
      return Promise.resolve(null)
    },
    createJournalPage(date: string): Promise<Record<string, unknown> | null> {
      return Promise.resolve({ id: 914, name: date, originalName: date, journalDay: num(date) })
    },
    getAllTags(): Promise<unknown[]> {
      return Promise.resolve([
        { id: 170, name: 'task', title: 'Task', ident: ':logseq.class/Task' },
        { id: 171, name: '待办', title: '待办', ident: ':user.class/待办' },
        { id: 172, name: '待办列表', title: '待办列表', ident: ':user.class/待办列表' },
        { id: 173, name: 'project', title: 'Project', ident: ':user.class/project' },
      ])
    },
    getAllProperties(): Promise<unknown[]> {
      return Promise.resolve([
        { id: 60, name: 'status', title: 'Status', ident: ':logseq.property/status' },
        { id: 61, name: 'scheduled', title: 'Scheduled', ident: ':logseq.property/scheduled' },
        { id: 62, name: 'deadline', title: 'Deadline', ident: ':logseq.property/deadline' },
        { id: 63, name: 'pomodoro-log', title: 'Pomodoro Log', ident: ':user.property/pomodoro-log' },
      ])
    },
    scrollToBlockInPage(pageName: string, blockId: string): Promise<void> {
      console.log('[mock] scrollToBlockInPage', pageName, blockId)
      return Promise.resolve()
    },
  },
  DB: {
    datascriptQuery(query: string): Promise<unknown> {
      // ── 写入辅助：状态选项列表 / 日志页 id ──
      if (query.includes(':block/closed-value-property')) {
        if (query.includes('[?s :db/ident ?v]')) {
          return Promise.resolve(
            [...MOCK_STATUS_BY_ID.entries()].map(([id, v]) => [id, `:logseq.task.status/${v.replace(/\s/g, '-')}`]),
          )
        }
        return Promise.resolve([...MOCK_STATUS_BY_ID.entries()].map(([id, v]) => [id, v]))
      }
      if (query.includes(':find ?p :where') && query.includes('[?p :block/journal-day ')) {
        return Promise.resolve([[914]])
      }
      // ── 引用字典（必须最先路由，名字与下面的任务查询有重叠） ──
      if (query.includes('[?s :block/title ?v]')) {
        return Promise.resolve([...MOCK_STATUS_BY_ID.entries()].map(([id, v]) => [id, v]))
      }
      if (query.includes('[?s :block/name ?v]') || query.includes('[?s :logseq.property/value ?v]') || query.includes('[?s :db/ident ?v]')) {
        return Promise.resolve([])
      }
      if (query.includes('[?p :block/title ?n]')) {
        return Promise.resolve([[914, 'work']])
      }
      if (query.includes('[?p :block/name ?n]')) {
        return Promise.resolve([])
      }
      if (query.includes('[?p :block/journal-day ?d]')) {
        return Promise.resolve([[914, TN]])
      }
      const tasks = blocks.filter((b) => b.tags?.includes('Task'))
      const open = tasks.filter((b) => !['Done', 'Canceled'].includes(statusValue(b) ?? ''))
      const doneToday = blocks.filter(
        (b) => b.page?.['journal-day'] === TN && ['Done', 'Canceled'].includes(statusValue(b) ?? ''),
      )
      // 计数（诊断①）
      if (query.includes('count ?b') && query.includes(':logseq.property/scheduled')) {
        return Promise.resolve([[open.filter((b) => b.scheduled != null || b.properties?.['scheduled'] != null).length]])
      }
      if (query.includes('count ?b') && query.includes(':logseq.property/deadline')) {
        return Promise.resolve([[open.filter((b) => b.deadline != null || b.properties?.['deadline'] != null).length]])
      }
      if (query.includes('count ?b')) {
        return Promise.resolve([[open.length]])
      }
      // 今日 journal 页全部 block（fetchDoneToday）——注意只匹配 :where 子句
      // （主查询的 pull 表达式也含 :block/journal-day，不能按 includes 路由）
      if (query.includes('[?p :block/journal-day')) {
        const m = query.match(/:block\/journal-day\s+(\d{8})/)
        const jd = m ? Number(m[1]) : TN
        return Promise.resolve(clone(blocks.filter((b) => b.page?.['journal-day'] === jd)).map((b) => [b]))
      }
      // status 实体原始三元组（诊断⑨ 新增）
      if (query.includes('[?s ?a ?v]')) {
        return Promise.resolve([])
      }
      // 按 uuid 读取单个 block（诊断⑩）
      if (query.includes(':block/uuid #uuid')) {
        const m = query.match(/#uuid\s+"([^"]+)"/)
        const hit = m ? blocks.find((b) => b.uuid === m[1]) : undefined
        return Promise.resolve(hit ? [[clone(hit)]] : [])
      }
      // 按数字实体 id 读取（诊断⑩：查 status 值 76 是什么）
      if (query.includes(':db/id')) {
        const m = query.match(/:db\/id\s+(\d+)/)
        const id = m ? Number(m[1]) : 0
        return Promise.resolve([
          [{ id, title: '待办列表', 'closed-value-property': [{ id: 75 }], page: { id: 75 } }],
        ])
      }
      // 父 block 字典（折叠分组：parent id → uuid / title）
      if (query.includes(':block/parent ?p] [?p :block/uuid')) {
        return Promise.resolve([[900, 'mock-uuid-14']])
      }
      if (query.includes(':block/parent ?p] [?p :block/title')) {
        return Promise.resolve([[900, '验证未展开状态引用']])
      }
      // status 实体全属性（诊断⑨ 新增）
      if (query.includes('pull ?v [*]')) {
        return Promise.resolve([...MOCK_STATUS_BY_ID.entries()].map(([id, v]) => [{ id, title: v }]))
      }
      // 已完成任务全属性样本（诊断⑨）
      if (query.includes('pull ?b [*]') && query.includes(':logseq.property/status')) {
        return Promise.resolve(
          clone(blocks.filter((b) => ['Done', 'Canceled'].includes(statusValue(b) ?? ''))).map((b) => [b]),
        )
      }
      // 原始抽样（诊断②）
      if (query.includes('pull ?b [*]')) {
        return Promise.resolve(clone(blocks.slice(0, 3)).map((b) => [b]))
      }
      // 策略1：Task 标签 → 全部任务（含 Done，stores 侧过滤开放态）
      if (query.includes(':logseq.class/Task')) {
        return Promise.resolve(clone(tasks).map((b) => [b]))
      }
      // 策略2：status 属性
      if (query.includes(':logseq.property/status')) {
        return Promise.resolve(
          clone(blocks.filter((b) => b.status != null || b[':logseq.property/status'] != null)).map((b) => [b]),
        )
      }
      // 策略3：文件版 marker 兜底
      if (query.includes(':block/marker')) {
        return Promise.resolve(clone(blocks.filter((b) => b.marker != null)).map((b) => [b]))
      }
      return Promise.resolve(clone(open).map((b) => [b]))
    },
    onChanged(cb: () => void): void {
      dbChangedCbs.push(cb)
    },
  },
  UI: {
    showMsg(content: string, status?: string): Promise<string> {
      console.log(`[mock] showMsg(${status ?? 'info'})`, content)
      return Promise.resolve('mock-key')
    },
  },
}

;(window as unknown as Record<string, unknown>).logseq = logseqMock

// 测试钩子：浏览器控制台可用
;(window as unknown as Record<string, unknown>).__mock = {
  emitDbChange(): void {
    dbChangedCbs.forEach((cb) => cb())
  },
  setTheme(mode: 'dark' | 'light'): void {
    themeCb.cb?.({ mode })
  },
  setDbGraph(isDb: boolean): void {
    dbGraphFlag = isDb
  },
  blocks,
}

console.log('[mock] logseq API（DB 版任务模型）已安装，window.__mock 可用（emitDbChange / setTheme）')
