import { describe, expect, it } from "vitest";
import { ACCOUNT_CREATE_ENTRY, ACCOUNT_ENTRY, accountEntryMode, shouldOpenAccount, shouldOpenWorkspace } from "./entry";

describe("public entry boundary", () => {
  it("keeps public visitors out of workspace hydration", () => {
    expect(shouldOpenWorkspace(new URL("https://axom.info/"))).toBe(false);
    expect(shouldOpenWorkspace(new URL("https://axom.info/?utm_source=example"))).toBe(false);
  });
  it.each(["/?app=1", "/?app=1&account=1", "/#questions", "/#shared-set?id=abc", "/?code=auth-code", "/?error=denied", "/#access_token=example&type=recovery", "/nested/"])("preserves app entry %s", (path) => {
    expect(shouldOpenWorkspace(new URL(path, "https://axom.info"))).toBe(true);
  });
  it("preserves native and installed app startup", () => {
    expect(shouldOpenWorkspace(new URL("https://tauri.localhost/"), true)).toBe(true);
    expect(shouldOpenWorkspace(new URL("https://axom.info/"), false, true)).toBe(true);
  });
  it("routes sign-in and auth callbacks through the existing account controls before setup", () => {
    for (const path of ["/?app=1&account=1", "/?code=auth-code", "/?error=expired", "/#access_token=example&type=recovery"]) {
      expect(shouldOpenAccount(new URL(path, "https://axom.info"))).toBe(true);
    }
    expect(shouldOpenAccount(new URL("https://axom.info/?app=1#questions"))).toBe(false);
  });
  it("opens the account page on the create form only when asked", () => {
    const create = new URL(ACCOUNT_CREATE_ENTRY, "https://axom.info");
    expect(shouldOpenWorkspace(create)).toBe(true);
    expect(shouldOpenAccount(create)).toBe(true);
    expect(accountEntryMode(create)).toBe("create");
    expect(accountEntryMode(new URL(ACCOUNT_ENTRY, "https://axom.info"))).toBe("sign-in");
    expect(accountEntryMode(new URL("/?code=auth-code", "https://axom.info"))).toBe("sign-in");
    expect(shouldOpenAccount(new URL("/?app=1&account=other", "https://axom.info"))).toBe(false);
  });
});
