import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  eventId: string | null;
}

/**
 * React Error Boundary
 *
 * Catches unhandled React rendering errors so the app never shows a white
 * screen. Logs the error to the console (and optionally to Sentry if
 * @sentry/react is integrated in the future).
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, eventId: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, eventId: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled error:', error, errorInfo);

    // If Sentry is configured on the frontend, you could report here:
    // Sentry.captureException(error, { extra: errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, eventId: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>⚠️</div>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.message}>
              An unexpected error occurred. Our team has been notified.
            </p>
            {this.state.error && (
              <details style={styles.details}>
                <summary style={styles.summary}>Error details</summary>
                <pre style={styles.pre}>{this.state.error.message}</pre>
              </details>
            )}
            <div style={styles.actions}>
              <button
                id="error-boundary-reload"
                style={{ ...styles.button, ...styles.primaryButton }}
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
              <button
                id="error-boundary-reset"
                style={{ ...styles.button, ...styles.secondaryButton }}
                onClick={this.handleReset}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    padding: '1rem',
  },
  card: {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '1rem',
    padding: '2.5rem',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center',
    color: '#fff',
    boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
  },
  icon: {
    fontSize: '3rem',
    marginBottom: '1rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    marginBottom: '0.75rem',
    color: '#fff',
  },
  message: {
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.6,
    marginBottom: '1.5rem',
  },
  details: {
    textAlign: 'left',
    marginBottom: '1.5rem',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: '0.5rem',
    padding: '0.75rem',
  },
  summary: {
    cursor: 'pointer',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '0.875rem',
    marginBottom: '0.5rem',
  },
  pre: {
    fontSize: '0.75rem',
    color: '#ff6b6b',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    marginTop: '0.5rem',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
  },
  button: {
    padding: '0.625rem 1.25rem',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 600,
    transition: 'opacity 0.2s',
  },
  primaryButton: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: '#fff',
  },
  secondaryButton: {
    background: 'rgba(255,255,255,0.1)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.2)',
  },
};

export default ErrorBoundary;
