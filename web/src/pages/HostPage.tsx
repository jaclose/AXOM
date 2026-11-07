import { useEffect, useState } from "react";
import { BarChart3, CircleAlert, Crown, Download, RefreshCw, ShieldCheck, ShieldX, Users, Zap } from "lucide-react";
import { useAccount } from "../lib/account/accountStore";
import {
  loadOperatorDashboard, resolveReport, searchOperatorAccounts, setOperatorAI, setOperatorRole, useAccountIdentity,
  type OperatorAccount, type OperatorDashboard,
} from "../lib/operator/hostClient";
import { GButton, GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import { auditCsv, filterHostAudit } from "../lib/operator/hostAuditExport";
import { QuestionSetLibraryReviewQueue } from "../components/questions/QuestionSetLibraryReviewQueue";
import { JournalFeedbackReview } from "../components/dashboard/JournalFeedbackReview";
import "../styles/host-console.css";

function date(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "Never";
}

type AccountSearchState = {
  query: string;
  status: "loading" | "ready" | "error";
  accounts: OperatorAccount[];
  message?: string;
};

export function HostPage() {
  const identity = useAccountIdentity();
  return <HostAccountPage key={identity} />;
}

function HostAccountPage() {
  const userId = useAccount(s => s.user?.id);
  const [dashboard, setDashboard] = useState<OperatorDashboard>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState<AccountSearchState>();
  const [searchRetry, setSearchRetry] = useState(0);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, "admin" | "moderator" | "member">>({});
  const [aiDrafts, setAiDrafts] = useState<Record<string, { enabled: boolean; limit: string }>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reportReasons, setReportReasons] = useState<Record<string, string>>({});
  const [auditQuery, setAuditQuery] = useState("");
  useEffect(() => {
    let alive = true;
    setDashboard(undefined);
    if (!userId) { setLoading(false); return; }
    setLoading(true); setError("");
    void loadOperatorDashboard(userId).then(value => { if (alive) setDashboard(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Host console unavailable."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId, refresh]);
  useEffect(() => {
    const recheck = () => setRefresh(value => value + 1);
    window.addEventListener("focus", recheck);
    window.addEventListener("axom:operator-access-changed", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      window.removeEventListener("axom:operator-access-changed", recheck);
    };
  }, []);
  const role = dashboard?.role;
  const owner = role === "owner";
  const attentionCount = (dashboard?.overview?.academic_review_pending ?? 0) + (dashboard?.overview?.reports_pending ?? 0);
  const canManageAccounts = owner || role === "admin";
  const normalizedSearch = search.trim();
  const visibleAudit = filterHostAudit(dashboard?.audit ?? [], auditQuery);
  function jumpToHostSection(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }
  function exportAudit() {
    // This is an owner-scoped snapshot received from the existing audited read
    // path, not a full audit export or a new privileged API.
    if (!owner || !dashboard) return;
    const content = auditCsv(visibleAudit);
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `axom-host-audit-recent-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
  useEffect(() => {
    if (!userId || !canManageAccounts || loading || !normalizedSearch) {
      setAccountSearch(undefined);
      return;
    }
    let active = true;
    setAccountSearch({ query: normalizedSearch, status: "loading", accounts: [] });
    const timer = window.setTimeout(() => {
      void searchOperatorAccounts(userId, normalizedSearch)
        .then(accounts => { if (active) setAccountSearch({ query: normalizedSearch, status: "ready", accounts }); })
        .catch(cause => { if (active) setAccountSearch({ query: normalizedSearch, status: "error", accounts: [],
          message: cause instanceof Error ? cause.message : "Account search is unavailable. Retry when connected." }); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [userId, canManageAccounts, loading, normalizedSearch, refresh, searchRetry]);
  const activeSearch = accountSearch?.query === normalizedSearch ? accountSearch : undefined;
  const accounts = normalizedSearch ? activeSearch?.status === "ready" ? activeSearch.accounts : [] : dashboard?.accounts ?? [];
  async function change(fn: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await fn();
      setMessage(success);
      setRefresh(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "The change was not saved."); }
    finally { setBusy(false); }
  }
  function controlFor(account: OperatorAccount) {
    const draft = aiDrafts[account.user_id] ?? { enabled: account.ai_enabled, limit: String(account.ai_daily_limit) };
    const reason = reasons[account.user_id] ?? "";
    return <div className="host-account-controls">
      <label>Role
        <select value={roleDrafts[account.user_id] ?? account.role ?? "member"}
          disabled={!owner || account.role === "owner" || busy}
          onChange={e => setRoleDrafts(current => ({...current,[account.user_id]:e.target.value as "admin" | "moderator" | "member"}))}>
          {account.role === "owner" && <option value="owner">Project CEO</option>}
          <option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Administrator</option>
        </select>
      </label>
      {owner && account.role !== "owner" && <GButton size="sm" disabled={busy || reason.trim().length < 8 || (roleDrafts[account.user_id] ?? account.role ?? "member") === (account.role ?? "member")}
        onClick={() => {
          const wanted = roleDrafts[account.user_id];
          if (!wanted) return;
          void change(() => setOperatorRole(userId!, account.user_id, wanted, reason), "Role updated and audited.");
        }}>Apply role</GButton>}
      <label>Cloud AI
        <select value={draft.enabled ? "enabled" : "disabled"} disabled={!owner || busy}
          onChange={e => setAiDrafts(current => ({...current,[account.user_id]:{...draft,enabled:e.target.value === "enabled"}}))}>
          <option value="enabled">Enabled</option><option value="disabled">Disabled</option>
        </select>
      </label>
      <label>Daily AI request cap
        <input type="number" min={0} max={1000} step={1} value={draft.limit} disabled={!owner || busy}
          onChange={e => setAiDrafts(current => ({...current,[account.user_id]:{...draft,limit:e.target.value}}))} />
      </label>
      {owner && <GButton size="sm" disabled={busy || reason.trim().length < 8 || (!((aiDrafts[account.user_id]?.enabled ?? account.ai_enabled) !== account.ai_enabled)
        && Number(aiDrafts[account.user_id]?.limit ?? account.ai_daily_limit) === account.ai_daily_limit)}
        onClick={() => {
          const limit = Number(draft.limit);
          if (!Number.isInteger(limit) || limit < 0 || limit > 1000) { setError("Quota must be 0 to 1000."); return; }
          void change(() => setOperatorAI(userId!, account.user_id, draft.enabled, limit, reason), "AI policy saved and audited.");
        }}>Apply AI policy</GButton>}
      {owner && <label className="host-change-reason">Reason for changing {account.display_name ?? "this account"}
        <textarea value={reason} minLength={8} maxLength={500} rows={2} disabled={busy} onChange={event => setReasons(current => ({ ...current, [account.user_id]: event.target.value }))} placeholder="Record why this access or allowance is changing." />
        <small>Required for role and AI changes. Saved in the audit history.</small>
      </label>}
    </div>;
  }
  return <main className="host-page stack" aria-labelledby="host-page-title">
    <section className="host-banner">
      <div><span className="host-eyebrow"><ShieldCheck size={17} aria-hidden="true" /> AXOM OPERATOR CONSOLE</span>
        <h1 id="host-page-title">Host dashboard</h1>
        <p>Server-enforced permissions, responsible moderation and traceable operational controls.</p>
      </div>
      {role && <Tag tone="gold">{role === "owner" ? "Project CEO" : role === "admin" ? "Administrator" : "Moderator"}</Tag>}
    </section>
    <div className="host-toolbar">
      <GButton size="sm" disabled={loading || busy} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={15} aria-hidden="true"/> Refresh</GButton>
      <nav className="host-quick-nav" aria-label="Host sections">
        <button className="ghost-btn" type="button" onClick={() => jumpToHostSection("host-community-review")}>Communities</button>
        <button className="ghost-btn" type="button" onClick={() => jumpToHostSection("host-academic-review")}>Question Bank</button>
        {owner && <button className="ghost-btn" type="button" onClick={() => jumpToHostSection("host-audit-history")}>Audit</button>}
      </nav>
    </div>
    {loading && <p role="status">Checking operator access…</p>}
    {error && <div role="alert" className="host-warning"><p>{error}</p><GButton size="sm" disabled={loading || busy} onClick={() => setRefresh(n => n + 1)}>Retry Host</GButton></div>}
    {message && <p role="status" className="sub">{message}</p>}
    {!userId && <GlassCard pad><PanelHeader title="Sign-in required" headingLevel={2} sub="Use your verified AXOM account to access host operations." /></GlassCard>}
    {!loading && userId && dashboard?.role === null && <GlassCard pad><PanelHeader title="Operator permission required" headingLevel={2}
      sub="This account does not have an operator role. Display names cannot grant executive access. The verified owner must be provisioned by immutable auth user ID." />
      <p className="sub">No private learner data is accessible through the public client.</p>
    </GlassCard>}
    {dashboard?.overview && <div className="host-layout">
      <div className="stack">
        <GlassCard pad className="host-overview">
          <div className="host-overview-intro">
            <div><span className="host-overview-eyebrow">CURRENT SNAPSHOT</span>
              <h2 id="host-overview-title">Attention queue</h2></div>
            <p>{attentionCount === 0
              ? "Review and moderation queues are clear."
              : `${attentionCount} ${attentionCount === 1 ? "item" : "items"} in review and moderation queues.`}</p>
          </div>
          <div className="host-priority-metrics" data-has-attention={attentionCount > 0} aria-labelledby="host-overview-title">
            <div className="host-priority-metric">
              <span className="host-priority-icon"><CircleAlert size={18} aria-hidden="true" /></span>
              <strong>{dashboard.overview.academic_review_pending}</strong>
              <span>Review submissions</span>
            </div>
            <div className="host-priority-metric">
              <span className="host-priority-icon"><ShieldX size={18} aria-hidden="true" /></span>
              <strong>{dashboard.overview.reports_pending}</strong>
              <span>Moderation reports</span>
            </div>
          </div>
          <dl className="host-platform-metrics" aria-label="Platform totals">
            {([
              ["Registered accounts", dashboard.overview.registered_accounts, Users],
              ["Community profiles", dashboard.overview.shared_profiles, Users],
              ["AI requests, 7 days", dashboard.overview.ai_requests_7d, Zap],
              ["Approved shared collections", dashboard.overview.academic_approved, BarChart3],
            ] as const).map(([label, value, Icon]) => <div key={label}>
              <dt><Icon size={15} aria-hidden="true" />{label}</dt>
              <dd data-restricted={value === null}>{value ?? "Restricted"}</dd>
            </div>)}
          </dl>
        </GlassCard>
        {(role === "owner" || role === "admin") && <GlassCard pad>
          <PanelHeader headingLevel={2} title="Accounts & AI" sub="Changes are checked on the server. Operators cannot inspect private learner workspaces." />
          <label className="host-search">Find account<input type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name or email" /></label>
          {normalizedSearch && (!activeSearch || activeSearch.status === "loading") && <p role="status">Searching all accounts…</p>}
          {activeSearch?.status === "error" && <div role="alert" className="host-warning"><p>{activeSearch.message}</p>
            <GButton size="sm" onClick={() => setSearchRetry(value => value + 1)}>Retry search</GButton></div>}
          <div className="host-accounts">{accounts.map(account => <article key={account.user_id} className="host-account">
            <div className="host-account-head"><div><b>{account.display_name ?? account.email ?? "Account"}</b>
              <small>{account.email ?? "No email"} · Joined {date(account.created_at)} · Last login {date(account.last_sign_in_at)}</small></div>
              {account.role && <Tag tone={account.role === "owner" ? "gold" : "neutral"}>{account.role === "owner" ? "Project CEO" : account.role}</Tag>}</div>
            <p className="sub">AI requests today: {account.ai_used_today} of {account.ai_daily_limit}</p>
            {controlFor(account)}
          </article>)}</div>
          {activeSearch?.status === "ready" && accounts.length === 0 && <p className="sub">No accounts match that name or email.</p>}
          {!normalizedSearch && accounts.length === 0 && <p className="sub">No accounts to show.</p>}
          <p className="sub">Recent view shows up to 100 accounts. Search by name or email across the full directory. Project CEO access is bound to a verified account ID, never an editable name.</p>
        </GlassCard>}
        <GlassCard pad id="host-academic-review">
          <PanelHeader headingLevel={2} title="Submitted QBank review" sub="Revision-bound collections intentionally submitted for sharing. Pending review never implies approval." />
          {dashboard.queue.length === 0 ? <p className="sub">No submitted Question Banks await review.</p> :
            <div className="host-queue">{dashboard.queue.map(item => <div className="host-queue-row" key={item.collection_id}>
              <div><b>{item.title}</b><small>{item.module} · {item.term} · submitted for review · {date(item.updated_at)}</small></div>
              <div><Tag tone="orange">Pending</Tag><small>{item.ready_questions} candidate-ready · {item.review_questions} review</small></div>
            </div>)}</div>}
          <p className="sub">Approval is intentionally not a one-click host operation. Source provenance, rights and answer-review evidence must be validated through the academic review process first.</p>
        </GlassCard>
        {userId && <QuestionSetLibraryReviewQueue accountId={userId} />}
        {userId && (role === "owner" || role === "admin") && <JournalFeedbackReview accountId={userId} />}
        <GlassCard pad id="host-community-review">
          <PanelHeader headingLevel={2} title="Reported community posts" sub="Only reported posts enter this moderation queue." />
          {dashboard.reports.length === 0 ? <p className="sub">No posts have been reported.</p> : dashboard.reports.map(report => <article key={report.post_id} className="host-report">
            <b>@{report.author_handle} · {report.post_kind}</b>
            <p>{report.reports} reports · {report.reason}</p>
            {report.note && <p className="sub">{report.note}</p>}
            <label>Reason for resolving @{report.author_handle}'s report
              <textarea value={reportReasons[report.post_id] ?? ""} minLength={8} maxLength={500} rows={2} disabled={busy}
                onChange={event => setReportReasons(current => ({ ...current, [report.post_id]: event.target.value }))}
                placeholder="Record the evidence for this moderation decision." />
              <small>8 to 500 characters, saved in the audit history.</small>
            </label>
            <div className="row wrap gap8"><GButton size="sm" disabled={busy || (reportReasons[report.post_id] ?? "").trim().length < 8}
              onClick={() => void change(() => resolveReport(userId!, report.post_id, "dismiss", reportReasons[report.post_id] ?? ""), "Report dismissed and audited.")}>Dismiss report</GButton>
              <GButton size="sm" variant="danger" disabled={busy || (reportReasons[report.post_id] ?? "").trim().length < 8} onClick={() => {
                if (window.confirm("Remove this reported post? The author’s private workspace stays untouched."))
                  void change(() => resolveReport(userId!, report.post_id, "remove", reportReasons[report.post_id] ?? ""), "Reported post removed and audited.");
              }}>Remove post</GButton>
            </div>
          </article>)}
        </GlassCard>
      </div>
      <aside className="stack">
        <GlassCard pad>
          <PanelHeader headingLevel={2} title="Permissions model" sub="Least privilege enforced in Postgres." />
          <div className="host-role" data-current={owner}><Crown size={17} aria-hidden="true"/><div><b>Project CEO</b><small>Account roles, AI limits, reports, operational data and audit history.</small></div></div>
          <div className="host-role" data-current={role === "admin"}><ShieldCheck size={17} aria-hidden="true"/><div><b>Administrator</b><small>Account directory, aggregate usage and review queues. No role escalation.</small></div></div>
          <div className="host-role" data-current={role === "moderator"}><Users size={17} aria-hidden="true"/><div><b>Moderator</b><small>Submitted bank metadata and reported community posts only.</small></div></div>
          <p className="sub">No operator role grants unrestricted access to individual private source files, notes, questions or saved progress.</p>
        </GlassCard>
        {owner && <GlassCard pad id="host-audit-history">
          <PanelHeader headingLevel={2} title="Audit history" sub="Server-authorized recent actions, with immutable actor and target identities." />
          <div className="host-audit-tools">
            <label htmlFor="host-audit-search">Filter recent events
              <input id="host-audit-search" type="search" value={auditQuery} maxLength={160}
                placeholder="Action, account ID, reason…" onChange={(event) => setAuditQuery(event.target.value)} />
            </label>
            <GButton size="sm" disabled={visibleAudit.length === 0} onClick={exportAudit}><Download size={15} aria-hidden="true" /> Export visible CSV</GButton>
          </div>
          <p className="sub" role="status">Showing {visibleAudit.length} of {dashboard.audit.length} recently fetched events (maximum 30). This is not a complete audit history.</p>
          {dashboard.audit.length === 0 && <p className="sub">No privileged changes yet.</p>}
          {dashboard.audit.length > 0 && visibleAudit.length === 0 && <p className="sub">No recent events match this filter.</p>}
          {visibleAudit.map(item => <div className="host-audit" key={item.id}>
            <b>{item.action}</b><small>{date(item.created_at)}</small>
            <small>Actor: {item.actor_id?.slice(0,8) ?? "Deleted account"} · Target: {item.target_id?.slice(0,8) ?? "none"}</small>
            {typeof item.metadata.reason === "string" && <p className="sub">{item.metadata.reason}</p>}
          </div>)}
        </GlassCard>}
      </aside>
    </div>}
  </main>;
}
