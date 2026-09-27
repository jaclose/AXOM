// ===========================================================================
// Provider resolution + feature helpers. resolveActiveProvider() is the ONLY
// entry point UI code should use: it maps the user's AI settings to a concrete
// provider (or null when AI is off/unavailable) so no feature ever claims AI
// is active without a reachable provider behind it.
// ===========================================================================
import type { AIProvider, CardGenerationStyle, GeneratedCardDraft, GeneratedQuestionDraft } from "./types";
import { loadAiSettings, type AiSettings } from "./settings";
import { createOllamaProvider, detectOllama } from "./ollama";
import { createMockProvider } from "./mock";
import { createCloudProvider } from "./cloud";
import { cloudConfigured, loadSupabase } from "../account/supabase";
import { validateGeneratedCards, validateGeneratedQuestions } from "./schemas";
import { buildTask, taskWarnings, TASK_LIMITS, type AiTaskId, type TaskInputs } from "../../../../supabase/functions/ai-proxy/tasks";

export { TASK_LIMITS } from "../../../../supabase/functions/ai-proxy/tasks";

export { detectOllama } from "./ollama";
export { cloudAiRemaining } from "./cloud";
export { loadAiSettings, saveAiSettings, DEFAULT_AI_SETTINGS } from "./settings";
export type { AiSettings } from "./settings";
export * from "./types";
export { validateAiBrief, validateGeneratedCards, validateGeneratedQuestions } from "./schemas";

/**
 * Resolve the configured provider without a network probe. Returns null when
 * AI is off or misconfigured — callers must treat null as "feature hidden".
 */
export function resolveActiveProvider(settings: AiSettings = loadAiSettings()): AIProvider | null {
  if (settings.mode === "mock") return createMockProvider();
  if (settings.mode === "local" && settings.localModel) {
    return createOllamaProvider(settings.localEndpoint, settings.localModel);
  }
  // Cloud mode = AXOM Cloud AI: Claude through the ai-proxy Edge Function,
  // authorized by the signed-in account. No client-side key path exists.
  if (settings.mode === "cloud" && cloudConfigured()) {
    return createCloudProvider({
      endpoint: cloudEndpoint(settings),
      apiKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
      getAccessToken: async () => {
        const client = await loadSupabase();
        const { data } = client ? await client.auth.getSession() : { data: { session: null } };
        return data.session?.access_token ?? null;
      },
    });
  }
  return null;
}

export function cloudEndpoint(settings: AiSettings = loadAiSettings()): string {
  return settings.cloudProxyUrl || `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/ai-proxy`;
}

/** Probe the configured provider; used by settings UI and feature gates. */
export async function checkProviderHealth(settings: AiSettings = loadAiSettings()) {
  if (settings.mode === "off") return { ok: false, detail: "AI is turned off." };
  if (settings.mode === "cloud") {
    if (!cloudConfigured()) return { ok: false, detail: "This build has no AXOM account server, so Cloud AI is unavailable. Local Ollama works without any key." };
    const provider = resolveActiveProvider(settings);
    return provider ? provider.available() : { ok: false, detail: "Cloud AI is unavailable." };
  }
  if (settings.mode === "mock") return { ok: true, detail: "Demo mode — canned outputs, clearly labeled." };
  return detectOllama(settings.localEndpoint);
}

/**
 * Runs a generation task. AXOM Cloud AI builds the prompt, schema and budget
 * on the server; Local and Demo providers get the identical prompt built here.
 * Inputs are validated first, so an oversized paste never spends quota.
 */
async function runAiTask<T extends AiTaskId>(provider: AIProvider, task: T, input: TaskInputs[T]): Promise<{ raw: unknown; promptVersion: string }> {
  const built = buildTask(task, input);
  if (!built.ok) throw new Error(built.error);
  if (provider.runTask) {
    const reply = await provider.runTask(task, input);
    return { raw: reply.result, promptVersion: reply.promptVersion ?? built.task.promptVersion };
  }
  const { system, prompt, maxTokens, schema, promptVersion } = built.task;
  return { raw: await provider.completeJson({ task, system, prompt, maxTokens, schema }), promptVersion };
}

/** An empty batch is explained by the model's own warning when it gave one. */
function emptyBatchError(kind: string, raw: unknown, errors: string[]): Error {
  const reason = taskWarnings(raw)[0] ?? errors.join(" ");
  return new Error(`No usable ${kind} came back. ${reason}`.trim());
}

