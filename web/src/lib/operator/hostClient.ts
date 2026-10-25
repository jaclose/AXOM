import { accountOperationClient } from "../account/supabase";

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
  id: string; actor_id: string; action: string; target_id: string | null;
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

async function clientFor(accountId: string) {
  const scoped = await accountOperationClient();
  if (scoped.userId !== accountId) throw new Error("This account changed. Reopen the host console.");
  return scoped.client;
}

export async function operatorRole(accountId: string): Promise<OperatorRole | null> {
  const { data, error } = await (await clientFor(accountId)).rpc("axom_operator_role");
  if (error) return null;
  return data === "owner" || data === "admin" || data === "moderator" ? data : null;
}
export async function loadOperatorDashboard(accountId: string): Promise<OperatorDashboard> {
  const client = await clientFor(accountId);
  const { data: roleData, error: roleError } = await client.rpc("axom_operator_role");
  if (roleError) throw new Error("Host access could not be checked. Verify the database migration is installed.");
  const role = roleData === "owner" || roleData === "admin" || roleData === "moderator" ? roleData as OperatorRole : null;
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
  return {
    role, overview: overview.data as OperatorOverview,
    accounts: accounts.data as OperatorAccount[], queue: queue.data as OperatorBank[],
    reports: reports.data as OperatorReport[], audit: audit.data as OperatorAudit[],
  };
}
export async function setOperatorRole(accountId: string, target: string, role: "admin" | "moderator" | "member"): Promise<void> {
  const { error } = await (await clientFor(accountId)).rpc("axom_operator_set_role", { target, wanted: role });
  if (error) throw new Error("Role update was denied or could not be saved.");
}
export async function setOperatorAI(accountId: string, target: string, enabled: boolean, dailyLimit: number): Promise<void> {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) throw new Error("Daily quota must be an integer from 0 to 1000.");
  const { error } = await (await clientFor(accountId)).rpc("axom_operator_set_ai", { target, permitted: enabled, requested_limit: dailyLimit });
  if (error) throw new Error("AI permissions could not be changed.");
}
export async function resolveReport(accountId: string, postId: string, resolution: "dismiss" | "remove"): Promise<void> {
  const { error } = await (await clientFor(accountId)).rpc("axom_operator_resolve_report", { target: postId, resolution });
  if (error) throw new Error("The report could not be resolved.");
}