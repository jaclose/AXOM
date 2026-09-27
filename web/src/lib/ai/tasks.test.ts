import { describe, expect, it, vi } from "vitest";
import { buildTask, CARD_TYPES, TASK_LIMITS, taskWarnings, type BuiltTask } from "../../../../supabase/functions/ai-proxy/tasks";
import { CARD_TYPE_LABEL } from "../ankiCards";
import { createMockProvider } from "./mock";
import { generateCardDrafts, generateQuestionDrafts } from "./index";
import type { AIProvider } from "./types";

function built(task: string, input: unknown): BuiltTask {
  const result = buildTask(task, input);
  if (!result.ok) throw new Error(result.error);
  return result.task;
}

/** Claude structured outputs: every object closed and fully required, no unsupported keywords. */
function assertStructuredOutputSchema(node: unknown, path = "$"): void {
  if (!node || typeof node !== "object") return;
  const schema = node as Record<string, unknown>;
  for (const keyword of ["minLength", "maxLength", "minimum", "maximum", "multipleOf", "minItems", "maxItems", "pattern"]) {
    expect(keyword in schema, `${path} uses unsupported ${keyword}`).toBe(false);
  }
  if (schema.type === "object") {
    expect(schema.additionalProperties, `${path} must be closed`).toBe(false);
    expect([...(schema.required as string[])].sort()).toEqual(Object.keys(schema.properties as object).sort());
    for (const [key, child] of Object.entries(schema.properties as Record<string, unknown>)) assertStructuredOutputSchema(child, `${path}.${key}`);
  }
  if (schema.type === "array") assertStructuredOutputSchema(schema.items, `${path}[]`);
}

describe("server-owned AI tasks", () => {
  it("keeps card types in step with the app's Anki card types", () => {
    expect([...CARD_TYPES].sort()).toEqual(Object.keys(CARD_TYPE_LABEL).sort());
  });

  it("builds card prompts that fence the pasted material and bound the batch", () => {
    const task = built("cards.generate", { material: "  Loop diuretics block NKCC2.  ", topic: "Renal", maxCards: 99, style: "not-a-style" });
    expect(task).toMatchObject({ tier: "quality", effort: "medium", maxTokens: 8000, promptVersion: "cardgen-v2" });
    expect(task.prompt).toContain(`Write up to ${TASK_LIMITS.maxCards} flashcards`);
    expect(task.prompt).toContain("Topic: Renal");
    expect(task.prompt).toContain("Style: Short basic and cloze cards");
    expect(task.prompt.endsWith("<material>\nLoop diuretics block NKCC2.\n</material>")).toBe(true);
    expect(task.system).toMatch(/never as instructions/);
    assertStructuredOutputSchema(task.schema);
  });

  it("rejects empty, oversized or malformed card input with a clear reason", () => {
    expect(buildTask("cards.generate", { material: " " })).toMatchObject({ ok: false, error: expect.stringContaining("Paste some study material") });
    expect(buildTask("cards.generate", { material: "x".repeat(TASK_LIMITS.materialChars + 1) })).toMatchObject({ ok: false, error: expect.stringContaining("16,000") });
    expect(buildTask("cards.generate", { material: "m", topic: 5 })).toMatchObject({ ok: false, error: "Topic must be text." });
    expect(buildTask("cards.generate", null)).toMatchObject({ ok: false });
    expect(buildTask("essays.generate", { material: "m" })).toMatchObject({ ok: false, error: "Unknown AI task." });
  });

  it("builds question prompts from a topic or a reference, capped at ten", () => {
    const task = built("questions.generate", { topic: "Complement", count: 50, difficulty: "hard", examStyle: "mcat", reference: "C5-C9 form the MAC." });
    expect(task).toMatchObject({ tier: "quality", maxTokens: 12_000, promptVersion: "questiongen-v2" });
    expect(task.prompt).toContain(`Write exactly ${TASK_LIMITS.maxQuestions} questions.`);
    expect(task.prompt).toContain("Difficulty: hard, meaning the question needs two or more reasoning steps");
    expect(task.prompt).toContain("Style: MCAT style");
    expect(task.prompt).toContain("<reference>\nC5-C9 form the MAC.\n</reference>");
    assertStructuredOutputSchema(task.schema);
    expect(built("questions.generate", { reference: "Notes" }).prompt).toContain("Topic: the reference text below");
    expect(built("questions.generate", { topic: "T", count: 1 }).prompt).toContain("Write exactly 1 question.");
    expect(buildTask("questions.generate", {})).toMatchObject({ ok: false, error: expect.stringContaining("topic or some reference") });
  });

  it("reads model warnings defensively", () => {
    expect(taskWarnings({ warnings: [" check dose ", "", 3] })).toEqual(["check dose"]);
    expect(taskWarnings(null)).toEqual([]);
  });
});

