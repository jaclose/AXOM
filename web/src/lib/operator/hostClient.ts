import { accountOperationClient } from "../account/supabase";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAccount } from "../account/accountStore";
import { academicAccountScope } from "../academicLibrary/accountScope";

let accountEpoch = 0;
const identityListeners = new Set<() => void>();
useAccount.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    accountEpoch++;
    for (const listener of identityListeners) listener();
  }
});
const identitySnapshot = () => `${accountEpoch}:${useAccount.getState().user?.id ?? "signed-out"}`;
const subscribeIdentity = (listener: () => void) => { identityListeners.add(listener); return () => { identityListeners.delete(listener); }; };
/** Key account-bound screens so even a quick A → B → A transition drops stale drafts and responses. */
export function useAccountIdentity() { return useSyncExternalStore(subscribeIdentity, identitySnapshot, identitySnapshot); }

export type OperatorRole = "owner" | "admin" | "moderator";
export interface OperatorOverview {
  role: OperatorRole;
  registered_accounts: number | null;
  shared_profiles: number;
  shared_posts: number;
  reports_pending: number;
  academic_review_pending: number;
  academic_approved: number;
  ai_requests_7d: number | null;
}
export interface OperatorAccount {
  user_id: string; email: string | null; display_name: string | null;
  role: OperatorRole | null; created_at: string; last_sign_in_at: string | null;
  ai_enabled: boolean; ai_daily_limit: number; ai_used_today: number;
}
export interface OperatorBank {
  collection_id: string; title: string; module: string; term: string; owner_id: string;
  visibility: string; ready_questions: number; review_questions: number; updated_at: string;
}
export interface OperatorReport {
  post_id: string; author_handle: string; post_kind: string; reason: string;
  note: string; reports: number; latest_at: string;
}
export interface OperatorAudit {
  id: string; actor_id: string | null; action: string; target_id: string | null;
  metadata: Record<string, unknown>; created_at: string;
}
export interface OperatorDashboard {
  role: OperatorRole | null;
  overview: OperatorOverview | null;
  accounts: OperatorAccount[];
  queue: OperatorBank[];
  reports: OperatorReport[];
  audit: OperatorAudit[];
}

async function withClient<T>(accountId: string, run: (client: SupabaseClient) => Promise<T>): Promise<T> {
  const guard = academicAccountScope(accountId);
  try {
    guard.assertCurrent();
    const scoped = await accountOperationClient();
    guard.assertCurrent();
    if (scoped.userId !== accountId) throw new Error("This account changed. Reopen the host console.");
    await scoped.assertCurrent();
    const result = await run(scoped.client);
    guard.assertCurrent();
    await scoped.assertCurrent();
    guard.assertCurrent();
    return result;
  } finally { guard.dispose(); }
}

const row = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nullableCount = (value: unknown) => value === null || count(value);
const roleValue = (value: unknown) => value === "owner" || value === "admin" || value === "moderator";
const bounded = (value: unknown, max: number, check: (item: unknown) => boolean) => Array.isArray(value) && value.length <= max && value.every(check);

export function validOperatorDashboard(value: unknown): value is OperatorDashboard {
  if (!row(value) || !(value.role === null || roleValue(value.role))) return false;
  if (value.role === null) return value.overview === null && [value.accounts, value.queue, value.reports, value.audit].every(items => Array.isArray(items) && !items.length);
  const overview = value.overview;
  return row(overview) && overview.role === value.role && nullableCount(overview.registered_accounts) && nullableCount(overview.ai_requests_7d)
    && [overview.shared_profiles, overview.shared_posts, overview.reports_pending, overview.academic_review_pending, overview.academic_approved].every(count)
    && bounded(value.accounts, 100, item => row(item) && text(item.user_id) && nullableText(item.email) && nullableText(item.display_name)
      && (item.role === null || roleValue(item.role)) && text(item.created_at) && nullableText(item.last_sign_in_at)
      && typeof item.ai_enabled === "boolean" && count(item.ai_daily_limit) && count(item.ai_used_today))
    && bounded(value.queue, 100, item => row(item) && [item.collection_id, item.title, item.module, item.term, item.owner_id, item.visibility, item.updated_at].every(text) && count(item.ready_questions) && count(item.review_questions))
    && bounded(value.reports, 100, item => row(item) && [item.post_id, item.author_handle, item.post_kind, item.reason, item.note, item.latest_at].every(text) && count(item.reports))
    && bounded(value.audit, 30, item => row(item) && text(item.id) && nullableText(item.actor_id) && text(item.action) && nullableText(item.target_id) && row(item.metadata) && text(item.created_at));
}

