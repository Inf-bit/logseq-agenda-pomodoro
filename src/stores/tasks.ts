import { atom, getDefaultStore } from 'jotai'
import { fetchTaskEntities, errMsg, isDbNotReady, withDbReadyRetry } from '../data/queries'
import { toTask } from '../data/taskMapper'
import type { Task } from '../types'
import { todayStr } from '../utils/date'

export const tasksAtom = atom<Task[]>([])
/** 全部已完成（DONE/CANCELED）任务，带 completedAt 完成日期 */
export const completedAtom = atom<Task[]>([])
/** 今日已完成：完成日期 = 今天（按完成日期归档，而非按任务所在日志页） */
export const doneTodayAtom = atom<Task[]>([])
export const loadStateAtom = atom<'idle' | 'loading' | 'error'>('idle')
export const loadErrorAtom = atom<string | null>(null)
export const lastLoadedAtAtom = atom<number | null>(null)
export const dataChangedCountAtom = atom(0)
/** 当前图谱不是 DB 版（D1：明确提示而非静默失败） */
export const notDbGraphAtom = atom(false)

const store = getDefaultStore()

let inflight: Promise<void> | null = null

/** 单次刷新总超时：真实环境 API 挂起时转成可见错误，而非无限 loading */
function withTimeout<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`查询超时（${ms / 1000}s）— 宿主 API 无响应`)),
      ms,
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

const OPEN_MARKERS = new Set(['TODO', 'DOING', 'NOW', 'LATER', 'WAITING'])

export function refreshTasks(): Promise<void> {
  if (inflight) return inflight
  store.set(loadStateAtom, 'loading')
  inflight = (async () => {
    try {
      // 插件可能在 Logseq 数据库 worker 就绪前被触发：这类错误重试，避免启动瞬间整页报错
      let isDb = await withTimeout(withDbReadyRetry(() => logseq.App.checkCurrentIsDbGraph()))
      if (!isDb) {
        // 启动竞态下 checkCurrentIsDbGraph 可能短暂返回 false，稍后再确认一次
        await new Promise((r) => window.setTimeout(r, 1200))
        isDb = await withTimeout(withDbReadyRetry(() => logseq.App.checkCurrentIsDbGraph()))
      }
      if (!isDb) {
        store.set(notDbGraphAtom, true)
        store.set(tasksAtom, [])
        store.set(completedAtom, [])
        store.set(doneTodayAtom, [])
        store.set(loadErrorAtom, null)
        store.set(loadStateAtom, 'idle')
        return
      }
      store.set(notDbGraphAtom, false)
      const entities = await withTimeout(withDbReadyRetry(fetchTaskEntities))
      const all = entities
        .map((e) => toTask(e, { assumeTask: true }))
        .filter((t): t is Task => t !== null)
      const completed = all
        .filter((t) => t.marker === 'DONE' || t.marker === 'CANCELED')
        // 看板「已完成」列按完成日期倒序（日期缺失的排最后）
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      const today = todayStr()
      store.set(tasksAtom, all.filter((t) => OPEN_MARKERS.has(t.marker)))
      store.set(completedAtom, completed)
      store.set(
        doneTodayAtom,
        completed.filter((t) => t.completedAt === today),
      )
      store.set(loadErrorAtom, null)
      store.set(loadStateAtom, 'idle')
      store.set(lastLoadedAtAtom, Date.now())
    } catch (e) {
      store.set(
        loadErrorAtom,
        isDbNotReady(e)
          ? 'Logseq 数据库尚未就绪（图谱还在加载），稍后点「刷新」重试即可'
          : errMsg(e),
      )
      store.set(loadStateAtom, 'error')
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** DB 数据变更通知（onChanged 回调里调用）：计数 + debounce 后刷新 */
let changedTimer: number | undefined
export function notifyDataChanged(): void {
  store.set(dataChangedCountAtom, store.get(dataChangedCountAtom) + 1)
  clearTimeout(changedTimer)
  changedTimer = window.setTimeout(() => void refreshTasks(), 500)
}
