import { useAtomValue } from 'jotai'
import { fmtRemaining, remainingMs, type PomRunning } from '../pomodoro/engine'
import {
  awaitingBreakAtom,
  pomAtom,
  pomConfigAtom,
  pomInterrupt,
  pomNowAtom,
  pomSkipBreak,
  pomStartBreak,
} from '../stores/pomodoro'
import { getT } from '../i18n'
import { langAtom } from '../stores/settings'

function phaseLabel(r: PomRunning, lang: string): string {
  if (r.phase === 'focus') return lang === 'zh' ? '🍅 专注中' : '🍅 Focusing'
  return lang === 'zh' ? '☀️ 休息中' : '☀️ Break'
}

export default function PomodoroBar(): JSX.Element | null {
  const snap = useAtomValue(pomAtom)
  const cfg = useAtomValue(pomConfigAtom)
  const now = useAtomValue(pomNowAtom)
  const awaitingBreak = useAtomValue(awaitingBreakAtom)
  const lang = useAtomValue(langAtom)
  const t = getT(lang)

  const rem = remainingMs(snap.running, now)

  if (snap.running === null && !awaitingBreak) return null

  if (snap.running === null) {
    // 刚完成一个专注，提示开始休息
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/40 px-4 py-3 flex items-center gap-3">
        <span className="text-sm text-emerald-700 dark:text-emerald-300">
          {lang === 'zh'
            ? `已完成 ${snap.focusDone} 个专注 🍅`
            : `${snap.focusDone} pomodoros done 🍅`}
        </span>
        <div className="flex-1" />
        <button
          className="px-3 py-1.5 rounded text-sm bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => pomStartBreak()}
        >
          {lang === 'zh' ? '开始休息' : 'Start break'}
        </button>
      </div>
    )
  }

  const r = snap.running
  return (
    <div
      className={`rounded px-4 py-3 flex items-center gap-4 border ${
        r.phase === 'focus'
          ? 'bg-red-50 dark:bg-red-900/40'
          : 'bg-sky-50 dark:bg-sky-900/40'
      }`}
      style={r.phase === 'focus' ? { borderColor: '#f87171' } : undefined}
    >
      <span className="text-sm font-medium">{phaseLabel(r, lang)}</span>
      <span className="text-3xl font-mono font-bold tabular-nums">
        {fmtRemaining(rem ?? 0)}
      </span>
      {r.taskTitle && (
        <span className="text-sm truncate max-w-[20rem] opacity-70" title={r.taskTitle}>
          {r.taskTitle}
        </span>
      )}
      <div className="flex-1" />
      {r.phase !== 'focus' && (
        <button
          className="px-3 py-1.5 rounded text-sm bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
          onClick={() => pomSkipBreak()}
        >
          {lang === 'zh' ? '跳过休息' : 'Skip break'}
        </button>
      )}
      <button
        className="px-3 py-1.5 rounded text-sm bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900"
        onClick={() => pomInterrupt()}
      >
        {r.phase === 'focus'
          ? lang === 'zh'
            ? '中断'
            : 'Interrupt'
          : lang === 'zh'
            ? '结束休息'
            : 'End break'}
      </button>
      <span className="text-xs opacity-50">
        {lang === 'zh' ? `今日 ${snap.focusDone} 🍅` : `${snap.focusDone} 🍅 today`}
        {cfg.autoStartNext ? (lang === 'zh' ? ' · 自动' : ' · auto') : ''}
      </span>
    </div>
  )
}
