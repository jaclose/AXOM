// ===========================================================================
// Study Methods library (directive §15). Evidence-informed technique templates
// with honest "when NOT to use it" guidance. Static typed data + a rules-based
// recommender the AI layer can later replace through the same interface.
// ===========================================================================

export interface StudyMethod {
  id: string;
  name: string;
  summary: string;
  whenToUse: string;
  whenNotToUse: string;
  materials: string[];
  timeEstimateMinutes: number;
  steps: string[];
  commonMistakes: string[];
  tags: Array<"recall" | "review" | "planning" | "recovery" | "exam-week" | "low-energy" | "deep-work">;
}

export const STUDY_METHODS: StudyMethod[] = [
  {
    id: "active-recall",
    name: "Active recall",
    summary: "Test yourself before re-reading anything. Retrieval is the study event.",
    whenToUse: "Any content you've seen at least once; the default for consolidating lectures.",
    whenNotToUse: "First contact with brand-new material — you need one orienting pass first.",
    materials: ["Lecture objectives or cards", "Blank paper or the question workspace"],
    timeEstimateMinutes: 30,
    steps: [
      "Close the notes. Write or say everything you remember about the topic.",
      "Check against the source; mark gaps, not successes.",
      "Re-derive only the gaps. Repeat once.",
      "Convert the stubborn gaps into cards or an error-log entry.",
    ],
    commonMistakes: ["Re-reading and calling it recall", "Checking the source too early", "Skipping the gap-to-card step"],
    tags: ["recall"],
  },
  {
    id: "spaced-repetition",
    name: "Spaced repetition",
    summary: "Let a scheduler decide what you review and when. Trust the queue.",
    whenToUse: "Daily, for anything already converted into cards.",
    whenNotToUse: "As a substitute for understanding — cards encode conclusions, not reasoning.",
    materials: ["Anki or the in-app review queue"],
    timeEstimateMinutes: 25,
    steps: [
      "Do the due queue before adding anything new.",
      "Rate honestly — 'again' is data, not failure.",
      "Cap new cards on heavy days; the queue compounds either way.",
    ],
    commonMistakes: ["Hoarding new cards while due reviews pile up", "Editing cards mid-review", "Marathon catch-up sessions that burn the habit"],
    tags: ["recall", "review"],
  },
  {
    id: "interleaving",
    name: "Interleaving",
    summary: "Mix related topics in one session so retrieval has to discriminate.",
    whenToUse: "Second-pass review across organ systems or drug classes that blur together.",
    whenNotToUse: "First exposure — interleaving unlearned material is just confusion.",
    materials: ["Two or three related topic sets"],
    timeEstimateMinutes: 45,
    steps: [
      "Pick 2–3 confusable topics (e.g., vasculitides).",
      "Alternate question blocks between them in short runs.",
      "Note every cross-topic confusion in the error log.",
    ],
    commonMistakes: ["Blocking by topic and calling it interleaving", "Mixing unrelated topics for its own sake"],
    tags: ["recall", "review"],
  },
  {
    id: "blurting",
    name: "Blurting",
    summary: "Brain-dump a whole lecture from memory onto one page, then diff.",
    whenToUse: "Right after a lecture pass, or 24 hours later as a consolidation check.",
    whenNotToUse: "Dense reference material (pharm tables) where structure matters more than flow.",
    materials: ["Blank page", "The lecture handout for the diff"],
    timeEstimateMinutes: 20,
    steps: [
      "Write the lecture title. Dump everything you remember, unstructured.",
      "Diff against the slides in a different color.",
      "The diff IS the study list for the next pass.",
    ],
    commonMistakes: ["Writing neatly instead of fast", "Skipping the diff step"],
    tags: ["recall"],
  },
  {
    id: "teach-back",
    name: "Teach-back",
    summary: "Explain the concept aloud to an imagined M1 until there are no hand-waves.",
    whenToUse: "Mechanisms and pathways you 'sort of' understand.",
    whenNotToUse: "Pure memorization lists — teaching won't help you hold 20 drug names.",
    materials: ["None — a whiteboard helps"],
    timeEstimateMinutes: 15,
    steps: [
      "Explain the mechanism out loud, from first principles.",
      "Every time you say 'somehow' or 'it just does', write that spot down.",
      "Look up only those spots. Re-teach once.",
    ],
    commonMistakes: ["Reciting instead of explaining", "Glossing over the hand-wave moments"],
    tags: ["recall", "deep-work"],
  },
  {
    id: "question-first",
    name: "Question-first studying",
    summary: "Open the question bank before the notes; let misses set the reading agenda.",
    whenToUse: "Second pass onward, exam runway, or when reading feels endless.",
    whenNotToUse: "Zero-exposure topics — random guessing teaches little and dents morale.",
    materials: ["Question set for the topic", "Error log"],
    timeEstimateMinutes: 50,
    steps: [
      "Answer 10–15 questions on the topic, untimed.",
      "Log every miss with an error type (knowledge gap vs misread vs …).",
      "Read ONLY the sections your misses point at.",
      "Re-attempt the missed questions at the end.",
    ],
    commonMistakes: ["Reading explanations passively", "Skipping error classification", "Doing 40 questions and reviewing none"],
    tags: ["recall", "review", "exam-week"],
  },
  {
    id: "error-log-review",
    name: "Error-log review",
    summary: "Study your own mistakes as a curriculum. Repeat offenders get priority.",
    whenToUse: "Weekly, and always in the last days before an assessment.",
    whenNotToUse: "When the log is empty — go generate misses first.",
    materials: ["Question workspace error log"],
    timeEstimateMinutes: 30,
    steps: [
      "Open Repeat Offenders and Incorrects Only.",
      "For each: say why the wrong answer tempted you, then the correct reasoning.",
      "Convert anything missed twice into an error-repair card.",
    ],
    commonMistakes: ["Rereading errors without re-answering", "Treating all misses as knowledge gaps"],
    tags: ["review", "exam-week"],
  },
  {
    id: "focused-lecture-review",
    name: "Focused lecture review",
    summary: "One lecture, one pass, one output artifact (cards or a blurt page).",
    whenToUse: "Keeping up with the current teaching week.",
    whenNotToUse: "Exam week — triage beats completeness there.",
    materials: ["Lecture slides", "Objectives list"],
    timeEstimateMinutes: 45,
    steps: [
      "Read the objectives first — they are the exam contract.",
      "Pass through slides answering each objective aloud.",
      "Produce one artifact: 5–10 cards or one blurt page.",
      "Log the pass in the tracker.",
    ],
    commonMistakes: ["Highlighting as the output", "Making 40 cards from one lecture"],
    tags: ["deep-work"],
  },
  {
    id: "exam-week-triage",
    name: "Exam-week triage",
    summary: "Stop trying to finish. Rank by yield, cut the bottom, rehearse the top.",
    whenToUse: "Assessment within ~5 days and material remains uncovered.",
    whenNotToUse: "Normal weeks — triage as a lifestyle creates permanent debt.",
    materials: ["Objectives list", "Error log", "Past question sets"],
    timeEstimateMinutes: 60,
    steps: [
      "List uncovered topics; mark each high/medium/low yield in one pass — no agonizing.",
      "Drop the low-yield list explicitly. Written down is not lost.",
      "Alternate: high-yield content block → linked question block.",
      "Every day ends with error-log review, not new content.",
    ],
    commonMistakes: ["Refusing to cut anything", "New content on exam eve instead of error review"],
    tags: ["exam-week", "planning"],
  },
  {
    id: "low-energy-protocol",
    name: "Low-energy study protocol",
    summary: "A legitimate session for bad days: small, passive-adjacent, zero setup.",
    whenToUse: "Exhausted, sick, post-call, or emotionally flattened — but wanting continuity.",
    whenNotToUse: "As the default mode when energy is actually fine.",
    materials: ["Due card queue or one recorded lecture"],
    timeEstimateMinutes: 15,
    steps: [
      "Take the smaller step Up next offers under “Short on time?”.",
      "Timebox 15 minutes. When it rings you are DONE, guilt-free.",
      "Log it. Continuity preserved; recovery beats heroics.",
    ],
    commonMistakes: ["Turning it into a full session and burning tomorrow too", "Skipping the log because it 'barely counts' — it counts"],
    tags: ["low-energy", "recovery"],
  },
  {
    id: "catch-up-protocol",
    name: "Catch-up protocol",
    summary: "Structured debt repayment: newest material first, backfill by yield.",
    whenToUse: "Behind by days-to-a-week with an assessment still comfortably ahead.",
    whenNotToUse: "Exam inside ~5 days — switch to exam-week triage instead.",
    materials: ["Tracker backlog list"],
    timeEstimateMinutes: 90,
    steps: [
      "Stay current FIRST: today's material before old material, every day.",
      "Backfill one high-yield old lecture per day — no more.",
      "Questions on backfilled topics the following day to lock them.",
      "Accept that low-yield backlog may never be repaid. That is the plan working.",
    ],
    commonMistakes: ["Pausing current material to repay debt (debt then compounds)", "Backfilling chronologically instead of by yield"],
    tags: ["recovery", "planning"],
  },
  {
    id: "session-25-5",
    name: "25/5 sprints",
    summary: "Classic short focus cycles. Momentum for task-starting problems.",
    whenToUse: "Procrastination loops, admin-heavy days, card queues.",
    whenNotToUse: "Deep problem-solving that needs 40+ minutes of runway.",
    materials: ["The in-app timer"],
    timeEstimateMinutes: 30,
    steps: ["Pick ONE task.", "25 minutes on, 5 off. The break is mandatory.", "After 4 cycles take a long break."],
    commonMistakes: ["Skipping breaks and flaming out at cycle 3", "Switching tasks mid-sprint"],
    tags: ["deep-work", "low-energy"],
  },
  {
    id: "session-50-10",
    name: "50/10 blocks",
    summary: "The workhorse block for lecture passes and question sets.",
    whenToUse: "Standard content sessions when energy is adequate.",
    whenNotToUse: "Very low energy days — use 25/5 or the low-energy protocol.",
    materials: ["The in-app timer"],
    timeEstimateMinutes: 60,
    steps: ["One block = one named outcome (a lecture pass, a 15-question set).", "50 minutes on, 10 genuinely off — stand up.", "Three blocks is a strong day."],
    commonMistakes: ["Vague block goals ('study bio')", "Spending the 10 minutes on the phone and calling it rest"],
    tags: ["deep-work"],
  },
  {
    id: "deep-work",
    name: "Deep-work session (90–120m)",
    summary: "Long uninterrupted runway for the hardest integrative work.",
    whenToUse: "Weekend mornings; complex topics needing sustained model-building.",
    whenNotToUse: "Fragmented days, low energy, or as a daily default — it doesn't scale.",
    materials: ["Phone in another room", "Everything needed pre-gathered"],
    timeEstimateMinutes: 105,
    steps: [
      "Define the single outcome before starting.",
      "Full distraction shutdown; the session dies with the first context switch.",
      "90–120 minutes, then a real break away from the desk.",
    ],
    commonMistakes: ["Starting without materials gathered", "Two deep sessions back-to-back"],
    tags: ["deep-work"],
  },
];

// --- rules-based recommender (AI-replaceable through the same signature) -----------

export interface MethodRecommendationInput {
  energy: "low" | "medium" | "high";
  minutesAvailable: number;
  examDaysAway: number | null;
  inRecovery: boolean;
}

export function recommendMethod(input: MethodRecommendationInput): StudyMethod {
  const byId = (id: string) => STUDY_METHODS.find((m) => m.id === id)!;
  if (input.energy === "low" || input.minutesAvailable <= 20) return byId("low-energy-protocol");
  if (input.examDaysAway !== null && input.examDaysAway >= 0 && input.examDaysAway <= 5) return byId("exam-week-triage");
  if (input.inRecovery) return byId("catch-up-protocol");
  if (input.minutesAvailable >= 90 && input.energy === "high") return byId("deep-work");
  if (input.minutesAvailable >= 50) return byId("question-first");
  return byId("session-25-5");
}
