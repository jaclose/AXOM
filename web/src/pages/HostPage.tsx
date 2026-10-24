import { useEffect, useMemo, useState } from "react";
import { BarChart3, CircleAlert, Crown, RefreshCw, ShieldCheck, ShieldX, Users, Zap } from "lucide-react";
import { useAccount } from "../lib/account/accountStore";
import {
  loadOperatorDashboard, resolveReport, setOperatorAI, setOperatorRole,
  type OperatorAccount, type OperatorDashboard, type OperatorRole,
} from "../lib/operator/hostClient";
import { GButton, GhostButton, GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import "../styles/host-console.css";

function date(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "Never";
}

export function HostPage() {
  const userId = useAccount(s => s.user?.id);
  const [dashboard, setDashboard] = useState<OperatorDashboard>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, "admin" | "moderator" | "member">>({});
  const [aiDrafts, setAiDrafts] = useState<Record<string, { enabled: boolean; limit: string }>>({});
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
  const role = dashboard?.role;
  const owner = role === "owner";
  const accounts = useMemo(() => (dashboard?.accounts ?? []).filter(account =>
    [account.email,account.display_name,account.user_id].some(text => text?.toLowerCase().includes(search.toLowerCase()))
  ), [dashboard,search]);
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
    return <div className="host-account-controls">
      <label>Role
        <select value={roleDrafts[account.user_id] ?? account.role ?? "member"}
          disabled={!owner || account.role === "owner" || busy}
          onChange={e => setRoleDrafts(current => ({...current,[account.user_id]:e.target.value as "admin" | "moderator" | "member"}))}>
          {account.role === "owner" && <option value="owner">Executive owner</option>}
          <option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Administrator</option>
        </select>
      </label>
      {owner && account.role !== "owner" && <GButton size="sm" disabled={busy || (roleDrafts[account.user_id] ?? account.role ?? "member") === (account.role ?? "member")}
        onClick={() => {
          const wanted = roleDrafts[account.user_id];
          if (!wanted || !window.confirm("Apply this account's new server-side role?")) return;
          void change(() => setOperatorRole(userId!, account.user_id, wanted), "Role updated and audited.");
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
      {owner && <GButton size="sm" disabled={busy || (!((aiDrafts[account.user_id]?.enabled ?? account.ai_enabled) !== account.ai_enabled)
        && Number(aiDrafts[account.user_id]?.limit ?? account.ai_daily_limit) === account.ai_daily_limit)}
        onClick={() => {
          const limit = Number(draft.limit);
          if (!Number.isInteger(limit) || limit < 0 || limit > 1000) { setError("Quota must be 0 to 1000."); return; }
          if (!window.confirm("Apply this user's cloud AI permission and daily quota?")) return;
          void change(() => setOperatorAI(userId!, account.user_id, draft.enabled, limit), "AI policy saved and audited.");
        }}>Apply AI policy</GButton>}
    </div>;
  }
  return <div className="host-page stack">
    <section className="host-banner">
      <div><span className="host-eyebrow"><ShieldCheck size={17} /> AXOM OPERATOR CONSOLE</span>
        <h2>Host dashboard</h2>
        <p>Server-enforced permissions, responsible moderation and traceable operational controls.</p>
      </div>
      {role && <Tag tone="gold">{role === "owner" ? "Executive owner" : role === "admin" ? "Administrator" : "Moderator"}</Tag>}
    </section>
    <div className="row wrap gap8">
      <GButton size="sm" disabled={loading || busy} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={15}/> Refresh</GButton>
      <a className="ghost-btn" href="#community">Community</a>
      <a className="ghost-btn" href="#questions">Question Bank</a>
    </div>
    {loading && <p role="status">Checking operator access…</p>}
    {error && <p role="alert" className="host-warning">{error}</p>}
    {message && <p role="status" className="sub">{message}</p>}
    {!userId && <GlassCard pad><PanelHeader title="Sign-in required" headingLevel={2} sub="Use your verified AXOM account to access host operations." /></GlassCard>}
    {!loading && userId && dashboard?.role === null && <GlassCard pad><PanelHeader title="Operator permission required" headingLevel={2}
      sub="This account does not have an operator role. Display names cannot grant executive access. The verified owner must be provisioned by immutable auth user ID." />
      <p className="sub">No private learner data is accessible through the public client.</p>
    </GlassCard>}
    {dashboard?.overview && <div className="host-layout">
      <div className="stack">
        <div className="host-stats">
          {([
            ["Registered accounts", dashboard.overview.registered_accounts, Users],
            ["Public profiles", dashboard.overview.shared_profiles, Users],
            ["Review submissions", dashboard.overview.academic_review_pending, CircleAlert],
            ["Moderation reports", dashboard.overview.reports_pending, ShieldX],
            ["AI requests, 7 days", dashboard.overview.ai_requests_7d, Zap],
            ["Approved shared collections", dashboard.overview.academic_approved, BarChart3],
          ] as const).map(([label, value, Icon]) => <GlassCard key={label} pad className="host-metric">
            <Icon size={18} aria-hidden="true" /><b>{value ?? "Restricted"}</b><span>{label}</span>
          </GlassCard>)}
        </div>
        {(role === "owner" || role === "admin") && <GlassCard pad>
          <PanelHeader headingLevel={2} title="Accounts & AI" sub="Changes are checked on the server. Operators cannot inspect private learner workspaces." />
          <label className="host-search">Find account<input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name or email" /></label>
          <div className="host-accounts">{accounts.map(account => <article key={account.user_id} className="host-account">
            <div className="host-account-head"><div><b>{account.display_name ?? account.email ?? "Account"}</b>
              <small>{account.email ?? "No email"} · Joined {date(account.created_at)} · Last login {date(account.last_sign_in_at)}</small></div>
              {account.role && <Tag tone={account.role === "owner" ? "gold" : "neutral"}>{account.role}</Tag>}</div>
            <p className="sub">AI requests today: {account.ai_used_today} of {account.ai_daily_limit}</p>
            {controlFor(account)}
          </article>)}</div>
          {accounts.length === 0 && <p className="sub">No matching accounts in this page of the directory.</p>}
          <p className="sub">Up to 100 recent accounts are listed. Executive permissions are bound to account IDs, not editable names.</p>
        </GlassCard>}
        <GlassCard pad>
          <PanelHeader headingLevel={2} title="Submitted QBank review" sub="Non-private collections intentionally submitted for sharing. Pending review never implies approval." />
          {dashboard.queue.length === 0 ? <p className="sub">No shared Question Banks await review.</p> :
            <div className="host-queue">{dashboard.queue.map(item => <div className="host-queue-row" key={item.collection_id}>
              <div><b>{item.title}</b><small>{item.module} · {item.term} · {item.visibility} · {date(item.updated_at)}</small></div>
              <div><Tag tone="orange">Pending</Tag><small>{item.ready_questions} candidate-ready · {item.review_questions} review</small></div>
            </div>)}</div>}
          <p className="sub">Approval is intentionally not a one-click host operation. Source provenance, rights and answer-review evidence must be validated through the academic review process first.</p>
        </GlassCard>
        <GlassCard pad>
          <PanelHeader headingLevel={2} title="Reported community posts" sub="Only reported posts enter this moderation queue." />
          {dashboard.reports.length === 0 ? <p className="sub">No posts have been reported.</p> : dashboard.reports.map(report => <article key={report.post_id} className="host-report">
            <b>@{report.author_handle} · {report.post_kind}</b>
            <p>{report.reports} reports · {report.reason}</p>
            {report.note && <p className="sub">{report.note}</p>}
            <div className="row wrap gap8"><GButton size="sm" disabled={busy}
              onClick={() => void change(() => resolveReport(userId!, report.post_id, "dismiss"), "Report dismissed and audited.")}>Dismiss report</GButton>
              <GButton size="sm" variant="danger" disabled={busy} onClick={() => {
                if (window.confirm("Remove this reported post? The author’s private workspace stays untouched."))
                  void change(() => resolveReport(userId!, report.post_id, "remove"), "Reported post removed and audited.");
              }}>Remove post</GButton>
            </div>
          </article>)}
        </GlassCard>
      </div>
      <aside className="stack">
        <GlassCard pad>
          <PanelHeader headingLevel={2} title="Permissions model" sub="Least privilege enforced in Postgres." />
          <div className="host-role"><Crown size={17}/><b>Executive owner</b><small>Account roles, AI limits, reports, operational data and audit history.</small></div>
          <div className="host-role"><ShieldCheck size={17}/><b>Administrator</b><small>Account directory, aggregate usage and review queues. No role escalation.</small></div>
          <div className="host-role"><Users size={17}/><b>Moderator</b><small>Submitted bank metadata and reported community posts only.</small></div>
          <p className="sub">No operator role grants unrestricted access to individual private source files, notes, questions or saved progress.</p>
        </GlassCard>
        {owner && <GlassCard pad>
          <PanelHeader headingLevel={2} title="Audit history" sub="Recent privileged actions and their immutable account IDs." />
          {dashboard.audit.length === 0 && <p className="sub">No privileged changes yet.</p>}
          {dashboard.audit.map(item => <div className="host-audit" key={item.id}>
            <b>{item.action}</b><small>{date(item.created_at)}</small>
            <small>Actor: {item.actor_id.slice(0,8)} · Target: {item.target_id?.slice(0,8) ?? "none"}</small>
          </div>)}
        </GlassCard>}
      </aside>
    </div>}
  </div>;
}