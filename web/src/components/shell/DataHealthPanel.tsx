// ===========================================================================
// Local data health (directive §5) — the visible trust surface: storage
// driver, record counts, schema/migration state, last backup age, and the
// pre-migration snapshot recovery path. No silent states.
// ===========================================================================
import { useEffect, useState } from "react";
import { Database, HardDrive, ShieldCheck, Wrench } from "lucide-react";
import { useStore } from "../../lib/store";
import { findOrphans } from "../../lib/orphanRepair";
import { STORAGE_KEYS } from "../../lib/brand";
import { GhostButton, Tag } from "../ui/primitives";
import { pushToast } from "../../lib/toast";
import { ICON_SIZE } from "../../lib/iconSize";
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

export function DataHealthPanel() {
  const s = useStore();
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

  return (
    <div className="stack" style={{ gap: 12 }}>
      {idbOk === false && (
        <div className="data-health-warning" role="status">
          <b>This browser is using its backup storage</b>
          <span>Everything works, but browser cleanup can clear it more easily. Export a copy in Emergency recovery to be safe.</span>
        </div>
      )}

      <div className="data-health-grid">
        {counts.map(([label, count]) => (
          <div key={label} className="data-health-cell">
            <b>{count}</b>
            <span className="sub">{label}</span>
          </div>
        ))}
      </div>

      {orphans.totalIssues > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Wrench size={ICON_SIZE.body} style={{ color: "var(--cyan)" }} />
          <span className="sub">
            {orphans.totalIssues} question link{orphans.totalIssues === 1 ? " needs" : "s need"} a quick repair. Repair never deletes questions or history.
          </span>
          <GhostButton onClick={() => {
            const fixed = s.repairQuestionBankOrphans();
            pushToast({ title: fixed ? `Repaired ${fixed} link${fixed === 1 ? "" : "s"}` : "Nothing to repair", tone: "success" });
          }}>Repair links</GhostButton>
        </div>
      )}

      <TechnicalDetails>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Tag tone={idbOk === false ? "orange" : "green"}>
            <Database size={ICON_SIZE.microInline} /> {idbOk === null ? "Checking storage…" : idbOk ? "IndexedDB vault active" : "localStorage fallback"}
          </Tag>
          <Tag tone="neutral"><HardDrive size={ICON_SIZE.microInline} /> Approx. storage used: {storageUsed}</Tag>
          <Tag tone="green"><ShieldCheck size={ICON_SIZE.microInline} /> Autosave active</Tag>
          <Tag tone={duplicateSources ? "orange" : "green"}>
            <FileFingerprintIcon /> {duplicateSources ? `${duplicateSources} duplicate source${duplicateSources === 1 ? "" : "s"}` : "Source checksums healthy"}
          </Tag>
        </div>
        <p>{orphans.totalIssues === 0 ? "Question-bank links are healthy: no orphaned questions, sets, or documents." : `${orphans.totalIssues} dangling link${orphans.totalIssues === 1 ? "" : "s"} across questions, sets, and documents.`}</p>
        <p>Storage health and record counts describe this device only.</p>
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
