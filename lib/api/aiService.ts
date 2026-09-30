import { logAiUsage } from "./dataService.js";

export type AiFeature =
  | "next-move"
  | "anki-generator"
  | "step-planner"
  | "weak-area-analysis"
  | "daily-report";

export interface AiRequestBody {
  feature?: string;
  context?: Record<string, unknown>;
  notes?: string;
  cardType?: "Basic" | "Cloze" | "Custom";
  tags?: string[];
}

export interface AiResult {
  provider: string;
  feature: AiFeature;
  result: Record<string, unknown>;
  safetyNote: string;
}

interface AiProvider {
  name: string;
  run(feature: AiFeature, body: AiRequestBody): Promise<AiResult>;
}

export async function runAiFeature(feature: AiFeature, body: AiRequestBody) {
  const provider = getProvider();
  const result = await provider.run(feature, body);

  await logAiUsage({
    feature,
    inputSummary: summarizeInput(feature, body),
    outputSummary: summarizeOutput(result),
    tokenEstimate: estimateTokens(body),
  });

  return result;
}

function getProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER || "mock").toLowerCase();
  if (provider === "mock") return new MockAiProvider();
  return new PlaceholderProvider(provider);
}

class PlaceholderProvider implements AiProvider {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  async run(feature: AiFeature): Promise<AiResult> {
    return {
      provider: this.name,
      feature,
      result: {
        status: "not_configured",
        message: `${this.name} is scaffolded but not enabled yet. Set AI_PROVIDER=mock for development, or implement the provider adapter in lib/api/aiService.ts.`,
      },
      safetyNote: studyOnlyNote(),
    };
  }
}

class MockAiProvider implements AiProvider {
  name = "mock";

  async run(feature: AiFeature, body: AiRequestBody): Promise<AiResult> {
    const context = body.context ?? {};
    const result = feature === "anki-generator"
      ? buildAnkiDrafts(body)
      : feature === "step-planner"
        ? buildStepPlan(context)
        : feature === "weak-area-analysis"
          ? buildWeakAreaAnalysis(context)
          : feature === "daily-report"
            ? buildDailyReport(context)
            : buildNextMove(context);

    return {
      provider: this.name,
      feature,
      result,
      safetyNote: studyOnlyNote(),
    };
  }
}

function buildNextMove(context: Record<string, unknown>) {
  const weakAreas = asList(context.weakAreas);
  const dueReviews = Number(context.dueReviews ?? context.dueReviewCount ?? 0);
  const openTasks = asList(context.tasks);
  const currentCourse = String(context.currentCourse ?? context.course ?? "current course");
  const stepStatus = String(context.stepStatus ?? context.stepPrepStatus ?? "");

  const moves = [];
  if (dueReviews > 0) {
    moves.push({
      title: `Clear ${Math.min(dueReviews, 80)} due reviews`,
      why: "Spaced repetition debt compounds quickly. Clear a realistic block first.",
      mode: "Anki",
      effortMinutes: dueReviews > 80 ? 45 : 25,
    });
  }
  if (weakAreas.length) {
    moves.push({
      title: `Repair ${weakAreas[0]}`,
      why: "Weak areas should get active recall plus questions before passive rereading.",
      mode: "Weak-area drill",
      effortMinutes: 40,
    });
  }
  if (openTasks.length) {
    moves.push({
      title: String(openTasks[0]).slice(0, 96),
      why: "The oldest visible task is a friction point. Close one loop before adding more.",
      mode: "Task execution",
      effortMinutes: 30,
    });
  }

  if (!moves.length) {
    moves.push({
      title: `Do a mixed ${currentCourse} retrieval block`,
      why: stepStatus ? "You have no obvious fires. Mixed retrieval protects board prep and course retention." : "You have no obvious fires. Build a simple active-recall floor.",
      mode: "Retrieval",
      effortMinutes: 35,
    });
  }

  return {
    nextMove: moves[0],
    queue: moves.slice(0, 4),
    rule: "Due reviews first, then weak areas, then deadline/task closure, then mixed retrieval.",
  };
}