/**
 * Generate a SMALL reviewed batch of card drafts (directive §11: quality over
 * volume, small batch first, user review before save).
 */
export async function generateCardDrafts(
  provider: AIProvider,
  req: { material: string; topic?: string; style: CardGenerationStyle; maxCards: number; source?: string },
): Promise<{ drafts: GeneratedCardDraft[]; warnings: string[]; promptVersion: string }> {
  const max = Math.max(1, Math.min(req.maxCards, TASK_LIMITS.maxCards));
  const { raw, promptVersion } = await runAiTask(provider, "cards.generate", {
    material: req.material, topic: req.topic, source: req.source, style: req.style, maxCards: max,
  });
  const result = validateGeneratedCards(raw);
  if (!result.ok || !result.value) throw emptyBatchError("cards", raw, result.errors);
  return { drafts: result.value.slice(0, max), warnings: [...taskWarnings(raw), ...result.errors], promptVersion };
}

// --- question-level AI actions (pre-beta §9) -----------------------------------
// All plain-text answers come back as {"text": "..."} so completeJson stays the
// single transport; callers render the text, never auto-save it.

async function completeText(provider: AIProvider, system: string, prompt: string): Promise<string> {
  const raw = await provider.completeJson({
    system: `${system} Return JSON: {"text": "your answer"}. Keep it under 120 words.`,
    prompt,
    maxTokens: 500,
  });
  const text = typeof raw === "object" && raw !== null && typeof (raw as { text?: unknown }).text === "string"
    ? (raw as { text: string }).text.trim()
    : "";
  if (!text) throw new Error("The model returned an empty answer.");
  return text;
}

// --- card-level AI actions (Anki Lab reviewer) ---------------------------------
// Inspired by in-reviewer AI sidebars (e.g. the "Anki Terminator" add-on), kept
// to AXOM's rule: suggestions only; a rewrite is applied only when accepted.

export function explainCard(provider: AIProvider, card: { front: string; back: string }): Promise<string> {
  return completeText(
    provider,
    "You are a concise medical tutor. Explain the mechanism behind this flashcard so the answer becomes obvious, in plain language.",
    `Card front: ${card.front.slice(0, 1500)}\nCard back: ${card.back.slice(0, 1500)}`,
  );
}

export function cardMnemonic(provider: AIProvider, card: { front: string; back: string }): Promise<string> {
  return completeText(
    provider,
    "You create one short, vivid, accurate memory hook (mnemonic, image or story) for a flashcard. Never change the facts.",
    `Card front: ${card.front.slice(0, 1500)}\nCard back: ${card.back.slice(0, 1500)}`,
  );
}

export interface CardRewrite {
  front: string;
  back: string;
  why: string;
}

/** Propose a sharper card (minimum-information principle); the learner accepts or ignores it. */
export async function sharpenCard(provider: AIProvider, card: { type: string; front: string; back: string }): Promise<CardRewrite> {
  const raw = await provider.completeJson({
    system: "You improve spaced-repetition flashcards using the minimum-information principle: one fact per card, unambiguous cue, no lists on the back, cloze syntax {{c1::...}} kept when present. Keep every fact accurate; never add facts that are not on the card. Return JSON {\"front\": string, \"back\": string, \"why\": string (one sentence)}.",
    prompt: `Card type: ${card.type}\nFront: ${card.front.slice(0, 1500)}\nBack: ${card.back.slice(0, 1500)}`,
    maxTokens: 600,
  });
  const value = raw as Partial<CardRewrite> | null;
  if (!value || typeof value.front !== "string" || !value.front.trim() || typeof value.back !== "string") {
    throw new Error("The model did not return a usable card.");
  }
  return { front: value.front.trim(), back: value.back.trim(), why: typeof value.why === "string" ? value.why.trim() : "" };
}

export function explainSimply(provider: AIProvider, q: { stem: string; correct?: string; explanation?: string }): Promise<string> {
  return completeText(
    provider,
    "You explain exam questions to a tired medical student in plain language, mechanism first.",
    `Question: ${q.stem.slice(0, 2000)}\nCorrect answer: ${q.correct ?? "unknown"}\nExisting explanation: ${q.explanation?.slice(0, 1500) ?? "none"}\nExplain simply why the correct answer is right.`,
  );
}

