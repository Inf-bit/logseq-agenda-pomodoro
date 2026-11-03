/**
 * 浏览器开发模式入口：安装 logseq mock 后加载插件主逻辑。
 * 仅被 dev.html 引用；生产入口是 index.html → src/main.tsx。
 */
import './mock/logseq-mock'
import './main'
