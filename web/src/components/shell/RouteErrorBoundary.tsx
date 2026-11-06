import { Component, type ErrorInfo, type ReactNode } from "react";
import { LayoutDashboard, RefreshCw, RotateCcw } from "lucide-react";
import { GButton } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { createUpdateCheckpoint } from "../../lib/updateCheckpoint";
import { activateWaitingWebUpdate } from "../../lib/webUpdates";
import { isChunkLoadError } from "../../lib/chunkErrors";

export { isChunkLoadError };

type Props = { children: ReactNode; onHome: () => void };
type State = { error: Error | null; saving?: boolean; recoveryError?: string; canContinueWithoutRecoverySnapshot?: boolean };

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
  reloadSafely = async () => {
    this.setState({ saving: true, recoveryError: undefined, canContinueWithoutRecoverySnapshot: false });
    try {
      await createUpdateCheckpoint(false);
      await activateWaitingWebUpdate();
      window.location.reload();
    } catch (error) {
      this.setState({
        saving: false,
        recoveryError: error instanceof Error ? error.message : "Could not save your workspace. Export a backup before reloading.",
        canContinueWithoutRecoverySnapshot: canContinueWithoutSnapshot(error),
      });
    }
  };
  reloadWithVerifiedSave = async () => {
    // A verified primary save does not imply an independent recovery backup.
    // Keep the fallback opt-in, even when a stale screen interrupted work.
    if (!window.confirm("AXOM verified your saved workspace, but could not create an extra recovery copy. Are you sure you want to refresh without that extra recovery copy? Export a backup first if you need one.")) return;
    this.setState({ saving: true, recoveryError: undefined, canContinueWithoutRecoverySnapshot: false });
    try {
      await createUpdateCheckpoint(false, { skipRecoverySnapshot: true });
      await activateWaitingWebUpdate();
      window.location.reload();
    } catch (error) {
      this.setState({
        saving: false,
        recoveryError: error instanceof Error ? error.message : "Could not verify your saved workspace. This window has been kept open.",
      });
    }
  };
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
              ? "This screen could not load. A connection problem or an app update may be responsible. AXOM will verify your saved work before reloading."
              : "Nothing you saved was lost. Try the screen again, or head back to the dashboard."}
          </p>
          <div className="route-error-actions">
            {stale ? (
              <>
                <GButton variant="primary" disabled={this.state.saving} onClick={this.reloadSafely}>
                  <RefreshCw size={ICON_SIZE.body} /> {this.state.saving ? "Saving before reload…" : "Reload AXOM"}
                </GButton>
                {this.state.canContinueWithoutRecoverySnapshot && <GButton disabled={this.state.saving} onClick={this.reloadWithVerifiedSave}>
                  <RefreshCw size={ICON_SIZE.body} /> Refresh with verified save
                </GButton>}
              </>
            ) : (
              <GButton variant="primary" onClick={() => this.setState({ error: null })}>
                <RotateCcw size={ICON_SIZE.body} /> Try again
              </GButton>
            )}
            <GButton onClick={this.props.onHome}>
              <LayoutDashboard size={ICON_SIZE.body} /> Dashboard
            </GButton>
          </div>
          {this.state.recoveryError && <p role="status">{this.state.recoveryError} This window has been kept open.</p>}
          {this.state.canContinueWithoutRecoverySnapshot && <p className="sub">Your saved workspace was verified, but AXOM could not create an extra recovery copy. Export a backup first if you need one, or refresh with the verified save after confirmation.</p>}
          <details className="route-error-details">
            <summary>Technical details</summary>
            <pre>{String(error.message).slice(0, 1200)}</pre>
          </details>
        </div>
      </section>
    );
  }
}

function canContinueWithoutSnapshot(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "canContinueWithoutRecoverySnapshot" in error
    && error.canContinueWithoutRecoverySnapshot === true;
}
