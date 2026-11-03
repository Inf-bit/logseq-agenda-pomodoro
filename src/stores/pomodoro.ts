import { atom, getDefaultStore } from 'jotai'
import {
  DEFAULT_CONFIG,
  finishPhase,
  fmtRemaining,
  interrupt,
  remainingMs,
  startBreak,
  startFocus,
  type PomConfig,
  type PomSnapshot,
} from '../pomodoro/engine'
import { appendPomodoroLog, type PomodoroEntry } from '../data/writer'
import { errMsg } from '../data/queries'

/** 番茄记录写入失败不应打断计时流程：提示但不抛错 */
async function writePomodoroLog(uuid: string, entry: PomodoroEntry): Promise<void> {
  try {
    await appendPomodoroLog(uuid, entry)
  } catch (e) {
    console.warn('[pomodoro] 写入 pomodoro-log 失败', e)
    void logseq.UI.showMsg(`番茄记录未写入：${errMsg(e)}`, 'warning')
  }
}

export const pomAtom = atom<PomSnapshot>({ running: null, focusDone: 0 })
export const pomConfigAtom = atom<PomConfig>(DEFAULT_CONFIG)
export const pomNowAtom = atom<number>(Date.now())
/** 专注刚结束、等待用户开始休息（不持久化，避免重载后残留提示） */
export const awaitingBreakAtom = atom<boolean>(false)

const store = getDefaultStore()

let ticker: number | undefined
let lastToolbarMinute = ''

/** 工具栏倒计时：每分钟重注册同 key UIItem 更新文本（sawhney17 插件实证的模式） */
function updateToolbar(text: string | null): void {
  const template = text
    ? `<a class="button" data-on-click="openAgenda" title="Agenda &amp; 番茄钟" style="font-size:14px;line-height:1;">🍅 <span style="font-size:11px;font-family:monospace;">${text}</span></a>`
    : `<a class="button" data-on-click="openAgenda" title="Agenda &amp; 番茄钟" style="font-size:14px;line-height:1;">📅</a>`
  logseq.App.registerUIItem('toolbar', {
    key: 'logseq-agenda-pomodoro',
    template,
  })
}

function ensureTicker(): void {
  if (ticker !== undefined) return
  ticker = window.setInterval(() => {
    const now = Date.now()
    store.set(pomNowAtom, now)
    const snap = store.get(pomAtom)
    const rem = remainingMs(snap.running, now)

    // 工具栏按分钟粒度更新（减少重注册频率）
    const minute = rem !== null ? fmtRemaining(rem).slice(0, 2) : ''
    if (minute !== lastToolbarMinute) {
      lastToolbarMinute = minute
      updateToolbar(rem !== null ? fmtRemaining(rem) : null)
    }

    if (rem === 0) void onPhaseEnd()
  }, 1000)
}

function stopTickerIfIdle(): void {
  const snap = store.get(pomAtom)
  if (snap.running === null && ticker !== undefined) {
    window.clearInterval(ticker)
    ticker = undefined
    lastToolbarMinute = ''
    updateToolbar(null)
  }
}

function notify(title: string, body: string, cfg: PomConfig): void {
  try {
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') void Notification.requestPermission()
      if (Notification.permission === 'granted') new Notification(title, { body })
    }
  } catch {
    /* iframe 内不可用时静默 */
  }
  if (cfg.soundEnabled) beep()
}

function beep(): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
  } catch {
    /* 无音频设备时静默 */
  }
}

async function onPhaseEnd(): Promise<void> {
  const snap = store.get(pomAtom)
  const cfg = store.get(pomConfigAtom)
  const { snap: next, finished, taskUuid } = finishPhase(snap)
  store.set(pomAtom, next)
  persist()

  if (finished === 'focus') {
    notify('🍅 专注完成！', `已专注 ${snap.running?.plannedMinutes ?? 0} 分钟，休息一下吧`, cfg)
    if (taskUuid) {
      await writePomodoroLog(taskUuid, {
        ts: Date.now(),
        minutes: snap.running?.plannedMinutes ?? 0,
        status: 'done',
      })
    }
    if (cfg.autoStartNext) {
      store.set(pomAtom, startBreak(next, cfg))
      persist()
      ensureTicker()
    } else {
      store.set(awaitingBreakAtom, true)
      stopTickerIfIdle()
    }
  } else if (finished === 'break') {
    notify('☀️ 休息结束', '准备开始下一个专注吗？', cfg)
    stopTickerIfIdle()
  }
}