export async function operatorRole(accountId: string): Promise<OperatorRole | null> {
  return withClient(accountId, async client => {
    const { data, error } = await client.rpc("axom_operator_role");
    if (error) throw new Error("Host access could not be checked. Retry when connected.");
    if (data !== null && !roleValue(data)) throw new Error("The server returned an invalid Host permission.");
    return data as OperatorRole | null;
  });
}
export function useOperatorAccess() {
  const identity = useAccountIdentity();
  const accountId = useAccount(state => state.user?.id);
  const [revision, setRevision] = useState(0);
  const [access, setAccess] = useState<{ identity: string; role: OperatorRole | null }>();
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("axom:operator-access-changed", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("axom:operator-access-changed", refresh); };
  }, []);
  useEffect(() => {
    let active = true;
    setAccess(undefined);
    if (accountId) void operatorRole(accountId).then(role => { if (active) setAccess({ identity, role }); })
      .catch(() => { if (active) setAccess({ identity, role: null }); });
    return () => { active = false; };
  }, [identity, accountId, revision]);
  return access?.identity === identity ? access.role : null;
}
export async function loadOperatorDashboard(accountId: string): Promise<OperatorDashboard> {
  return withClient(accountId, async client => {
  const { data: roleData, error: roleError } = await client.rpc("axom_operator_role");
  if (roleError) throw new Error("Host access could not be checked. Verify the database migration is installed.");
  if (roleData !== null && !roleValue(roleData)) throw new Error("The server returned an invalid Host permission.");
  const role = roleData as OperatorRole | null;
  if (!role) return { role: null, overview: null, accounts: [], queue: [], reports: [], audit: [] };
  const [overview, queue, reports, accounts, audit] = await Promise.all([
    client.rpc("axom_operator_overview"),
    client.rpc("axom_operator_review_queue"),
    client.rpc("axom_operator_reports"),
    role === "owner" || role === "admin" ? client.rpc("axom_operator_accounts", { query_text: "" }) : Promise.resolve({ data: [], error: null }),
    role === "owner" ? client.from("axom_operator_audit").select("id,actor_id,action,target_id,metadata,created_at").order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (overview.error || queue.error || reports.error || accounts.error || audit.error
    || !overview.data || !Array.isArray(queue.data) || !Array.isArray(reports.data)
    || !Array.isArray(accounts.data) || !Array.isArray(audit.data)) {
    throw new Error("The host console could not load safely. No changes were made.");
  }
  const result = {
    role, overview: overview.data as OperatorOverview,
    accounts: accounts.data as OperatorAccount[], queue: queue.data as OperatorBank[],
    reports: reports.data as OperatorReport[], audit: audit.data as OperatorAudit[],
  };
  if (!validOperatorDashboard(result)) throw new Error("The host console returned incomplete data. Refresh before continuing.");
  return result;
  });
}
const checkReason = (reason: string) => { if (reason.trim().length < 8 || reason.trim().length > 500) throw new Error("Record a reason of 8 to 500 characters."); };
export async function setOperatorRole(accountId: string, target: string, role: "admin" | "moderator" | "member", reason: string): Promise<void> {
  checkReason(reason);
  return withClient(accountId, async client => {
  const { error } = await client.rpc("axom_operator_set_role", { target, wanted: role, reason: reason.trim() });
  if (error) throw new Error("Role update was denied or could not be saved.");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("axom:operator-access-changed"));
  });
}
export async function setOperatorAI(accountId: string, target: string, enabled: boolean, dailyLimit: number, reason: string): Promise<void> {
  checkReason(reason);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) throw new Error("Daily quota must be an integer from 0 to 1000.");
  return withClient(accountId, async client => {
  const { error } = await client.rpc("axom_operator_set_ai", { target, permitted: enabled, requested_limit: dailyLimit, reason: reason.trim() });
  if (error) throw new Error("AI permissions could not be changed.");
  });
}
export async function resolveReport(accountId: string, postId: string, resolution: "dismiss" | "remove"): Promise<void> {
  return withClient(accountId, async client => {
  const { error } = await client.rpc("axom_operator_resolve_report", { target: postId, resolution });
  if (error) throw new Error("The report could not be resolved.");
  });
}
