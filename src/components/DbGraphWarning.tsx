import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { refreshTasks } from '../stores/tasks'
import { langAtom } from '../stores/settings'
import { getT } from '../i18n'

/** 非 DB 图谱统一降级提示（D1：明确提示而非静默失败），所有 tab 生效 */
export default function DbGraphWarning(): JSX.Element {
  const lang = useAtomValue(langAtom)
  const t = getT(lang)
  const [checking, setChecking] = useState(false)

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      await refreshTasks()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/40 px-4 py-6 text-center space-y-3">
        <h2 className="font-bold text-amber-800 dark:text-amber-200">
          ⚠️ {t('notDbGraphTitle')}
        </h2>
        <p className="text-sm text-amber-700 dark:text-amber-300">{t('notDbGraphBody')}</p>
        <button
          className="px-4 py-1.5 rounded text-sm bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          disabled={checking}
          onClick={() => void recheck()}
        >
          {checking
            ? lang === 'zh'
              ? '检测中…'
              : 'Checking…'
            : lang === 'zh'
              ? '重新检测'
              : 'Re-check'}
        </button>
      </div>
    </div>
  )
}
