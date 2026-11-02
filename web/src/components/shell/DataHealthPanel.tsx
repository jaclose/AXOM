// ===========================================================================
// Local data health (directive §5) — the visible trust surface: storage
// driver, record counts, schema/migration state, last backup age, and the
// pre-migration snapshot recovery path. No silent states.
// ===========================================================================
import { useEffect, useState, useSyncExternalStore } from "react";
import { Database, HardDrive, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import { useStore } from "../../lib/store";
import { findOrphans } from "../../lib/orphanRepair";
import { STORAGE_KEYS } from "../../lib/brand";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import { pushToast } from "../../lib/toast";
import { ICON_SIZE } from "../../lib/iconSize";
import { subscribeVault, useLastVaultWrite } from "./SettingsSections";
import { readVaultWriteFailure } from "../../lib/vaultActivity";
import { localVaultStorage, flushLocalVaultWrites } from "../../lib/localVault";
import { toPortableState } from "../../lib/backup";
import { TechnicalDetails } from "./TechnicalDetails";

async function probeIndexedDb(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(false);
      const req = indexedDB.open(STORAGE_KEYS.vaultDb);
      req.onsuccess = () => { req.result.close(); resolve(true); };
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export function DataHealthPanel({ onOpenBackup }: { onOpenBackup?: () => void } = {}) {
  const s = useStore();
  const failure = useSyncExternalStore(subscribeVault, readVaultWriteFailure, () => null);
  const lastWrite = useLastVaultWrite();
  const [saving, setSaving] = useState(false);
  async function retrySave() {
    setSaving(true);
    try {
      await flushLocalVaultWrites();
      const state = useStore.getState();
      const options = useStore.persist.getOptions();
      const value = JSON.stringify({ state: options.partialize ? options.partialize(state) : state, version: options.version });
      await localVaultStorage.setItem(STORAGE_KEYS.persistedState, value);
      if (await localVaultStorage.getItem(STORAGE_KEYS.persistedState) !== value) throw new Error("Saving is still unavailable. Export a backup while this window is open.");
      pushToast({ title: "Workspace saved", tone: "success" });
    } catch (error) {
      pushToast({ title: "Keep this window open", body: error instanceof Error ? error.message : "Export a backup before reloading.", tone: "warn" });
    } finally { setSaving(false); }
  }
  const [idbOk, setIdbOk] = useState<boolean | null>(null);
  const [storageUsed, setStorageUsed] = useState<string>("Checking…");

  useEffect(() => {
    let stopped = false;
    probeIndexedDb().then((ok) => { if (!stopped) setIdbOk(ok); });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    let stopped = false;
    if (!navigator.storage?.estimate) {
      setStorageUsed("Unavailable");
      return;
    }
    navigator.storage.estimate()
      .then(({ usage }) => {
        if (!stopped) setStorageUsed(formatBytes(usage ?? 0));
      })
      .catch(() => { if (!stopped) setStorageUsed("Unavailable"); });
    return () => { stopped = true; };
  }, []);

  const orphans = findOrphans(s);
  const checksumCounts = new Map<string, number>();
  for (const document of s.documents ?? []) {
    if (document.checksum) checksumCounts.set(document.checksum, (checksumCounts.get(document.checksum) ?? 0) + 1);
  }
  const duplicateSources = [...checksumCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const counts: Array<[string, number]> = [
    ["Tracker items", s.tracker.length],
    ["Tasks", s.tasks.length],
    ["Study logs", s.logs.length],
    ["Sessions", (s.sessions ?? []).length],
    ["Questions", (s.questions ?? []).length],
    ["Cards", (s.ankiCards ?? []).length],
    ["Journal entries", s.journal.length],
    ["Closeouts", (s.closeouts ?? []).length],
  ];
  const saveTone = failure ? "needs-attention" : idbOk === false ? "fallback" : lastWrite ? "saved" : "pending";
  const saveTitle = failure ? "Your latest changes need saving"
    : idbOk === false ? "Main vault unavailable"
      : lastWrite ? "Saved on this device" : "Waiting for the first save";
  const saveDescription = failure
    ? "Keep AXOM open. Try saving again, then export a backup if the problem continues."
    : idbOk === false
      ? `The main vault could not open.${lastWrite?.target === "local-fallback" ? " Your last confirmed save used browser fallback storage." : " A fallback save has not been confirmed."} Export a portable backup.`
      : lastWrite
        ? `Last confirmed at ${new Date(lastWrite.at).toLocaleTimeString()}${lastWrite.target === "local-fallback" ? " in browser fallback storage" : ""}. Your work stays available on this device.`
        : "AXOM will confirm this workspace as soon as the first local save finishes.";

  return (
    <div className="data-health-panel">
      <section className={`data-health-state ${saveTone}`} aria-labelledby="data-health-save-title" role="status">
        <div className="data-health-state-icon" aria-hidden="true">
          {failure || idbOk === false ? <ShieldAlert size={ICON_SIZE.display} /> : <ShieldCheck size={ICON_SIZE.display} />}
        </div>
        <div className="data-health-state-copy">
          <span className="data-health-eyebrow">Local workspace</span>
          <h5 id="data-health-save-title">{saveTitle}</h5>
          <p>{saveDescription}</p>
        </div>
        {(failure || idbOk === false) && (
          <div className="data-health-state-actions">
            {failure && <GButton variant="primary" disabled={saving} onClick={retrySave}>{saving ? "Saving…" : "Try saving again"}</GButton>}
            {onOpenBackup && <GButton onClick={onOpenBackup}>Open Emergency recovery</GButton>}
          </div>
        )}
      </section>

      <section className="data-health-inventory" aria-labelledby="data-health-inventory-title">
        <div className="data-health-inventory-head">
          <div>
            <span className="data-health-eyebrow">On this device</span>
            <h5 id="data-health-inventory-title">Your saved work</h5>
          </div>
          <span className="data-health-inventory-total">{counts.reduce((total, [, count]) => total + count, 0).toLocaleString()} records</span>
        </div>
        <div className="data-health-grid">
          {counts.map(([label, count]) => (
            <div key={label} className="data-health-cell">
              <b>{count.toLocaleString()}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      {orphans.totalIssues > 0 && (
        <section className="data-health-repair" aria-label="Question link repair">
          <Wrench size={ICON_SIZE.body} aria-hidden="true" />
          <div><b>{orphans.totalIssues} question link{orphans.totalIssues === 1 ? " needs" : "s need"} repair</b><p>Repair reconnects records. It never deletes questions or history.</p></div>
          <GhostButton onClick={() => {
            const fixed = s.repairQuestionBankOrphans();
            pushToast({ title: fixed ? `Repaired ${fixed} link${fixed === 1 ? "" : "s"}` : "Nothing to repair", tone: "success" });
          }}>Repair links</GhostButton>
        </section>
      )}

      <TechnicalDetails>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Tag tone={failure || idbOk === false ? "orange" : idbOk === null ? "neutral" : "green"}>
            <Database size={ICON_SIZE.microInline} /> {idbOk === null ? "Checking storage…" : idbOk ? "IndexedDB available" : "localStorage fallback"}
          </Tag>
          <Tag tone="neutral"><HardDrive size={ICON_SIZE.microInline} /> Whole browser storage: {storageUsed}</Tag>
          <Tag tone={failure ? "orange" : lastWrite ? "green" : "neutral"}><ShieldCheck size={ICON_SIZE.microInline} /> {failure ? "Autosave needs attention" : lastWrite ? "Last save confirmed" : "Save not yet confirmed"}</Tag>
          <Tag tone={duplicateSources ? "orange" : "green"}>
            <FileFingerprintIcon /> {duplicateSources ? `${duplicateSources} duplicate source${duplicateSources === 1 ? "" : "s"}` : "Source checksums healthy"}
          </Tag>
        </div>
        <p>{orphans.totalIssues === 0 ? "Question-bank links are healthy: no orphaned questions, sets, or documents." : `${orphans.totalIssues} dangling link${orphans.totalIssues === 1 ? "" : "s"} across questions, sets, and documents.`}</p>
        <p>Workspace records: {formatBytes(new TextEncoder().encode(JSON.stringify(toPortableState(s))).length)} before compression. Browser storage also includes images, safety snapshots and cached app files. It is not your account size.</p>
      </TechnicalDetails>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileFingerprintIcon() {
  return <span aria-hidden="true" style={{ fontSize: 11, fontWeight: 800 }}>#</span>;
}
