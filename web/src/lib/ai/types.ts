// ===========================================================================
// AI provider abstraction (directive Phase 3). Typed interfaces only — no
// implementation here. Three modes: local (Ollama, no key), BYOK cloud
// (config surface only until a secure server proxy exists — keys are NEVER
// stored or shipped client-side), and a clearly-labeled deterministic mock.
// Raw model output NEVER mutates the user's plan: every feature returns a
// PROPOSAL that is schema-validated and reviewed by the user before saving.
// ===========================================================================
import type { BriefMode } from "../commandBrief";
import type { AnkiCardType } from "../ankiCards";
import type { QuestionErrorType } from "../questions";

export type AiMode = "off" | "local" | "cloud" | "mock";

export interface AiProviderInfo {
  kind: "ollama" | "openai-compat" | "anthropic" | "gemini" | "deepseek" | "mock";
  label: string;
  /** True when inference happens on the user's machine. */
  local: boolean;
  requiresKey: boolean;
}

export interface AiAvailability {
  ok: boolean;
  detail: string;
  models?: string[];
}

export interface AiJsonRequest {
  system?: string;
  prompt: string;
  /** Rough cap; providers map it to their own parameter. */
  maxTokens?: number;
  /** The shape the reply must have, where the provider can enforce one. The caller still validates what comes back. */
  schema?: Record<string, unknown>;
  /** Stops the request when the learner cancels. */
  signal?: AbortSignal;
}

/** The base capability every provider implements. */
export interface AIProvider {
  info: AiProviderInfo;
  /** Cheap, non-throwing reachability probe. */
  available(): Promise<AiAvailability>;
  /** One-shot completion that must return parseable JSON. */
  completeJson(req: AiJsonRequest): Promise<unknown>;
}

// --- feature-level provider interfaces (directive §7) -------------------------------

/** Structured Command Brief proposal — validated, then shown for review. */
export interface AiBriefProposal {
  mode: BriefMode;
  rationale: string;
  nextBestMove: { title: string; reason: string; estimatedMinutes: number };
  minimumViableWin: { title: string; estimatedMinutes: number };
  recommendedDuration: number;
  priorityLevel: "low" | "medium" | "high";
  recoveryActions: string[];
  warnings: string[];
  confidence: number; // 0..1
  assumptions: string[];
}

export interface StudyPlanProvider {
  proposeBrief(context: Record<string, unknown>): Promise<AiBriefProposal>;
}

export interface GeneratedCardDraft {
  type: AnkiCardType;
  front: string;
  back: string;
  extra?: string;
  tags: string[];
  source?: string;
}

export type CardGenerationStyle =
  | "concise"
  | "detailed"
  | "cloze-heavy"
  | "clinical-vignette-heavy"
  | "exam-style"
  | "mechanism-focused"
  | "image-labeling";

export interface FlashcardProvider {
  generateCards(req: {
    material: string;
    topic?: string;
    style: CardGenerationStyle;
    maxCards: number;
    source?: string;
  }): Promise<GeneratedCardDraft[]>;
}

export interface QuestionAnalysisProvider {
  classifyError(req: { stem: string; userAnswer?: string; correctAnswer?: string; userNote?: string }): Promise<{
    errorType: QuestionErrorType;
    rationale: string;
    confidence: number;
  }>;
}

export interface GeneratedQuestionDraft {
  stem: string;
  options: Array<{ key: string; text: string }>;
  correctKey: string;
  explanation: string;
  whyOthersWrong?: string;
  tags: string[];
  estimatedDifficulty: "easy" | "medium" | "hard";
}

export interface QuestionGeneratorProvider {
  generateQuestions(req: {
    objectives: string;
    weakTopics?: string[];
    difficulty: "easy" | "medium" | "hard";
    count: number;
  }): Promise<GeneratedQuestionDraft[]>;
}

export interface RecoveryCoachProvider {
  refinePlan(context: Record<string, unknown>): Promise<{ adjustments: string[]; encouragementFreeSummary: string }>;
}

/** Future: application/residency profile analysis (Phase 7 §16). Interface only. */
export interface ProfileAnalysisProvider {
  analyzeProfile(profile: Record<string, unknown>): Promise<{
    relativeStrengths: string[];
    relativeGaps: string[];
    uncertainty: string;
    nextAction: string;
    missingPrerequisites: string[];
  }>;
}
