import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Without this, any uncaught render error blanks the
 * entire window with no recovery path. Here we catch it, log it, and show a
 * recoverable fallback so the operator can reload the view instead of being
 * stuck on a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    this.setState({ error: null });
    window.location.hash = '#/';
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950 p-6 text-surface-100">
        <div className="w-full max-w-md rounded-xl border border-surface-800 bg-surface-900 p-8 text-center shadow-2xl">
          <h1 className="mb-2 text-lg font-semibold text-red-400">Something went wrong</h1>
          <p className="mb-6 text-sm text-surface-400">
            The screen hit an unexpected error and could not finish loading. Your data is safe —
            reloading usually resolves it.
          </p>
          <pre className="mb-6 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-surface-950 p-3 text-left text-xs text-surface-500">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-500"
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
