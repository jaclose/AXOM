import { Component, type ErrorInfo, type ReactNode } from "react";

/** Render failures must leave a useful recovery screen, never a blank window. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AXOM] Interface failed; local data was not reset", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" style={{ maxWidth: 640, margin: "12vh auto", padding: 32, fontFamily: "system-ui", lineHeight: 1.6 }}>
        <h1>AXOM needs to reopen this screen</h1>
        <p>A screen could not finish rendering. Your local data has not been cleared. Reopen AXOM; if this repeats, keep your data and share the technical details below.</p>
        <button type="button" onClick={() => window.location.reload()}>Reopen AXOM</button>
        <details><summary>Technical details</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(this.state.error.message).slice(0, 2000)}</pre></details>
      </main>
    );
  }
}
