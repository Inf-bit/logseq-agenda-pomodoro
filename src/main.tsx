import '@logseq/libs'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import { notifyDataChanged, refreshTasks } from './stores/tasks'
import { initSettings, setTheme } from './stores/settings'
import { pomStart, refreshPomConfig, restoreFromSettings } from './stores/pomodoro'
import { RuntimeErrorBar, registerGlobalErrorCapture } from './components/RuntimeErrorBar'

function registerToolbar(): void {
  logseq.App.registerUIItem('toolbar', {
    key: 'logseq-agenda-pomodoro',
    template: `<a class="button" data-on-click="openAgenda" title="Agenda &amp; 番茄钟" style="font-size:14px;line-height:1;">📅</a>`,
  })
  logseq.provideModel({
    openAgenda(): void {
      void logseq.showMainUI({ autoFocus: true })
    },
  })
}

function registerSettingsSchema(): void {
  logseq.useSettingsSchema([
    {
      key: 'viewHeading',
      type: 'heading',
      title: 'View / 视图',
      default: null,
      description: 'View preferences.',
    },
    {
      key: 'lang',
      type: 'enum',
      title: 'Language / 语言',
      enumChoices: ['zh', 'en'],
      enumPicker: 'select',
      default: 'zh',
      description: 'UI language of the plugin main view.',
    },
    {
      key: 'weekStart',
      type: 'number',
      title: 'Week start (0=Sun, 1=Mon) / 每周起始日',
      default: 1,
      description: '0 = Sunday, 1 = Monday.',
    },
    {
      key: 'defaultTab',
      type: 'enum',
      title: 'Default tab / 默认标签页',
      enumChoices: ['today', 'month', 'kanban'],
      enumPicker: 'select',
      default: 'today',
      description: 'Tab shown when the main UI opens.',
    },
    {
      key: 'pomHeading',
      type: 'heading',
      title: 'Pomodoro / 番茄钟',
      default: null,
      description: 'Pomodoro timer preferences.',
    },
    {
      key: 'pomFocusMinutes',
      type: 'number',
      title: 'Focus minutes / 专注时长（分钟）',
      default: 25,
      description: '1-180.',
    },
    {
      key: 'pomShortBreak',
      type: 'number',
      title: 'Short break / 短休（分钟）',
      default: 5,
      description: '1-180.',
    },
    {
      key: 'pomLongBreak',
      type: 'number',
      title: 'Long break / 长休（分钟）',
      default: 15,
      description: '1-180.',
    },
    {
      key: 'pomLongBreakInterval',
      type: 'number',
      title: 'Long break interval / 长休间隔（番茄数）',
      default: 4,
      description: 'Take a long break after N focus sessions.',
    },
    {
      key: 'pomAutoStartNext',
      type: 'boolean',
      title: 'Auto start next / 自动开始休息与下一轮',
      default: false,
      description: 'Automatically start break after focus ends.',
    },
    {
      key: 'pomSound',
      type: 'boolean',
      title: 'Sound / 提示音',
      default: true,
      description: 'Play a beep when a phase ends.',
    },
  ])
}

function registerEvents(): void {
  // 主 UI 打开时刷新数据（SDK 0.3.4：顶层 EventEmitter）
  logseq.on('ui:visible:changed', ({ visible }) => {
    if (visible) void refreshTasks()
  })

  // 主题跟随 Logseq 明暗模式
  logseq.App.onThemeModeChanged(({ mode }) => setTheme(mode))

  // 设置变更后重新读取（视图设置 + 番茄钟参数即时生效）
  logseq.on('settings:changed', () => {
    initSettings()
    refreshPomConfig()
  })

  // 数据变更事件（DB.onChanged；spike 验证触发可靠性，不可用则降级为 focus + 轮询）
  if (typeof logseq.DB.onChanged === 'function') {
    logseq.DB.onChanged(() => notifyDataChanged())
  } else {
    window.addEventListener('focus', () => notifyDataChanged())
    window.setInterval(() => notifyDataChanged(), 30_000)
  }
}

/** 命令面板：对当前光标所在 block 启动番茄钟 */
function registerCommands(): void {
  // 注意：registerCommandPalette 属于 App 命名空间（SDK IAppProxy），
  // 误用 logseq.Editor.* 会走异步 API 回退路径，回调无法被结构化克隆 → DataCloneError
  logseq.App.registerCommandPalette(
    { key: 'agenda-pomodoro-start', label: 'Agenda: Start pomodoro for current block' },
    async () => {
      const block = await logseq.Editor.getCurrentBlock()
      if (!block?.uuid) {
        void logseq.UI.showMsg('请先把光标放在一个任务 block 上 / Put cursor on a task block first', 'warning')
        return
      }
      const firstLine = (block.content ?? '').split('\n')[0] ?? ''
      const title = firstLine.replace(/^(TODO|DOING|NOW|LATER|WAITING)\s+/i, '').trim()
      pomStart(block.uuid, title || '(untitled)')
      void logseq.UI.showMsg(`🍅 番茄钟已启动：${title || '(untitled)'}`, 'success')
    },
  )
}

async function main(): Promise<void> {
  registerGlobalErrorCapture()
  initSettings()
  restoreFromSettings()
  registerToolbar()
  registerSettingsSchema()
  registerEvents()
  registerCommands()
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
      <RuntimeErrorBar />
    </ErrorBoundary>,
  )
  void refreshTasks()
}

logseq.ready(main).catch(console.error)
