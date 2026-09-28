// ===========================================================================
// Demo/mock provider (directive §7C) — development only. Deterministic,
// clearly labeled output. Every string it produces carries a "Demo" marker so
// mock data can never masquerade as real analysis.
// ===========================================================================
import type { AIProvider, AiJsonRequest } from "./types";
import { demoCourseTask } from "./mockCourse";

export const MOCK_LABEL = "Demo (mock output — not real analysis)";

export function createMockProvider(): AIProvider {
  return {
    info: { kind: "mock", label: MOCK_LABEL, local: true, requiresKey: false },
    available: async () => ({ ok: true, detail: "Demo mode active — responses are canned examples.", models: ["demo"] }),
    async completeJson(req: AiJsonRequest): Promise<unknown> {
      // Deterministic: keyed off the task id, else the prompt, so tests are
      // stable. The task id wins: "Topic: cardiology" is not a card request.
      if (req.task === "cards.generate") return demoCards();
      if (req.task === "questions.generate") return demoQuestions();
      const courseDemo = demoCourseTask(req);
      if (courseDemo !== undefined) return courseDemo;
      // No topic ids: the guide falls back to its own local matches.
      if (req.task === "guide.ask") return { answer: "[DEMO] Here's where to look. Turn on a real provider for written answers.", topicIds: [] };
      if (/card/i.test(req.prompt)) return demoCards();
      if (/error|classif/i.test(req.prompt)) {
        return { errorType: "knowledge-gap", rationale: "[DEMO] Canned classification for development.", confidence: 0.5 };
      }
      if (/questions/i.test(req.system ?? "") && /topic/i.test(req.prompt)) return demoQuestions();
      if (/map the correct answer/i.test(req.system ?? "")) {
        return { suggestedKey: null, evidence: null, confidence: 0.3, needsReview: true };
      }
      if (/tighten a messy question explanation/i.test(req.system ?? "")) {
        return { text: "[DEMO] Cleaned explanation — the correct answer is unchanged; connect a real provider for genuine rewriting." };
      }
      if (/study coach/i.test(req.system ?? "")) {
        return {
          diagnosis: "[DEMO] You aren't mainly missing these from knowledge gaps — you're over-picking broad answers when the stem hinges on one discriminating clue.",
          suggestedBlock: "[DEMO] A 10-question tutor block on your weakest category, incorrect-only.",
        };
      }
      if (/pitfalls/i.test(req.system ?? "")) {
        return {
          summary: "[DEMO] This set primarily tests complement deficiencies and infection-pattern recognition.",
          pitfalls: ["[DEMO] Confusing terminal complement with C3 deficiency", "[DEMO] Misreading recurrent viral as bacterial infections"],
          suggestedReview: ["[DEMO] Revisit T-cell vs B-cell deficiency patterns", "[DEMO] Create Anki cards from missed explanations"],
        };
      }
      if (/\{"text"/.test(req.system ?? "")) {
        return { text: "[DEMO] Canned explanation for development — connect a real provider for actual analysis." };
      }
      return {
        mode: "maintain",
        rationale: "[DEMO] Canned brief for development — not real analysis.",
        nextBestMove: { title: "[DEMO] Review a flagged lecture", reason: "Demo output", estimatedMinutes: 45 },
        minimumViableWin: { title: "[DEMO] Review 8 due cards", estimatedMinutes: 5 },
        recommendedDuration: 45,
        priorityLevel: "medium",
        recoveryActions: [],
        warnings: ["This is demo output."],
        confidence: 0.5,
        assumptions: ["Demo mode is active."],
      };
    },
  };
}

function demoCards() {
  return {
    cards: [
      {
        type: "basic",
        front: "[DEMO] What activates the classical complement pathway?",
        back: "[DEMO] Antigen-antibody complexes (IgM or IgG).",
        tags: ["demo"],
        source: "Demo output — replace with a real provider",
      },
      {
        type: "cloze",
        front: "[DEMO] C3b's main role is {{c1::opsonization}}.",
        back: "",
        tags: ["demo"],
        source: "Demo output — replace with a real provider",
      },
    ],
  };
}

function demoQuestions() {
  return {
    questions: [{
      stem: "[DEMO] A 34-year-old presents with recurrent Neisseria infections. Which complement component is most likely deficient?",
      options: [
        { key: "A", text: "C3" }, { key: "B", text: "C5-C9" },
        { key: "C", text: "C1 esterase inhibitor" }, { key: "D", text: "Factor H" },
      ],
      correctKey: "B",
      explanation: "[DEMO] Terminal complement (MAC) deficiency classically predisposes to recurrent Neisseria infections.",
      whyOthersWrong: "[DEMO] C3 deficiency causes pyogenic infections; C1-INH deficiency causes angioedema.",
      tags: ["demo", "immunology"],
      estimatedDifficulty: "medium",
    }],
  };
}
