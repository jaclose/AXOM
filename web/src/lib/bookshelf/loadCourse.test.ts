import { beforeEach, expect, it, vi } from "vitest";
import { commitCourseLoad } from "./loadCourse";
import { buildCourseBooks } from "./courseBooks";
import { SGU_CURRICULUM } from "../curricula";

const vault = vi.hoisted(() => ({ flush: vi.fn(), check: vi.fn(), set: vi.fn() }));
vi.mock("../store", () => ({ useStore: { getState: () => ({ terms: [], courses: [] }), setState: vault.set } }));
vi.mock("../localVault", () => ({ flushLocalVaultWrites: vault.flush, getVaultWriteCheckpoint: () => 17, assertVaultWritesSince: vault.check }));
const book = buildCourseBooks({ terms: [], courses: [], tracker: [], curricula: [SGU_CURRICULUM] })[0];
beforeEach(() => vi.resetAllMocks());

it("waits for the device write before reporting a saved course", async () => {
  let finish!: () => void;
  vault.flush.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  let settled = false;
  const pending = commitCourseLoad(book).then((result) => { settled = true; return result; });
  await vi.waitFor(() => expect(vault.flush).toHaveBeenCalled());
  expect(settled).toBe(false);
  finish();
  expect(await pending).toEqual({ status: "saved-on-device" });
  expect(vault.check).toHaveBeenCalledWith(17);
});

it("reports a recorded storage failure instead of claiming success", async () => {
  vault.check.mockImplementation(() => { throw new Error("Device storage is full"); });
  expect(await commitCourseLoad(book)).toEqual({ status: "failed", message: "Device storage is full" });
});
