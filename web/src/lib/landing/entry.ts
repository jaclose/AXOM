/** Public entry never imports the workspace store, runs migrations or writes learner data. */
export function shouldOpenWorkspace(url: URL, native = false, installed = false): boolean {
  return native || installed || url.pathname !== "/" || url.searchParams.get("app") === "1"
    || Boolean(url.hash) || ["code", "error", "error_description", "token_hash", "type"].some((key) => url.searchParams.has(key));
}

export const BROWSER_ENTRY = "/?app=1";
export const ACCOUNT_ENTRY = "/?app=1&account=1";
/** The same account controls, opened on the form that creates an account. */
export const ACCOUNT_CREATE_ENTRY = "/?app=1&account=create";

export function shouldOpenAccount(url: URL): boolean {
  const fragment = new URLSearchParams(url.hash.slice(1));
  return ["1", "create"].includes(url.searchParams.get("account") ?? "") || ["code", "token_hash", "error", "error_description"].some((key) => url.searchParams.has(key))
    || fragment.has("access_token") || fragment.get("type") === "recovery";
}

/** Which form the account page opens on. Auth callbacks keep the default. */
export function accountEntryMode(url: URL): "sign-in" | "create" {
  return url.searchParams.get("account") === "create" ? "create" : "sign-in";
}
