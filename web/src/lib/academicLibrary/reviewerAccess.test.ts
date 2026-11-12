import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountOperationClient } from "../account/supabase";
import { isAcademicReviewer } from "./client";

vi.mock("../account/supabase", () => ({ accountOperationClient: vi.fn() }));

const rpc = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(accountOperationClient).mockResolvedValue({
    userId: "synthetic-reviewer", client: { rpc },
  } as never);
});

describe("academic reviewer permission freshness", () => {
  it("rechecks after denial, grant and revocation rather than retaining stale browser-session authority", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    expect(await isAcademicReviewer("synthetic-reviewer")).toBe(false);
    expect(await isAcademicReviewer("synthetic-reviewer")).toBe(true);
    expect(await isAcademicReviewer("synthetic-reviewer")).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith("academic_is_reviewer");
  });

  it("deduplicates simultaneous checks but not later attempts", async () => {
    let finish!: (value: { data: boolean; error: null }) => void;
    const pending = new Promise<{ data: boolean; error: null }>(resolve => { finish = resolve; });
    rpc.mockReturnValueOnce(pending).mockResolvedValue({ data: true, error: null });
    const first = isAcademicReviewer("synthetic-reviewer");
    const second = isAcademicReviewer("synthetic-reviewer");
    expect(first).toBe(second);
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);
    finish({ data: true, error: null });
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(await isAcademicReviewer("synthetic-reviewer")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed during a backend error and permits a subsequent safe retry", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "503", message: "Unavailable" } })
      .mockResolvedValueOnce({ data: true, error: null });
    expect(await isAcademicReviewer("synthetic-reviewer")).toBe(false);
    expect(await isAcademicReviewer("synthetic-reviewer")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
