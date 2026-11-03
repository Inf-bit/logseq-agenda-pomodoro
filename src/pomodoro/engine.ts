/** 番茄钟纯状态机：状态只存绝对时间戳，tick 用 endTime - now 重算（防 iframe 后台节流漂移） */

export type PomPhase = 'idle' | 'focus' | 'short-break' | 'long-break'

export interface PomRunning {
  phase: Exclude<PomPhase, 'idle'>
  taskUuid: string | null
  taskTitle: string | null
  startedAt: number
  endAt: number
  plannedMinutes: number
}

export interface PomSnapshot {
  running: PomRunning | null
  /** 今日已完成专注数（用于长休间隔与统计） */
  focusDone: number
}

export interface PomConfig {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakInterval: number
  autoStartNext: boolean
  soundEnabled: boolean
}

export const DEFAULT_CONFIG: PomConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartNext: false,
  soundEnabled: true,
}

export function startFocus(
  snap: PomSnapshot,
  cfg: PomConfig,
  taskUuid: string | null,
  taskTitle: string | null,
  now = Date.now(),
): PomSnapshot {
  return {
    ...snap,
    running: {
      phase: 'focus',
      taskUuid,
      taskTitle,
      startedAt: now,
      endAt: now + cfg.focusMinutes * 60_000,
      plannedMinutes: cfg.focusMinutes,
    },
  }
}

export function startBreak(snap: PomSnapshot, cfg: PomConfig, now = Date.now()): PomSnapshot {
  const long = snap.focusDone > 0 && snap.focusDone % cfg.longBreakInterval === 0
  const minutes = long ? cfg.longBreakMinutes : cfg.shortBreakMinutes
  return {
    ...snap,
    running: {
      phase: long ? 'long-break' : 'short-break',
      taskUuid: null,
      taskTitle: null,
      startedAt: now,
      endAt: now + minutes * 60_000,
      plannedMinutes: minutes,
    },
  }
}

/** 自然结束（计时到点）：专注→计数+记录完成；休息→idle */
export function finishPhase(snap: PomSnapshot): {
  snap: PomSnapshot
  finished: 'focus' | 'break' | null
  taskUuid: string | null
} {
  if (!snap.running) return { snap, finished: null, taskUuid: null }
  const r = snap.running
  if (r.phase === 'focus') {
    return {
      snap: { running: null, focusDone: snap.focusDone + 1 },
      finished: 'focus',
      taskUuid: r.taskUuid,
    }
  }
  return { snap: { ...snap, running: null }, finished: 'break', taskUuid: null }
}

/** 手动中断：仅专注阶段记录为 interrupted */
export function interrupt(snap: PomSnapshot): {
  snap: PomSnapshot
  taskUuid: string | null
  wasFocus: boolean
} {
  if (!snap.running) return { snap, taskUuid: null, wasFocus: false }
  const r = snap.running
  return {
    snap: { ...snap, running: null },
    taskUuid: r.taskUuid,
    wasFocus: r.phase === 'focus',
  }
}

export function remainingMs(r: PomRunning | null, now = Date.now()): number | null {
  if (!r) return null
  return Math.max(0, r.endAt - now)
}

export function fmtRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
