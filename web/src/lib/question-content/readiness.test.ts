// Invented teaching content throughout.
import { describe, expect, it } from "vitest";
import { QUESTION_FLAG_TYPES, type PackageIssue, type PackageQuestion, type QuestionFlagType } from "./package";
import { countReadiness, questionReadiness, withReviewedAnswer } from "./readiness";

const question = (over: Partial<PackageQuestion> = {}): PackageQuestion => ({
  id: "q1",
  source: { filename: "invented.pdf", questionNumber: 1 },
  stem: [{ type: "text", text: "Which nerve supplies the diaphragm?" }],
  choices: [
    { id: "q1-a", label: "A", blocks: [{ type: "text", text: "Vagus nerve" }] },
    { id: "q1-b", label: "B", blocks: [{ type: "text", text: "Phrenic nerve" }] },
  ],
  correctAnswer: { labels: ["B"], evidence: "printed-key" },
  assets: [],
  provenance: { method: "pdf-import" },
  ...over,
});
const flagged = (type: QuestionFlagType, message = "A note on this question."): PackageQuestion => question({ flags: [{ type, message }] });
const own = (severity: PackageIssue["severity"], code: PackageIssue["code"], message = "A note on this question."): PackageIssue => ({ severity, code, message, questionId: "q1" });

describe("ready: a verified key and nothing that bears on answering it", () => {
  it("is ready with a printed key and no notes", () => {
    expect(questionReadiness(question(), [])).toEqual({ readiness: "ready", reasons: [], advisories: [] });
  });

  it("is ready with a key a reviewer set", () => {
    expect(questionReadiness(question({ correctAnswer: { labels: ["B"], evidence: "reviewer" } }), []).readiness).toBe("ready");
  });

  it("is ready whatever is wrong with another question or with the package as a whole", () => {
    const issues: PackageIssue[] = [
      { severity: "error", code: "invalid_question", message: "Another question has one choice.", questionId: "q2" },
      { severity: "warning", code: "media_association_uncertain", message: "Two pictures could not be tied to a question." },
    ];
    expect(questionReadiness(question(), issues)).toEqual({ readiness: "ready", reasons: [], advisories: [] });
  });
});

describe("advisory: shown, and never a reason to hold a keyed question back", () => {
  it.each<QuestionFlagType>(["media_position_uncertain", "possible_duplicate"])("a %s flag", (type) => {
    expect(questionReadiness(flagged(type), [])).toEqual({ readiness: "ready", reasons: [], advisories: ["A note on this question."] });
  });

  it.each<QuestionFlagType>(["missing_explanation", "answer_reveal_asset"])("a %s flag, which is plain information and not even an advisory", (type) => {
    expect(questionReadiness(flagged(type), [])).toEqual({ readiness: "ready", reasons: [], advisories: [] });
  });

  it.each<PackageIssue["code"]>(["scope_mismatch", "rich_text_escaped", "unknown_field", "unknown_flag", "tracked_changes", "asset_reference_broken", "media_cropped"])("a %s warning", (code) => {
    expect(questionReadiness(question(), [own("warning", code)])).toEqual({ readiness: "ready", reasons: [], advisories: ["A note on this question."] });
  });

  it("any note that is only information, whatever its code", () => {
    expect(questionReadiness(question(), [own("info", "unsupported_content"), own("info", "answer_reveal_asset", "A picture shows the answer. It is held back.")]))
      .toEqual({ readiness: "ready", reasons: [], advisories: [] });
  });

  it("gives a flag once when the package checks repeat it as an issue", () => {
    const verdict = questionReadiness(flagged("possible_duplicate", "It reads like question 4."), [own("warning", "possible_duplicate", "It reads like question 4.")]);
    expect(verdict.advisories).toEqual(["It reads like question 4."]);
  });
});

