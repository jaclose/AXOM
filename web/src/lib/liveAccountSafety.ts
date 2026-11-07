/**
 * Destructive live-account Playwright guardrails, kept independent of provider clients.
 * A dedicated test project is mandatory. No fallback to a production Supabase URL.
 */
const productionProjectRef = "jofkmfwkidubxcutkwzf";
const pageSize = 100;
const maxPages = 100;

type UserRecord = { id?: unknown; email?: unknown; created_at?: unknown };

export function dedicatedLiveProjectUrl(rawUrl: string | undefined, expectedRef: string | undefined): string {
  if (!rawUrl || !expectedRef) {
    throw new Error("Live account tests require VITE_SUPABASE_URL and AXOM_LIVE_TEST_PROJECT_REF.");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Live-account Supabase URL is invalid.");
  }
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname);
  if (parsed.protocol !== "https:" || !match || parsed.username || parsed.password
    || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Live accounts require the HTTPS URL of an explicit Supabase test project.");
  }
  if (match[1] === productionProjectRef || expectedRef === productionProjectRef || match[1] !== expectedRef) {
    throw new Error("Refusing live-account mutations outside the explicitly named non-production test project.");
  }
  return parsed.origin;
}

export async function assertUnusedEmail(
  email: string,
  fetchPage: (page: number, perPage: number) => Promise<{
    data?: { users?: UserRecord[] } | null;
    error?: unknown;
  }>,
): Promise<void> {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Live-account email must be a valid, explicitly supplied disposable address.");
  }
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page, pageSize);
    if (result.error || !Array.isArray(result.data?.users)) {
      throw new Error("Cannot prove the live-account email is unused: Supabase listing failed.");
    }
    if (result.data.users.some((user) => typeof user.email === "string"
      && user.email.toLowerCase() === email.toLowerCase())) {
      throw new Error("Live-account email already exists; refusing to touch an existing account.");
    }
    if (result.data.users.length < pageSize) return;
  }
  throw new Error("Supabase user listing exceeded the safe pagination limit; refusing account creation.");
}

export function signupResponseUserId(payload: unknown, expectedEmail: string): string {
  if (!payload || typeof payload !== "object" || !("user" in payload)) {
    throw new Error("Signup response did not return a newly created user identity.");
  }
  const user = (payload as { user?: UserRecord }).user;
  if (!user || typeof user.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)
    || typeof user.email !== "string" || user.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error("Signup response identity mismatch; refusing account mutation or deletion.");
  }
  return user.id;
}

export function matchesRunOwnedUser(
  user: unknown,
  id: string,
  email: string,
  startedAtMs: number,
): boolean {
  if (!user || typeof user !== "object") return false;
  const record = user as UserRecord;
  if (record.id !== id || typeof record.email !== "string"
    || record.email.toLowerCase() !== email.toLowerCase()
    || typeof record.created_at !== "string") return false;
  const createdAt = Date.parse(record.created_at);
  // Allow small clock skew, but never accept a historical account as run-owned.
  return Number.isFinite(createdAt) && createdAt >= startedAtMs - 60_000;
}
