import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// base: './' 保证产物在 Logseq 插件 iframe 中以相对路径加载资源
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  // dev server（浏览器 mock 模式）下把真实 SDK 替换为空 stub：
  // 真实包 import 时安装宿主 postMessage 桥接，脱离 Logseq 无法工作；
  // window.logseq 由 src/mock/logseq-mock.ts 提供。build 产物不受影响。
  resolve:
    command === 'serve'
      ? {
          alias: [
            {
              find: /^@logseq\/libs$/,
              replacement: path.resolve(__dirname, 'src/mock/libs-stub.ts'),
            },
          ],
        }
      : {},
}))
