import { Component, ErrorInfo, ReactNode } from 'react';
import { logFrontend } from '../lib/tauri';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logFrontend('ERROR', `[ErrorBoundary] React render crash: ${error.message}\n${errorInfo.componentStack}`);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(9, 9, 11, 0.95)',
          color: '#f87171',
          padding: '24px',
          fontFamily: 'monospace',
          textAlign: 'center',
          zIndex: 9999,
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '12px' }}>Carousel Render Error</h2>
          <p style={{ color: '#d4d4d8', maxWidth: '600px', fontSize: '13px', marginBottom: '16px' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              background: '#27272a',
              border: '1px solid #3f3f46',
              color: '#ffffff',
              cursor: 'pointer',
            }}
          >
            Reload Interface
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
