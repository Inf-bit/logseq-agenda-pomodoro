import { useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import dayjs from 'dayjs'
import type { Task } from '../types'
import { tasksAtom, completedAtom, refreshTasks } from '../stores/tasks'
import { langAtom, weekStartAtom } from '../stores/settings'
import { getT } from '../i18n'
import { jumpToBlock, setMarker, setScheduledViaProperty } from '../data/writer'
import { errMsg } from '../data/queries'
import { pomStart } from '../stores/pomodoro'

type ColumnId = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

/** 本周最后一天（遵循 weekStart 设置：1=周一启→周日止；0=周日启→周六止） */
function weekEndStr(weekStart: 0 | 1): string {
  const today = dayjs()
  const dow = today.day() // 0=周日
  const daysToWeekEnd = weekStart === 1 ? (7 - dow) % 7 : 6 - dow
  return today.add(daysToWeekEnd, 'day').format('YYYY-MM-DD')
}

interface Column {
  id: ColumnId
  title: string
  accent: string
}

function dateOf(t: Task): string | null {
  return t.scheduled ?? t.deadline
}

function columnOf(t: Task, weekEnd: string): ColumnId {
  const today = dayjs()
  const d = dateOf(t)
  if (d === null) return 'none'
  if (d < today.format('YYYY-MM-DD')) return 'overdue'
  if (d === today.format('YYYY-MM-DD')) return 'today'
  if (d === today.add(1, 'day').format('YYYY-MM-DD')) return 'tomorrow'
  if (d <= weekEnd) return 'week'
  return 'later'
}

function targetDate(col: ColumnId, weekEnd: string): string | null {
  const today = dayjs()
  switch (col) {
    case 'overdue':
      return today.subtract(1, 'day').format('YYYY-MM-DD')
    case 'today':
      return today.format('YYYY-MM-DD')
    case 'tomorrow':
      return today.add(1, 'day').format('YYYY-MM-DD')
    case 'week':
      return weekEnd
    case 'later':
      return dayjs(weekEnd).add(1, 'day').format('YYYY-MM-DD')
    default:
      return null
  }
}

function Card({
  task,
  group,
}: {
  task: Task
  /** 有子任务时提供折叠开关 */
  group?: { open: boolean; toggle: () => void; count: number }
}): JSX.Element {
  const lang = useAtomValue(langAtom)
  const t = getT(lang)
  const done = async (): Promise<void> => {
    try {
      await setMarker(task.uuid, 'DONE')
      await refreshTasks()
    } catch (e) {
      void logseq.UI.showMsg(`${t('done')} 失败：${errMsg(e)}`, 'error')
    }
  }
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.uuid)}
      className="rounded border border-slate-200 bg-white px-2 py-1.5 text-sm cursor-grab shadow-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
    >
      <div className="flex items-center gap-1">
        {group && (
          <button
            className="shrink-0 text-[10px] w-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            onClick={group.toggle}
            title={group.open ? (lang === 'zh' ? '折叠' : 'Collapse') : lang === 'zh' ? '展开' : 'Expand'}
          >
            {group.open ? '▾' : '▸'}
          </button>
        )}
        <span
          className="text-[10px] font-mono px-1 rounded bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-300 max-w-[6rem] truncate"
          title={task.statusLabel ?? task.marker}
        >
          {task.statusLabel ?? task.marker}
        </span>
        <button
          className="flex-1 text-left truncate hover:underline"
          title={`${task.content}（${task.pageName}）`}
          onClick={() => void jumpToBlock(task)}
        >
          {task.content}
        </button>
        <button
          className="text-xs text-emerald-600 hover:text-emerald-700"
          title={t('done')}
          onClick={() => void done()}
        >
          ✓
        </button>
        <button
          className="text-xs text-red-500 hover:text-red-600"
          title={lang === 'zh' ? '番茄钟' : 'Pomodoro'}
          onClick={() => pomStart(task.uuid, task.content)}
        >
          🍅
        </button>
      </div>
      {dateOf(task) && (
        <div className="text-[10px] text-slate-400 mt-0.5">
          {task.scheduled ? `📅 ${task.scheduled}` : `⏰ ${task.deadline}`} · {task.pageName}
        </div>
      )}
    </div>
  )
}