/** 运行态持久化到 logseq.settings，插件重载后可恢复 */
function persist(): void {
  const snap = store.get(pomAtom)
  try {
    logseq.updateSettings({
      pomRunning: snap.running,
      pomFocusDone: snap.focusDone,
    })
  } catch {
    /* settings 写入失败不影响运行 */
  }
}

function readPomConfig(): PomConfig {
  const s = (logseq.settings ?? {}) as {
    pomFocusMinutes?: number
    pomShortBreak?: number
    pomLongBreak?: number
    pomLongBreakInterval?: number
    pomAutoStartNext?: boolean
    pomSound?: boolean
  }
  return {
    focusMinutes: clampMinutes(s.pomFocusMinutes, DEFAULT_CONFIG.focusMinutes),
    shortBreakMinutes: clampMinutes(s.pomShortBreak, DEFAULT_CONFIG.shortBreakMinutes),
    longBreakMinutes: clampMinutes(s.pomLongBreak, DEFAULT_CONFIG.longBreakMinutes),
    longBreakInterval: s.pomLongBreakInterval ?? DEFAULT_CONFIG.longBreakInterval,
    autoStartNext: s.pomAutoStartNext ?? DEFAULT_CONFIG.autoStartNext,
    soundEnabled: s.pomSound ?? DEFAULT_CONFIG.soundEnabled,
  }
}

/** 设置面板变更后即时生效 */
export function refreshPomConfig(): void {
  store.set(pomConfigAtom, readPomConfig())
}

export function restoreFromSettings(): void {
  store.set(pomConfigAtom, readPomConfig())

  const s = (logseq.settings ?? {}) as {
    pomRunning?: PomSnapshot['running']
    pomFocusDone?: number
  }
  const snap: PomSnapshot = {
    running: s.pomRunning ?? null,
    focusDone: s.pomFocusDone ?? 0,
  }
  // 恢复时已过期的专注直接结算为完成，并补写记录（D2）
  if (snap.running && remainingMs(snap.running) === 0) {
    const expired = snap.running
    const { snap: settled } = finishPhase(snap)
    store.set(pomAtom, settled)
    if (expired.phase === 'focus' && expired.taskUuid) {
      void writePomodoroLog(expired.taskUuid, {
        ts: expired.endAt,
        minutes: expired.plannedMinutes,
        status: 'done',
      })
    }
  } else {
    store.set(pomAtom, snap)
  }
  if (store.get(pomAtom).running) ensureTicker()
  else updateToolbar(null)
}

function clampMinutes(v: number | undefined, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 180) return dflt
  return Math.round(v)
}

/** 从任务启动专注 */
export function pomStart(taskUuid: string | null, taskTitle: string | null): void {
  const snap = store.get(pomAtom)
  const cfg = store.get(pomConfigAtom)
  store.set(pomAtom, startFocus(snap, cfg, taskUuid, taskTitle))
  store.set(awaitingBreakAtom, false)
  persist()
  ensureTicker()
  const r = store.get(pomAtom).running
  if (r) updateToolbar(fmtRemaining(remainingMs(r) ?? 0))
}

/** 手动中断当前阶段 */
export function pomInterrupt(): void {
  const snap = store.get(pomAtom)
  const cfg = store.get(pomConfigAtom)
  const { snap: next, taskUuid, wasFocus } = interrupt(snap)
  store.set(pomAtom, next)
  persist()
  if (wasFocus && taskUuid) {
    const r = snap.running
    const elapsedMin = r ? Math.round((Date.now() - r.startedAt) / 60_000) : 0
    if (elapsedMin >= 1) {
      void writePomodoroLog(taskUuid, { ts: Date.now(), minutes: elapsedMin, status: 'interrupted' })
    }
  }
  stopTickerIfIdle()
}

/** 跳过当前休息 / 立即结束休息 */
export function pomSkipBreak(): void {
  const snap = store.get(pomAtom)
  if (!snap.running || snap.running.phase === 'focus') return
  store.set(pomAtom, { ...snap, running: null })
  store.set(awaitingBreakAtom, false)
  persist()
  stopTickerIfIdle()
}

/** 专注结束后手动开始休息（autoStartNext 关闭时） */
export function pomStartBreak(): void {
  const snap = store.get(pomAtom)
  const cfg = store.get(pomConfigAtom)
  store.set(pomAtom, startBreak(snap, cfg))
  store.set(awaitingBreakAtom, false)
  persist()
  ensureTicker()
}

export function pomNow(): number {
  return store.get(pomNowAtom)
}
