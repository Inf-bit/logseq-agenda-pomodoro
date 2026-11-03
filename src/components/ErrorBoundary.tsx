import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: string | null
}

/** 渲染错误边界：真实环境调试用——错误显示在界面上而非白屏无反应 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? null })
    console.error('[AgendaPomodoro] render error:', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-4 space-y-3">
          <div className="rounded border border-red-300 bg-red-50 px-4 py-3 space-y-2">
            <h2 className="font-bold text-red-700">⚠️ 界面渲染出错 / Render error</h2>
            <pre className="text-xs whitespace-pre-wrap break-all text-red-600">
              {this.state.error.message}
            </pre>
            {this.state.info && (
              <pre className="text-[10px] whitespace-pre-wrap break-all text-red-400 max-h-48 overflow-auto">
                {this.state.info}
              </pre>
            )}
            <button
              className="px-3 py-1 rounded text-sm bg-red-600 text-white hover:bg-red-700"
              onClick={() => this.setState({ error: null, info: null })}
            >
              重试 / Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
