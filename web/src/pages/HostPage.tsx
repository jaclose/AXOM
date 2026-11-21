import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, CircleAlert, Crown, RefreshCw, ShieldCheck, ShieldX, Users, Zap } from "lucide-react";
import { useAccount } from "../lib/account/accountStore";
import {
  loadOperatorDashboard, resolveReport, searchOperatorAccounts, setOperatorAI, setOperatorRole, useAccountIdentity,
  type OperatorAccount, type OperatorDashboard,
} from "../lib/operator/hostClient";
import { GButton, GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import { QuestionSetLibraryReviewQueue } from "../components/questions/QuestionSetLibraryReviewQueue";
import { CommunityUploads } from "../components/questions/CommunityUploads";
import { JournalFeedbackReview } from "../components/dashboard/JournalFeedbackReview";
import "../styles/host-console.css";

/** A cleared number input is an incomplete edit, not a deliberate zero-cap policy. */
function parseDailyAiRequestCap(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 1000 ? value : null;
}

function date(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "Never";
}

/** A fresh, actor-bound audit receipt is stronger than a successful network response.
 * Compare with the previous snapshot so older unrelated actions cannot be reused. */
function hasNewOperatorAudit(before: OperatorDashboard | undefined, next: OperatorDashboard,
  actor: string, target: string, action: string, reason: string, expected: Record<string, unknown> = {},
): boolean {
  const oldIds = new Set(before?.audit.map(item => item.id) ?? []);
  return next.audit.some(item => !oldIds.has(item.id) && item.actor_id === actor
    && item.target_id === target && item.action === action && item.metadata.reason === reason.trim()
    && Object.entries(expected).every(([key, value]) => item.metadata[key] === value));
}

type AccountSearchState = {
  query: string;
  status: "loading" | "ready" | "error";
  accounts: OperatorAccount[];
  refreshVersion: number;
  message?: string;
};

export function HostPage() {
  const identity = useAccountIdentity();
  return <HostAccountPage key={identity} />;
}

function HostAccountPage() {
  const userId = useAccount(s => s.user?.id);
  const [dashboard, setDashboard] = useState<OperatorDashboard>();
  // Reviewer UI requires a confirmed Host role for this exact account, not a stale snapshot.
  const [verifiedOperatorAccountId, setVerifiedOperatorAccountId] = useState<string | null>(null);
  // A refresh increment invalidates the last Host authorization immediately in
  // render, before effects clear stale data. The review modal portals to body.
  const [verifiedDashboardRefresh, setVerifiedDashboardRefresh] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // React may batch two click events before the disabled state commits.
  // The synchronous guard prevents duplicate privileged RPCs and audit writes.
  const mutationInFlight = useRef(false);
  // Keep privileged writes blocked until a post-settlement server readback succeeds.
  // A lost acknowledgement is not proof that a role/AI/audit write was rolled back.
  const pendingReadbackVersion = useRef<number | null>(null);
  const mutationOutcome = useRef<{
    success?: string; error?: string; verify: (next: OperatorDashboard) => boolean;
  } | null>(null);
  const refreshVersion = useRef(0);
  const requestRefresh = useCallback(() => {
    const next = ++refreshVersion.current;
    setRefresh(next);
    return next;
  }, []);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState<AccountSearchState>();
  const [searchRetry, setSearchRetry] = useState(0);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, "admin" | "moderator" | "member">>({});
  const [aiDrafts, setAiDrafts] = useState<Record<string, { enabled: boolean; limit: string }>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reportReasons, setReportReasons] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    setDashboard(undefined);
    if (!userId) { setVerifiedOperatorAccountId(null); setLoading(false); return; }
    setLoading(true); setError("");
    void loadOperatorDashboard(userId).then(value => {
      if (!alive) return;
      setDashboard(value);
      setVerifiedDashboardRefresh(refresh);
      setVerifiedOperatorAccountId(value.role && value.overview ? userId : null);
      // Older focus/initial reads must never release a newer mutation barrier.
      if (pendingReadbackVersion.current !== null && refresh >= pendingReadbackVersion.current) {
        const result = mutationOutcome.current;
        if (result?.success && !result.verify(value)) {
          // Do not unlock a privileged action or claim an audit solely because
          // a dashboard fetch succeeded. A later Retry Host may resolve the state.
          setError("Host readback did not confirm this change. The action may have been applied. Retry Host to verify the server state before another change.");
          return;
        }
        pendingReadbackVersion.current = null;
        mutationOutcome.current = null;
        mutationInFlight.current = false;
        setBusy(false);
        if (result?.success) setMessage(result.success);
        if (result?.error) {
          if (result.verify(value)) setMessage("The server confirms this action despite a lost acknowledgement.");
          else setError(result.error);
        }
      }
    }).catch(cause => {
      if (!alive) return;
      const detail = cause instanceof Error ? cause.message : "Host console unavailable.";
      setError(pendingReadbackVersion.current !== null && refresh >= pendingReadbackVersion.current
        ? `Host readback failed: ${detail}. The action may have been applied. Retry Host to verify the server state before another change.`
        : detail);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId, refresh]);
  useEffect(() => {
    const recheck = () => requestRefresh();
    window.addEventListener("focus", recheck);
    window.addEventListener("axom:operator-access-changed", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      window.removeEventListener("axom:operator-access-changed", recheck);
    };
  }, [requestRefresh]);
  // A new refresh epoch revokes the previous privileged snapshot at render time,
  // before the effect can clear state. Otherwise owner emails/actions can appear
  // in the DOM during the initial reauthorization commit.
  const authorizedDashboard = verifiedOperatorAccountId === userId && verifiedDashboardRefresh === refresh
    ? dashboard : undefined;
  const role = authorizedDashboard?.role;
  const owner = role === "owner";
  const attentionCount = (authorizedDashboard?.overview?.academic_review_pending ?? 0)
    + (authorizedDashboard?.overview?.reports_pending ?? 0);
  const accessPending = !!userId && (loading || verifiedDashboardRefresh !== refresh);
  const canManageAccounts = owner || role === "admin";
  const normalizedSearch = search.trim();
  useEffect(() => {
    if (!userId || !canManageAccounts || loading || !normalizedSearch) {
      setAccountSearch(undefined);
      return;
    }
    let active = true;
    setAccountSearch({ query: normalizedSearch, refreshVersion: refresh, status: "loading", accounts: [] });
    const timer = window.setTimeout(() => {
      void searchOperatorAccounts(userId, normalizedSearch)
        .then(accounts => { if (active) setAccountSearch({ query: normalizedSearch, refreshVersion: refresh, status: "ready", accounts }); })
        .catch(cause => { if (active) setAccountSearch({ query: normalizedSearch, refreshVersion: refresh, status: "error", accounts: [],
          message: cause instanceof Error ? cause.message : "Account search is unavailable. Retry when connected." }); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [userId, canManageAccounts, loading, normalizedSearch, refresh, searchRetry]);
  const activeSearch = accountSearch?.query === normalizedSearch && accountSearch.refreshVersion === refresh
    ? accountSearch : undefined;
  const accounts = normalizedSearch ? activeSearch?.status === "ready" ? activeSearch.accounts : [] : authorizedDashboard?.accounts ?? [];
  async function change(fn: () => Promise<void>, success: string,
    verify: (next: OperatorDashboard) => boolean,
  ) {
    // A stale onClick captured before a refresh must not issue a privileged RPC.
    if (!authorizedDashboard || refreshVersion.current !== refresh || mutationInFlight.current || busy) return;
    mutationInFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await fn();
      mutationOutcome.current = { success, verify };
    } catch (e) {
      const detail = e instanceof Error ? e.message : "The change could not be confirmed.";
      mutationOutcome.current = { error: `${detail}. Verify the refreshed server state before retrying.`, verify };
    } finally {
      // Even a rejected transport reply may follow a committed server-side audit.
      // Do not permit another action until a request started after this point resolves.
      pendingReadbackVersion.current = requestRefresh();
    }
  }
  function controlFor(account: OperatorAccount) {
    const draft = aiDrafts[account.user_id] ?? { enabled: account.ai_enabled, limit: String(account.ai_daily_limit) };
    const reason = reasons[account.user_id] ?? "";
    const validDraftLimit = parseDailyAiRequestCap(draft.limit);
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
          void change(() => setOperatorRole(userId!, account.user_id, wanted, reason), "Role updated and audited.",
            next => hasNewOperatorAudit(dashboard, next, userId!, account.user_id, "account.role", reason, { assigned: wanted })
              && (!next.accounts.some(item => item.user_id === account.user_id)
                || (next.accounts.find(item => item.user_id === account.user_id)?.role ?? "member") === wanted));
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
      {owner && <GButton size="sm" disabled={busy || validDraftLimit === null || reason.trim().length < 8
        || (draft.enabled === account.ai_enabled && validDraftLimit === account.ai_daily_limit)}
        onClick={() => {
          const limit = parseDailyAiRequestCap(draft.limit);
          if (limit === null) { setError("Enter a whole-number quota from 0 to 1000."); return; }
          void change(() => setOperatorAI(userId!, account.user_id, draft.enabled, limit, reason), "AI policy saved and audited.",
            next => hasNewOperatorAudit(dashboard, next, userId!, account.user_id, "ai.policy", reason,
              { enabled: draft.enabled, daily_limit: limit })
              && (!next.accounts.some(item => item.user_id === account.user_id)
                || next.accounts.some(item => item.user_id === account.user_id
                  && item.ai_enabled === draft.enabled && item.ai_daily_limit === limit)));
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
      <GButton size="sm" disabled={accessPending || busy} onClick={() => requestRefresh()}><RefreshCw size={15} aria-hidden="true"/> Refresh</GButton>
      <nav className="host-quick-nav" aria-label="Host sections">
        <a className="ghost-btn" href="#communities">Communities</a>
        <a className="ghost-btn" href="#questions">Question Bank</a>
      </nav>
    </div>
    {accessPending && <p role="status">Checking operator access…</p>}
    {error && <div role="alert" className="host-warning"><p>{error}</p><GButton size="sm" disabled={loading || (busy && pendingReadbackVersion.current === null)} onClick={() => requestRefresh()}>Retry Host</GButton></div>}
    {message && <p role="status" className="sub">{message}</p>}
    {!userId && <GlassCard pad><PanelHeader title="Sign-in required" headingLevel={2} sub="Use your verified AXOM account to access host operations." /></GlassCard>}
    {!accessPending && userId && verifiedDashboardRefresh === refresh && dashboard?.role === null && <GlassCard pad><PanelHeader title="Operator permission required" headingLevel={2}
      sub="This account does not have an operator role. Display names cannot grant executive access. The verified owner must be provisioned by immutable auth user ID." />
      <p className="sub">No private learner data is accessible through the public client.</p>
    </GlassCard>}
    {userId && <div className="host-layout">
      <div className="stack">
        {authorizedDashboard?.overview && <>
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
              <strong>{authorizedDashboard.overview.academic_review_pending}</strong>
              <span>Review submissions</span>
            </div>
            <div className="host-priority-metric">
              <span className="host-priority-icon"><ShieldX size={18} aria-hidden="true" /></span>
              <strong>{authorizedDashboard.overview.reports_pending}</strong>
              <span>Moderation reports</span>
            </div>
          </div>
          <dl className="host-platform-metrics" aria-label="Platform totals">
            {([
              ["Registered accounts", authorizedDashboard.overview.registered_accounts, Users],
              ["Community profiles", authorizedDashboard.overview.shared_profiles, Users],
              ["AI requests, 7 days", authorizedDashboard.overview.ai_requests_7d, Zap],
              ["Approved shared collections", authorizedDashboard.overview.academic_approved, BarChart3],
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
        <GlassCard pad>
          <PanelHeader headingLevel={2} title="Submitted QBank review" sub="Revision-bound collections intentionally submitted for sharing. Pending review never implies approval." />
          {authorizedDashboard.queue.length === 0 ? <p className="sub">No submitted Question Banks await review.</p> :
            <div className="host-queue">{authorizedDashboard.queue.map(item => <div className="host-queue-row" key={item.collection_id}>
              <div><b>{item.title}</b><small>{item.module} · {item.term} · submitted for review · {date(item.updated_at)}</small></div>
              <div><Tag tone="orange">Pending</Tag><small>{item.ready_questions} candidate-ready · {item.review_questions} review</small></div>
            </div>)}</div>}
          <p className="sub">Inspect and decide on each exact submitted revision in the academic review queue below. Host ownership alone does not grant reviewer permission; answer evidence and sharing rights remain mandatory.</p>
        </GlassCard>
        {userId && <CommunityUploads reviewOnly
          onOpenLibrary={() => { location.hash = "questions"; }}
          onReviewed={() => { setMessage("Academic course review recorded. Checking Host queues."); requestRefresh(); }} />}
        </>}
        {/* Academic reviewer authorization is checked independently of the Host snapshot.
            Keep this queue mounted during same-account Host refresh so the decision receipt survives. */}
        {verifiedOperatorAccountId === userId && <div hidden={loading || verifiedDashboardRefresh !== refresh || !dashboard?.overview}>
          <QuestionSetLibraryReviewQueue key={userId} accountId={userId} refreshSignal={refresh}
            accessSuspended={loading || verifiedDashboardRefresh !== refresh || !dashboard?.overview}
            onReviewed={() => { setMessage("Question Set review recorded. Checking Host queues."); requestRefresh(); }} />
        </div>}
        {authorizedDashboard?.overview && <>
        {userId && (role === "owner" || role === "admin") && <JournalFeedbackReview accountId={userId} />}
        <GlassCard pad>
          <PanelHeader headingLevel={2} title="Reported community posts" sub="Only reported posts enter this moderation queue." />
          {authorizedDashboard.reports.length === 0 ? <p className="sub">No posts have been reported.</p> : authorizedDashboard.reports.map(report => <article key={report.post_id} className="host-report">
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
              onClick={() => void change(() => resolveReport(userId!, report.post_id, "dismiss", reportReasons[report.post_id] ?? ""), "Report dismissed and audited.",
                next => Boolean(next.role) && !next.reports.some(item => item.post_id === report.post_id)
                  && (role !== "owner" || hasNewOperatorAudit(dashboard, next, userId!, report.post_id,
                    "social.report.dismiss", reportReasons[report.post_id] ?? "")))}>Dismiss report</GButton>
              <GButton size="sm" variant="danger" disabled={busy || (reportReasons[report.post_id] ?? "").trim().length < 8} onClick={() => {
                // Skip a second destructive prompt before React commits the busy state.
                if (!authorizedDashboard || refreshVersion.current !== refresh || mutationInFlight.current || busy) return;
                if (window.confirm("Remove this reported post? The author’s private workspace stays untouched."))
                  void change(() => resolveReport(userId!, report.post_id, "remove", reportReasons[report.post_id] ?? ""), "Reported post removed and audited.",
                    next => Boolean(next.role) && !next.reports.some(item => item.post_id === report.post_id)
                      && (role !== "owner" || hasNewOperatorAudit(dashboard, next, userId!, report.post_id,
                        "social.report.remove", reportReasons[report.post_id] ?? "")));
              }}>Remove post</GButton>
            </div>
          </article>)}
        </GlassCard>
        </>}
      </div>
      {authorizedDashboard?.overview && <aside className="stack">
        <GlassCard pad>
          <PanelHeader headingLevel={2} title="Permissions model" sub="Least privilege enforced in Postgres." />
          <div className="host-role" data-current={owner}><Crown size={17} aria-hidden="true"/><div><b>Project CEO</b><small>Account roles, AI limits, reports, operational data and audit history.</small></div></div>
          <div className="host-role" data-current={role === "admin"}><ShieldCheck size={17} aria-hidden="true"/><div><b>Administrator</b><small>Account directory, aggregate usage and review queues. No role escalation.</small></div></div>
          <div className="host-role" data-current={role === "moderator"}><Users size={17} aria-hidden="true"/><div><b>Moderator</b><small>Submitted bank metadata and reported community posts only.</small></div></div>
          <p className="sub">No operator role grants unrestricted access to individual private source files, notes, questions or saved progress.</p>
        </GlassCard>
        {owner && <GlassCard pad>
          <PanelHeader headingLevel={2} title="Audit history" sub="Recent privileged actions and their immutable account IDs." />
          {authorizedDashboard.audit.length === 0 && <p className="sub">No privileged changes yet.</p>}
          {authorizedDashboard.audit.map(item => <div className="host-audit" key={item.id}>
            <b>{item.action}</b><small>{date(item.created_at)}</small>
            <small>Actor: {item.actor_id?.slice(0,8) ?? "Deleted account"} · Target: {item.target_id?.slice(0,8) ?? "none"}</small>
            {typeof item.metadata.reason === "string" && <p className="sub">{item.metadata.reason}</p>}
          </div>)}
        </GlassCard>}
      </aside>}
    </div>}
  </main>;
}
