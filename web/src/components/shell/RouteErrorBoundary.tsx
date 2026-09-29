import { Component, type ErrorInfo, type ReactNode } from "react";
import { LayoutDashboard, RefreshCw, RotateCcw } from "lucide-react";
import { GButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

/** A lazy screen whose code is gone (a deploy replaced it) or unreachable (offline). */
export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed|MIME type of "text\/html"/i.test(text);
}

type Props = { children: ReactNode; onHome: () => void };
type State = { error: Error | null };

/**
 * Keeps a failed screen inside the shell. The sidebar, focus dock and a
 * playing soundscape survive; only the page area shows the recovery card.
 * The parent keys this by route, so navigating away clears the error.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AXOM] A screen failed to render; the shell stayed open", error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <section className="route-error" role="alert" aria-labelledby="route-error-title">
        <div className="route-error-card">
          <h2 id="route-error-title">{stale ? "This screen needs the latest AXOM" : "This screen hit a snag"}</h2>
          <p>
            {stale
              ? "AXOM was updated while this window was open, so this screen's code moved. Reload to open the newest version. Your saved work stays put."
              : "Nothing you saved was lost. Try the screen again, or head back to the dashboard."}
          </p>
          <div className="route-error-actions">
            {stale ? (
              <GButton variant="primary" onClick={() => window.location.reload()}>
                <RefreshCw size={ICON_SIZE.body} /> Reload AXOM
              </GButton>
            ) : (
              <GButton variant="primary" onClick={() => this.setState({ error: null })}>
                <RotateCcw size={ICON_SIZE.body} /> Try again
              </GButton>
            )}
            <GButton onClick={this.props.onHome}>
              <LayoutDashboard size={ICON_SIZE.body} /> Dashboard
            </GButton>
          </div>
          <details className="route-error-details">
            <summary>Technical details</summary>
            <pre>{String(error.message).slice(0, 1200)}</pre>
          </details>
        </div>
      </section>
    );
  }
}
