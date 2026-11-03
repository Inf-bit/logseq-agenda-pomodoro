import { useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventContentArg, EventDropArg } from '@fullcalendar/core'
import type { Task } from '../types'
import { tasksAtom, completedAtom, refreshTasks } from '../stores/tasks'
import { langAtom, weekStartAtom } from '../stores/settings'
import { getT } from '../i18n'
import { jumpToBlock, setScheduledViaProperty } from '../data/writer'
import { errMsg } from '../data/queries'
import { todayStr } from '../utils/date'

/** Task → FullCalendar event（scheduled 蓝色 / deadline 橙红色，逾期加标记） */
function toEvent(t: Task, group?: { count: number; open: boolean; toggle: () => void }) {
  const isDeadline = t.scheduled === null && t.deadline !== null
  const date = t.scheduled ?? t.deadline
  const overdue = date !== null && date < todayStr()
  return {
    id: isDeadline ? `${t.uuid}#deadline` : t.uuid,
    taskId: t.uuid,
    title: `${isDeadline ? '⏰ ' : ''}${t.content}`,
    start: date ?? undefined,
    allDay: true,
    editable: true,
    backgroundColor: overdue ? '#ef4444' : isDeadline ? '#f97316' : '#3b82f6',
    borderColor: overdue ? '#b91c1c' : undefined,
    textColor: '#fff',
    extendedProps: { group },
  }
}

/** 已完成任务 → 灰底事件，落在完成日期上（不可拖动） */
function toDoneEvent(t: Task) {
  return {
    id: `${t.uuid}#done`,
    taskId: t.uuid,
    title: `${t.marker === 'CANCELED' ? '✕' : '✓'} ${t.content}`,
    start: t.completedAt ?? undefined,
    allDay: true,
    editable: false,
    backgroundColor: '#94a3b8',
    borderColor: '#64748b',
    textColor: '#fff',
    extendedProps: { group: undefined },
  }
}

function EventItem(arg: EventContentArg): JSX.Element {
  const group = arg.event.extendedProps.group as
    | { count: number; open: boolean; toggle: () => void }
    | undefined
  return (
    <div className="fc-event-main-wrapper flex items-center gap-0.5 truncate" title={arg.event.title}>
      {group && (
        <button
          className="shrink-0 px-0.5 text-[10px] leading-none"
          onClick={(e) => {
            e.stopPropagation()
            group.toggle()
          }}
        >
          {group.open ? '▾' : `▸${group.count}`}
        </button>
      )}
      <span className="truncate">{arg.event.title}</span>
    </div>
  )
}

