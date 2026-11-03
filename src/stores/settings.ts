import { atom, getDefaultStore } from 'jotai'
import type { Lang } from '../i18n'

export type TabId = 'today' | 'month' | 'kanban' | 'diagnostics'

interface PluginSettings {
  lang?: Lang
  weekStart?: 0 | 1 // 0=周日 1=周一
  defaultTab?: TabId
}

export const langAtom = atom<Lang>('zh')
export const weekStartAtom = atom<0 | 1>(1)
export const defaultTabAtom = atom<TabId>('today')
export const themeAtom = atom<'light' | 'dark'>('light')

const store = getDefaultStore()

/** 从 logseq.settings 读取（main.tsx 在 ready 前调用） */
export function initSettings(): void {
  const s = (logseq.settings ?? {}) as PluginSettings
  store.set(langAtom, s.lang === 'en' ? 'en' : 'zh')
  store.set(weekStartAtom, s.weekStart === 0 ? 0 : 1)
  const tab = s.defaultTab
  store.set(
    defaultTabAtom,
    tab === 'month' || tab === 'kanban' || tab === 'diagnostics' ? tab : 'today',
  )
}

export function setTheme(mode: 'light' | 'dark'): void {
  store.set(themeAtom, mode)
}
