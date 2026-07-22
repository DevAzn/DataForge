import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches render crashes so the window is never a silent blank. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[DataForge] UI crash', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            height: '100%',
            overflow: 'auto',
            background: '#0f1419',
            color: '#e7ecf3',
            fontFamily: 'system-ui, sans-serif',
            padding: '2rem'
          }}
        >
          <h1 style={{ color: '#f87171', fontSize: '1.25rem', marginBottom: '0.75rem' }}>
            DataForge hit a UI error
          </h1>
          <p style={{ color: '#8b9bb4', marginBottom: '1rem' }}>
            The window was blank because React stopped rendering. Details:
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: '#1a2332',
              border: '1px solid #2d3a4d',
              borderRadius: 8,
              padding: '1rem',
              fontSize: 12,
              color: '#fbbf24'
            }}
          >
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: 6,
              border: 'none',
              background: '#3b82f6',
              color: '#fff',
              cursor: 'pointer'
            }}
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
          >
            Reload app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