/** 已完成卡片：只读，不可拖动，划线展示；有子任务时带折叠开关 */
function DoneCard({
  task,
  group,
}: {
  task: Task
  group?: { open: boolean; toggle: () => void; count: number }
}): JSX.Element {
  const lang = useAtomValue(langAtom)
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm opacity-70 dark:border-slate-600 dark:bg-slate-700/50">
      <div className="flex items-center gap-1">
        {group && (
          <button
            className="shrink-0 text-[10px] w-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            onClick={group.toggle}
            title={group.open ? (lang === 'zh' ? '折叠' : 'Collapse') : lang === 'zh' ? '展开' : 'Expand'}
          >
            {group.open ? '▾' : '▸'}
          </button>
        )}
        <span className="text-[10px] shrink-0 text-emerald-600 dark:text-emerald-400">
          {task.marker === 'CANCELED' ? '✕' : '✓'}
        </span>
        <button
          className="flex-1 text-left truncate line-through hover:underline"
          title={`${task.content}（${task.pageName}）`}
          onClick={() => void jumpToBlock(task)}
        >
          {task.content}
        </button>
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">
        {task.completedAt ?? '—'} · {task.pageName}
      </div>
    </div>
  )
}

/** 父任务 + 子任务的折叠组（看板列内） */
function CardGroup({ task, children }: { task: Task; children: Task[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="space-y-1">
      <Card task={task} group={{ open, toggle: () => setOpen((v) => !v), count: children.length }} />
      {open && (
        <div className="space-y-1 ml-3 pl-1.5 border-l-2 border-slate-200 dark:border-slate-600">
          {children.map((c) => (
            <Card key={c.uuid} task={c} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 已完成分组：父完成卡 + 折叠的子完成卡 */
function DoneGroup({ task, children }: { task: Task; children: Task[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="space-y-1">
      <DoneCard task={task} group={{ open, toggle: () => setOpen((v) => !v), count: children.length }} />
      {open && (
        <div className="space-y-1 ml-3 pl-1.5 border-l-2 border-slate-200 dark:border-slate-600">
          {children.map((c) => (
            <DoneCard key={c.uuid} task={c} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 已完成时间段：今日 / 近 7 天 / 近 30 天 / 全部 */
type DoneRange = 'today' | '7d' | '30d' | 'all'

export default function KanbanView(): JSX.Element {
  const tasks = useAtomValue(tasksAtom)
  const completed = useAtomValue(completedAtom)
  const lang = useAtomValue(langAtom)
  const weekStart = useAtomValue(weekStartAtom)
  const t = getT(lang)
  const weekEnd = weekEndStr(weekStart)
  const [doneRange, setDoneRange] = useState<DoneRange>('today')

  /** 按完成日期过滤（completedAt 为 YYYY-MM-DD；缺失的仅在「全部」里显示） */
  const doneFiltered = useMemo(() => {
    if (doneRange === 'all') return completed
    const since =
      doneRange === 'today'
        ? dayjs().format('YYYY-MM-DD')
        : dayjs().subtract(doneRange === '7d' ? 6 : 29, 'day').format('YYYY-MM-DD')
    return completed.filter((x) => x.completedAt != null && x.completedAt >= since)
  }, [completed, doneRange])

  const columns: Column[] = [
    { id: 'overdue', title: t('kanbanOverdue'), accent: 'border-t-red-400' },
    { id: 'today', title: t('kanbanToday'), accent: 'border-t-blue-400' },
    { id: 'tomorrow', title: t('kanbanTomorrow'), accent: 'border-t-cyan-400' },
    { id: 'week', title: t('kanbanThisWeek'), accent: 'border-t-indigo-400' },
    { id: 'later', title: t('kanbanLater'), accent: 'border-t-purple-400' },
    { id: 'none', title: t('kanbanNoDate'), accent: 'border-t-slate-300' },
  ]

  const byCol = useMemo(() => {
    const m = new Map<ColumnId, Task[]>([
      ['overdue', []],
      ['today', []],
      ['tomorrow', []],
      ['week', []],
      ['later', []],
      ['none', []],
    ])
    // 父任务与子任务同列时折叠到父任务下；不在同一列则各自平铺，避免任务丢失
    const byId = new Map(tasks.map((x) => [x.uuid, x]))
    for (const x of tasks) {
      const col = columnOf(x, weekEnd)
      const parent = x.parentUuid ? byId.get(x.parentUuid) : undefined
      if (parent && parent.uuid !== x.uuid && columnOf(parent, weekEnd) === col) continue
      m.get(col)!.push(x)
    }
    return m
  }, [tasks, weekEnd])

  const childrenOf = (uuid: string): Task[] =>
    tasks.filter((x) => x.parentUuid === uuid && x.uuid !== uuid)

  /** 已完成列按父子关系折叠（父任务也在已完成列表时才折叠） */
  const doneGrouped = useMemo(() => {
    const ids = new Set(doneFiltered.map((x) => x.uuid))
    const children = new Map<string, Task[]>()
    const nested = new Set<string>()
    for (const x of doneFiltered) {
      if (x.parentUuid && ids.has(x.parentUuid) && x.uuid !== x.parentUuid) {
        nested.add(x.uuid)
        const arr = children.get(x.parentUuid) ?? []
        arr.push(x)
        children.set(x.parentUuid, arr)
      }
    }
    return { roots: doneFiltered.filter((x) => !nested.has(x.uuid)), children }
  }, [doneFiltered])

  const onDrop = async (col: ColumnId, e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    const uuid = e.dataTransfer.getData('text/plain')
    if (!uuid) return
    const date = targetDate(col, weekEnd)
    try {
      if (date === null) {
        // 拖入"无日期"：暂无移除日期的 API，提示用户手动处理
        void logseq.UI.showMsg(
          lang === 'zh' ? '暂不支持拖入无日期列移除日期' : 'Removing date by drag is not supported yet',
          'warning',
        )
        return
      }
      await setScheduledViaProperty(uuid, date)
      await refreshTasks()
    } catch (err) {
      void logseq.UI.showMsg(`改期失败：${errMsg(err)}`, 'error')
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 h-full">
      {columns.map((col) => (
        <div
          key={col.id}
          className="flex-1 min-w-[13rem] rounded border border-slate-200 border-t-4 bg-slate-50 p-2 flex flex-col dark:border-slate-700 dark:bg-slate-800/60"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => void onDrop(col.id, e)}
        >
          <h3 className="font-bold text-sm mb-2 dark:text-slate-100">
            {col.title}
            <span className="ml-1 text-xs font-normal text-slate-400">
              {byCol.get(col.id)!.length}
            </span>
          </h3>
          <div
            className={`flex-1 space-y-2 overflow-y-auto rounded ${col.accent} border-t-0`}
          >
            {byCol.get(col.id)!.map((x) => {
              const kids = childrenOf(x.uuid)
              return kids.length > 0 ? (
                <CardGroup key={x.uuid} task={x} children={kids} />
              ) : (
                <Card key={x.uuid} task={x} />
              )
            })}
          </div>
        </div>
      ))}

      {/* 已完成：只读列，按完成日期倒序 */}
      <div className="flex-1 min-w-[13rem] rounded border border-slate-200 border-t-4 border-t-emerald-300 bg-slate-50 p-2 flex flex-col dark:border-slate-700 dark:bg-slate-800/60">
        <h3 className="font-bold text-sm mb-2 dark:text-slate-100">
          {lang === 'zh' ? '已完成' : 'Done'}
          <span className="ml-1 text-xs font-normal text-slate-400">{doneFiltered.length}</span>
        </h3>
        <div className="flex flex-wrap gap-1 mb-2">
          {(
            [
              ['today', lang === 'zh' ? '今日' : 'Today'],
              ['7d', lang === 'zh' ? '近7天' : '7 days'],
              ['30d', lang === 'zh' ? '近30天' : '30 days'],
              ['all', lang === 'zh' ? '全部' : 'All'],
            ] as Array<[DoneRange, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                doneRange === id
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700'
              }`}
              onClick={() => setDoneRange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {doneGrouped.roots.map((x) => {
            const kids = doneGrouped.children.get(x.uuid)
            return kids && kids.length > 0 ? (
              <DoneGroup key={x.uuid} task={x} children={kids} />
            ) : (
              <DoneCard key={x.uuid} task={x} />
            )
          })}
        </div>
      </div>
    </div>
  )
}