describe("blocking: a doubt about answering or marking the question", () => {
  it.each<[QuestionFlagType, string]>([
    ["source_inconsistency", "the source disagrees with itself"],
    ["media_association_uncertain", "a picture or table may belong to another question"],
    ["table_parse_uncertain", "a table may not have been read as printed"],
  ])("a %s flag: %s", (type) => {
    expect(questionReadiness(flagged(type), [])).toEqual({ readiness: "needs-review", reasons: ["A note on this question."], advisories: [] });
  });

  it.each<PackageIssue["code"]>(["needs_review", "possible_answer_marking", "choices_incomplete", "unsupported_content", "invalid_question"])("a %s warning", (code) => {
    expect(questionReadiness(question(), [own("warning", code)]).readiness).toBe("needs-review");
  });

  it("a picture that shows the answer placed where the question would show it", () => {
    const verdict = questionReadiness(question(), [own("warning", "answer_reveal_asset", "An image that shows the answer is placed in the stem.")]);
    expect(verdict).toEqual({ readiness: "needs-review", reasons: ["An image that shows the answer is placed in the stem."], advisories: [] });
  });

  it("keeps the advisory notes apart from what blocks", () => {
    const verdict = questionReadiness(question({ flags: [{ type: "source_inconsistency", message: "The stem says 12 and the key says 21." }, { type: "possible_duplicate", message: "It reads like question 4." }] }), []);
    expect(verdict).toEqual({ readiness: "needs-review", reasons: ["The stem says 12 and the key says 21."], advisories: ["It reads like question 4."] });
  });

  it("holds back for a code nobody has classified, so a new kind of doubt is never waved through", () => {
    const unclassified = QUESTION_FLAG_TYPES.filter((type) => questionReadiness(flagged(type), []).readiness === "ready");
    expect(unclassified.sort()).toEqual(["answer_reveal_asset", "media_position_uncertain", "missing_explanation", "possible_duplicate"]);
    expect(questionReadiness(question(), [own("warning", "a_code_added_next_year" as PackageIssue["code"])]).readiness).toBe("needs-review");
  });
});

describe("an answer that is not verified is never ready", () => {
  it("a key read from a slide that marks the answer", () => {
    const verdict = questionReadiness(question({ correctAnswer: { labels: ["B"], evidence: "answer-reveal-slide" } }), []);
    expect(verdict.readiness).toBe("needs-review");
    expect(verdict.reasons).toEqual([expect.stringContaining("slide that marks the answer")]);
  });

  it("a key worked out from the wording of an explanation", () => {
    const verdict = questionReadiness(question({ correctAnswer: { labels: ["B"], evidence: "explanation" } }), []);
    expect(verdict.reasons).toEqual([expect.stringContaining("worked out from the wording of the explanation")]);
  });

  it("a key the package gives no source for", () => {
    expect(questionReadiness(question({ correctAnswer: { labels: ["B"] } }), []).readiness).toBe("needs-review");
  });

  it("no key, with the answer kept in a form a person can read: review", () => {
    const marked = question({ correctAnswer: undefined, flags: [{ type: "answer_needs_review", message: "The answer is shown by a mark on the answer slide." }] });
    expect(questionReadiness(marked, [own("warning", "missing_answer_key", "The question has no answer key.")])).toEqual({ readiness: "needs-review", reasons: ["The answer is shown by a mark on the answer slide."], advisories: [] });
  });

  it("no key and nothing kept to settle it: unresolved", () => {
    expect(questionReadiness(question({ correctAnswer: undefined }), [own("warning", "missing_answer_key")])).toEqual({ readiness: "unresolved", reasons: ["No answer for this question could be read from the source."], advisories: [] });
  });
});

describe("an answer a person sets", () => {
  const marked = question({ correctAnswer: undefined, flags: [{ type: "answer_needs_review", message: "The answer is shown by a mark on the answer slide." }, { type: "possible_duplicate", message: "It reads like question 4." }] });

  it("is recorded as the reviewer's, clears the request for review and makes the question ready", () => {
    const reviewed = withReviewedAnswer(marked, "A");
    expect(reviewed.correctAnswer).toEqual({ labels: ["A"], evidence: "reviewer" });
    expect(reviewed.flags).toEqual([{ type: "possible_duplicate", message: "It reads like question 4." }]);
    expect(questionReadiness(reviewed, [])).toEqual({ readiness: "ready", reasons: [], advisories: ["It reads like question 4."] });
    // The question it was given is left as it was.
    expect(marked.correctAnswer).toBeUndefined();
    expect(marked.flags).toHaveLength(2);
  });

  it("does not clear any other doubt", () => {
    const doubted = withReviewedAnswer({ ...marked, flags: [...marked.flags!, { type: "media_association_uncertain", message: "A picture on page 4 may belong to this question." }] }, "B");
    expect(questionReadiness(doubted, [])).toMatchObject({ readiness: "needs-review", reasons: ["A picture on page 4 may belong to this question."] });
  });

  it("refuses a letter that is not one of the choices", () => {
    expect(() => withReviewedAnswer(marked, "E")).toThrow(/not one of the choices/);
  });
});

describe("what cannot be run at all", () => {
  it("is unresolved when an error stops it, key or not", () => {
    expect(questionReadiness(question(), [own("error", "missing_required_media", "The stem needs a picture that is not in the package.")]))
      .toEqual({ readiness: "unresolved", reasons: ["The stem needs a picture that is not in the package."], advisories: [] });
  });

  it("counts a bank", () => {
    const questions = [question(), question({ id: "q2", correctAnswer: undefined }), { ...flagged("source_inconsistency"), id: "q3" }, { ...flagged("possible_duplicate"), id: "q4" }];
    expect(countReadiness(questions, [])).toEqual({ ready: 2, "needs-review": 1, unresolved: 1 });
  });
});
