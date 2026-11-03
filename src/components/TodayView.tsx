import { useState } from 'react'
import { useAtomValue } from 'jotai'
import type { Task } from '../types'
import {
  doneTodayAtom,
  lastLoadedAtAtom,
  loadErrorAtom,
  loadStateAtom,
  refreshTasks,
  tasksAtom,
} from '../stores/tasks'
import { jumpToBlock, setMarker, setScheduledViaProperty } from '../data/writer'
import { errMsg } from '../data/queries'
import { pomStart } from '../stores/pomodoro'
import { todayStr } from '../utils/date'
import { BUILD_TAG } from '../build-tag'
import PomodoroBar from './PomodoroBar'
import { langAtom } from '../stores/settings'
import { getT, tf } from '../i18n'

function badgeClass(marker: string): string {
  switch (marker) {
    case 'DOING':
    case 'NOW':
      return 'bg-blue-100 text-blue-700'
    case 'WAITING':
      return 'bg-amber-100 text-amber-700'
    default:
      return 'bg-slate-200 text-slate-600'
  }
}

function dateOf(t: Task): string | null {
  return t.scheduled ?? t.deadline
}

function TaskCard({
  task,
  showSchedule,
  group,
}: {
  task: Task
  showSchedule?: boolean
  /** 「待办列表」条目：提供折叠开关与子任务数量 */
  group?: { open: boolean; toggle: () => void; count: number }
}): JSX.Element {
  const lang = useAtomValue(langAtom)
  const t = getT(lang)
  const done = async (): Promise<void> => {
    try {
      await setMarker(task.uuid, 'DONE')
      await refreshTasks()
    } catch (e) {
      void logseq.UI.showMsg(`${t('done')}: ${errMsg(e)}`, 'error')
    }
  }
  const scheduleToday = async (): Promise<void> => {
    try {
      await setScheduledViaProperty(task.uuid, todayStr())
      await refreshTasks()
    } catch (e) {
      void logseq.UI.showMsg(`${t('scheduleToday')}: ${errMsg(e)}`, 'error')
    }
  }
  const jump = async (): Promise<void> => {
    try {
      await jumpToBlock(task)
    } catch (e) {
      void logseq.UI.showMsg(errMsg(e), 'error')
    }
  }

  const d = dateOf(task)
  return (
    <li className="flex items-center gap-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2">
      {group && (
        <button
          className="shrink-0 text-xs w-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          onClick={group.toggle}
          title={group.open ? (lang === 'zh' ? '折叠' : 'Collapse') : lang === 'zh' ? '展开' : 'Expand'}
        >
          {group.open ? '▾' : '▸'}
        </button>
      )}
      <span
        className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 max-w-[7rem] truncate ${badgeClass(task.marker)}`}
        title={task.statusLabel ?? task.marker}
      >
        {task.statusLabel ?? task.marker}
      </span>
      <button
        className="flex-1 text-left truncate hover:underline"
        title={`${task.content}（${task.pageName}）`}
        onClick={() => void jump()}
      >
        {task.content}
      </button>
      {d && (
        <span className={`text-xs shrink-0 ${d < todayStr() ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
          {task.scheduled ? `📅 ${task.scheduled}` : `⏰ ${task.deadline}`}
        </span>
      )}
      <span className="text-xs text-slate-300 truncate max-w-[10rem] shrink-0" title={task.pageName}>
        {task.pageName}
      </span>
      {showSchedule && (
        <button
          className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 shrink-0"
          onClick={() => void scheduleToday()}
        >
          {t('scheduleToday')}
        </button>
      )}
      <button
        className="text-xs px-2 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200 shrink-0"
        title={lang === 'zh' ? '番茄钟' : 'Pomodoro'}
        onClick={() => pomStart(task.uuid, task.content)}
      >
        🍅
      </button>
      <button
        className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 shrink-0"
        onClick={() => void done()}
      >
        {t('done')}
      </button>
    </li>
  )
}

