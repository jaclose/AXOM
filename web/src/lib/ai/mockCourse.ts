// ===========================================================================
// Demo output for the course tasks (course.extract, questions.extract,
// course.advise). Deterministic and "[DEMO]"-labeled like the rest of the
// Demo provider, so it can never pass for a real reading of the learner's
// course or screenshots. Advice cites only ids from the request's snapshot.
// ===========================================================================
import type { AiJsonRequest } from "./types";

export function demoCourseTask(req: AiJsonRequest): unknown | undefined {
  if (req.task === "course.extract") return demoCourseExtract();
  if (req.task === "questions.extract") return demoQuestionExtract();
  if (req.task === "course.advise") return demoCourseAdvice(req.prompt);
  return undefined;
}

function demoCourseExtract() {
  return {
    course: { code: "[DEMO] DEMO 101", name: "[DEMO] Example course", term: "", instructors: [] },
    modules: [{
      name: "[DEMO] Week 1",
      items: [
        { title: "[DEMO] Lecture 1: Example topic", kind: "lecture", dateType: "none", dateText: "", date: "", weight: "", points: "", objectives: ["[DEMO] Example objective"], evidence: "" },
        { title: "[DEMO] Practice quiz 1", kind: "practice", dateType: "none", dateText: "", date: "", weight: "", points: "", objectives: [], evidence: "" },
      ],
    }],
    assessments: [],
    gradingGroups: [],
    resources: [],
    warnings: ["[DEMO] Demo mode returns this example instead of reading your material. Turn on AXOM Cloud AI or a local model to extract your real course."],
  };
}

function demoQuestionExtract() {
  return {
    questions: [{
      number: "1",
      stem: "[DEMO] Example transcribed stem. Demo mode does not read your screenshots.",
      options: [
        { key: "A", text: "[DEMO] Option A" },
        { key: "B", text: "[DEMO] Option B" },
        { key: "C", text: "[DEMO] Option C" },
      ],
      markedAnswer: "",
      answerEvidence: "",
      explanation: "",
      hasFigure: false,
      uncertain: ["markedAnswer"],
      screenshots: [1],
    }],
    warnings: ["[DEMO] Demo mode returns this example instead of transcribing your screenshots. Turn on AXOM Cloud AI to transcribe them."],
  };
}

/** Advice for the first two item ids in the snapshot, so demo suggestions stay acceptable and harmless. */
function demoCourseAdvice(prompt: string) {
  const itemRows = prompt.split(/\nAssessments/)[0];
  const ids = [...itemRows.matchAll(/^([^|\n]+?) \| /gm)]
    .map((match) => match[1].trim())
    .filter((id) => id && id !== "Items: id" && id !== "Assessments: id" && !id.includes(" "));
  const [first, second] = ids;
  return {
    summary: "[DEMO] Canned advice for development. Turn on AXOM Cloud AI or a local model for real advice on your course.",
    currentMoveView: { verdict: "no-opinion", explanation: "[DEMO] Demo mode does not weigh in on your plan." },
    nextSessions: first ? [{ title: "[DEMO] Start with the first unfinished item", itemIds: [first], focus: "first-pass", minutes: 45, reason: "[DEMO] Example reason." }] : [],
    risks: [],
    highYield: second ? [{ itemId: second, reason: "[DEMO] Example reason." }] : [],
    adjustments: [],
    workload: { minutes: 0, note: "[DEMO] No real estimate in demo mode." },
    warnings: ["[DEMO] This is demo output, not an analysis of your course."],
  };
}
