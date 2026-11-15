// @vitest-environment jsdom
// APEX R66: cross-workstream, synthetic receipt -> term quiz -> guarded launch.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../library";
import type { QuestionRecord } from "../questions";
import type { Course, Term } from "../types";
import type { DownloadReference, DownloadWorkspace } from "./downloadReference";

const mocks = vi.hoisted(() => ({ list: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn() }));
vi.mock("./client", () => ({ listAcademicCourses: mocks.list }));
vi.mock("./accountScope", () => ({
  academicAccountScope: (key: string) => ({
    key, assertCurrent: mocks.assertCurrent, dispose: mocks.dispose,
  }),
}));
vi.mock("../store", () => ({ useStore: { getState: vi.fn() } }));
vi.mock("../sync/contentDownloads", () => ({ downloadAccountContent: vi.fn() }));
vi.mock("../localVault", () => ({
  getVaultWriteCheckpoint: vi.fn(), flushLocalVaultWrites: vi.fn(), assertVaultWritesSince: vi.fn(),
}));

import { termQuizSelection } from "./termCourses";
import { COURSE_QUIZ_LAUNCH_KEY, launchCourseQuiz, readCourseQuizLaunch } from "../course-engine/quizLaunch";
import { inspectCourseLaunch } from "../exam/courseLaunchGuard";

const question = (id: string, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "imported", stem: id,
  options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
  correctKey: "A", status: "unseen", tags: [], attempts: [],
  createdAt: "2026-10-28", updatedAt: "2026-10-28", ...patch,
});

const receipt = (index: number, questionIds: string[], setIds: string[], accountId = "account"): SourceDocument => ({
  id: `academic-revision-${index}`, fileType: "axom-academic-reference", title: "Synthetic receipt",
  fileName: "course-reference.json", sizeBytes: 1,
  rawText: JSON.stringify({
    collectionId: `course-${index}`, revisionId: `revision-${index}`,
    accountId, status: "complete", warnings: [], term: "Term 5", module: `Module ${index}`,
    templateIds: [], documentIds: [], questionIds, setIds,
  } satisfies DownloadReference),
  uploadedAt: "2026-10-28", tags: [], linkedQuestionSetIds: [], libraryOnly: true,
});

const workspace = (documents: SourceDocument[], questions: QuestionRecord[]): DownloadWorkspace & {
  courses: Course[]; terms: Term[];
} => ({ documents, questions, questionSets: [], courses: [], terms: [] });

beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });

describe("R64 + R65 academic integration, without source or learner mutation", () => {
  it("launches exact authorized cross-module term questions with unique original sets", () => {
    const state = workspace([
      receipt(1, ["goer"], ["set-goer"]),
      receipt(2, ["ncrs"], ["set-ncrs"]),
    ], [
      question("goer", { module: "GOER", week: 1, setId: "set-goer" }),
      question("ncrs", { module: "NCRS", week: 2, setId: "set-ncrs" }),
    ]);
    const set = (id: string) => ({ id }) as unknown as (typeof state.questionSets)[number];
    state.questionSets = [set("set-goer"), set("set-ncrs")];
    const selection = termQuizSelection("Term 5", "account", state);
    expect(selection).toMatchObject({
      scopeKind: "term", module: "Term 5", term: "Term 5",
      questionIds: ["goer", "ncrs"], setIds: ["set-goer", "set-ncrs"],
    });
    launchCourseQuiz(selection);
    const original = sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY);
    expect(inspectCourseLaunch(state.questions)).toEqual({ state: "ready", launch: selection });
    expect(readCourseQuizLaunch(state.questions)).toEqual(selection);
    expect(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY)).toBe(original);
  });

  it("holds orphan/duplicate-set questions while preserving independent eligible neighbors", () => {
    const state = workspace([
      receipt(1, ["ambiguous", "orphan", "clean", "loose"], ["duplicate", "orphan", "clean"]),
    ], [
      question("ambiguous", { module: "GOER", setId: "duplicate" }),
      question("orphan", { module: "GOER", setId: "orphan" }),
      question("clean", { module: "NCRS", setId: "clean" }),
      question("loose", { module: "GOER" }),
    ]);
    const set = (id: string) => ({ id }) as unknown as (typeof state.questionSets)[number];
    state.questionSets = [set("duplicate"), set("duplicate"), set("clean")];
    const selection = termQuizSelection("Term 5", "account", state);
    expect(selection.questionIds).toEqual(["clean", "loose"]);
    expect(selection.setIds).toEqual(["clean"]);
    launchCourseQuiz(selection);
    expect(inspectCourseLaunch(state.questions)).toEqual({ state: "ready", launch: selection });
    expect(readCourseQuizLaunch(state.questions)?.questionIds).toEqual(["clean", "loose"]);
  });

  it("rejects damaged metadata at partial hydration, without modifying original handoff bytes", () => {
    const state = workspace([receipt(1, ["goer", "ncrs"], ["set-goer"])], [
      question("goer", { module: "GOER" }), question("ncrs", { module: "NCRS" }),
    ]);
    state.questionSets = [{ id: "set-goer" } as unknown as (typeof state.questionSets)[number]];
    const selection = termQuizSelection("Term 5", "account", state);
    expect(selection.questionIds).toEqual(["goer", "ncrs"]);
    launchCourseQuiz(selection);
    const valid = sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY)!;
    expect(inspectCourseLaunch([state.questions[0]])).toMatchObject({
      state: "pending", total: 2, ready: 1, missing: 1,
    });
    for (const malformed of [
      { ...selection, setIds: ["set-goer", "set-goer"] },
      { ...selection, courseId: 42 },
    ]) {
      const bytes = JSON.stringify(malformed);
      sessionStorage.setItem(COURSE_QUIZ_LAUNCH_KEY, bytes);
      expect(inspectCourseLaunch([]).state).toBe("invalid");
      expect(inspectCourseLaunch([state.questions[0]]).state).toBe("invalid");
      expect(readCourseQuizLaunch(state.questions)).toBeNull();
      expect(sessionStorage.getItem(COURSE_QUIZ_LAUNCH_KEY)).toBe(bytes);
    }
    sessionStorage.setItem(COURSE_QUIZ_LAUNCH_KEY, valid);
    expect(inspectCourseLaunch(state.questions).state).toBe("ready");
  });

  it("does not expose another account's downloaded receipt in term practice", () => {
    const state = workspace([
      receipt(1, ["mine"], [], "account"),
      receipt(2, ["theirs"], [], "other"),
    ], [question("mine"), question("theirs")]);
    const selected = termQuizSelection("Term 5", "account", state);
    expect(selected.questionIds).toEqual(["mine"]);
    launchCourseQuiz(selected);
    expect(readCourseQuizLaunch(state.questions)?.questionIds).toEqual(["mine"]);
  });
});
