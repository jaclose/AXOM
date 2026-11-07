import type { OperatorAudit } from "./hostClient";

/** Search only evidence actually read from the owner-authorized server response. */
export function filterHostAudit(audit: readonly OperatorAudit[], query: string): OperatorAudit[] {
  const needle = query.trim().toLocaleLowerCase().slice(0, 160);
  if (!needle) return [...audit];
  return audit.filter((item) => [
    item.action, item.actor_id ?? "", item.target_id ?? "", item.created_at,
    typeof item.metadata.reason === "string" ? item.metadata.reason : "",
  ].some((value) => value.toLocaleLowerCase().includes(needle)));
}

/** Never let an audit field become an executable spreadsheet formula. */
function cell(raw: unknown): string {
  const value = String(raw ?? "");
  // CSV quotes do not neutralize spreadsheet formula evaluation.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** The caller owns the scope label: this is the latest 30 rows, NOT a full ledger. */
export function auditCsv(items: readonly OperatorAudit[]): string {
  const header = "Timestamp,Action,Actor ID,Target ID,Reason,Metadata";
  const rows = items.map((item) => [
    item.created_at, item.action, item.actor_id ?? "", item.target_id ?? "",
    typeof item.metadata.reason === "string" ? item.metadata.reason : "",
    JSON.stringify(item.metadata),
  ].map(cell).join(","));
  return [header, ...rows, ""].join("\r\n");
}
