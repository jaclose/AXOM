// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../brand";
import { COURSE_QUIZ_LAUNCH_KEY } from "../course-engine/quizLaunch";
import { resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import type { QuestionRecord } from "../questions";
import { capturePracticeLaunchContext, launchRecommendedPractice, takeRecommendedPractice } from "./practiceLaunch";

const question = (id = "one"): QuestionRecord => ({
  id, source: "imported", stem: "Synthetic question", options: [{ key: "A", text: "First" }, { key: "B", text: "Second" }],
  correctKey: "A", status: "unseen", tags: [], attempts: [], createdAt: "2026-11-01", updatedAt: "2026-11-01",
});
beforeEach(() => {
  const storage = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  };
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  resetQuestionAttachmentScopeForTests();
  try { takeRecommendedPractice([]); } catch { /* Clear only the ephemeral prior test request. */ }
});
afterEach(() => vi.unstubAllGlobals());

describe("recommended practice handoff", () => {
  it("opens the exact selection once and tolerates unrelated workspace updates", () => {
    const questions = [question(), question("two")];
    launchRecommendedPractice(["two"], capturePracticeLaunchContext(questions), questions);
    expect(location.hash).toBe("#questions");
    expect(takeRecommendedPractice([...questions])).toEqual(["two"]);
    expect(takeRecommendedPractice(questions)).toBeNull();
  });
  it("rejects A to B to A and workspace replacement even when IDs agree", () => {
    const questions = [question()];
    setQuestionAttachmentAccount("A");
    launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions);
    setQuestionAttachmentAccount("B");
    setQuestionAttachmentAccount("A");
    expect(() => takeRecommendedPractice(questions)).toThrow("account changed");
    launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions);
    expect(() => takeRecommendedPractice([{ ...questions[0] }])).toThrow("workspace changed");
  });
  it("rejects a stale rendered recommendation before navigating or queueing it", () => {
    const questions = [question()];
    setQuestionAttachmentAccount("A");
    const rendered = capturePracticeLaunchContext(questions);
    location.hash = "productivity";
    expect(() => launchRecommendedPractice(["one"], rendered, [{ ...questions[0], stem: "Replacement" }])).toThrow("workspace changed");
    expect(location.hash).toBe("#productivity");
    expect(takeRecommendedPractice(questions)).toBeNull();
    setQuestionAttachmentAccount("B");
    setQuestionAttachmentAccount("A");
    expect(() => launchRecommendedPractice(["one"], rendered, questions)).toThrow("account changed");
    expect(location.hash).toBe("#productivity");
    expect(takeRecommendedPractice(questions)).toBeNull();
  });
  it("preserves active, unreadable and per-tab recovery instead of launching over it", () => {
    const questions = [question()];
    const active = JSON.stringify({ poolIds: ["unfinished"] });
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, active);
    expect(() => launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions)).toThrow("Resume or finish");
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBe(active);
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, "broken");
    expect(() => launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions)).toThrow("cannot be read");
    localStorage.removeItem(STORAGE_KEYS.quizActiveSession);
    sessionStorage.setItem(`${STORAGE_KEYS.quizActiveSession}:run-id`, "run");
    localStorage.setItem(`${STORAGE_KEYS.quizActiveSession}:run:run`, active);
    expect(() => launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions)).toThrow("Resume or finish");
  });
  it("holds pending course selection and rejects newly conflicting question identities", () => {
    const questions = [question()];
    sessionStorage.setItem(COURSE_QUIZ_LAUNCH_KEY, "pending");
    expect(() => launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions)).toThrow("pending course selection");
    sessionStorage.setItem(COURSE_QUIZ_LAUNCH_KEY, "");
    expect(() => launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions)).toThrow("pending course selection");
    sessionStorage.removeItem(COURSE_QUIZ_LAUNCH_KEY);
    launchRecommendedPractice(["one"], capturePracticeLaunchContext(questions), questions);
    expect(() => takeRecommendedPractice([...questions, { ...questions[0] }])).toThrow("workspace changed");
  });
});
