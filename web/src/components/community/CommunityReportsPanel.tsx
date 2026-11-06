import { useEffect, useState } from "react";
import { Flag, RefreshCw } from "lucide-react";
import { GButton, GhostButton, GlassCard, PanelHeader } from "../ui/primitives";
import { loadOperatorReports, refreshOperatorAccess, resolveReport, useOperatorAccessStatus, type OperatorReport } from "../../lib/operator/hostClient";
import { postKindLabel } from "./CommunityPostContent";
import type { CommunityPost } from "../../lib/community/community";

const ROLE_LABEL = { owner: "Project CEO", admin: "Administrator", moderator: "Moderator" } as const;
const REASON_LABEL: Record<string, string> = {
  spam: "Spam", harassment: "Harassment", copyright: "Copyright concern", inaccurate: "Misleading study content", other: "Other concern",
};

/** Report review for moderators and administrators inside Community. Host stays
 * the owner's alone; Postgres still decides who may read and resolve reports. */
export function CommunityReportsPanel({ accountId }: { accountId: string }) {
  const { role } = useOperatorAccessStatus();
  const [reports, setReports] = useState<OperatorReport[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyPost, setBusyPost] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);

  // Opening Community re-reads the role in the background, so a moderator
  // granted a moment ago sees this panel without reloading.
  useEffect(() => { refreshOperatorAccess(); }, [accountId]);

  useEffect(() => {
    if (!role) { setReports(undefined); return; }
    let active = true;
    setLoading(true);
    setError("");
    void loadOperatorReports(accountId)
      .then(result => { if (active) setReports(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Reported posts could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, role, refresh]);

  if (!role) return null;

  async function decide(report: OperatorReport, resolution: "dismiss" | "remove") {
    const reason = (reasons[report.post_id] ?? "").trim();
    if (reason.length < 8) { setError("Write a reason of at least 8 characters. It is saved in the audit history."); return; }
    setBusyPost(report.post_id);
    setError("");
    setMessage("");
    try {
      await resolveReport(accountId, report.post_id, resolution, reason);
      setMessage(resolution === "remove" ? `Removed @${report.author_handle}'s post.` : `Kept @${report.author_handle}'s post and closed the report.`);
      setReasons(current => { const next = { ...current }; delete next[report.post_id]; return next; });
      setRefresh(value => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report could not be resolved.");
    } finally {
      setBusyPost(null);
    }
  }

  return <GlassCard pad className="community-reports">
    <PanelHeader headingLevel={2} title="Reported posts"
      sub={`${ROLE_LABEL[role]} review. Every decision needs a reason and is kept in the audit history.`}
      action={<GButton size="sm" disabled={loading || Boolean(busyPost)} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /> Refresh reports</GButton>} />
    {loading && !reports && <p role="status" className="sub">Loading reports…</p>}
    {error && <p role="alert" className="community-error">{error}</p>}
    {message && <p role="status" className="sub">{message}</p>}
    {reports && reports.length === 0 && <p className="sub">No open reports. Private posts never enter this queue.</p>}
    {reports && reports.length > 0 && <ul className="community-report-list">
      {reports.map(report => <li key={report.post_id} className="community-report-item">
        <div className="community-report-head">
          <Flag size={15} aria-hidden="true" />
          <b>@{report.author_handle}</b>
          <span>{postKindLabel(report.post_kind as CommunityPost["kind"])}</span>
          <small>{report.reports} {report.reports === 1 ? "report" : "reports"} · {new Date(report.latest_at).toLocaleDateString()}</small>
        </div>
        <p><strong>{REASON_LABEL[report.reason] ?? report.reason}</strong>{report.note ? ` · ${report.note}` : ""}</p>
        <label className="community-report-reason">Reason for your decision
          <textarea value={reasons[report.post_id] ?? ""} maxLength={500} rows={2} disabled={busyPost === report.post_id}
            placeholder="At least 8 characters, kept in the audit history"
            onChange={event => setReasons(current => ({ ...current, [report.post_id]: event.target.value }))} />
        </label>
        <div className="row wrap gap8">
          <GButton size="sm" disabled={Boolean(busyPost)} onClick={() => void decide(report, "dismiss")}>Keep post</GButton>
          <GhostButton disabled={Boolean(busyPost)} onClick={() => void decide(report, "remove")}>Remove post</GhostButton>
        </div>
      </li>)}
    </ul>}
  </GlassCard>;
}