/** 当日已完成的一行；有子任务时带折叠开关 */
function DayDoneItem({ task, children }: { task: Task; children: Task[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <li className="text-sm">
      <div className="flex items-center gap-1">
        {children.length > 0 && (
          <button
            className="shrink-0 text-xs w-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <button
          className="text-slate-400 line-through hover:underline truncate max-w-[24rem]"
          onClick={() => void jumpToBlock(task)}
        >
          {task.marker === 'CANCELED' ? '✕' : '✓'} {task.content}
        </button>
        <span className="text-slate-300 text-xs ml-2">{task.pageName}</span>
      </div>
      {open && children.length > 0 && (
        <ul className="ml-5 pl-2 border-l-2 border-slate-200 dark:border-slate-700 space-y-1 mt-1">
          {children.map((c) => (
            <li key={`${c.uuid}-done-child`} className="text-sm">
              <button
                className="text-slate-400 line-through hover:underline truncate max-w-[22rem]"
                onClick={() => void jumpToBlock(c)}
              >
                {c.marker === 'CANCELED' ? '✕' : '✓'} {c.content}
              </button>
              <span className="text-slate-300 text-xs ml-2">{c.pageName}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** 当日明细里的一行；有子任务时带折叠开关 */
function DayTaskItem({ task, children }: { task: Task; children: Task[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <li className="text-sm">
      <div className="flex items-center gap-1">
        {children.length > 0 && (
          <button
            className="shrink-0 text-xs w-4 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        <button
          className="text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[24rem]"
          onClick={() => void jumpToBlock(task)}
        >
          {task.scheduled ? '📅' : task.deadline ? '⏰' : '·'} {task.content}
        </button>
        <span className="text-slate-400 text-xs ml-2">{task.pageName}</span>
      </div>
      {open && children.length > 0 && (
        <ul className="ml-5 pl-2 border-l-2 border-slate-200 dark:border-slate-700 space-y-1 mt-1">
          {children.map((c) => (
            <li key={`${c.uuid}-child`} className="text-sm">
              <button
                className="text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[22rem]"
                onClick={() => void jumpToBlock(c)}
              >
                {c.scheduled ? '📅' : c.deadline ? '⏰' : '·'} {c.content}
              </button>
              <span className="text-slate-400 text-xs ml-2">{c.pageName}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function MonthView(): JSX.Element {
  const tasks = useAtomValue(tasksAtom)
  const completed = useAtomValue(completedAtom)
  const lang = useAtomValue(langAtom)
  const weekStart = useAtomValue(weekStartAtom)
  const t = getT(lang)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  /** 日历格子内的折叠：同一日期上的子任务挂到父事件下，可收起 */
  const events = useMemo(() => {
    const dated = tasks.filter((x) => x.scheduled || x.deadline)
    const byId = new Map(tasks.map((x) => [x.uuid, x]))
    const kidsByParent = new Map<string, Task[]>()
    const parentOf = new Map<string, string>()
    for (const x of dated) {
      const parent = x.parentUuid ? byId.get(x.parentUuid) : undefined
      if (!parent || parent.uuid === x.uuid) continue
      const childDate = x.scheduled ?? x.deadline
      const parentDate = parent.scheduled ?? parent.deadline
      if (!childDate || childDate !== parentDate) continue
      const arr = kidsByParent.get(parent.uuid) ?? []
      arr.push(x)
      kidsByParent.set(parent.uuid, arr)
      parentOf.set(x.uuid, parent.uuid)
    }
    const toggle = (uuid: string): void =>
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(uuid)) next.delete(uuid)
        else next.add(uuid)
        return next
      })
    const out = dated
      .filter((x) => !parentOf.has(x.uuid) || !collapsed.has(parentOf.get(x.uuid)!))
      .map((x) => {
        const kids = kidsByParent.get(x.uuid)
        return toEvent(
          x,
          kids && kids.length > 0
            ? { count: kids.length, open: !collapsed.has(x.uuid), toggle: () => toggle(x.uuid) }
            : undefined,
        )
      })
    out.push(...completed.filter((x) => x.completedAt).map(toDoneEvent))
    return out
  }, [tasks, completed, collapsed])

  const dayTasks = useMemo(() => {
    if (!selectedDay) return []
    return tasks.filter(
      (x) => x.scheduled === selectedDay || x.deadline === selectedDay,
    )
  }, [tasks, selectedDay])

  const dayDone = useMemo(() => {
    if (!selectedDay) return []
    return completed.filter((x) => x.completedAt === selectedDay)
  }, [completed, selectedDay])

  /** 当日待办按父子关系分组：父任务也在当天则折叠到父任务下 */
  const dayGrouped = useMemo(() => {
    const ids = new Set(dayTasks.map((x) => x.uuid))
    const children = new Map<string, Task[]>()
    const nested = new Set<string>()
    for (const x of dayTasks) {
      if (x.parentUuid && ids.has(x.parentUuid) && x.uuid !== x.parentUuid) {
        nested.add(x.uuid)
        const arr = children.get(x.parentUuid) ?? []
        arr.push(x)
        children.set(x.parentUuid, arr)
      }
    }
    // 父任务本身没有当天日期（如无日期的待办列表）时，也把它作为分组头带出来，
    // 否则子任务只能平铺、看不到折叠
    const byId = new Map(tasks.map((x) => [x.uuid, x]))
    const extraParents = new Map<string, Task>()
    for (const x of dayTasks) {
      if (!x.parentUuid || x.uuid === x.parentUuid || ids.has(x.parentUuid)) continue
      const parent = byId.get(x.parentUuid)
      if (!parent || parent.completedAt) continue
      extraParents.set(parent.uuid, parent)
      nested.add(x.uuid)
      const arr = children.get(parent.uuid) ?? []
      arr.push(x)
      children.set(parent.uuid, arr)
    }
    return {
      roots: [...extraParents.values(), ...dayTasks.filter((x) => !nested.has(x.uuid))],
      children,
    }
  }, [dayTasks, tasks])

  /** 当日已完成按父子关系分组 */
  const dayDoneGrouped = useMemo(() => {
    const ids = new Set(dayDone.map((x) => x.uuid))
    const children = new Map<string, Task[]>()
    const nested = new Set<string>()
    for (const x of dayDone) {
      if (x.parentUuid && ids.has(x.parentUuid) && x.uuid !== x.parentUuid) {
        nested.add(x.uuid)
        const arr = children.get(x.parentUuid) ?? []
        arr.push(x)
        children.set(x.parentUuid, arr)
      }
    }
    return { roots: dayDone.filter((x) => !nested.has(x.uuid)), children }
  }, [dayDone])

  /** 点击日历上的事件条 → 跳转原 block（scheduled/deadline 两类事件的 id 都带后缀） */
  const onEventClick = (info: { event: { id: string } }): void => {
    const uuid = String(info.event.id).split('#')[0]
    const task = tasks.find((x) => x.uuid === uuid) ?? completed.find((x) => x.uuid === uuid)
    if (task) void jumpToBlock(task)
  }

  const onDrop = async (info: EventDropArg): Promise<void> => {
    const uuid = String(info.event.id).split('#')[0]
    const date = info.event.startStr.slice(0, 10)
    try {
      await setScheduledViaProperty(uuid, date)
      await refreshTasks()
      setSelectedDay(date)
    } catch (e) {
      setErr(errMsg(e))
      info.revert()
    }
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {t('queryFailed')}：{err}
        </div>
      )}
      <div className="rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          firstDay={weekStart}
          height="auto"
          fixedWeekCount={false}
          locale={lang === 'zh' ? 'zh-cn' : 'en'}
          events={events}
          eventContent={EventItem}
          editable
          eventDrop={(i) => void onDrop(i)}
          eventClick={onEventClick}
          dateClick={(i) => setSelectedDay(i.dateStr.slice(0, 10))}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
        />
      </div>

      {selectedDay && (
        <div className="rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="font-bold mb-2 dark:text-slate-100">
            {selectedDay}（{dayTasks.length + dayDone.length}）
          </h3>
          <ul className="space-y-1">
            {dayTasks.length === 0 && dayDone.length === 0 && (
              <li className="text-sm text-slate-400">{t('empty')}</li>
            )}
            {dayGrouped.roots.map((x) => (
              <DayTaskItem key={`${x.uuid}-${x.scheduled ? 's' : 'd'}`} task={x} children={dayGrouped.children.get(x.uuid) ?? []} />
            ))}
            {dayDoneGrouped.roots.map((x) => (
              <DayDoneItem key={`${x.uuid}-done`} task={x} children={dayDoneGrouped.children.get(x.uuid) ?? []} />
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-400">
        {lang === 'zh'
          ? '提示：拖动事件可改期；点击日期格查看当日明细；点击任务跳转原 block。'
          : 'Tip: drag events to reschedule; click a day cell for details; click a task to jump.'}
      </p>
    </div>
  )
}