export function explainWhyWrong(provider: AIProvider, q: { stem: string; picked: string; correct?: string }): Promise<string> {
  return completeText(
    provider,
    "You explain, without judgment, why a chosen exam answer is wrong and what clue distinguishes the right one.",
    `Question: ${q.stem.slice(0, 2000)}\nStudent picked: ${q.picked}\nCorrect answer: ${q.correct ?? "unknown"}\nWhy was the pick wrong, and what's the discriminating clue?`,
  );
}

export function memoryHook(provider: AIProvider, q: { stem: string; correct?: string }): Promise<string> {
  return completeText(
    provider,
    "You create one short, vivid, accurate memory hook (mnemonic, analogy, or contrast) for a medical fact.",
    `Fact to anchor — question: ${q.stem.slice(0, 1500)}\nCorrect answer: ${q.correct ?? "unknown"}\nGive one memory hook.`,
  );
}

/**
 * Generate NEW practice questions behind the review gate (§5C). Output is
 * schema-validated, capped, labeled AI-generated by the caller, and never
 * saved without explicit user approval.
 */
export async function generateQuestionDrafts(
  provider: AIProvider,
  req: {
    topic: string;
    category?: string;
    examStyle?: string;
    difficulty: "easy" | "medium" | "hard";
    count: number;
    reference?: string;
  },
): Promise<{ drafts: GeneratedQuestionDraft[]; warnings: string[]; promptVersion: string }> {
  const count = Math.min(Math.max(1, req.count), TASK_LIMITS.maxQuestions);
  const { raw, promptVersion } = await runAiTask(provider, "questions.generate", {
    topic: req.topic, category: req.category, examStyle: req.examStyle, difficulty: req.difficulty, count, reference: req.reference,
  });
  const result = validateGeneratedQuestions(raw);
  if (!result.ok || !result.value) throw emptyBatchError("questions", raw, result.errors);
  return { drafts: result.value.slice(0, count), warnings: [...taskWarnings(raw), ...result.errors], promptVersion };
}

/**
 * AI Mapping Assist (rehaul phase 4.1). Given a question and the surrounding
 * extracted document text, suggest the correct answer AND the evidence it used.
 * Hard rule: if the model can't ground the answer in the provided text, it must
 * return needsReview=true and NOT assert a key. Callers keep the answer unset
 * on low confidence — the model never silently decides.
 */
export async function mapAnswerFromText(
  provider: AIProvider,
  req: { stem: string; options: Array<{ key: string; text: string }>; nearbyText: string },
): Promise<{ suggestedKey?: string; evidence?: string; confidence: number; needsReview: boolean }> {
  const raw = await provider.completeJson({
    system: [
      "You map the correct answer for a multiple-choice question using ONLY the provided source text.",
      "You must quote the exact snippet you relied on as evidence.",
      "If the source does not clearly indicate the answer, set needsReview=true and leave suggestedKey null.",
      "Never guess. Never use outside knowledge to assert a key.",
      'Return JSON: {"suggestedKey": "C" | null, "evidence": "quoted snippet or null", "confidence": 0..1, "needsReview": bool}.',
    ].join(" "),
    prompt: [
      `Question: ${req.stem.slice(0, 1500)}`,
      "Options:",
      ...req.options.map((o) => `${o.key}. ${o.text}`),
      "Source text:",
      req.nearbyText.slice(0, 4000),
    ].join("\n"),
    maxTokens: 400,
  });
  const rec = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const key = typeof rec.suggestedKey === "string" ? rec.suggestedKey.trim().toUpperCase() : undefined;
  const validKey = key && req.options.some((o) => o.key === key) ? key : undefined;
  const evidence = typeof rec.evidence === "string" && rec.evidence.trim() ? rec.evidence.trim() : undefined;
  const needsReview = rec.needsReview === true || !validKey || !evidence;
  return {
    suggestedKey: needsReview ? undefined : validKey,
    evidence,
    confidence: typeof rec.confidence === "number" ? Math.min(1, Math.max(0, rec.confidence)) : 0.4,
    needsReview,
  };
}

/**
 * AI Weakness Coach (rehaul phase 4.5). Looks at missed questions + their error
 * types and explains the BEHAVIORAL pattern behind the misses, then suggests a
 * targeted block. Grounded in the user's own attempt data.
 */
