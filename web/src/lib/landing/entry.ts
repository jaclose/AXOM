/** Public entry never imports the workspace store, runs migrations or writes learner data. */
export function shouldOpenWorkspace(url: URL, native = false, installed = false): boolean {
  return native || installed || url.pathname !== "/" || url.searchParams.get("app") === "1"
    || Boolean(url.hash) || ["code", "error", "error_description", "token_hash", "type"].some((key) => url.searchParams.has(key));
}

export const BROWSER_ENTRY = "/?app=1";
export const ACCOUNT_ENTRY = "/?app=1&account=1";

export function shouldOpenAccount(url: URL): boolean {
  const fragment = new URLSearchParams(url.hash.slice(1));
  return url.searchParams.get("account") === "1" || ["code", "token_hash", "error", "error_description"].some((key) => url.searchParams.has(key))
    || fragment.has("access_token") || fragment.get("type") === "recovery";
}
