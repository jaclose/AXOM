// ===========================================================================
// Demo/mock provider (directive §7C) — development only. Deterministic,
// clearly labeled output. Every string it produces carries a "Demo" marker so
// mock data can never masquerade as real analysis.
// ===========================================================================
import type { AIProvider, AiJsonRequest } from "./types";

export const MOCK_LABEL = "Demo (mock output — not real analysis)";

/**
 * A canned Decode analysis for the question in the prompt. Its one quotation
 * is copied from the evidence that was sent, so it passes the same checks a
 * real reply must pass.
 */
function demoDecodeAnalysis(prompt: string): unknown {
  let request: { options?: Array<{ key: string }>; correctKey?: string; evidence?: Array<{ documentId: string; page: number; text: string }> } = {};
  try { request = JSON.parse(prompt); } catch { /* an empty analysis below still fails validation loudly */ }
  const excerpt = request.evidence?.[0];
  return {
    concept: "[DEMO] The concept this question tests",
    task: "[DEMO] Pick the option the stem's key finding points to.",
    rule: "[DEMO] Canned rule for development. Connect a real provider for an actual analysis.",
    explanation: "[DEMO] Canned explanation for development.",
    decisiveClues: ["[DEMO] The finding the stem turns on"],
    mechanism: [],
    distractors: (request.options ?? []).filter((option) => option.key !== request.correctKey)
      .map((option) => ({ key: option.key, whyWrong: "[DEMO] Canned reason this option does not fit.", wouldFitIf: "" })),
    references: excerpt
      ? [{ documentId: excerpt.documentId, page: excerpt.page, quote: excerpt.text.replace(/\s+/g, " ").trim().slice(0, 80), role: "question" }]
      : [],
  };
}

export function createMockProvider(): AIProvider {
  return {
    info: { kind: "mock", label: MOCK_LABEL, local: true, requiresKey: false },
    available: async () => ({ ok: true, detail: "Demo mode active — responses are canned examples.", models: ["demo"] }),
    async completeJson(req: AiJsonRequest): Promise<unknown> {
      // Deterministic: keyed off the prompt so tests are stable.
      if (/AXOM Decode/.test(req.system ?? "")) return demoDecodeAnalysis(req.prompt);
      if (/card/i.test(req.prompt)) {
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
      if (/error|classif/i.test(req.prompt)) {
        return { errorType: "knowledge-gap", rationale: "[DEMO] Canned classification for development.", confidence: 0.5 };
      }
      if (/questions/i.test(req.system ?? "") && /topic/i.test(req.prompt)) {
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