export async function coachWeakness(
  provider: AIProvider,
  req: { missed: Array<{ stem: string; category?: string; errorType?: string }> },
): Promise<{ diagnosis: string; suggestedBlock: string }> {
  const sample = req.missed.slice(0, 30);
  const raw = await provider.completeJson({
    system: [
      "You are a study coach analyzing a medical student's missed questions and error types.",
      "Explain the behavioral pattern behind the misses (e.g. misreading clues, over-picking broad answers),",
      "not just the topics. Then suggest one concrete targeted block. Be specific and calm, never generic.",
      'Return JSON: {"diagnosis": "...", "suggestedBlock": "..."}.',
    ].join(" "),
    prompt: sample.map((m, i) => `${i + 1}. [${m.category ?? "uncategorized"}${m.errorType ? ` / ${m.errorType}` : ""}] ${m.stem.slice(0, 200)}`).join("\n"),
    maxTokens: 500,
  });
  const rec = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const diagnosis = typeof rec.diagnosis === "string" ? rec.diagnosis.trim() : "";
  const suggestedBlock = typeof rec.suggestedBlock === "string" ? rec.suggestedBlock.trim() : "";
  if (!diagnosis) throw new Error("The model returned no usable coaching.");
  return { diagnosis, suggestedBlock };
}

/**
 * AI Explanation Cleaner (rehaul phase 8). Rewrites messy feedback into a clean,
 * concise explanation WITHOUT changing the meaning or the answer. The prompt
 * forbids introducing a new correct answer; the caller keeps the original
 * correctKey regardless of what the model returns.
 */
export async function cleanExplanation(
  provider: AIProvider,
  req: { stem: string; correct?: string; rawExplanation: string },
): Promise<string> {
  const raw = await provider.completeJson({
    system: [
      "You tighten a messy question explanation into clear prose for a medical student.",
      "Preserve the meaning and the stated correct answer exactly. Do NOT introduce or change the answer.",
      "Remove feedback labels, duplicated text, and formatting noise. Keep it under 100 words.",
      'Return JSON: {"text": "cleaned explanation"}.',
    ].join(" "),
    prompt: [
      `Question: ${req.stem.slice(0, 1200)}`,
      req.correct ? `Correct answer: ${req.correct}` : "",
      `Raw explanation: ${req.rawExplanation.slice(0, 3000)}`,
    ].filter(Boolean).join("\n"),
    maxTokens: 400,
  });
  const text = typeof raw === "object" && raw !== null && typeof (raw as { text?: unknown }).text === "string"
    ? (raw as { text: string }).text.trim()
    : "";
  if (!text) throw new Error("The model returned no cleaned explanation.");
  return text;
}

/**
 * Question Intelligence (§AI enhancement): digest of what a question set
 * tests, common pitfalls, and suggested review targets. Output is labeled
 * with the provider and stored on the set only after the user opted in.
 */
export async function enhanceQuestionSet(
  provider: AIProvider,
  req: { title: string; questions: Array<{ stem: string; correct?: string; explanation?: string }> },
): Promise<{ summary: string; pitfalls: string[]; suggestedReview: string[] }> {
  const sample = req.questions.slice(0, 25);
  const raw = await provider.completeJson({
    system: [
      "You analyze a set of practice questions for a medical student.",
      "Identify what the set actually tests, the likely pitfalls (confusable pairs, misread patterns), and 2-4 concrete review targets.",
      'Return JSON: {"summary": "...", "pitfalls": ["..."], "suggestedReview": ["..."]}. Be specific, never generic filler.',
    ].join(" "),
    prompt: [
      `Set: ${req.title}`,
      ...sample.map((q, i) => `Q${i + 1}: ${q.stem.slice(0, 400)}${q.correct ? ` [answer: ${q.correct}]` : ""}`),
    ].join("\n"),
    maxTokens: 900,
  });
  const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const pitfalls = Array.isArray(record.pitfalls)
    ? record.pitfalls.filter((p): p is string => typeof p === "string" && !!p.trim()).slice(0, 6)
    : [];
  const suggestedReview = Array.isArray(record.suggestedReview)
    ? record.suggestedReview.filter((p): p is string => typeof p === "string" && !!p.trim()).slice(0, 4)
    : [];
  if (!summary) throw new Error("The model returned no usable digest.");
  return { summary, pitfalls, suggestedReview };
}
