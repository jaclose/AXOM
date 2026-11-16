import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resetSupabaseForTests } from "../account/supabase";
import { getPublicCourse, listPublicCourses, offerCoursePublicly, publicCatalogCourse, publicOfferState } from "./publicCatalog";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), accountClient: vi.fn() }));
vi.mock("./client", () => ({ academicClient: (...args: unknown[]) => mocks.accountClient(...args) }));

const ID = "11111111-1111-4111-8111-111111111111";
const REVISION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const row = { id: ID, title: "GOER course", module: "GOER", term: "Term 5", academic_term: null, cohort: null,
  current_revision_id: REVISION, ready_questions: 7, has_plan: true };
const fake = { rpc: (...args: unknown[]) => mocks.rpc(...args) } as unknown as SupabaseClient;
const answer = (data: unknown, error: { code?: string } | null = null) => mocks.rpc.mockResolvedValueOnce({ data, error });

afterEach(() => { vi.resetAllMocks(); resetSupabaseForTests(); });

describe("visitor catalog reader", () => {
  it("reads one page with the search, term and cursor it was given, signed out", async () => {
    resetSupabaseForTests(fake);
    answer([row, { ...row, id: "22222222-2222-4222-8222-222222222222", academic_term: "Fall 2026", cohort: "A", has_plan: false }]);
    const courses = await listPublicCourses("goer", "Term 5", ID);
    expect(mocks.rpc).toHaveBeenCalledWith("academic_public_catalog", { search: "goer", term_filter: "Term 5", after_id: ID });
    expect(courses).toEqual([
      { id: ID, title: "GOER course", module: "GOER", term: "Term 5", current_revision_id: REVISION, ready_questions: 7, has_plan: true },
      { id: "22222222-2222-4222-8222-222222222222", title: "GOER course", module: "GOER", term: "Term 5", academic_term: "Fall 2026", cohort: "A",
        current_revision_id: REVISION, ready_questions: 7, has_plan: false },
    ]);
    expect(mocks.accountClient).not.toHaveBeenCalled();
  });

  it("answers an empty catalog when accounts are not configured or the backend has no visitor catalog yet", async () => {
    resetSupabaseForTests(null);
    expect(await listPublicCourses()).toEqual([]);
    expect(await getPublicCourse(ID)).toBeNull();
    resetSupabaseForTests(fake);
    answer(null, { code: "PGRST202" });
    expect(await listPublicCourses()).toEqual([]);
    answer(null, { code: "PGRST202" });
    expect(await getPublicCourse(ID)).toBeNull();
  });

  it("reports an outage plainly and refuses a malformed page instead of showing part of it", async () => {
    resetSupabaseForTests(fake);
    answer(null, { code: "57014" });
    await expect(listPublicCourses()).rejects.toThrow("could not be loaded");
    for (const bad of [{ ...row, id: "not-a-uuid" }, { ...row, has_plan: undefined }, { ...row, ready_questions: -1 }, { ...row, title: "" }, { ...row, cohort: 4 }, null]) {
      answer([row, bad]);
      await expect(listPublicCourses(), JSON.stringify(bad)).rejects.toThrow("invalid");
    }
    answer(Array.from({ length: 25 }, () => row));
    await expect(listPublicCourses()).rejects.toThrow("invalid");
  });

  it("opens one offered course with its plan, and nothing when it is not offered", async () => {
    resetSupabaseForTests(fake);
    answer({ ...row, has_plan: undefined, source_revision: "2026-A", template_text: "T5 - GOER - Course plan:\nWeek 1:\nLecture 1 [Lecture]" });
    expect(await getPublicCourse(ID)).toEqual({ id: ID, title: "GOER course", module: "GOER", term: "Term 5", current_revision_id: REVISION,
      ready_questions: 7, source_revision: "2026-A", template_text: "T5 - GOER - Course plan:\nWeek 1:\nLecture 1 [Lecture]" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("academic_public_course", { collection: ID });
    answer(null);
    expect(await getPublicCourse(ID)).toBeNull();
    answer({ ...row, id: "22222222-2222-4222-8222-222222222222", template_text: "" });
    await expect(getPublicCourse(ID)).rejects.toThrow("identity");
    answer({ ...row, template_text: "x".repeat(262_145) });
    await expect(getPublicCourse(ID)).rejects.toThrow("invalid");
    answer(null, { code: "08006" });
    await expect(getPublicCourse(ID)).rejects.toThrow("could not be opened");
  });

  it("renders an offered course through the account catalog's card shape without claiming ownership", () => {
    expect(publicCatalogCourse({ ...row, academic_term: "Fall 2026" } as never)).toEqual({
      id: ID, title: "GOER course", module: "GOER", term: "Term 5", academic_term: "Fall 2026", visibility: "shared", review_status: "approved",
      current_revision_id: REVISION, owned: false, ready_questions: 7, review_questions: 0,
    });
  });
});

describe("reviewer's public offer", () => {
  it("reports offered, not offered, or no control when the check cannot be made", async () => {
    mocks.accountClient.mockResolvedValue(fake);
    answer(true); expect(await publicOfferState(ID, "owner")).toBe("offered");
    answer(false); expect(await publicOfferState(ID, "owner")).toBe("not-offered");
    answer(null, { code: "PGRST202" }); expect(await publicOfferState(ID, "owner")).toBe("unavailable");
    mocks.accountClient.mockRejectedValueOnce(new Error("Sign in again"));
    expect(await publicOfferState(ID, "owner")).toBe("unavailable");
    expect(mocks.accountClient).toHaveBeenCalledWith("owner");
  });

  it("binds the decision to the revision on screen and explains each refusal", async () => {
    mocks.accountClient.mockResolvedValue(fake);
    const course = { id: ID, current_revision_id: REVISION };
    answer(null);
    await offerCoursePublicly(course, true, "owner");
    expect(mocks.rpc).toHaveBeenCalledWith("academic_offer_publicly", { collection: ID, offered: true, expected_revision: REVISION });
    answer(null, { code: "40001" });
    await expect(offerCoursePublicly(course, true, "owner")).rejects.toThrow("This course changed");
    answer(null, { code: "42501" });
    await expect(offerCoursePublicly(course, true, "owner")).rejects.toThrow("Only the reviewer who owns");
    answer(null, { code: "42501" });
    await expect(offerCoursePublicly(course, false, "owner")).rejects.toThrow("Only the course owner or a reviewer");
    answer(null, { code: "XX000" });
    await expect(offerCoursePublicly(course, false, "owner")).rejects.toThrow("could not be saved");
  });
});
