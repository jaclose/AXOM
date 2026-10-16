// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../store";
import * as vault from "../localVault";
import { openEmptyWorkspace, closeWorkspace } from "../question-content/persistenceHarness.testing";
import { prepareCourseTemplate } from "../course-engine/templateLibrary";
import { withPreparedCourses, loadPreparedCourse } from "./preparedCourses";
import { commitCourseLoad } from "./loadCourse";
import { buildCourseBooks } from "./courseBooks";
beforeEach(openEmptyWorkspace);
afterEach(async () => { vi.restoreAllMocks(); await closeWorkspace(); });
async function course() {
  const document = await prepareCourseTemplate("T5 - GOER - Lectures:\nWeek 2:\nLecture 01 Synthetic [Lecture]\n", "synthetic.txt");
  useStore.getState().addDocument(document); await vault.flushLocalVaultWrites();
  const books = buildCourseBooks({ terms: [], courses: [], tracker: [], curricula: [{
    id: "guarded-load", label: "Guarded load", terms: [{
      name: "Term 5", courses: [{ code: "PPM 501", name: "Principles & Practice of Medicine II", modules: ["GOER"] }],
    }],
  }] });
  return withPreparedCourses(books, [document])[0];
}
it("refuses an activation whose account guard is already invalid", async () => {
  const book = await course(), before = useStore.getState();
  const result = await commitCourseLoad(book, () => { throw new Error("Account changed"); });
  expect(result).toEqual({ status: "failed", message: "Account changed" });
  expect(useStore.getState().terms).toEqual(before.terms);
  expect(useStore.getState().courses).toEqual(before.courses);
});
it("does not add activities after the account changes while structural saving completes", async () => {
  const book = await course(); let changed = false;
  const flush = vault.flushLocalVaultWrites;
  vi.spyOn(vault, "flushLocalVaultWrites").mockImplementation(async () => { await flush(); changed = true; });
  const result = await loadPreparedCourse(book, () => { if (changed) throw new Error("Account changed"); });
  expect(result).toEqual({ status: "failed", message: "Account changed" });
  expect(useStore.getState().tracker.filter(item => item.templateKey)).toHaveLength(0);
});
