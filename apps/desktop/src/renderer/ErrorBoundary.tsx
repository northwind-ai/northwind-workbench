import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: string;
}

/**
 * Renderer crash guard. Catches render/runtime errors, reports them to the main
 * process log, and shows a safe fallback with recovery actions — so the app
 * never white-screens silently.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info: info.componentStack ?? "" });
    void window.workbench?.logError?.(
      "renderer",
      `${error.message}\n${error.stack ?? ""}\n${info.componentStack ?? ""}`,
    );
  }

  private reload = (): void => window.location.reload();
  private openLogs = (): void => void window.workbench?.openLogsFolder?.();

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="pw-crash">
        <div className="pw-crash__card">
          <div className="pw-crash__icon">⚠️</div>
          <h1>Something went wrong</h1>
          <p className="pw-muted">
            The interface hit an unexpected error. Your work and history are
            safe on disk.
          </p>
          <div className="pw-crash__actions">
            <button className="pw-btn" onClick={this.reload}>
              Reload
            </button>
            <button className="pw-btn pw-btn--ghost" onClick={this.openLogs}>
              Open Logs Folder
            </button>
          </div>
          <details className="pw-crash__details">
            <summary>Error details</summary>
            <pre className="pw-log">
              {error.message}
              {"\n"}
              {error.stack}
              {info}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
