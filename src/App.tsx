import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import TodayView from './components/TodayView'
import MonthView from './components/MonthView'
import KanbanView from './components/KanbanView'
import DiagnosticsView from './components/DiagnosticsView'
import DbGraphWarning from './components/DbGraphWarning'
import { defaultTabAtom, langAtom, themeAtom, type TabId } from './stores/settings'
import { loadStateAtom, notDbGraphAtom, tasksAtom } from './stores/tasks'
import { getT } from './i18n'

function tabBtnClass(active: boolean): string {
  return `px-3 py-1 rounded text-sm ${
    active
      ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
      : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700'
  }`
}

const TABS: Array<{ id: TabId; key: 'today' | 'month' | 'kanban' | 'diagnostics' }> = [
  { id: 'today', key: 'today' },
  { id: 'month', key: 'month' },
  { id: 'kanban', key: 'kanban' },
  { id: 'diagnostics', key: 'diagnostics' },
]

export default function App(): JSX.Element {
  const [tab, setTab] = useState<TabId>(useAtomValue(defaultTabAtom))
  const theme = useAtomValue(themeAtom)
  const lang = useAtomValue(langAtom)
  const notDbGraph = useAtomValue(notDbGraphAtom)
  const tasksCount = useAtomValue(tasksAtom).length
  const loadState = useAtomValue(loadStateAtom)
  const t = getT(lang)

  // 诊断 + 兜底：原生 capture 委托。绕过 React 合成事件（真实环境 tab 无反应的嫌疑层），
  // 同时记录最后点击目标，指示器实时显示数据层状态。
  const [clicks, setClicks] = useState(0)
  const [lastTarget, setLastTarget] = useState('-')
  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      // try/catch 全包裹：保证任何异常都不中断 React 的状态批量提交（否则计数/切页会「冻结」）
      try {
        setClicks((c) => c + 1)
        const target = e.target as HTMLElement | null
        if (target) {
          const cls =
            typeof target.className === 'string' && target.className
              ? `.${target.className.trim().split(/\s+/).slice(0, 2).join('.')}`
              : ''
          setLastTarget(`${target.tagName}${cls}`)
        }
        // 原生兜底切换：data-tab / data-action
        const hit = target?.closest?.('[data-tab],[data-action]')
        if (hit instanceof HTMLElement) {
          const wantTab = hit.getAttribute('data-tab')
          if (wantTab) setTab(wantTab as TabId)
          if (hit.getAttribute('data-action') === 'close') logseq.hideMainUI()
        }
      } catch (err) {
        console.error('[agenda] click handler error:', err)
      }
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') logseq.hideMainUI()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className={`h-full flex flex-col ${
        theme === 'dark'
          ? 'dark bg-slate-900 text-slate-100'
          : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* 顶部留空：真实环境实测插件 iframe 顶部区域与 Logseq 窗口自身控件存在点击冲突（用户反馈），
          导航整体移到底部，内容区从安全距离之下开始 */}
      <main className="flex-1 overflow-auto px-4 pt-14 pb-4">
        {notDbGraph ? (
          <DbGraphWarning />
        ) : (
          <>
            {tab === 'today' && <TodayView />}
            {tab === 'month' && <MonthView />}
            {tab === 'kanban' && <KanbanView />}
            {tab === 'diagnostics' && <DiagnosticsView />}
          </>
        )}
      </main>
      <footer className="flex items-center gap-3 px-4 h-12 border-t border-slate-200 dark:border-slate-700 shrink-0">
        <span className="text-lg font-bold">Agenda &amp; 🍅</span>
        <nav className="flex gap-1">
          {TABS.map(({ id, key }) => (
            <button
              key={id}
              data-tab={id}
              className={tabBtnClass(tab === id)}
              onClick={() => {
                console.log('[agenda] tab click ->', id)
                setTab(id)
              }}
            >
              {t(key)}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        {/* 诊断仪表盘：🖱=点击数 / tab=当前页 / tasks=任务数 / load=加载态 / db=图谱检测 / last=最后点击目标 */}
        <span className="text-xs text-slate-400 font-mono" data-testid="diag">
          🖱{clicks} tab={tab} tasks={tasksCount} load={loadState}
          {notDbGraph ? ' db=N' : ''} last={lastTarget}
        </span>
        <button
          data-action="close"
          className="px-3 py-1 rounded text-sm bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
          onClick={() => logseq.hideMainUI()}
        >
          {t('close')}
        </button>
      </footer>
    </div>
  )
}
