import type { Session, SupabaseClient } from "@supabase/supabase-js";

/**
 * The optional AXOM account backend. When the two public env values are
 * absent AXOM stays fully local and every account control explains why.
 *
 * The SDK is loaded lazily, so local-only installs never download it.
 * PKCE keeps auth callbacks in the query string, so they never collide with
 * AXOM's hash routes (#dashboard, #reports…). Email one-time codes are the
 * primary passwordless path because they also work in the packaged desktop
 * app, where a browser redirect cannot return to the window.
 */
let client: SupabaseClient | null | undefined;
let loading: Promise<SupabaseClient | null> | undefined;

/**
 * Dev servers only: a browser test points the account client at a stand-in
 * backend it answers itself (e2e/accounts-sync-failure.spec.ts). The branch is
 * compiled out of every build, where the two env values are the only source.
 */
function standIn(): { url?: string; key?: string } | undefined {
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  return (window as Window & { __AXOM_E2E_ACCOUNT__?: { url?: string; key?: string } }).__AXOM_E2E_ACCOUNT__;
}

function projectUrl(): string | undefined {
  return standIn()?.url ?? import.meta.env.VITE_SUPABASE_URL;
}

/** Supabase's newer "publishable" key and the legacy anon key are both public client keys. */
function publicKey(): string | undefined {
  return standIn()?.key ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function cloudConfigured(): boolean {
  return Boolean(projectUrl() && publicKey());
}

/** Load (once) and return the client, or null when accounts are not configured. */
export function loadSupabase(): Promise<SupabaseClient | null> {
  if (client !== undefined) return Promise.resolve(client);
  if (!cloudConfigured()) {
    client = null;
    return Promise.resolve(null);
  }
  loading ??= import("@supabase/supabase-js").then(({ createClient }) => {
    client = createClient(projectUrl()!, publicKey()!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
    return client;
  });
  return loading;
}

/** Where supabase-js keeps this device's session (its default storage key). */
export function authStorageKey(): string | null {
  const url = projectUrl();
  if (!url) return null;
  try {
    return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  } catch {
    return null;
  }
}

/**
 * The session supabase-js saved on this device, read without loading the SDK,
 * so AXOM can show who is signed in at once while the SDK confirms it. Only a
 * session that can still be refreshed counts; the SDK has the final word.
 */
export function readStoredSession(): Session | null {
  const key = authStorageKey();
  if (!key || typeof localStorage === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as (Session & { currentSession?: Session }) | null;
    const session = raw?.currentSession ?? raw;
    return session?.user?.id && typeof session.refresh_token === "string" && session.refresh_token ? session : null;
  } catch {
    return null;
  }
}

/** The already-loaded client (null before loadSupabase resolves or when unconfigured). */
export function getSupabase(): SupabaseClient | null {
  return client ?? null;
}

/** Where email links should return. Desktop builds rely on codes instead. */
export function authRedirectUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}

/** Test hook: reset the memoized client between tests. */
export function resetSupabaseForTests(next?: SupabaseClient | null): void {
  client = next;
  loading = undefined;
}
