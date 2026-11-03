export type Lang = 'zh' | 'en'

const dict = {
  zh: {
    today: '今日',
    month: '月历',
    kanban: '看板',
    diagnostics: '诊断 (M1)',
    close: '✕ 关闭',
    refresh: '刷新',
    doing: '进行中',
    dueToday: '今日',
    overdue: '逾期',
    backlog: 'Backlog · 无日期',
    empty: '（空）',
    done: '完成',
    scheduleToday: '排到今天',
    reschedule: '改期',
    scheduleTo: '排期',
    totalTasks: (n: number) => `共 ${n} 个 open 任务`,
    updatedAt: (t: string) => `更新于 ${t}`,
    queryFailed: '查询失败',
    notDbGraphTitle: '此插件仅支持 DB 版图谱',
    notDbGraphBody:
      '当前图谱是旧版文件图谱（OG）。请将图谱迁移为 Logseq DB 版（2.x）后使用，或切换到 DB 图谱。',
    kanbanOverdue: '逾期',
    kanbanToday: '今天',
    kanbanTomorrow: '明天',
    kanbanThisWeek: '本周',
    kanbanLater: '以后',
    kanbanNoDate: '无日期',
    taskOf: (page: string) => `@${page}`,
  },
  en: {
    today: 'Today',
    month: 'Month',
    kanban: 'Kanban',
    diagnostics: 'Diagnostics (M1)',
    close: '✕ Close',
    refresh: 'Refresh',
    doing: 'Doing',
    dueToday: 'Today',
    overdue: 'Overdue',
    backlog: 'Backlog · no date',
    empty: '(empty)',
    done: 'Done',
    scheduleToday: 'Schedule today',
    reschedule: 'Reschedule',
    scheduleTo: 'Schedule',
    totalTasks: (n: number) => `${n} open tasks`,
    updatedAt: (t: string) => `updated at ${t}`,
    queryFailed: 'Query failed',
    notDbGraphTitle: 'DB graph required',
    notDbGraphBody:
      'This graph is a legacy file-based (OG) graph. Please migrate to a Logseq DB graph (2.x) or switch to one.',
    kanbanOverdue: 'Overdue',
    kanbanToday: 'Today',
    kanbanTomorrow: 'Tomorrow',
    kanbanThisWeek: 'This week',
    kanbanLater: 'Later',
    kanbanNoDate: 'No date',
    taskOf: (page: string) => `@${page}`,
  },
} as const

type Dict = typeof dict.zh

export function getT(lang: Lang): (key: keyof Dict) => string {
  return (key) => dict[lang][key] as unknown as string
}

/** 带参数的文案 */
export function tf(
  lang: Lang,
  key: keyof Dict,
  ...args: unknown[]
): string {
  const fn = dict[lang][key] as unknown as (...a: unknown[]) => string
  return typeof fn === 'function' ? fn(...args) : String(fn)
}
