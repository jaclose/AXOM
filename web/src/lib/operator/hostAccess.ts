import type { OperatorRole } from "./hostClient";

/**
 * Host is JD's private operator console. Only the server-verified Project CEO
 * (the single `owner` row in `axom_operator_roles`) sees Host anywhere in the
 * app: navigation, page title, Settings and Community links. Every Host RPC is
 * still authorized in Postgres; this only decides what the interface shows.
 */
export function canOpenHost(role: OperatorRole | null | undefined): role is "owner" {
  return role === "owner";
}
