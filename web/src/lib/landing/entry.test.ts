import { describe, expect, it } from "vitest";
import { shouldOpenAccount, shouldOpenWorkspace } from "./entry";

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
});
