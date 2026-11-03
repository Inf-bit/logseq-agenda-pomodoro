import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { fetchRawSampleDiag, fetchTaskCount, errMsg, probeTaskModel, fetchBlockByUuid } from '../data/queries'
import {
  jumpToBlock,
  readBlock,
  setMarker,
  setScheduledViaContent,
  setScheduledViaProperty,
} from '../data/writer'
import { dataChangedCountAtom, lastLoadedAtAtom, tasksAtom } from '../stores/tasks'
import { todayStr } from '../utils/date'

const btnClass =
  'px-3 py-1.5 rounded text-sm bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 text-left'
const boxClass = 'rounded border border-slate-200 bg-white p-3'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export default function DiagnosticsView(): JSX.Element {
  const tasks = useAtomValue(tasksAtom)
  const changedCount = useAtomValue(dataChangedCountAtom)
  const lastLoadedAt = useAtomValue(lastLoadedAtAtom)
  const [uuid, setUuid] = useState('')
  const [probeUuid, setProbeUuid] = useState('')
  const [output, setOutput] = useState<string>('（点击上方按钮运行检查，结果以 JSON 显示）')
  const [busy, setBusy] = useState(false)

  const run = async (title: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      const result = await fn()
      setOutput(`▶ ${title} ✓\n${JSON.stringify(result, null, 2)}`)
    } catch (e) {
      setOutput(`▶ ${title} ✗\n${errMsg(e)}${e instanceof Error && e.stack ? `\n${e.stack}` : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const targetUuid = uuid || tasks[0]?.uuid || ''
  const targetTask = tasks.find((t) => t.uuid === targetUuid) ?? tasks[0]

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <p className="text-sm text-slate-500">
        M1 spike 面板：验证设计文档 §6.3 / §9 列出的不确定项。建议顺序：① 环境信息 → ② 原始抽样（重点看
        scheduled/deadline 的值形态）→ 选择目标任务 → ④⑤⑥⑦ 写入测试 → ⑧ 跳转测试；
        另外在 Logseq 里随便编辑一个 block，观察「DB.onChanged 触发次数」是否增长。
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          className={btnClass}
          disabled={busy}
          onClick={() =>
            void run('① 环境信息', async () => {
              const app = logseq.App as unknown as {
                checkCurrentIsDbGraph?: () => Promise<boolean>
              }
              return {
                isDbGraph: app.checkCurrentIsDbGraph ? await app.checkCurrentIsDbGraph() : '(API 不存在)',
                taskCount: tasks.length,
                dataChangedCount: changedCount,
                lastLoadedAt: lastLoadedAt ? new Date(lastLoadedAt).toISOString() : null,
              }
            })
          }
        >
          ① 环境信息（是否 DB 图谱）
        </button>
        <button
          className={btnClass}
          disabled={busy}
          onClick={() =>
            void run('② 原始抽样（通道探测 + Task 标签 + status 属性）', () => fetchRawSampleDiag(3))
          }
        >
          ② 原始抽样
        </button>
        <button
          className={btnClass}
          disabled={busy}
          onClick={() => void run('③ 任务统计', () => fetchTaskCount())}
        >
          ③ 任务统计
        </button>
        <button
          className={btnClass}
          disabled={busy}
          onClick={() => void run('④ 读取目标 block', () => readBlock(targetUuid))}
        >
          ④ 读取目标 block
        </button>
        <button
          className={btnClass}
          disabled={busy}
          onClick={() =>
            void run('⑤ 写入A：upsertBlockProperty', async () => {
              const method = await setScheduledViaProperty(targetUuid, todayStr())
              await wait(300)
              return { method, blockAfter: await readBlock(targetUuid) }
            })
          }
        >
          ⑤ 写入A（property）
        </button>
        <button
          className={btnClass}
          disabled={busy}
          onClick={() =>
            void run('⑥ 写入B：SCHEDULED 内容行', async () => {
              const method = await setScheduledViaContent(targetUuid, todayStr())
              await wait(300)
              return { method, blockAfter: await readBlock(targetUuid) }
            })
          }
        >
          ⑥ 写入B（内容行）
        </button>
        <button
          className={btnClass}
          disabled={busy}
          onClick={() =>
            void run('⑦ marker 流转', async () => {
              const method = await setMarker(targetUuid, 'DOING')
              await wait(300)
              return { method, blockAfter: await readBlock(targetUuid) }
            })
          }
        >
          ⑦ 标记 DOING
        </button>
        <button
          className={btnClass}
          disabled={busy}
          onClick={() => void run('⑨ 探查：待办标签 / 完成时间属性 / 已完成样本', () => probeTaskModel())}
        >
          ⑨ 探查标签与属性
        </button>
        <div className="col-span-2 flex gap-2 items-center">
          <input
            className="flex-1 border rounded px-2 py-1 text-sm"
            placeholder="粘贴 uuid，或直接输入数字实体 id（如 76）"
            value={probeUuid}
            onChange={(e) => setProbeUuid(e.target.value)}
          />
          <button
            className={btnClass}
            disabled={busy || !probeUuid.trim()}
            onClick={() => void run('⑩ 读取指定 block 全属性', () => fetchBlockByUuid(probeUuid))}
          >
            ⑩ 读取该 block
          </button>
        </div>
        <button
          className={btnClass}
          disabled={busy || !targetTask}
          onClick={() =>
            void run('⑧ 跳转（scrollToBlockInPage）', async () => {
              if (!targetTask) throw new Error('没有可用任务')
              await jumpToBlock(targetTask)
              return { jumpedTo: targetTask.pageName, uuid: targetTask.uuid }
            })
          }
        >
          ⑧ 跳转
        </button>
      </div>

      <div className={boxClass}>
        <label className="text-sm font-medium block">
          目标任务：
          <select
            className="ml-2 border rounded px-2 py-1 max-w-full mt-1"
            value={targetUuid}
            onChange={(e) => setUuid(e.target.value)}
          >
            {tasks.map((t) => (
              <option key={t.uuid} value={t.uuid}>
                {`${t.marker} ${t.content.slice(0, 30)} @${t.pageName}`}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 text-xs text-slate-400">
          DB.onChanged 触发次数：{changedCount}（在 Logseq 中编辑任意 block 后应增长）
        </div>
      </div>

      <pre className={`${boxClass} text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto`}>
        {output}
      </pre>
    </div>
  )
}
