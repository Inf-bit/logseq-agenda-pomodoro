/**
 * Datalog 查询返回的原始 block entity。
 * 注意：datascript pull 返回的 JS key 与 Clojure keyword 的对应关系并不统一——
 * :block/title → "title"、:block/page → "page"（去掉了 block/ 前缀），
 * 但 :logseq.property/status → ":logseq.property/status"（保留命名空间并带冒号）。
 * 因此所有属性读取都走 taskMapper 的 prop() 多键兼容，不要直接点号访问。
 */
export interface TaskEntity {
  uuid?: string
  /** :block/title（DB 版第一行内容） */
  title?: string
  /** 文件版内容（DB 版已改名为 title） */
  content?: string
  /** 文件版 marker（TODO/DOING...） */
  marker?: string
  /** DB 版 :logseq.property/status 的 pull 结果（展开后通常是 {title: "Todo"}） */
  status?: unknown
  scheduled?: unknown
  deadline?: unknown
  properties?: Record<string, unknown> | null
  tags?: unknown
  /** DB 版 pull 的 :block/page 通常只有 {id}，需再查字典补全 */
  page?: {
    id?: number
    name?: string
    'original-name'?: string
    title?: string
    'journal-day'?: number
    'journal?'?: boolean
    [key: string]: unknown
  }
  /** DB 版 pull 的 :block/parent 通常只有 {id}，由 queries 补成 parentUuid / parentTitle */
  parent?: {
    id?: number
    [key: string]: unknown
  }
  parentUuid?: string | null
  parentTitle?: string | null
  /** 其余 pull 属性（含带命名空间的键） */
  [key: string]: unknown
}

/** 归一化后的任务视图模型 */
export interface Task {
  uuid: string
  content: string // 首行、去掉 marker
  marker: string
  /** 原始状态文字（待办 / 待办列表 / Doing…）；界面优先显示它，用于区分同属性的不同状态值 */
  statusLabel: string | null
  scheduled: string | null // YYYY-MM-DD
  deadline: string | null // YYYY-MM-DD
  /** 完成日期（仅 DONE/CANCELED）：DB 版无完成时间属性，取 updated-at，缺失时退回所在 journal 页日期 */
  completedAt: string | null
  pageName: string
  isJournalPage: boolean
  /** 父 block 的 uuid（用于把子任务折叠到所属父任务下）；无父 block 时为 null */
  parentUuid: string | null
  /** 父 block 的标题（分组展示用，可缺失） */
  parentTitle: string | null
}
