import { describe, expect, it } from "vitest";
import { importFromCsv, importFromJson } from "./questionImport";
import { cleanExplanationText } from "./questionExplanation";
import { parseQuestionBlocks, parseQuestionText, splitAnswerKeySection } from "./questionParse";
import { answerKeyLines, draftsToQuestions } from "./question-content/fromDrafts";
import { questionReadiness } from "./question-content/readiness";
import { pairDraftAnswers } from "./question-content/separateAnswerKey";

const labels = [..."ABCDEFGHI"];
const options = labels.map((key) => ({ key, text: `Sample choice ${key}` }));
const choiceLines = options.map(({ key, text }) => `${key}. ${text}`);
const stem = "Which sample choice is identified by the supplied key?";
const question = [stem, ...choiceLines].join("\n");

describe("nine-choice source import compatibility", () => {
  it.each(["Answer: I", "Answer: (i)", "Answer: I. Sample choice I"])("preserves all choices and the explicit %s through the canonical bridge", (answer) => {
    const draft = parseQuestionText(`${question}\n${answer}`);
    expect(draft.options).toEqual(options);
    expect(draft.correctKey).toBe("I");
    const { questions } = draftsToQuestions([draft], { media: [] }, {
      bankId: "synthetic-nine", sourceFilename: "synthetic-nine.txt", method: "manual-transcription",
    });
    expect(questions[0].choices.map((choice) => choice.label)).toEqual(labels);
    expect(questions[0].correctAnswer).toEqual({ labels: ["I"], evidence: "printed-key" });
    expect(questionReadiness(questions[0], []).readiness).toBe("ready");
  });

  it("preserves I in inline, Markdown, labelled-record, and marked-option layouts", () => {
    const layouts = [
      `${stem}\n${choiceLines.join(" ")}\nAnswer: I`,
      `${stem}\n${choiceLines.map((line) => `- ${line}`).join("\n")}\nAnswer: I`,
      `QUESTION_NUMBER\n1\nSTEM\n${stem}\nCHOICES\n${options.map(({ key, text }) => `${key} ${text}`).join("\n")}\nCORRECT ANSWER\nI`,
      `${question} ✓`,
    ];
    for (const layout of layouts) {
      const draft = parseQuestionBlocks(layout)[0];
      expect(draft.options, layout).toEqual(options);
      expect(draft.correctKey, layout).toBe("I");
    }
  });

  it("maps I in printed trailing keys and DOCX key tables", () => {
    expect(splitAnswerKeySection("Body\nAnswers: 1I, 2H, 3A").answerKey).toEqual(new Map([[1, "I"], [2, "H"], [3, "A"]]));
    expect(answerKeyLines([["Question", "Answer"], ["1", "I"], ["2", "H"], ["3", "A"]])).toEqual(["1. I", "2. H", "3. A"]);
    const draft = parseQuestionBlocks(`1. ${question}\nAnswer key:\n1. I`)[0];
    expect(draft.correctKey).toBe("I");
    expect(draft.options).toEqual(options);
  });

  it.each(["letters", "numbered"])("preserves nine CSV columns with %s headers and JSON I keys", (layout) => {
    const headers = layout === "letters" ? labels : labels.map((_, index) => `option${index + 1}`);
    const csv = ["question", ...headers, "answer"].join(",") + "\n" + [stem, ...options.map(({ text }) => text), "I"].join(",");
    for (const result of [importFromCsv(csv), importFromJson(JSON.stringify([{ stem, options, answer: "I" }]))]) {
      expect(result.drafts[0].options).toEqual(options);
      expect(result.drafts[0].correctKey).toBe("I");
      expect(result.drafts[0].needsReview).not.toBe(true);
    }
  });

  it("keeps a separate I key provisional and detects an H/I source-mark conflict", () => {
    const unkeyed = parseQuestionBlocks(`1. ${question}\n\n2. ${question}`);
    const paired = pairDraftAnswers(unkeyed, "1. I\n2. I", { name: "synthetic-key.txt", checksum: `sha256:${"a".repeat(64)}` });
    expect(paired.matched).toBe(2);
    expect(paired.value.every((draft) => draft.correctKey === "I" && draft.needsReview)).toBe(true);
    const conflicted = parseQuestionText(`${question}\nAnswer: H\nSource marks: H and I`);
    expect(conflicted.correctKey).toBeUndefined();
    expect(conflicted.needsReview).toBe(true);
    expect(conflicted.parserRuleIds).toContain("conflict.source-key");
  });

  it("cleans repeated I choice/key material without discarding the explanation", () => {
    const text = cleanExplanationText(`${question}\nAnswer: I\nThe supplied example identifies the ninth choice.`, { stem, options, correctKey: "I" });
    expect(text).toBe("The supplied example identifies the ninth choice.");
  });

  it("does not manufacture keys from missing evidence, I-leading prose, or unsupported J", () => {
    for (const suffix of ["", "\nAnswer: I believe another response is possible", "\nAnswer: J"]) {
      const draft = parseQuestionText(question + suffix);
      expect(draft.options).toEqual(options);
      expect(draft.correctKey).toBeUndefined();
      expect(draft.needsReview).toBe(true);
    }
  });
});