/** 「待办列表」+ 其子任务的折叠分组 */
function TaskGroup({
  task,
  children,
  showSchedule,
}: {
  task: Task
  children: Task[]
  showSchedule?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <li className="space-y-2">
      <ul className="space-y-2">
        <TaskCard task={task} showSchedule={showSchedule} group={{ open, toggle: () => setOpen((v) => !v), count: children.length }} />
      </ul>
      {open && (
        <ul className="space-y-2 ml-4 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
          {children.map((c) => (
            <TaskCard key={c.uuid} task={c} showSchedule={showSchedule} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** 已完成条目（只读）；有子任务时提供折叠开关 */
function DoneCard({
  task,
  group,
}: {
  task: Task
  group?: { open: boolean; toggle: () => void; count: number }
}): JSX.Element {
  const lang = useAtomValue(langAtom)
  return (
    <li className="flex items-center gap-2 rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 opacity-70">
      {group && (
        <button
          className="shrink-0 text-xs w-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          onClick={group.toggle}
          title={group.open ? (lang === 'zh' ? '折叠' : 'Collapse') : lang === 'zh' ? '展开' : 'Expand'}
        >
          {group.open ? '▾' : '▸'}
        </button>
      )}
      <span className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
        ✓
      </span>
      <button
        className="flex-1 text-left truncate line-through hover:underline"
        title={`${task.content}（${task.pageName}）`}
        onClick={() => void jumpToBlock(task)}
      >
        {task.content}
      </button>
      <span className="text-xs text-slate-400 shrink-0">
        {task.marker === 'CANCELED' ? '✕' : '✓'} {task.completedAt ?? (lang === 'zh' ? '日期未知' : 'unknown')}
      </span>
    </li>
  )
}

/** 已完成任务 + 其子任务的折叠分组 */
function DoneGroup({ task, children }: { task: Task; children: Task[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <li className="space-y-2">
      <ul className="space-y-2">
        <DoneCard task={task} group={{ open, toggle: () => setOpen((v) => !v), count: children.length }} />
      </ul>
      {open && (
        <ul className="space-y-2 ml-4 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
          {children.map((c) => (
            <DoneCard key={c.uuid} task={c} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Empty({ lang }: { lang: string }): JSX.Element {
  return (
    <li className="text-sm text-slate-400 px-3 py-4 rounded border border-dashed border-slate-200 text-center">
      {lang === 'zh' ? '（空）' : '(empty)'}
    </li>
  )
}

export default function TodayView(): JSX.Element {
  const tasks = useAtomValue(tasksAtom)
  const doneToday = useAtomValue(doneTodayAtom)
  const loadState = useAtomValue(loadStateAtom)
  const loadError = useAtomValue(loadErrorAtom)
  const lastLoadedAt = useAtomValue(lastLoadedAtAtom)
  const lang = useAtomValue(langAtom)
  const t = getT(lang)

  const today = todayStr()

  // 折叠分组：父 block 本身也是任务时，把子任务从平铺列表里摘出来挂到父任务下
  const taskUuids = new Set(tasks.map((t) => t.uuid))
  const childrenMap = new Map<string, Task[]>()
  const nestedIds = new Set<string>()
  for (const t of tasks) {
    if (t.parentUuid && taskUuids.has(t.parentUuid) && t.uuid !== t.parentUuid) {
      nestedIds.add(t.uuid)
      const arr = childrenMap.get(t.parentUuid) ?? []
      arr.push(t)
      childrenMap.set(t.parentUuid, arr)
    }
  }
  const roots = tasks.filter((t) => !nestedIds.has(t.uuid))

  // 已完成列表同样按父子关系折叠（父任务也在已完成列表时才折叠）
  const doneUuids = new Set(doneToday.map((t) => t.uuid))
  const doneChildren = new Map<string, Task[]>()
  const doneNested = new Set<string>()
  for (const t of doneToday) {
    if (t.parentUuid && doneUuids.has(t.parentUuid) && t.uuid !== t.parentUuid) {
      doneNested.add(t.uuid)
      const arr = doneChildren.get(t.parentUuid) ?? []
      arr.push(t)
      doneChildren.set(t.parentUuid, arr)
    }
  }
  const doneRoots = doneToday.filter((t) => !doneNested.has(t.uuid))

  const renderItems = (list: Task[], showSchedule?: boolean): JSX.Element[] =>
    list.map((x) => {
      const kids = childrenMap.get(x.uuid)
      return kids && kids.length > 0 ? (
        <TaskGroup key={x.uuid} task={x} children={kids} showSchedule={showSchedule} />
      ) : (
        <TaskCard key={x.uuid} task={x} showSchedule={showSchedule} />
      )
    })

  const doing = roots.filter((t) => t.marker === 'DOING' || t.marker === 'NOW')
  const doingIds = new Set(doing.map((t) => t.uuid))
  const dated = roots.filter((t) => !doingIds.has(t.uuid) && dateOf(t) !== null && dateOf(t)! <= today)
  const overdue = dated.filter((t) => dateOf(t)! < today)
  const dueToday = dated.filter((t) => dateOf(t) === today)
  const backlog = roots.filter((t) => !doingIds.has(t.uuid) && t.scheduled === null && t.deadline === null)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PomodoroBar />
      {loadState === 'error' && (
        <div className="rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm dark:bg-red-950 dark:text-red-300 dark:border-red-800">
          {t('queryFailed')}：{loadError}
          {lang === 'zh' ? '（请到「诊断」页查看详情，并确认当前图谱为 DB 版）' : ''}
        </div>
      )}
      {loadState === 'loading' && (
        <div className="rounded border border-amber-300 bg-amber-50 text-amber-700 px-3 py-2 text-sm dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
          ⏳ {lang === 'zh' ? '数据加载中…（首次查询可能需要数秒）' : 'Loading tasks…'}
        </div>
      )}
      {loadState === 'idle' && tasks.length === 0 && (
        <div className="rounded border border-sky-300 bg-sky-50 text-sky-700 px-3 py-2 text-sm dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800">
          {lang === 'zh'
            ? '查询成功但返回 0 个任务。若图谱中确有任务（带 #Task 标签），请点'
            : 'Query OK but 0 tasks. If your graph has #Task blocks, go to '}
          <button
            data-tab="diagnostics"
            className="underline font-medium"
            onClick={() => undefined}
          >
            {lang === 'zh' ? '「打开诊断」' : 'Diagnostics'}
          </button>
          {lang === 'zh' ? '查看原始数据抽样（第 ② 项）。' : ' and run raw sample (②).'}
        </div>
      )}
      <div className="text-xs text-slate-400">
        {tf(lang, 'totalTasks', tasks.length)} · {t('overdue')} {overdue.length} ·{' '}
        {t('dueToday')} {dueToday.length} ·{' '}
        {tf(lang, 'updatedAt', lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString() : '-')}
        <button className="ml-2 underline" onClick={() => void refreshTasks()}>
          {t('refresh')}
        </button>
        <span className="ml-2 text-slate-300" title="构建标记">
          {BUILD_TAG}
        </span>
      </div>

      <section>
        <h2 className="font-bold mb-2">
          {t('doing')}（{doing.length}）
        </h2>
        <ul className="space-y-2">
          {doing.length ? renderItems(doing) : <Empty lang={lang} />}
        </ul>
      </section>

      <section>
        <h2 className="font-bold mb-2">
          {t('dueToday')}（{dueToday.length}）
          {overdue.length > 0 && (
            <span className="text-red-600">
              {' '}
              · {t('overdue')} {overdue.length}
            </span>
          )}
        </h2>
        <ul className="space-y-2">
          {dated.length ? renderItems(dated) : <Empty lang={lang} />}
        </ul>
      </section>

      <section>
        <h2 className="font-bold mb-2">
          {t('backlog')}（{backlog.length}）
        </h2>
        <ul className="space-y-2">
          {backlog.length ? (
            renderItems(backlog, true)
          ) : (
            <Empty lang={lang} />
          )}
        </ul>
      </section>

      <section>
        <h2 className="font-bold mb-2 text-slate-400">
          {lang === 'zh' ? '今日已完成' : 'Done today'}（{doneToday.length}）
        </h2>
        <ul className="space-y-2">
          {doneToday.length ? (
            doneRoots.map((x) => {
              const kids = doneChildren.get(x.uuid)
              return kids && kids.length > 0 ? (
                <DoneGroup key={x.uuid} task={x} children={kids} />
              ) : (
                <DoneCard key={x.uuid} task={x} />
              )
            })
          ) : (
            <Empty lang={lang} />
          )}
        </ul>
      </section>
    </div>
  )
}
