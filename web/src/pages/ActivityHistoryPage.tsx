import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, History } from "lucide-react";
import { useStore } from "../lib/store";
import { useAccount } from "../lib/account/accountStore";
import { GlassCard, GButton, PanelHeader, Tag, EmptyState } from "../components/ui/primitives";
import { Field, SelectField } from "../components/ui/Modal";
import { ActivityExportCellLimitError, ActivityExportNumericError, ActivityExportTextEncodingError, compareStudyLogsNewestFirst, exportActivityWorkbook, sumActivityMetric } from "../lib/activityExport";
import { pushToast } from "../lib/toast";
import { prettyDate } from "../lib/scoring";
import type { StudyLog } from "../lib/types";
import { ICON_SIZE } from "../lib/iconSize";

// Platform #727 supplies an in-memory identity/link epoch. Until FORGE combines
// that dependency, retained identity/link comparisons remain the legacy fallback.
type AccountWithIdentityEpoch = ReturnType<typeof useAccount.getState> & { identityEpoch?: number };
const currentAccount = (): AccountWithIdentityEpoch => useAccount.getState() as AccountWithIdentityEpoch;

export function ActivityHistoryPage() {
  const logs = useStore((s) => s.logs);
  const [type, setType] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportPending, setExportPending] = useState(false);
  // Rendering private device history has the same lifetime boundary as exporting it.
  // A sticky state update immediately hides the mounted ledger on account/link changes.
  const [viewRevoked, setViewRevoked] = useState(false);
  // Retained device logs can belong to a different account. Viewing them requires
  // a deliberate, mount-local choice when the signed-in workspace is not linked.
  // This never changes study data or grants account/cloud access.
  const [deviceHistoryRevealed, setDeviceHistoryRevealed] = useState(false);
  // This mounted view owns its original account. Re-enter Activity History after switching accounts.
  // Track intermediate transitions too: comparing the current ID alone misses A → B → A.
  const mountedAccountId = useRef(useAccount.getState().user?.id ?? null);
  const mountedDeviceLink = useRef(useAccount.getState().link);
  // A→B→A or linked→unlinked→linked may happen before subscription; final-value
  // checks alone cannot see those transitions. Store epoch is owned by Platform.
  const mountedIdentityEpoch = useRef(currentAccount().identityEpoch);
  // Treat device-link changes as a context switch, even if the user ID stays the same.
  const switchedAccount = useRef(false);
  const unmounted = useRef(false);
  const historyRoot = useRef<HTMLDivElement>(null);
  const sessionNotice = useRef<HTMLDivElement>(null);
  const focusNoticeOnRevoke = useRef(false);
  const focusHistoryOnReveal = useRef(false);
  useLayoutEffect(() => {
    unmounted.current = false;
    const revokeIfChanged = (state: ReturnType<typeof useAccount.getState>) => {
      if ((state.user?.id ?? null) !== mountedAccountId.current || state.link !== mountedDeviceLink.current
        || (mountedIdentityEpoch.current !== undefined
          && (state as AccountWithIdentityEpoch).identityEpoch !== mountedIdentityEpoch.current)) {
        // Remember keyboard focus before the control disappears from the DOM.
        if (historyRoot.current?.contains(document.activeElement)) focusNoticeOnRevoke.current = true;
        switchedAccount.current = true;
        setViewRevoked(true);
      }
    };
    // The DEV-only browser seam runs at this specific component's layout-effect
    // boundary, unlike intercepting an arbitrary account-store subscriber.
    // Vite strips this branch from production builds.
    if (import.meta.env.DEV) {
      (window as Window & { __AXOM_ACTIVITY_BEFORE_SUBSCRIBE__?: () => void })
        .__AXOM_ACTIVITY_BEFORE_SUBSCRIBE__?.();
    }
    const unsubscribe = useAccount.subscribe(revokeIfChanged);
    // Reconcile a transition occurring after render but before subscription.
    // Layout effects flush this revocation before the first browser paint.
    revokeIfChanged(useAccount.getState());
    return () => { unmounted.current = true; unsubscribe(); };
  }, []);
  useLayoutEffect(() => {
    // Move focus only when the previous focused control belonged to this view.
    // Do not steal focus from another part of the application.
    if (viewRevoked && focusNoticeOnRevoke.current) sessionNotice.current?.focus();
  }, [viewRevoked]);
  useLayoutEffect(() => {
    // The consent control disappears on reveal. If it held keyboard focus,
    // announce the newly available ledger through its named region instead
    // of leaving focus on the document body.
    if (deviceHistoryRevealed && !viewRevoked && focusHistoryOnReveal.current) {
      focusHistoryOnReveal.current = false;
      historyRoot.current?.focus();
    }
  }, [deviceHistoryRevealed, viewRevoked]);
  const accountIsStale = () => {
    const account = currentAccount();
    return unmounted.current || switchedAccount.current
      || (account.user?.id ?? null) !== mountedAccountId.current
      || account.link !== mountedDeviceLink.current
      || (mountedIdentityEpoch.current !== undefined && account.identityEpoch !== mountedIdentityEpoch.current);
  };
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
  // The workbook refuses misleading integer sums; the visible dashboard must
  // not report the same rounded total as if it were exact.
  const displayTotal = (key: "minutes" | "cards"): number | "Unavailable" => {
    try {
      return sumActivityMetric(filtered, key);
    } catch (error) {
      if (error instanceof ActivityExportNumericError) return "Unavailable";
      throw error;
    }
  };
  const minutes = displayTotal("minutes");
  const cards = displayTotal("cards");

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
    } catch (error) {
      if (!unmounted.current) pushToast(accountIsStale()
        ? { title: "Activity export canceled", body: "Your account or device link changed. Reopen Activity History before exporting again.", tone: "warn" }
        : historyIsStale()
          ? { title: "Activity export canceled", body: "Your study history changed. Reopen Activity History before exporting the current records.", tone: "warn" }
          : error instanceof ActivityExportTextEncodingError
            ? { title: "Activity export stopped", body: "Some saved activity text contains invalid Unicode that Excel would alter. No workbook was downloaded and your study history is unchanged. Preserve a workspace backup and correct the affected entry before exporting.", tone: "warn" }
            : error instanceof ActivityExportCellLimitError
              ? { title: "Activity export stopped", body: "Some saved activity text exceeds Excel cell limits (32,767 characters or 253 line feeds). No workbook was downloaded and your study history is unchanged. Preserve a workspace backup and shorten the affected entry before exporting.", tone: "warn" }
              : error instanceof ActivityExportNumericError
                ? { title: "Activity export stopped", body: "Some saved study numbers or totals cannot be represented reliably in Excel. No workbook was downloaded and your study history is unchanged. Preserve a workspace backup and inspect the affected entries before exporting.", tone: "warn" }
              : { title: "Activity export failed", body: "The workbook could not be downloaded. Your study logs are unchanged; try exporting again.", tone: "warn" });
    } finally {
      if (!unmounted.current) setExportPending(false);
    }
  }

  // Do not keep account A's notes, event types or totals visible while account B
  // is signing in. Re-entry mounts a fresh view for the current workspace.
  if (viewRevoked || accountIsStale()) {
    return (
      <div className="stack gap16" ref={sessionNotice} role="status" aria-live="polite" tabIndex={-1}>
        <GlassCard pad>
          <EmptyState
            icon={<History size={ICON_SIZE.display} />}
            title="Activity History session changed"
            hint="Your account or device link changed. Leave and reopen Activity History to see the current workspace."
          />
        </GlassCard>
      </div>
    );
  }

  // A newly mounted unlinked B session may still hold A's device-local logs.
  // The XLSX export confirmation alone cannot prevent disclosure on screen.
  // Render no totals, notes, event types, filters or export until B opts to view.
  if (mountedAccountId.current !== null && mountedDeviceLink.current !== "linked" && !deviceHistoryRevealed) {
    return (
      <div className="stack gap16" ref={historyRoot}>
        <GlassCard pad>
          <EmptyState
            icon={<History size={ICON_SIZE.display} />}
            title="Device history needs confirmation"
            hint="This device may retain study activity from a different account. You can view the local history without moving, deleting or linking those records to your account."
          />
          <GButton size="sm" variant="primary" onClick={() => {
            if (!accountIsStale()) {
              focusHistoryOnReveal.current = historyRoot.current?.contains(document.activeElement) ?? false;
              setDeviceHistoryRevealed(true);
            }
          }}>Show device history</GButton>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="stack gap16" ref={historyRoot} role="region" aria-label="Activity History" tabIndex={-1}>
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


function HistoryStat({ label, value }: { label: string; value: number | "Unavailable" }) {
  return (
    <GlassCard pad>
      <div className="stat-value" title={value === "Unavailable" ? "Study total cannot be represented reliably; original events are retained." : undefined}>{value}</div>
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
