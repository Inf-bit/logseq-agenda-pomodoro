# logseq-agenda-pomodoro

Agenda views (month / today / backlog / kanban) with a built-in pomodoro timer, for **Logseq DB graphs** (Logseq 2.x).

Logseq **DB 图谱**专用的 Agenda 插件：月历 / 今日 / 待办 / 看板四个视图 + 内置番茄钟。基于 [haydenull/logseq-plugin-agenda](https://github.com/haydenull/logseq-plugin-agenda) 改写，详见下方「出处与致谢」。

## 出处与致谢（Credits）

**本项目不是从零开始的原创作品。** 它基于下列开源项目改写而来，产品思路、视图形态与部分实现参考了它们的源码：

- [haydenull/logseq-plugin-agenda](https://github.com/haydenull/logseq-plugin-agenda) —— **原项目**：Agenda 插件（月历 / 今日 / 看板 / 任务改期等）。本项目针对 Logseq **DB 版图谱**重写了查询与写入层、重构了三个视图，并集成了番茄钟。
- [sawhney17/logseq-pomodoro-plugin](https://github.com/sawhney17/logseq-pomodoro-plugin) —— 工具栏计时器实现参考。
- [sethyuan/logseq-plugin-task-reminder](https://github.com/sethyuan/logseq-plugin-task-reminder) —— 任务记录格式参考。
- [logseq/logseq-plugin-samples](https://github.com/logseq/logseq-plugin-samples) —— 官方插件示例与 API 用法。

原项目版权归其作者所有，详见对应仓库的 LICENSE；本仓库同样以 MIT 协议发布，并在此保留对原作者的署名。若你是原作者并希望调整署名方式，欢迎提 issue 联系。

## Features

- **Today view** — doing / due today / overdue / backlog in one page; jump to source block, mark done, schedule to today
- **Month view** — FullCalendar month grid; scheduled (blue) vs deadline (orange), overdue in red; drag to reschedule
- **Kanban** — overdue / today / tomorrow / this week / later / no date; drag across columns to reschedule
- **Pomodoro timer** — start from any task (🍅 button) or command palette on current block; toolbar countdown; system notification + beep on finish; **records written back to the task block** as `pomodoro-log` property
- **Live refresh** — `DB.onChanged` driven (with focus/interval fallback)
- **Dark mode** follows Logseq; UI in Chinese or English

## Pomodoro log format

Each finished/interrupted focus session appends to the task block property `pomodoro-log`:

```json
[{"ts":1761600000000,"minutes":25,"status":"done"}]
```

Query your pomodoros with a Datalog query on `:block/properties`.

## Install (dev / unpacked)

```bash
npm install
npm run build
```

1. Logseq → Settings → General → enable **Developer mode**
2. Toolbar `...` → Plugins → **Load unpacked plugin** → select this directory

## Settings

- Language (`zh` / `en`), week start, default tab
- Pomodoro: focus / short break / long break minutes, long-break interval, auto-start next, sound

## Compatibility

- Logseq **DB graph** (2.x). File-based (OG) graphs are not supported (see design doc).
- SDK: `@logseq/libs` 0.3.x

## License

MIT