function buildAnkiDrafts(body: AiRequestBody) {
  const notes = (body.notes || String(body.context?.notes ?? "")).slice(0, 8000);
  const cardType = body.cardType || "Cloze";
  const tags = normalizeTags([...(body.tags ?? []), ...asList(body.context?.tags)]);
  const candidates = notes
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 24)
    .slice(0, 12);

  const cards = (candidates.length ? candidates : [
    "Active recall is stronger than passive rereading for durable exam preparation.",
    "Missed questions should be converted into targeted review prompts.",
  ]).map((sentence, index) => {
    const clean = sentence.replace(/\s+/g, " ");
    const cloze = clean.replace(/\b([A-Z][A-Za-z-]{4,}|[a-z][a-z-]{6,})\b/, "{{$1}}");
    if (cardType === "Basic") {
      return {
        type: "Basic",
        front: `What is the key high-yield point in: ${clean.slice(0, 120)}?`,
        back: clean,
        tags,
      };
    }
    if (cardType === "Custom") {
      return {
        type: "Custom",
        prompt: clean,
        answer: "Add concise answer from source material.",
        extra: "Review against the lecture before importing.",
        tags,
      };
    }
    return {
      type: "Cloze",
      text: cloze === clean ? `{{c1::${clean}}}` : cloze.replace("{{", "{{c1::").replace("}}", "}}"),
      extra: `Draft ${index + 1}. Verify wording before import.`,
      tags,
    };
  });

  return {
    cardType,
    cards,
    exportFormat: cardType === "Cloze" ? "Text\tExtra\tTags" : "Front\tBack\tTags",
    warning: "Mock drafts are formatting scaffolds. Verify all medical study content before importing.",
  };
}

function buildStepPlan(context: Record<string, unknown>) {
  const exam = String(context.exam ?? context.boardExam ?? "Step 1");
  const weeklyHours = Number(context.weeklyHours ?? 12);
  const weakSystems = asList(context.weakSystems ?? context.weakAreas);
  const resources = asList(context.resources);
  return {
    exam,
    weeklyHours,
    priorities: [
      "Protect daily spaced repetition and missed-review cleanup.",
      weakSystems.length ? `Repair weak systems first: ${weakSystems.slice(0, 3).join(", ")}.` : "Use a diagnostic block to identify the first weak systems.",
      resources.length ? `Keep resources tight: ${resources.slice(0, 3).join(", ")}.` : "Pick one question bank, one review text, and one spaced-repetition workflow.",
    ],
    weekTemplate: [
      { day: "Mon-Thu", work: "Concept repair + timed questions + missed-fact cards" },
      { day: "Fri", work: "Mixed block and error-log cleanup" },
      { day: "Sat", work: "Longer assessment/review block" },
      { day: "Sun", work: "Light spaced review and planning" },
    ],
  };
}

function buildWeakAreaAnalysis(context: Record<string, unknown>) {
  const weakAreas = asList(context.weakAreas ?? context.systems);
  const misses = asList(context.missedTopics ?? context.misses);
  return {
    weakAreas: weakAreas.length ? weakAreas : misses.slice(0, 5),
    recommendation: "Turn each miss into a small retrieval target, then retest with questions within 48 hours.",
    nextActions: [
      "Pick the weakest topic and write a 5-bullet error log.",
      "Do 10-20 focused questions.",
      "Convert missed facts into Anki cloze cards.",
      "Schedule a mixed retest after sleep.",
    ],
  };
}

function buildDailyReport(context: Record<string, unknown>) {
  const minutes = Number(context.minutes ?? context.studyMinutes ?? 0);
  const cards = Number(context.cards ?? 0);
  const tasksDone = Number(context.tasksDone ?? 0);
  const blockers = asList(context.blockers);
  const score = minutes >= 240 && cards >= 120 ? "excellent" : minutes >= 90 || cards >= 60 ? "solid" : "light";
  return {
    score,
    summary: `${minutes} minutes, ${cards} cards, ${tasksDone} tasks completed.`,
    commendation: score === "excellent" ? "Strong execution day. Protect recovery so it repeats." : "You logged the day. Keep the next move small and real.",
    blockers,
    tomorrow: blockers.length
      ? "Start by removing one blocker, then do a short retrieval block."
      : "Start with due reviews, then one focused course or Step block.",
  };
}

function asList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return [String(value)].filter(Boolean);
}

function normalizeTags(tags: string[]) {
  const clean = tags
    .flatMap((tag) => tag.split(/[,\s]+/))
    .map((tag) => tag.trim().replace(/[^a-zA-Z0-9:_-]/g, ""))
    .filter(Boolean);
  return [...new Set(["noctyrium", "draft", ...clean])].slice(0, 12);
}

function summarizeInput(feature: AiFeature, body: AiRequestBody) {
  const pieces = [`feature:${feature}`];
  if (body.notes) pieces.push(`notes:${body.notes.length} chars`);
  if (body.cardType) pieces.push(`cardType:${body.cardType}`);
  const contextKeys = body.context ? Object.keys(body.context).slice(0, 12).join(",") : "";
  if (contextKeys) pieces.push(`context:${contextKeys}`);
  return pieces.join(" | ").slice(0, 500);
}

function summarizeOutput(result: AiResult) {
  return `${result.provider}:${Object.keys(result.result).join(",")}`.slice(0, 500);
}

function estimateTokens(body: AiRequestBody) {
  return Math.ceil(JSON.stringify(body).length / 4);
}

function studyOnlyNote() {
  return "Study support only. Do not use this as patient care, diagnosis, or treatment advice.";
}
