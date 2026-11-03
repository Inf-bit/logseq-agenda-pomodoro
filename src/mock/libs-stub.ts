/**
 * 浏览器开发模式下的 @logseq/libs 替身（vite serve 时经 alias 生效）。
 * 真实包在 import 时会安装宿主 postMessage 桥接，脱离 Logseq 宿主无法工作；
 * dev 模式由 src/mock/logseq-mock.ts 提供 window.logseq。
 */
export {}
