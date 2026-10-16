import { useEffect, useId, useState } from "react";
import { AlertTriangle, Download, RefreshCw, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import type { BuildInfo } from "../../lib/buildInfo";
import { BUILD_INFO } from "../../lib/buildInfo";
import { STORAGE_KEYS } from "../../lib/brand";
import {
  readLastSeenBuild,
  readMigrationFailure,
  type StorageMigrationFailure,
  type StorageMigrationResult,
} from "../../lib/storageMigrations";
import {
  inspectLocalWorkspaceBackup,
  type LocalWorkspaceBackupInspection,
} from "../../lib/storageRecovery";
import { GButton, Tag } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

type ActionResult = void | boolean | StorageMigrationResult;

export interface RecoveryStatusCardProps {
  /** Omit to read the canonical device marker; pass null to force no card. */
  marker?: StorageMigrationFailure | null;
  /** Omit to read the existing last-seen build metadata. */
  previousBuild?: BuildInfo | null;
  onExport: () => void | boolean | Promise<void | boolean>;
  onChoosePortableRestore: () => void | Promise<void>;
  /** A reload handler is sufficient because startup reruns the migration. */
  onRetry: () => ActionResult | Promise<ActionResult>;
  /** Optional, confirmation-gated adapter for a verified automatic snapshot. */
  onRestoreAutomatic?: (backupKey: string) => void | boolean | Promise<void | boolean>;
  onResolved?: () => void;
  verifyBackup?: (backupKey: string) => Promise<LocalWorkspaceBackupInspection | null>;
}

type Verification =
  | { status: "none" }
  | { status: "checking" }
  | { status: "verified"; inspection: LocalWorkspaceBackupInspection }
  | { status: "unavailable" };

export function RecoveryStatusCard({
  marker,
  previousBuild,
  onExport,
  onChoosePortableRestore,
  onRetry,
  onRestoreAutomatic,
  onResolved,
  verifyBackup = inspectLocalWorkspaceBackup,
}: RecoveryStatusCardProps) {
  const headingId = useId();
  const [activeMarker, setActiveMarker] = useState<StorageMigrationFailure | null>(() => (
    marker === undefined ? readMigrationFailure() : marker
  ));
  const [verification, setVerification] = useState<Verification>({ status: "none" });
  const [busy, setBusy] = useState<"export" | "portable" | "restore" | "retry" | null>(null);
  const [actionStatus, setActionStatus] = useState<{ message: string; failed: boolean } | null>(null);
  const priorBuild = previousBuild === undefined ? readLastSeenBuild() : previousBuild;

  useEffect(() => {
    setActiveMarker(marker === undefined ? readMigrationFailure() : marker);
  }, [marker]);

  useEffect(() => {
    const key = activeMarker?.backupKey;
    if (!key) {
      setVerification({ status: "none" });
      return;
    }
    let cancelled = false;
    setVerification({ status: "checking" });
    verifyBackup(key)
      .then((inspection) => {
        if (cancelled) return;
        setVerification(inspection
          ? { status: "verified", inspection }
          : { status: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setVerification({ status: "unavailable" });
      });
    return () => { cancelled = true; };
  }, [activeMarker?.backupKey, verifyBackup]);

  if (!activeMarker) return null;

  const backupAt = verification.status === "verified"
    ? verification.inspection.savedAt
    : backupTimeFromKey(activeMarker.backupKey);

  async function runAction(
    kind: NonNullable<typeof busy>,
    action: () => void | boolean | Promise<void | boolean>,
    successMessage: string,
  ) {
    setBusy(kind);
    setActionStatus(null);
    try {
      const result = await action();
      setActionStatus(result === false
        ? { message: "That recovery action did not finish. Review the details below and try again.", failed: true }
        : { message: successMessage, failed: false });
    } catch (error) {
      setActionStatus({
        message: error instanceof Error ? error.message : "That recovery action could not be completed.",
        failed: true,
      });
    } finally {
      setBusy(null);
    }
  }

  async function retryStartup() {
    setBusy("retry");
    setActionStatus(null);
    try {
      const result = await onRetry();
      if (retrySucceeded(result)) {
        setActiveMarker(null);
        onResolved?.();
        return;
      }
      setActionStatus({
        message: retryFailed(result)
          ? "AXOM still could not complete the storage update. The original workspace remains in place."
          : "Startup retry requested. This card remains until the update completes successfully.",
        failed: retryFailed(result),
      });
    } catch (error) {
      setActionStatus({
        message: error instanceof Error ? error.message : "AXOM could not retry startup.",
        failed: true,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="backup-actions-panel" aria-labelledby={headingId}>
      <div className="spread" style={{ gap: 12, alignItems: "flex-start" }}>
        <div>
          <h4 id={headingId} style={{ margin: 0 }}>Workspace recovery</h4>
          <div className="sub" style={{ marginTop: 4 }}>
            AXOM warned because it could not finish a storage update during startup.
          </div>
        </div>
        <Tag tone="orange"><AlertTriangle size={ICON_SIZE.microInline} /> Needs attention</Tag>
      </div>

      <p className="sub" style={{ margin: 0 }}>
        Your original workspace was left in place and was not deleted. You can export the current
        workspace, choose a portable backup, or retry startup after reviewing the safety snapshot.
      </p>

      <dl className="sync-meta-grid" style={{ margin: 0 }}>
        <RecoveryDetail
          term="Previous version"
          detail={`Schema v${activeMarker.fromVersion} · app ${priorBuild?.version ?? "unknown"}`}
        />
        <RecoveryDetail
          term="Current version"
          detail={`Schema v${activeMarker.toVersion} · app ${activeMarker.build.version || BUILD_INFO.version}`}
        />
        <RecoveryDetail term="Safety snapshot" detail={backupAt ? formatDate(backupAt) : "Not created"} />
        <RecoveryDetail term="Verification" detail={verificationLabel(verification)} />
      </dl>

      <div className="row wrap gap8">
        <GButton
          size="sm"
          onClick={() => runAction("export", onExport, "Export started. Keep the downloaded file somewhere safe.")}
          disabled={busy !== null}
        >
          <Download size={ICON_SIZE.body} /> {busy === "export" ? "Exporting…" : "Export current workspace"}
        </GButton>
        <GButton
          size="sm"
          onClick={() => runAction("portable", onChoosePortableRestore, "Choose an AXOM backup file to continue.")}
          disabled={busy !== null}
        >
          <Upload size={ICON_SIZE.body} /> Choose backup file
        </GButton>
        {onRestoreAutomatic && activeMarker.backupKey && (
          <GButton
            size="sm"
            onClick={() => runAction(
              "restore",
              () => onRestoreAutomatic(activeMarker.backupKey!),
              "The verified workspace snapshot was restored. Retry startup to finish recovery.",
            )}
            disabled={busy !== null || verification.status !== "verified"}
          >
            {verification.status === "verified" ? <RotateCcw size={ICON_SIZE.body} /> : <ShieldCheck size={ICON_SIZE.body} />}
            {busy === "restore" ? "Restoring…" : "Restore safety snapshot"}
          </GButton>
        )}
        <GButton size="sm" variant="primary" onClick={retryStartup} disabled={busy !== null}>
          <RefreshCw size={ICON_SIZE.body} className={busy === "retry" ? "spin" : ""} />
          {busy === "retry" ? "Retrying…" : "Retry startup"}
        </GButton>
      </div>

      {actionStatus && (
        <div className="backup-status" role={actionStatus.failed ? "alert" : "status"}>
          {actionStatus.message}
        </div>
      )}

      <details>
        <summary>Technical details</summary>
        <div className="sub" style={{ marginTop: 8 }}>
          {activeMarker.errorMessage} · Recorded {formatDate(activeMarker.at)}
        </div>
      </details>
    </section>
  );
}

function RecoveryDetail({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="sync-meta-item">
      <dt>{term}</dt>
      <dd style={{ margin: 0 }}>{detail}</dd>
    </div>
  );
}

function verificationLabel(verification: Verification) {
  if (verification.status === "checking") return "Checking snapshot…";
  if (verification.status === "verified") return "Readable workspace snapshot";
  if (verification.status === "unavailable") return "Snapshot could not be verified";
  return "No automatic snapshot was created";
}

function retrySucceeded(result: ActionResult): boolean {
  return result === true || (typeof result === "object" && result !== null && result.ok === true);
}

function retryFailed(result: ActionResult): boolean {
  return result === false || (typeof result === "object" && result !== null && result.ok === false);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function backupTimeFromKey(key: string | null) {
  if (!key?.startsWith(STORAGE_KEYS.localBackupPrefix)) return null;
  const timestamp = key.slice(STORAGE_KEYS.localBackupPrefix.length);
  return Number.isNaN(new Date(timestamp).getTime()) ? null : timestamp;
}