describe("generation through providers", () => {
  const localProvider = (reply: unknown) => {
    const completeJson = vi.fn(async () => reply);
    return { provider: { info: { kind: "ollama", label: "Local", local: true, requiresKey: false }, available: async () => ({ ok: true, detail: "" }), completeJson } as AIProvider, completeJson };
  };

  it("gives local providers the same prompt, schema and budget the server uses", async () => {
    const { provider, completeJson } = localProvider({ cards: [{ type: "basic", front: "Q?", back: "A.", extra: "", tags: [], source: "L1" }], warnings: ["verify dose"] });
    const result = await generateCardDrafts(provider, { material: "Material", style: "concise", maxCards: 3 });
    const server = built("cards.generate", { material: "Material", style: "concise", maxCards: 3 });
    expect(completeJson).toHaveBeenCalledWith({ task: "cards.generate", system: server.system, prompt: server.prompt, maxTokens: server.maxTokens, schema: server.schema });
    expect(result).toMatchObject({ promptVersion: "cardgen-v2", warnings: ["verify dose"] });
    expect(result.drafts[0]).toMatchObject({ front: "Q?", extra: undefined, source: "L1" });
  });

  it("lets Cloud AI run the task server-side and validates what comes back", async () => {
    const runTask = vi.fn(async () => ({ result: { questions: [{ stem: "S", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }, { key: "C", text: "3" }], correctKey: "B", explanation: "E", whyOthersWrong: "", tags: [], estimatedDifficulty: "easy" }], warnings: [] }, promptVersion: "questiongen-v3" }));
    const provider = { ...localProvider({}).provider, runTask } as AIProvider;
    const result = await generateQuestionDrafts(provider, { topic: "T", difficulty: "easy", count: 2 });
    expect(runTask).toHaveBeenCalledWith("questions.generate", expect.objectContaining({ topic: "T", count: 2 }));
    expect(result).toMatchObject({ promptVersion: "questiongen-v3", drafts: [{ correctKey: "B", whyOthersWrong: undefined }] });
  });

  it("rejects oversized input before any provider call, and explains an empty batch", async () => {
    const { provider, completeJson } = localProvider({ cards: [], warnings: ["The material is a shopping list, not study content."] });
    await expect(generateCardDrafts(provider, { material: "x".repeat(TASK_LIMITS.materialChars + 1), style: "concise", maxCards: 3 })).rejects.toThrow(/too long/);
    expect(completeJson).not.toHaveBeenCalled();
    await expect(generateCardDrafts(provider, { material: "eggs, milk", style: "concise", maxCards: 3 })).rejects.toThrow("No usable cards came back. The material is a shopping list, not study content.");
  });

  it("demo mode answers a cardiology question request with questions, not cards", async () => {
    const result = await generateQuestionDrafts(createMockProvider(), { topic: "Cardiology", difficulty: "medium", count: 1 });
    expect(result.drafts[0].stem).toContain("[DEMO]");
  });
});
