import { atom, getDefaultStore, useAtomValue } from 'jotai'

/** 全局运行时错误（window error / unhandledrejection），浮层显示便于真实环境诊断 */
export const runtimeErrorsAtom = atom<Array<{ id: number; text: string }>>([])

let nextId = 1

export function pushRuntimeError(text: string): void {
  console.error('[AgendaPomodoro]', text)
  const store = getDefaultStore()
  const cur = store.get(runtimeErrorsAtom)
  store.set(runtimeErrorsAtom, [...cur.slice(-4), { id: nextId++, text }])
}

/** 注册全局错误捕获（main.tsx 在 ready 前调用） */
export function registerGlobalErrorCapture(): void {
  window.addEventListener('error', (e) => {
    pushRuntimeError(
      `${e.message} @${e.filename ?? ''}:${e.lineno ?? 0}`,
    )
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    pushRuntimeError(
      `unhandled rejection: ${r instanceof Error ? `${r.message}\n${r.stack ?? ''}` : String(r)}`,
    )
  })
}

export function RuntimeErrorBar(): JSX.Element | null {
  const errors = useAtomValue(runtimeErrorsAtom)
  if (errors.length === 0) return null
  return (
    <div className="fixed bottom-2 right-2 z-50 space-y-1 max-w-md">
      {errors.map((e) => (
        <div
          key={e.id}
          className="rounded border border-red-400 bg-red-100 px-3 py-2 text-xs text-red-700 shadow-lg whitespace-pre-wrap break-all"
        >
          {e.text}
        </div>
      ))}
    </div>
  )
}
