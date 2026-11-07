import { describe, expect, it } from "vitest";
import {
  assertUnusedEmail,
  dedicatedLiveProjectUrl,
  matchesRunOwnedUser,
  permitsLiveAccountRequest,
  signupResponseUserId,
} from "./liveAccountSafety";

const testRef = "abcdefghijklmnopqrst";
const testUrl = `https://${testRef}.supabase.co`;
const email = "axom-live+run@example.test";
const id = "12345678-1234-4234-9234-123456789abc";

describe("destructive live-account safety gates", () => {
  it("accepts only a named dedicated HTTPS Supabase test project", () => {
    expect(dedicatedLiveProjectUrl(testUrl, testRef)).toBe(testUrl);
    expect(() => dedicatedLiveProjectUrl(undefined, testRef)).toThrow(/require/);
    expect(() => dedicatedLiveProjectUrl(testUrl, undefined)).toThrow(/require/);
    expect(() => dedicatedLiveProjectUrl(testUrl, "differentprojectxxxxx")).toThrow(/Refusing/);
    expect(() => dedicatedLiveProjectUrl("https://jofkmfwkidubxcutkwzf.supabase.co", "jofkmfwkidubxcutkwzf")).toThrow(/Refusing/);
    expect(() => dedicatedLiveProjectUrl("http://" + testRef + ".supabase.co", testRef)).toThrow(/HTTPS/);
    expect(() => dedicatedLiveProjectUrl("https://evil.example", testRef)).toThrow(/HTTPS/);
    expect(() => dedicatedLiveProjectUrl(testUrl + "/auth/v1", testRef)).toThrow(/HTTPS/);
    expect(() => dedicatedLiveProjectUrl(testUrl + "?target=other", testRef)).toThrow(/HTTPS/);
  });

  it("permits only the dedicated cloud project, its storage host and local Vite origin", () => {
    const appOrigin = "http://127.0.0.1:5187";
    const allows = (url: string) => permitsLiveAccountRequest(url, testUrl, appOrigin);
    expect(allows(testUrl + "/auth/v1/signup")).toBe(true);
    expect(allows(testUrl + "/rest/v1/workspace_revisions")).toBe(true);
    expect(allows(`https://${testRef}.storage.supabase.co/storage/v1/upload/resumable`)).toBe(true);
    expect(allows(appOrigin + "/@vite/client")).toBe(true);
    expect(allows("https://jofkmfwkidubxcutkwzf.supabase.co/auth/v1/signup")).toBe(false);
    expect(allows("https://anotherprojectabcde.supabase.co/rest/v1/workspace")).toBe(false);
    expect(allows("https://anotherprojectabcde.storage.supabase.co/storage/v1/upload/resumable")).toBe(false);
    expect(allows("https://backend.example.test/auth/v1/signup")).toBe(false);
    expect(allows("https://fonts.googleapis.com/css2")).toBe(false);
    expect(allows("http://127.0.0.1:5188/auth/v1/signup")).toBe(false);
    expect(allows("http://localhost:5187/")).toBe(false);
    expect(allows("not a url")).toBe(false);
    expect(permitsLiveAccountRequest(testUrl, testUrl, "https://axom.info")).toBe(false);
    expect(permitsLiveAccountRequest(testUrl, "https://jofkmfwkidubxcutkwzf.supabase.co", appOrigin)).toBe(false);
  });

  it("rejects first-page API failures instead of treating missing data as an unused email", async () => {
    await expect(assertUnusedEmail(email, async () => ({ error: new Error("403"), data: null }))).rejects.toThrow(/listing failed/);
    await expect(assertUnusedEmail(email, async () => ({ data: null }))).rejects.toThrow(/listing failed/);
  });

  it("checks subsequent pages and fails closed if an address already exists", async () => {
    const pages: number[] = [];
    await expect(assertUnusedEmail(email, async (page, size) => {
      pages.push(page);
      return { data: { users: page === 1
        ? Array.from({ length: size }, (_, index) => ({ email: `other${index}@example.test` }))
        : [{ email: "AXOM-LIVE+RUN@EXAMPLE.TEST" }] } };
    })).rejects.toThrow(/already exists/);
    expect(pages).toEqual([1, 2]);
  });

  it("accepts only an exhaustively checked unused address", async () => {
    const pages: number[] = [];
    await assertUnusedEmail(email, async (page, size) => {
      pages.push(page);
      return { data: { users: page === 1 ? Array.from({ length: size }, () => ({ email: "other@example.test" })) : [] } };
    });
    expect(pages).toEqual([1, 2]);
  });

  it("rejects invalid addresses and never calls the admin API", async () => {
    let calls = 0;
    await expect(assertUnusedEmail("", async () => { calls++; return { data: { users: [] } }; })).rejects.toThrow(/valid/);
    expect(calls).toBe(0);
  });

  it("binds cleanup to the actual browser signup response, not an email lookup", () => {
    expect(signupResponseUserId({ user: { id, email } }, email)).toBe(id);
    expect(() => signupResponseUserId({ user: { id, email: "other@example.test" } }, email)).toThrow(/mismatch/);
    expect(() => signupResponseUserId({ user: { id: "old-account", email } }, email)).toThrow(/mismatch/);
    expect(() => signupResponseUserId({ error: "rate limited" }, email)).toThrow(/identity/);
  });

  it("rejects wrong, stale or malformed server identities before cleanup", () => {
    const started = Date.parse("2026-11-07T18:00:00Z");
    const user = { id, email, created_at: new Date(started).toISOString() };
    expect(matchesRunOwnedUser(user, id, email, started)).toBe(true);
    expect(matchesRunOwnedUser({ ...user, id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }, id, email, started)).toBe(false);
    expect(matchesRunOwnedUser({ ...user, email: "other@example.test" }, id, email, started)).toBe(false);
    expect(matchesRunOwnedUser({ ...user, created_at: "2026-10-01T00:00:00Z" }, id, email, started)).toBe(false);
    expect(matchesRunOwnedUser({ ...user, created_at: "not a date" }, id, email, started)).toBe(false);
    expect(matchesRunOwnedUser(null, id, email, started)).toBe(false);
  });
});
