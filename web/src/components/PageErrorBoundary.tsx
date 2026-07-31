import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '0.75rem',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#fff',
          margin: '1rem',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '1rem', fontSize: '0.875rem' }}>
            This section encountered an error. The rest of the app is still working.
          </p>
          {this.state.error && (
            <details style={{ textAlign: 'left', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem', padding: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>
                Error details
              </summary>
              <pre style={{ fontSize: '0.7rem', color: '#ff6b6b', whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>
                {this.state.error.message}
              </pre>
            </details>
          )}
          <button
            onClick={this.handleReset}
            style={{
              padding: '0.5rem 1rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PageErrorBoundary;
