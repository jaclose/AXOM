import { useEffect, useMemo, useRef, useState } from "react";
import { Download, History } from "lucide-react";
import { useStore } from "../lib/store";
import { useAccount } from "../lib/account/accountStore";
import { GlassCard, GButton, PanelHeader, Tag, EmptyState } from "../components/ui/primitives";
import { Field, SelectField } from "../components/ui/Modal";
import { exportActivityWorkbook } from "../lib/activityExport";
import { pushToast } from "../lib/toast";
import { prettyDate } from "../lib/scoring";
import type { StudyLog } from "../lib/types";
import { ICON_SIZE } from "../lib/iconSize";

export function ActivityHistoryPage() {
  const logs = useStore((s) => s.logs);
  const [type, setType] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportPending, setExportPending] = useState(false);
  // This mounted view owns its original account. Re-enter Activity History after switching accounts.
  // Track intermediate transitions too: comparing the current ID alone misses A → B → A.
  const mountedAccountId = useRef(useAccount.getState().user?.id ?? null);
  const mountedDeviceLink = useRef(useAccount.getState().link);
  // Treat device-link changes as a context switch, even if the user ID stays the same.
  const switchedAccount = useRef(false);
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    const unsubscribe = useAccount.subscribe((state) => {
      if ((state.user?.id ?? null) !== mountedAccountId.current || state.link !== mountedDeviceLink.current) {
        switchedAccount.current = true;
      }
    });
    return () => { unmounted.current = true; unsubscribe(); };
  }, []);
  const accountIsStale = () => unmounted.current || switchedAccount.current
    || (useAccount.getState().user?.id ?? null) !== mountedAccountId.current
    || useAccount.getState().link !== mountedDeviceLink.current;
  const assertCurrentAccount = () => {
    if (accountIsStale()) throw new Error("Activity export canceled because the account or device link changed.");
  };
  // A restore or new study event can replace the log snapshot without switching users.
  // The async XLSX import must not download rows from a superseded workspace.
  const historyIsStale = () => useStore.getState().logs !== logs;
  const assertCurrentExport = () => {
    assertCurrentAccount();
    if (historyIsStale()) throw new Error("Activity export canceled because study history changed.");
  };
  const types = useMemo(() => [...new Set(logs.map((log) => log.type).sort())], [logs]);
  const filtered = logs.filter((log) =>
    (type === null || log.type === type)
    && (!from || log.dayKey >= from)
    && (!to || log.dayKey <= to),
  );
  const minutes = filtered.reduce((sum, log) => sum + log.minutes, 0);
  const cards = filtered.reduce((sum, log) => sum + log.cards, 0);

  async function handleExport() {
    if (exportPending || !filtered.length) return;
    // Account identity checks prevent stale downloads, but study logs are device-local:
    // signing out deliberately retains them. Unlinked signed-in accounts must consent
    // before downloading a workbook that may include a previous account's local work.
    const account = useAccount.getState();
    if (!accountIsStale() && account.user && account.link !== "linked"
      && !window.confirm(
        "This workbook contains study activity saved on this device. It may include work from a different account because this device's workspace is not linked to your signed-in account. Export this device's study history?",
      )) return;
    setExportPending(true);
    try {
      assertCurrentExport();
      await exportActivityWorkbook(filtered, undefined, assertCurrentExport);
    } catch {
      if (!unmounted.current) pushToast(accountIsStale()
        ? { title: "Activity export canceled", body: "Your account or device link changed. Reopen Activity History before exporting again.", tone: "warn" }
        : historyIsStale()
          ? { title: "Activity export canceled", body: "Your study history changed. Reopen Activity History before exporting the current records.", tone: "warn" }
          : { title: "Activity export failed", body: "The workbook could not be downloaded. Your study logs are unchanged; try exporting again.", tone: "warn" });
    } finally {
      if (!unmounted.current) setExportPending(false);
    }
  }

  return (
    <div className="stack gap16">
      <GlassCard pad>
        <PanelHeader title="Activity History" sub="Study events saved on this device, including work retained after sign-out. Exports are device-local."
          action={<GButton size="sm" variant="primary" onClick={handleExport} disabled={!filtered.length || exportPending} aria-busy={exportPending}><Download size={ICON_SIZE.body} /> {exportPending ? "Exporting..." : "Export .xlsx"}</GButton>} />
        <div className="activity-history-filters">
          <SelectField label="Activity type" value={type === null ? "all" : `type:${type}`}
            onChange={(e) => setType(e.target.value === "all" ? null : e.target.value.slice(5))}>
            <option value="all">All activity types</option>
            {types.map((item) => <option key={item} value={`type:${item}`}>{item}</option>)}
          </SelectField>
          <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </GlassCard>

      <div className="grid grid-stats">
        <HistoryStat label="Events" value={filtered.length} />
        <HistoryStat label="Minutes" value={minutes} />
        <HistoryStat label="Cards" value={cards} />
      </div>

      <GlassCard pad>
        <PanelHeader title="Filtered ledger" sub="Newest first" action={<Tag tone={filtered.length ? "cyan" : "neutral"}>{filtered.length} event{filtered.length === 1 ? "" : "s"}</Tag>} />
        {!filtered.length ? (
          <EmptyState icon={<History size={ICON_SIZE.display} />} title="No activity matches" hint="Clear filters or log study time from Productivity." />
        ) : (
          <div className="activity-history-list">
            {filtered.slice().sort(compareStudyLogsNewestFirst).map((log) => <ActivityRow key={log.id} log={log} />)}
          </div>
        )}
      </GlassCard>
    </div>
  );
}


/** Keep the visible ledger chronologically consistent with the XLSX ordering. */
function compareStudyLogsNewestFirst(a: StudyLog, b: StudyLog): number {
  const aTime = Date.parse(a.ts);
  const bTime = Date.parse(b.ts);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);

  // Mixing epoch and lexical branches in one comparison creates sort cycles.
  if (aValid !== bValid) return aValid ? -1 : 1;
  if (aValid && bValid && aTime !== bTime) return bTime - aTime;

  return b.ts.localeCompare(a.ts) || a.id.localeCompare(b.id);
}

function HistoryStat({ label, value }: { label: string; value: number }) {
  return (
    <GlassCard pad>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </GlassCard>
  );
}

function ActivityRow({ log }: { log: StudyLog }) {
  return (
    <div className="activity-history-row">
      <span className="mono">{log.dayKey}</span>
      <Tag tone={log.type === "Anki" ? "purple" : log.type === "Pomodoro" ? "cyan" : "neutral"}>{log.type}</Tag>
      <span>{log.minutes}m</span>
      <span>{log.cards} cards</span>
      <span className="grow">
        <b>{prettyDate(`${log.dayKey}T12:00:00`)}</b>
        <small>{new Date(log.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{log.note ? ` - ${log.note}` : ""}</small>
      </span>
    </div>
  );
}
