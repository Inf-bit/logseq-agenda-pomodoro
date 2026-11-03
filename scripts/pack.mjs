/**
 * 打包成可直接分发的插件压缩包：
 *   npm run build && npm run pack
 * 产物：release/logseq-agenda-pomodoro-v<version>.zip
 * 包内结构：logseq-agenda-pomodoro/{package.json,icon.png,README.md,LICENSE,dist/}
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = 'logseq-agenda-pomodoro'
const releaseDir = join(root, 'release')
const stageDir = join(releaseDir, name)
const zipPath = join(releaseDir, `${name}-v${version}.zip`)

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('缺少 dist/index.html，请先执行 npm run build')
  process.exit(1)
}

rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })
for (const f of ['package.json', 'icon.png', 'README.md', 'LICENSE']) {
  cpSync(join(root, f), join(stageDir, f))
}
cpSync(join(root, 'dist'), join(stageDir, 'dist'), { recursive: true })

if (process.platform === 'win32') {
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${stageDir}' -DestinationPath '${zipPath}' -Force`,
  ])
} else {
  execFileSync('zip', ['-r', '-q', zipPath, name], { cwd: releaseDir })
}

console.log(`已生成 ${zipPath}`)
