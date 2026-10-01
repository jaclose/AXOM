// ===========================================================================
// Question block runner (pre-beta §7): Tutor mode (immediate feedback, AI
// actions, repair cards) and Exam mode (deferred feedback, optional timer,
// flagging, end-of-block review). Results persist as QuizSession records and
// every answer is recorded on the question for spaced retry.
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpenCheck, Check, ChevronLeft, Flag, ListPlus, Play, WandSparkles, Sparkles, Minus, RotateCcw, Timer, X } from "lucide-react";
import { useStore } from "../../lib/store";
import { STORAGE_KEYS } from "../../lib/brand";
import {
  buildQuizPool, missedQuestionIds, scoreSession,
  type QuizAnswer, type QuizFilters, type QuizMode, type QuizSession,
} from "../../lib/quiz";
import {
  ERROR_TYPE_LABEL, EXAM_TYPE_LABEL, QUESTION_CATEGORIES,
  questionMappingStatus,
  type QuestionErrorType, type QuestionExamType, type QuestionRecord,
} from "../../lib/questions";
import { newSchedule } from "../../lib/ankiCards";
import { explainSimply, explainWhyWrong, memoryHook, resolveActiveProvider } from "../../lib/ai";
import { Modal, SelectField } from "../ui/Modal";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import { pushToast } from "../../lib/toast";
import { QuizFeedback } from "./QuizFeedback";
import { accuracyTone } from "../../lib/library";
import { ICON_SIZE } from "../../lib/iconSize";
import { formatSeconds, pacingInsight, summarizePacing } from "../../lib/quizPacing";
import { createTextAnnotationWithIntegrity, removeTextAnnotationById, type QuestionAnnotationTarget, type QuestionAnnotationTone } from "../../lib/questionAnnotations";
import { AnnotatedQuestionText, type QuestionTextSelection } from "./AnnotatedQuestionText";
import { QuestionAttachmentsPanel } from "./QuestionAttachmentsPanel";
import { QuestionExhibits } from "./QuestionExhibits";
import {
  TutorUtilityDock,
  type AnnotationTool,
  type TutorPanel,
} from "./TutorUtilityDock";
import type { QuizCalculatorValue } from "./QuizCalculator";
import { ExamSimulator } from "./ExamSimulator";
import {
  BLOCK_PRESETS, EXAM_SKINS, blockCounts, formatClock, readSuspendedBlock, writeSuspendedBlock,
  type BlockPreset, type ExamSkin, type SuspendedBlock,
} from "../../lib/examSim";

const ERROR_TYPES = Object.keys(ERROR_TYPE_LABEL) as QuestionErrorType[];
const EXAM_TYPES = Object.keys(EXAM_TYPE_LABEL) as QuestionExamType[];

/** "sim-review": a finished simulation, read back in the interface it was sat in. */
type Stage = "setup" | "running" | "results" | "sim" | "sim-review";
type ExamInterface = "axom" | ExamSkin;
const INTERFACE_KEY = "axom.examSim.interface.v1";
function readInterface(): ExamInterface {
  try {
    const value = localStorage.getItem(INTERFACE_KEY);
    return value === "uworld" || value === "nbme" || value === "examsoft" ? value : "axom";
  } catch { return "axom"; }
}
/** Every preset runs at the USMLE pace of 90 seconds per item. */
const SECONDS_PER_ITEM = 90;
interface ActiveQuizSnapshot {
  mode: QuizMode; poolIds: string[]; index: number; answers: QuizAnswer[];
  picked?: string; revealed: boolean; startedAt: string; timed: boolean; filters: QuizFilters;
}
function readActiveQuiz(): ActiveQuizSnapshot | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession) ?? "null") as ActiveQuizSnapshot | null;
    return value && Array.isArray(value.poolIds) && value.poolIds.length > 0 ? value : undefined;
  } catch { return undefined; }
}

function trustedCorrectKey(question: QuestionRecord): string | undefined {
  return questionMappingStatus(question) === "ready" ? question.correctKey : undefined;
}

// Device-only reading preference for the quiz player (Q2a). A UI preference,
// never workspace content — persisted like theme.
const READING_SCALE_MIN = 0.9;
const READING_SCALE_MAX = 1.4;
function readReadingScale(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEYS.quizReadingScale));
    return Number.isFinite(value) && value >= READING_SCALE_MIN && value <= READING_SCALE_MAX ? value : 1;
  } catch { return 1; }
}

export function ExamRunner({ mode: initialMode, retakeIds, presetFilters, presetTimed = false, blockId, simulate = false, onClose }: {
  mode: QuizMode;
  /** When set, skips setup and runs exactly these questions (retake missed). */
  retakeIds?: string[];
  /** Pre-fill the setup (run-from-set, saved blocks). */
  presetFilters?: Partial<QuizFilters>;
  /** Preserve the timer setting when reopening a saved block/session. */
  presetTimed?: boolean;
  /** Saved block whose last-run timestamp advances only when the run begins. */
  blockId?: string;
  /** Open straight into exam-interface simulation (UWorld / NBME / ExamSoft). */
  simulate?: boolean;
  onClose: () => void;
}) {
  const s = useStore();
  const questions = s.questions ?? [];
  const questionSets = s.questionSets ?? [];
  const restored = useMemo(() => readActiveQuiz(), []);
  const [mode, setMode] = useState<QuizMode>(initialMode);
  const [stage, setStage] = useState<Stage>(restored || retakeIds?.length ? "running" : "setup");

  // --- setup state
  const [count, setCount] = useState(presetFilters?.count ?? (simulate ? 20 : 10));
  const [status, setStatus] = useState<QuizFilters["status"]>(presetFilters?.status ?? "all");
  const [category, setCategory] = useState(presetFilters?.categories?.[0] ?? "");
  const [examType, setExamType] = useState<QuestionExamType | "">(presetFilters?.examTypes?.[0] ?? "");
  const [setIds, setSetIds] = useState<string[]>(presetFilters?.setIds ?? []);
  const [ordered, setOrdered] = useState(presetFilters?.ordered ?? false);
  const [timed, setTimed] = useState(restored?.timed ?? (simulate || presetTimed));
  const [runBlockId, setRunBlockId] = useState(blockId);
  const [minutesPerQ] = useState(1.5);
  const [examInterface, setExamInterface] = useState<ExamInterface>(() => {
    if (retakeIds?.length) return "axom";
    const stored = readInterface();
    return simulate && stored === "axom" ? "nbme" : stored;
  });
  const [presetId, setPresetId] = useState<BlockPreset["id"]>("usmle-2026");
  const [suspended, setSuspended] = useState<SuspendedBlock | undefined>(() => readSuspendedBlock());
  const [simRun, setSimRun] = useState<{ skin: ExamSkin; pool: QuestionRecord[]; timeLimitSeconds?: number; resume?: SuspendedBlock } | null>(null);

  // --- run state
  const [pool, setPool] = useState<QuestionRecord[]>(() => restored
    ? restored.poolIds.map((id) => questions.find((question) => question.id === id)).filter((question): question is QuestionRecord => Boolean(question))
    : retakeIds?.length
      ? buildQuizPool(
          questions.filter((question) => retakeIds.includes(question.id)),
          { count: Math.max(1, retakeIds.length), status: "all", ordered: true },
        )
      : []);
  const [index, setIndex] = useState(restored?.index ?? 0);
  const [answers, setAnswers] = useState<Map<string, QuizAnswer>>(() => new Map((restored?.answers ?? []).map((answer) => [answer.questionId, answer])));
  const [picked, setPicked] = useState<string | undefined>(restored?.picked);
  const [revealed, setRevealed] = useState(restored?.revealed ?? false); // tutor mode reveal
  const [errorType, setErrorType] = useState<QuestionErrorType | "">("");
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5 | undefined>();
  const [startedAt, setStartedAt] = useState<string>(() => restored?.startedAt ?? new Date().toISOString());
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>(null);
  const [annotationSelection, setAnnotationSelection] = useState<{
    target: QuestionAnnotationTarget;
    range: QuestionTextSelection;
  } | null>(null);
  const [localAnnotations, setLocalAnnotations] = useState(() => pool[index]?.annotations ?? []);
  const localAnnotationsRef = useRef(localAnnotations);
  const [annotationStatus, setAnnotationStatus] = useState<string>();
  const [session, setSession] = useState<QuizSession | null>(null);
  const [reviewSetCreated, setReviewSetCreated] = useState(false);
  const [trackerReviewAdded, setTrackerReviewAdded] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [editingMapping, setEditingMapping] = useState(false);
  const recordedTutorAttempts = useRef(new Set<string>());
  /** Seconds spent on questions the learner stepped away from before answering. */
  const bankedSeconds = useRef(new Map<string, number>());

  // --- Q2a player toolkit: strikeout (session-transient per question), reading
  // scale (persisted device pref), calculator, and scroll-to-top on advance.
  const [struck, setStruck] = useState<Set<string>>(() => new Set());
  const [activePanel, setActivePanel] = useState<TutorPanel | null>(null);
  const [calculatorValue, setCalculatorValue] = useState<QuizCalculatorValue>({ expression: "", result: "" });
  const [readingScale, setReadingScale] = useState(() => readReadingScale());
  const [tipVisible, setTipVisible] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.quizTutorTips) !== "dismissed"; } catch { return true; }
  });
  const stemRef = useRef<HTMLDivElement>(null);

  function toggleStrike(key: string) {
    setStruck((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function adjustReadingScale(direction: 1 | -1) {
    setReadingScale((value) => {
      const next = Math.min(READING_SCALE_MAX, Math.max(READING_SCALE_MIN, Math.round((value + direction * 0.1) * 10) / 10));
      try { localStorage.setItem(STORAGE_KEYS.quizReadingScale, String(next)); } catch { /* device pref only */ }
      return next;
    });
  }
  function resetReadingScale() {
    setReadingScale(1);
    try { localStorage.setItem(STORAGE_KEYS.quizReadingScale, "1"); } catch { /* device pref only */ }
  }
  function dismissTip() {
    setTipVisible(false);
    try { localStorage.setItem(STORAGE_KEYS.quizTutorTips, "dismissed"); } catch { /* device guidance only */ }
  }
  function resetTips() {
    setTipVisible(true);
    try { localStorage.removeItem(STORAGE_KEYS.quizTutorTips); } catch { /* device guidance only */ }
  }

  const timeLimitSeconds = timed ? Math.round(pool.length * minutesPerQ * 60) : undefined;
  const question = pool[index];
  const provider = useMemo(() => resolveActiveProvider(), []);

  useEffect(() => {
    if (stage !== "running" || pool.length === 0) return;
    const filters: QuizFilters = { count, status, categories: category ? [category] : undefined, examTypes: examType ? [examType] : undefined, setIds: setIds.length ? setIds : undefined, ordered: ordered || undefined };
    const snapshot: ActiveQuizSnapshot = { mode, poolIds: pool.map((item) => item.id), index, answers: [...answers.values()], picked, revealed, startedAt, timed, filters };
    try { localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(snapshot)); } catch { /* Local Vault remains authoritative for saved work. */ }
  }, [answers, category, count, examType, index, mode, ordered, picked, pool, revealed, setIds, stage, startedAt, status, timed]);

  function clearActiveQuiz() {
    try { localStorage.removeItem(STORAGE_KEYS.quizActiveSession); } catch { /* non-fatal */ }
  }

  // Timer display tick (display only — limits derive from timestamps).
  useEffect(() => {
    if (stage !== "running" || !timed) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [stage, timed]);

  const elapsedSeconds = Math.floor((nowTick - Date.parse(startedAt)) / 1000);
  const timeLeft = timeLimitSeconds !== undefined ? Math.max(0, timeLimitSeconds - elapsedSeconds) : undefined;
  useEffect(() => {
    if (stage === "running" && timeLeft === 0 && timed) finishBlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, stage, timed]);

  // Keyboard shortcuts: A–E pick an option, Enter submits / advances, F flags.
  useEffect(() => {
    if (stage !== "running" || !question) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"]')) return;
      const letter = e.key.toUpperCase();
      if (letter === "F") {
        toggleFlag();
        e.preventDefault();
      } else if (/^[A-E]$/.test(letter) && question!.options.some((o) => o.key === letter)) {
        // Shift+letter eliminates/restores a choice; plain letter picks it.
        if (e.shiftKey) toggleStrike(letter);
        else if (!(mode === "tutor" && revealed)) setPicked(letter);
        e.preventDefault();
      } else if (e.key === "Enter") {
        if (mode === "tutor") { if (!revealed && picked) submitTutor(); else if (revealed) nextQuestion(); }
        else if (picked) submitExamAndNext();
        e.preventDefault();
      } else if (/^[1-5]$/.test(e.key) && mode === "tutor" && revealed) {
        // 1–5 sets confidence once the answer is revealed.
        setConfidence(Number(e.key) as 1 | 2 | 3 | 4 | 5);
        e.preventDefault();
      } else if (e.key === "ArrowLeft" && index > 0) {
        goPrevious();
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        if (mode === "tutor" && revealed) nextQuestion();
        else if (mode === "exam" && picked) submitExamAndNext();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, question?.id, revealed, picked, mode, errorType, confidence]);

  // Tutor tools consume Escape before the containing modal. The first press
  // closes the utility/mode; a later press retains the established leave-block
  // confirmation behavior.
  useEffect(() => {
    if (stage !== "running") return;
    function onToolEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || (!activePanel && !annotationTool)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (activePanel) {
        const label = activePanel === "highlight" ? "Highlight tools"
          : activePanel === "notes" ? "Question notes"
            : activePanel === "text" ? "Text settings"
              : activePanel === "help" ? "Tutor tips" : "Calculator";
        setActivePanel(null);
        window.setTimeout(() => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus(), 0);
      } else {
        setAnnotationTool(null);
        setAnnotationStatus("Annotation tool off.");
      }
    }
    window.addEventListener("keydown", onToolEscape, true);
    return () => window.removeEventListener("keydown", onToolEscape, true);
  }, [activePanel, annotationTool, stage]);

  // On advancing to a new question, clear this question's eliminations and reset
  // the reading surface to the top of the stem, moving focus there so assistive
  // tech announces the new question. Instant (no smooth scroll) respects
  // reduced-motion by construction.
  useEffect(() => {
    setStruck(new Set());
    setLocalAnnotations(question?.annotations ?? []);
    localAnnotationsRef.current = question?.annotations ?? [];
    setAnnotationSelection(null);
    setAnnotationStatus(undefined);
    if (stage !== "running") return;
    const stem = stemRef.current;
    const body = stem?.closest<HTMLElement>(".modal-body");
    if (body) body.scrollTop = 0;
    stem?.focus({ preventScroll: true });
  }, [index, stage, question?.id, question?.annotations]);

  function currentFilters(): QuizFilters {
    return {
      count,
      status,
      categories: category ? [category] : undefined,
      examTypes: examType ? [examType] : undefined,
      setIds: setIds.length ? setIds : undefined,
      ordered: ordered || undefined,
    };
  }

  function saveAsBlock() {
    const title = prompt("Name this block (it appears in Block Builder):", "");
    if (!title?.trim()) return;
    const id = crypto.randomUUID();
    s.saveQuizBlock({
      id,
      title: title.trim(),
      mode,
      timed,
      filters: currentFilters(),
      createdAt: new Date().toISOString(),
    });
    setRunBlockId(id);
    pushToast({ title: "Block saved", body: "Rerun it any time from Block Builder.", tone: "success" });
  }

  function chooseInterface(value: ExamInterface) {
    setExamInterface(value);
    try { localStorage.setItem(INTERFACE_KEY, value); } catch { /* device pref only */ }
    if (value !== "axom") {
      const preset = BLOCK_PRESETS.find((item) => item.id === presetId);
      if (preset?.items) setCount(preset.items);
    }
  }

  function choosePreset(preset: BlockPreset) {
    setPresetId(preset.id);
    if (preset.items) { setCount(preset.items); setTimed(true); }
  }

  function begin() {
    const filters = currentFilters();
    const built = buildQuizPool(questions, filters, questionSets);
    if (built.length === 0) {
      pushToast({ title: "No questions match", body: "Loosen the filters or import more questions first.", tone: "warn" });
      return;
    }
    if (examInterface !== "axom") {
      if (suspended && !confirm("Starting a new block discards your suspended block. Continue?")) return;
      writeSuspendedBlock(null);
      setSuspended(undefined);
      clearActiveQuiz();
      setSimRun({ skin: examInterface, pool: built, timeLimitSeconds: timed ? built.length * SECONDS_PER_ITEM : undefined });
      if (runBlockId) {
        const savedBlock = (s.quizBlocks ?? []).find((block) => block.id === runBlockId);
        if (savedBlock) s.saveQuizBlock({ ...savedBlock, lastRunAt: new Date().toISOString() });
      }
      setStage("sim");
      return;
    }
    const runStartedAt = new Date().toISOString();
    setPool(built);
    setStartedAt(runStartedAt);
    setShownAt(Date.now());
    if (runBlockId) {
      const savedBlock = (s.quizBlocks ?? []).find((block) => block.id === runBlockId);
      if (savedBlock) s.saveQuizBlock({ ...savedBlock, lastRunAt: runStartedAt });
    }
    setStage("running");
  }

  /** Whole seconds the question on screen has been showing this visit. */
  const secondsThisVisit = () => Math.round((Date.now() - shownAt) / 1000);

  /**
   * The record for the question on screen. Time adds up across visits: what an
   * earlier answer already counted, what was banked when the learner stepped
   * back without answering, and this visit.
   */
  function currentAnswer(answerKey: string | undefined, flagged: boolean): QuizAnswer | undefined {
    if (!question) return undefined;
    const correctKey = trustedCorrectKey(question);
    const correct = correctKey ? (answerKey ? answerKey === correctKey : false) : undefined;
    const earlier = (answers.get(question.id)?.seconds ?? 0) + (bankedSeconds.current.get(question.id) ?? 0);
    return { questionId: question.id, answerKey, correct, flagged, seconds: earlier + secondsThisVisit() };
  }

  function recordCurrent(answerKey: string | undefined, flagged: boolean): QuizAnswer | undefined {
    const record = currentAnswer(answerKey, flagged);
    if (!record) return undefined;
    bankedSeconds.current.delete(record.questionId);
    setAnswers((prev) => new Map(prev).set(record.questionId, record));
    return record;
  }

  function submitTutor() {
    if (!picked) return;
    recordCurrent(picked, answers.get(question!.id)?.flagged ?? false);
    setRevealed(true);
  }

  function nextQuestion() {
    // Tutor mode saves the attempt (with error type) as the user moves on.
    if (mode === "tutor" && question && revealed && !recordedTutorAttempts.current.has(question.id)) {
      const a = answers.get(question.id);
      s.recordQuestionAttempt(question.id, {
        answerKey: a?.answerKey,
        status: a?.correct === undefined ? "needs-review" : a.correct ? "correct" : "incorrect",
        timeSpentSeconds: a?.seconds,
        confidence,
        errorType: a?.correct === false ? (errorType || undefined) : undefined,
      });
      recordedTutorAttempts.current.add(question.id);
    }
    setPicked(undefined);
    setRevealed(false);
    setErrorType("");
    setConfidence(undefined);
    setAiText(null);
    setEditingMapping(false);
    setShownAt(Date.now());
    if (index + 1 >= pool.length) finishBlock();
    else setIndex(index + 1);
  }

  function submitExamAndNext() {
    const record = recordCurrent(picked, answers.get(question!.id)?.flagged ?? false);
    setPicked(undefined);
    if (index + 1 >= pool.length) finishBlock(picked, record);
    else { setIndex(index + 1); setShownAt(Date.now()); }
  }

  function goPrevious() {
    if (index <= 0) return;
    // Stepping back before answering still spent time on this question.
    if (question && !revealed) {
      bankedSeconds.current.set(question.id, (bankedSeconds.current.get(question.id) ?? 0) + secondsThisVisit());
    }
    const previous = pool[index - 1];
    const saved = answers.get(previous.id);
    setIndex((value) => Math.max(0, value - 1));
    setPicked(saved?.answerKey);
    setRevealed(mode === "tutor" && Boolean(saved?.answerKey));
    setErrorType("");
    setConfidence(undefined);
    setAiText(null);
    setEditingMapping(false);
    setShownAt(Date.now());
  }

  function finishBlock(lastPick?: string, justRecorded?: QuizAnswer) {
    // Ensure the in-flight answer is captured before scoring.
    const all = new Map(answers);
    const key = lastPick ?? picked;
    if (justRecorded) {
      // Recorded a moment ago; state has not caught up with it yet.
      all.set(justRecorded.questionId, justRecorded);
    } else if (question && key && (mode === "exam" || !all.has(question.id))) {
      // In an exam the pick on screen is the answer, even on a question answered
      // on an earlier visit (a changed last answer used to be dropped here).
      const record = currentAnswer(key, all.get(question.id)?.flagged ?? false);
      if (record) all.set(question.id, record);
    }
    const answerList = pool.map((q) => all.get(q.id) ?? ({ questionId: q.id, flagged: false } as QuizAnswer));
    const result: QuizSession = {
      id: crypto.randomUUID(),
      mode,
      startedAt,
      endedAt: new Date().toISOString(),
      timed,
      timeLimitSeconds,
      filters: currentFilters(),
      questionIds: pool.map((q) => q.id),
      answers: answerList,
      score: scoreSession(answerList),
    };
    // Exam mode records attempts at the END so nothing leaks mid-block.
    if (mode === "exam") {
      for (const a of answerList) {
        if (!a.answerKey && !a.flagged) continue;
        s.recordQuestionAttempt(a.questionId, {
          answerKey: a.answerKey,
          status: a.correct === undefined ? "needs-review" : a.correct ? "correct" : "incorrect",
          timeSpentSeconds: a.seconds,
        });
      }
    }
    s.saveQuizSession(result);
    clearActiveQuiz();
    setSession(result);
    setStage("results");
  }

  function resumeSuspended() {
    if (!suspended) return;
    const resumedPool = suspended.poolIds
      .map((id) => questions.find((question) => question.id === id))
      .filter((question): question is QuestionRecord => Boolean(question));
    if (!resumedPool.length) {
      pushToast({ title: "Suspended block unavailable", body: "Its questions are no longer in this workspace.", tone: "warn" });
      writeSuspendedBlock(null);
      setSuspended(undefined);
      return;
    }
    setMode(suspended.mode);
    setSimRun({ skin: suspended.skin, pool: resumedPool, timeLimitSeconds: suspended.timeLimitSeconds, resume: suspended });
    setStage("sim");
  }

  function discardSuspended() {
    if (!confirm("Discard the suspended block? Its answers will not be scored.")) return;
    writeSuspendedBlock(null);
    setSuspended(undefined);
  }

  function finishSimulation(answerList: QuizAnswer[], meta: { startedAt: string; elapsedSeconds: number }) {
    if (!simRun) return;
    const result: QuizSession = {
      id: crypto.randomUUID(),
      mode,
      startedAt: meta.startedAt,
      endedAt: new Date().toISOString(),
      timed: simRun.timeLimitSeconds !== undefined,
      timeLimitSeconds: simRun.timeLimitSeconds,
      filters: currentFilters(),
      questionIds: simRun.pool.map((q) => q.id),
      answers: answerList,
      score: scoreSession(answerList),
      simulation: { skin: simRun.skin, preset: simRun.resume ? undefined : presetId, elapsedSeconds: meta.elapsedSeconds },
    };
    for (const a of answerList) {
      if (!a.answerKey && !a.flagged) continue;
      s.recordQuestionAttempt(a.questionId, {
        answerKey: a.answerKey,
        status: a.correct === undefined ? "needs-review" : a.correct ? "correct" : "incorrect",
        timeSpentSeconds: a.seconds,
      });
    }
    s.saveQuizSession(result);
    writeSuspendedBlock(null);
    setSuspended(undefined);
    setPool(simRun.pool);
    setSession(result);
    setSimRun(null);
    setStage("results");
  }

  function suspendSimulation(block: SuspendedBlock) {
    writeSuspendedBlock(block);
    setSuspended(block);
    const counts = blockCounts(block.poolIds, block.items);
    pushToast({
      title: "Block suspended",
      body: `${counts.answered}/${counts.total} answered${block.timeLimitSeconds ? ` · ${formatClock(block.timeLimitSeconds - block.elapsedMs / 1000)} left` : ""}. Resume it from block setup.`,
      tone: "success",
    });
    onClose();
  }

  function toggleFlag() {
    if (!question) return;
    const existing = answers.get(question.id);
    setAnswers((prev) => new Map(prev).set(question.id, {
      questionId: question.id,
      answerKey: existing?.answerKey,
      correct: existing?.correct,
      flagged: !(existing?.flagged ?? false),
      seconds: existing?.seconds,
    }));
    s.updateQuestion(question.id, { marked: !(existing?.flagged ?? false) });
  }

  function makeRepairCard(q: QuestionRecord) {
    const correctKey = trustedCorrectKey(q);
    const correct = q.options.find((o) => o.key === correctKey);
    const result = s.addAnkiCards([{
      type: "error-repair",
      front: `You missed this: ${q.stem.slice(0, 300)}${q.stem.length > 300 ? "…" : ""}`,
      back: [
        correct ? `Correct: ${correct.key}. ${correct.text}` : "Set the correct answer on the question first.",
        q.explanation ?? "",
      ].filter(Boolean).join("\n\n"),
      source: q.citation ?? q.bank ?? "Question bank",
      tags: ["error-repair", ...(q.category ? [q.category] : []), ...(q.topic ? [q.topic] : [])],
      questionId: q.id,
      aiGenerated: false,
      schedule: newSchedule(),
    }]);
    pushToast(result.saved
      ? { title: "Repair card created", body: "Due now in the Anki Lab review queue.", tone: "success" }
      : { title: "Couldn't create card", body: result.errors.join(" "), tone: "warn" });
  }

  function createMissedReviewSet(questionIds: string[]) {
    if (!questionIds.length || reviewSetCreated) return;
    const createdAt = new Date().toISOString();
    s.addQuestionSet({
      id: crypto.randomUUID(),
      title: `Missed review — ${new Date(createdAt).toLocaleDateString()}`,
      sourceDocumentIds: [],
      createdAt,
      questionIds: [...questionIds],
      tags: ["missed-review"],
      aiEnhanced: false,
      parserWarnings: [],
      ordering: "import",
    });
    setReviewSetCreated(true);
    pushToast({ title: "Review set created", body: `${questionIds.length} missed question${questionIds.length === 1 ? "" : "s"} saved as a fixed Question Set.`, tone: "success" });
  }

  function addMissedTopicsToTracker(questionIds: string[]) {
    if (!questionIds.length || trackerReviewAdded) return;
    const topics = [...new Set(questionIds.flatMap((id) => {
      const item = questions.find((candidate) => candidate.id === id);
      return item ? [item.topic, item.category].filter((value): value is string => Boolean(value?.trim())) : [];
    }))];
    const existing = new Set(s.tracker.map((item) => `${item.path}|${item.label}`.toLowerCase()));
    const items = topics.flatMap((topic) => {
      const item = { path: "Question Bank/Review", label: `Review ${topic}`, kind: "Review Loop" as const, passes: 0, ankiPasses: 0, yield: "review" as const, note: "Created from missed Question Bank results." };
      return existing.has(`${item.path}|${item.label}`.toLowerCase()) ? [] : [item];
    });
    if (!items.length) {
      pushToast({ title: topics.length ? "Review topics already tracked" : "No topic labels available", body: topics.length ? "Nothing new was added." : "Add a topic or category to these questions before creating Tracker review work.", tone: "warn" });
      return;
    }
    s.bulkAddTrackerItems(items);
    setTrackerReviewAdded(true);
    pushToast({ title: "Review work added", body: `${items.length} weak topic${items.length === 1 ? "" : "s"} added under Question Bank/Review.`, tone: "success" });
  }

  async function runAi(kind: "simple" | "why-wrong" | "hook") {
    if (!provider || !question) return;
    setAiBusy(true);
    setAiText(null);
    try {
      const correctKey = trustedCorrectKey(question);
      const correct = question.options.find((o) => o.key === correctKey)?.text;
      const text = kind === "simple"
        ? await explainSimply(provider, { stem: question.stem, correct, explanation: question.explanation })
        : kind === "why-wrong"
          ? await explainWhyWrong(provider, { stem: question.stem, picked: picked ?? "?", correct })
          : await memoryHook(provider, { stem: question.stem, correct });
      setAiText(`${provider.info.local ? "" : ""}${text}`);
    } catch (err) {
      pushToast({ title: "AI request failed", body: err instanceof Error ? err.message : "Unknown error.", tone: "warn" });
    } finally {
      setAiBusy(false);
    }
  }

  function flagExtractionIssue(kind: "answer" | "explanation") {
    if (!question) return;
    const warning = kind === "answer"
      ? "User marked the mapped answer as wrong."
      : "User marked the extracted explanation as wrong.";
    const previous = question.extraction;
    s.updateQuestion(question.id, {
      needsReview: true,
      status: "needs-review",
      extraction: {
        confidence: "low",
        reviewed: false,
        ...previous,
        answerDetectionConfidence: kind === "answer" ? 0 : previous?.answerDetectionConfidence,
        explanationDetectionConfidence: kind === "explanation" ? 0 : previous?.explanationDetectionConfidence,
        overallImportConfidence: Math.min(previous?.overallImportConfidence ?? 0.35, 0.35),
        warnings: [...new Set([...(previous?.warnings ?? []), warning])],
      },
    });
    pushToast({ title: "Added to mapping review", body: warning, tone: "warn" });
  }

  // ------------------------------------------------------------------ render

  if (stage === "setup") {
    return (
      <Modal title={mode === "exam" ? "Set up an exam block" : "Set up a tutor block"} onClose={onClose}
        footer={
          <>
            <GhostButton onClick={saveAsBlock}>Save as block</GhostButton>
            <GButton variant="primary" onClick={begin}><Play size={ICON_SIZE.body} /> Start {mode} block</GButton>
          </>
        }>
        {suspended && (
          <div className="sim-suspended-banner" role="status">
            <div>
              <b>Suspended block · {EXAM_SKINS[suspended.skin].label}</b>
              <span className="sub">
                {(() => { const c = blockCounts(suspended.poolIds, suspended.items); return `${c.answered}/${c.total} answered · ${c.marked} marked`; })()}
                {suspended.timeLimitSeconds ? ` · ${formatClock(suspended.timeLimitSeconds - suspended.elapsedMs / 1000)} left` : ""}
                {` · suspended ${new Date(suspended.suspendedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`}
              </span>
            </div>
            <div className="row gap6">
              <GhostButton onClick={discardSuspended}>Discard</GhostButton>
              <GButton size="sm" variant="primary" onClick={resumeSuspended}><Play size={ICON_SIZE.body} /> Resume</GButton>
            </div>
          </div>
        )}
        <div className="stack gap6">
          <span className="field-label">Interface</span>
          <div className="sim-interface-grid" role="radiogroup" aria-label="Exam interface">
            {([["axom", "AXOM", "Tutor tools, AI help and repair cards in the AXOM player."], ...Object.entries(EXAM_SKINS).map(([id, meta]) => [id, meta.label, meta.description])] as Array<[ExamInterface, string, string]>).map(([id, label, description]) => (
              <button type="button" key={id} role="radio" aria-checked={examInterface === id} className={`sim-interface-option skin-${id} ${examInterface === id ? "on" : ""}`} onClick={() => chooseInterface(id)}>
                <b>{label}</b><small>{description}</small>
              </button>
            ))}
          </div>
        </div>
        {examInterface !== "axom" && (
          <div className="stack gap6">
            <span className="field-label">Block</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Block preset">
              {BLOCK_PRESETS.map((preset) => (
                <button type="button" key={preset.id} className={`filter-pill ${presetId === preset.id ? "on" : ""}`} aria-pressed={presetId === preset.id}
                  onClick={() => choosePreset(preset)} title={preset.note}>{preset.label}{preset.items ? ` · ${preset.items}` : ""}</button>
              ))}
            </div>
            <span className="sub">{BLOCK_PRESETS.find((preset) => preset.id === presetId)?.note}</span>
          </div>
        )}
        <div className="row" style={{ gap: 6 }} role="group" aria-label="Block mode">
          {(["tutor", "exam"] as QuizMode[]).map((m) => (
            <button type="button" key={m} className={`filter-pill ${mode === m ? "on" : ""}`}
              aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "tutor" ? "Tutor (feedback per question)" : "Exam (feedback at the end)"}
            </button>
          ))}
        </div>
        {questionSets.length > 0 && (
          <div className="stack gap6">
            <span className="field-label">Question sets (none selected = whole bank)</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Question sets">
              {questionSets.map((qset) => (
                <button type="button" key={qset.id} className={`filter-pill ${setIds.includes(qset.id) ? "on" : ""}`}
                  aria-pressed={setIds.includes(qset.id)}
                  onClick={() => setSetIds((prev) => prev.includes(qset.id) ? prev.filter((x) => x !== qset.id) : [...prev, qset.id])}>
                  {qset.title} ({qset.questionIds.length})
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="stack gap6">
          <span className="field-label">How many questions</span>
          <div className="row" style={{ flexWrap: "wrap" }} role="group" aria-label="Question count">
            {[5, 10, 20, 40, 50].map((n) => (
              <button type="button" key={n} className={`filter-pill ${count === n ? "on" : ""}`}
                aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>
            ))}
          </div>
        </div>
        <div className="stack gap6">
          <span className="field-label">Pool</span>
          <div className="row" style={{ flexWrap: "wrap" }} role="group" aria-label="Question pool">
            {([["all", "All"], ["unused", "Unused only"], ["incorrect", "Incorrect only"], ["marked", "Marked only"]] as Array<[QuizFilters["status"], string]>).map(([v, label]) => (
              <button type="button" key={v} className={`filter-pill ${status === v ? "on" : ""}`}
                aria-pressed={status === v} onClick={() => setStatus(v)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-2">
          <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Any</option>
            {QUESTION_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectField>
          <SelectField label="Exam style" value={examType} onChange={(e) => setExamType(e.target.value as QuestionExamType | "")}>
            <option value="">Any</option>
            {EXAM_TYPES.map((t) => <option key={t} value={t}>{EXAM_TYPE_LABEL[t]}</option>)}
          </SelectField>
        </div>
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={ordered} onChange={() => setOrdered((v) => !v)} />
          <span>Keep document order (instead of shuffling)</span>
        </label>
        {(mode === "exam" || examInterface !== "axom") && (
          <label className="row" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={timed} onChange={() => setTimed((v) => !v)} />
            <span>Timed · {minutesPerQ} min per question{examInterface !== "axom" && timed ? ` (${Math.round(count * minutesPerQ)} min block)` : ""}</span>
          </label>
        )}
      </Modal>
    );
  }

  if (stage === "sim" && simRun) {
    return (
      <ExamSimulator
        skin={simRun.skin}
        mode={mode}
        pool={simRun.pool}
        timeLimitSeconds={simRun.timeLimitSeconds}
        resume={simRun.resume}
        onFinish={finishSimulation}
        onSuspend={suspendSimulation}
      />
    );
  }

  if (stage === "sim-review" && session?.simulation && session.simulation.skin in EXAM_SKINS) {
    return (
      <ExamSimulator
        skin={session.simulation.skin as ExamSkin}
        mode={session.mode}
        pool={pool}
        review={{ answers: session.answers, startedAt: session.startedAt, elapsedSeconds: session.simulation.elapsedSeconds }}
        onFinish={() => undefined}
        onSuspend={() => undefined}
        onClose={() => setStage("results")}
      />
    );
  }

  if (stage === "results" && session) {
    const missed = missedQuestionIds(session);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const retakePool = buildQuizPool(
      questions.filter((question) => missed.includes(question.id)),
      { count: Math.max(1, missed.length), status: "all", ordered: true },
    );
    return (
      <Modal title="Block results" onClose={onClose}
        footer={
          <>
            {retakePool.length > 0 && (
              <GhostButton onClick={() => {
                setPool(retakePool);
                setAnswers(new Map());
                setIndex(0);
                setSession(null);
                recordedTutorAttempts.current = new Set();
                setStartedAt(new Date().toISOString());
                setShownAt(Date.now());
                setStage("running");
              }}>Retake {retakePool.length} missed</GhostButton>
            )}
            {session.simulation && session.simulation.skin in EXAM_SKINS && (
              <GhostButton onClick={() => setStage("sim-review")}>Review in the exam interface</GhostButton>
            )}
            <GButton variant="primary" onClick={onClose}>Done</GButton>
          </>
        }>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <Tag tone={accuracyTone(session.score?.pct ?? null)}>
            {session.score?.correct}/{session.score?.scored} correct ({session.score?.pct}%)
          </Tag>
          <Tag tone="neutral">{session.mode} mode</Tag>
          {session.simulation && <Tag tone="neutral">{EXAM_SKINS[session.simulation.skin as ExamSkin]?.label ?? "Simulation"}</Tag>}
          {session.simulation?.elapsedSeconds !== undefined
            ? <Tag tone="neutral">{formatClock(session.simulation.elapsedSeconds).replace(/^00:/, "")}{session.timeLimitSeconds ? ` of ${Math.round(session.timeLimitSeconds / 60)} min` : ""}</Tag>
            : session.timed && <Tag tone="neutral">{Math.round((Date.parse(session.endedAt!) - Date.parse(session.startedAt)) / 60000)} min</Tag>}
          {session.score && session.score.total > session.score.scored && (
            <span className="sub">{session.score.total - session.score.scored} unscored (no correct answer set)</span>
          )}
        </div>
        <PacingPanel session={session} />
        <section className="quiz-results-next" aria-labelledby="quiz-results-next-heading">
          <div><b id="quiz-results-next-heading">What next?</b><span className="sub">Continue with the missed material without rebuilding the session.</span></div>
          {missed.length > 0 ? <div className="row gap8" style={{ flexWrap: "wrap" }}>
            <GButton size="sm" onClick={() => createMissedReviewSet(missed)} disabled={reviewSetCreated}><ListPlus size={ICON_SIZE.body} /> {reviewSetCreated ? "Review set created" : "Create set from missed"}</GButton>
            <GButton size="sm" onClick={() => addMissedTopicsToTracker(missed)} disabled={trackerReviewAdded}><BookOpenCheck size={ICON_SIZE.body} /> {trackerReviewAdded ? "Topics added to Tracker" : "Add weak topics to Tracker"}</GButton>
          </div> : <span className="sub">You cleared this block. Close results or start another filtered block when ready.</span>}
        </section>
        {missed.length > 0 && (
          <div className="stack gap6">
            <span className="field-label">Missed — review and repair</span>
            {missed.map((id) => {
              const q = byId.get(id);
              if (!q) return null;
              const a = session.answers.find((x) => x.questionId === id);
              return (
                <div key={id} className="import-draft">
                  <div className="stack" style={{ gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{q.stem}</span>
                    <span className="sub">You picked {a?.answerKey ?? "nothing"} · correct {trustedCorrectKey(q) ?? "unresolved"}</span>
                    {/* Import owns cleanup; display must preserve legitimate user edits. */}
                    {q.explanation && <span className="sub">{q.explanation.trim()}</span>}
                    <div className="row">
                      <GhostButton onClick={() => makeRepairCard(q)}><WandSparkles size={ICON_SIZE.body} /> Repair card</GhostButton>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {missed.length === 0 && <div className="sub">Nothing missed in this block. The pool filters decide what comes next.</div>}
      </Modal>
    );
  }

  if (!question) return null;
  const answer = answers.get(question.id);
  const correctKey = trustedCorrectKey(question);
  const isCorrect = revealed && correctKey && picked === correctKey;
  const annotations = localAnnotations;
  const stemAnnotations = annotations.filter((annotation) => annotation.target === "stem");
  const explanationAnnotations = annotations.filter((annotation) => annotation.target === "explanation");
  /** Images that are part of the question itself, shown with the stem. */
  const exhibits = (question.attachments ?? []).filter((attachment) => attachment.role === "exhibit");

  function saveAnnotation(
    selection = annotationSelection,
    tone: QuestionAnnotationTone = annotationTool?.kind === "highlight" ? annotationTool.tone : "yellow",
  ) {
    if (!selection) return;
    const sourceText = selection.target === "stem" ? question.stem : question.explanation ?? "";
    const now = new Date().toISOString();
    const result = createTextAnnotationWithIntegrity({
      id: `annotation-${crypto.randomUUID()}`,
      target: selection.target,
      sourceText,
      startOffset: selection.range.startOffset,
      endOffset: selection.range.endOffset,
      tone,
      now,
      existingAnnotations: localAnnotationsRef.current,
    });
    if (result.status !== "created") {
      setAnnotationStatus(result.status === "overlap" ? result.reason : undefined);
      return;
    }
    const next = result.annotations;
    localAnnotationsRef.current = next;
    setLocalAnnotations(next);
    setPool((current) => current.map((item) => item.id === question.id ? { ...item, annotations: next } : item));
    s.updateQuestion(question.id, { annotations: next });
    setAnnotationSelection(null);
    setAnnotationStatus("Highlight saved.");
    window.getSelection()?.removeAllRanges();
  }

  function handleAnnotationSelection(target: QuestionAnnotationTarget, range: QuestionTextSelection | null) {
    const selection = range ? { target, range } : null;
    setAnnotationSelection(selection);
    if (selection && annotationTool?.kind === "highlight") {
      saveAnnotation(selection, annotationTool.tone);
      dismissTip();
    }
  }

  function clearAnnotations() {
    if (!annotations.length) return;
    if (annotations.length > 1 && !confirm(`Clear all ${annotations.length} highlights from this question?`)) return;
    localAnnotationsRef.current = [];
    setLocalAnnotations([]);
    setPool((current) => current.map((item) => item.id === question.id ? { ...item, annotations: [] } : item));
    s.updateQuestion(question.id, { annotations: [] });
    setAnnotationSelection(null);
    setAnnotationStatus("All highlights cleared.");
  }

  function deleteAnnotation(annotationId: string) {
    const next = removeTextAnnotationById(localAnnotationsRef.current, annotationId);
    if (next.length === localAnnotationsRef.current.length) return;
    localAnnotationsRef.current = next;
    setLocalAnnotations(next);
    setPool((current) => current.map((item) => item.id === question.id ? { ...item, annotations: next } : item));
    s.updateQuestion(question.id, { annotations: next });
    setAnnotationStatus("One highlight erased.");
    dismissTip();
  }

  return (
    <Modal
      title={`${mode === "exam" ? "Exam" : "Tutor"} · ${index + 1} of ${pool.length}`}
      className="quiz-player-modal"
      bodyClassName="quiz-player-body"
      onClose={() => { if (confirm("Leave this block? Progress in unanswered questions is discarded.")) { clearActiveQuiz(); onClose(); } }}
      footer={
        mode === "tutor"
          ? (
            <>
              <GhostButton disabled={index === 0} onClick={goPrevious}><ChevronLeft size={ICON_SIZE.body} /> Previous</GhostButton>
              <GhostButton onClick={toggleFlag} aria-label="Flag question" aria-pressed={answer?.flagged ?? false}>
                <Flag size={ICON_SIZE.body} /> {answer?.flagged ? "Flagged" : "Mark review"}
              </GhostButton>
              {!revealed
                ? <GButton variant="primary" disabled={!picked} onClick={submitTutor}>Check answer</GButton>
                : <GButton variant="primary" onClick={nextQuestion}>{index + 1 >= pool.length ? "Finish block" : "Next question"}</GButton>}
            </>
          )
          : (
            <>
              <GhostButton disabled={index === 0} onClick={goPrevious}><ChevronLeft size={ICON_SIZE.body} /> Previous</GhostButton>
              <GhostButton onClick={() => finishBlock()}>End block</GhostButton>
              <GButton variant="primary" disabled={!picked} onClick={submitExamAndNext}>
                {index + 1 >= pool.length ? "Submit & finish" : "Submit & next"}
              </GButton>
            </>
          )
      }
    >
      <div className="quiz-progress" aria-hidden="true">
        <span className="quiz-progress-fill" style={{ width: `${Math.round(((index + (revealed ? 1 : 0)) / pool.length) * 100)}%` }} />
      </div>
      <main className={`tutor-workspace-shell ${activePanel ? "panel-open" : ""}`} aria-label="Tutor question workspace">
      <section className="tutor-question-region" aria-labelledby="tutor-question-heading">
      <h2 id="tutor-question-heading" className="sr-only">Question {index + 1} of {pool.length}</h2>
      <div className="tutor-question-meta">
        {timed && timeLeft !== undefined && (
          <Tag tone={timeLeft < 60 ? "red" : "neutral"}>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")} left</Tag>
        )}
        {question.category && <Tag tone="neutral">{question.category}</Tag>}
        {question.examType && <Tag tone="neutral">{EXAM_TYPE_LABEL[question.examType]}</Tag>}
        {question.sourcePage && <Tag tone="neutral">p.{question.sourcePage}</Tag>}
        {question.bank && <span className="sub truncate" style={{ maxWidth: 200 }}>{question.bank}</span>}
        {struck.size > 0 && (
          <GhostButton className="quiz-tool" onClick={() => setStruck(new Set())} aria-label="Reset eliminations">
            <RotateCcw size={ICON_SIZE.microInline} /> Reset eliminations
          </GhostButton>
        )}
      </div>

      <div className="quiz-reading" style={{ "--quiz-reading-scale": readingScale } as CSSProperties}>
        <AnnotatedQuestionText
          text={question.stem}
          annotations={stemAnnotations}
          className="question-stem"
          label="Question stem"
          onDelete={deleteAnnotation}
          eraseMode={annotationTool?.kind === "eraser"}
          focusRef={stemRef}
          onSelection={(range) => handleAnnotationSelection("stem", range)}
        />

        <QuestionExhibits attachments={exhibits} />

        <div className="tutor-answer-options">
          {question.options.map((opt) => {
            const isPicked = picked === opt.key;
            const showCorrect = revealed && correctKey === opt.key;
            const showWrong = revealed && isPicked && Boolean(correctKey) && correctKey !== opt.key;
            const isStruck = struck.has(opt.key);
            return (
              <div key={opt.key}
                className={`option-row ${isPicked ? "picked" : ""} ${showCorrect ? "correct" : ""} ${showWrong ? "wrong" : ""} ${isStruck ? "struck" : ""}`}>
                <button type="button" className="option-pick"
                  aria-label={`${opt.key}. ${opt.text}`}
                  aria-pressed={isPicked}
                  disabled={revealed}
                  onClick={() => setPicked(opt.key)}>
                  <span className="mono option-key">{opt.key}</span>
                  <span className="option-text">{opt.text}</span>
                </button>
                {/* Once revealed: a tick on the right answer, a cross on a wrong pick. Never a tick on the pick itself. */}
                {showCorrect ? <span className="option-result ok" role="img" aria-label="Correct answer"><Check size={ICON_SIZE.emphasis} /></span>
                  : showWrong ? <span className="option-result bad" role="img" aria-label="Your answer (incorrect)"><X size={ICON_SIZE.emphasis} /></span>
                  : (
                    <button type="button" className="option-strike"
                      aria-label={`${isStruck ? "Restore" : "Eliminate"} option ${opt.key}`}
                      aria-pressed={isStruck}
                      disabled={revealed}
                      onClick={() => toggleStrike(opt.key)}>
                      <Minus size={ICON_SIZE.body} />
                    </button>
                  )}
              </div>
            );
          })}
        </div>
      </div>

      {mode === "tutor" && revealed && (
        <>
          <QuizFeedback
            question={question}
            pickedKey={picked}
            onRepairCard={!isCorrect ? () => makeRepairCard(question) : undefined}
            onAddReview={() => s.updateQuestion(question.id, { marked: true })}
            onMarkExplanationWrong={() => flagExtractionIssue("explanation")}
            onMarkAnswerWrong={() => flagExtractionIssue("answer")}
            onEditMapping={() => setEditingMapping((value) => !value)}
            explanationContent={question.explanation ? (
              <AnnotatedQuestionText
                text={question.explanation.trim()}
                annotations={explanationAnnotations}
                className="question-explanation-text"
                label="Question explanation"
                onDelete={deleteAnnotation}
                eraseMode={annotationTool?.kind === "eraser"}
                inline
                onSelection={(range) => handleAnnotationSelection("explanation", range)}
              />
            ) : undefined}
          />
          {editingMapping && (
            <SelectField label="Repair correct-answer mapping" value={question.correctKey ?? ""}
              onChange={(event) => {
                s.updateQuestion(question.id, {
                  correctKey: event.target.value || undefined,
                  needsReview: !event.target.value,
                  extraction: question.extraction ? {
                    ...question.extraction,
                    reviewed: Boolean(event.target.value),
                    reviewedAt: event.target.value ? new Date().toISOString() : undefined,
                    answerDetectionConfidence: event.target.value ? 1 : 0,
                  } : undefined,
                });
                setEditingMapping(false);
              }}>
              <option value="">No reliable answer</option>
              {question.options.map((option) => <option key={option.key} value={option.key}>{option.key}. {option.text}</option>)}
            </SelectField>
          )}
          {question.choiceRationales && Object.keys(question.choiceRationales).length > 0 && (() => {
            const rationales = question.choiceRationales!;
            const correctWhy = correctKey ? rationales[correctKey] : undefined;
            const pickedWhy = picked && picked !== correctKey ? rationales[picked] : undefined;
            const others = Object.entries(rationales).filter(([key]) => key !== correctKey && key !== picked);
            return (
              <div className="stack gap6 choice-rationales">
                {/* Lead with what the learner most needs: why the correct answer
                    is right, then why their own pick was wrong; the remaining
                    distractors collapse so they never bury the key point. */}
                {correctWhy && (
                  <div className="rationale-lead">
                    <b className="grade-green">Why {correctKey} is correct</b>
                    <p>{correctWhy}</p>
                  </div>
                )}
                {pickedWhy && (
                  <div className="rationale-lead">
                    <b className="grade-red">Why your choice ({picked}) is wrong</b>
                    <p>{pickedWhy}</p>
                  </div>
                )}
                {others.length > 0 && (
                  <details className="rationale-others">
                    <summary>Why the other choices are wrong</summary>
                    <div className="stack gap6">
                      {others.map(([key, why]) => (
                        <div key={key} className="sub"><b>{key}:</b> {why}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })()}
          {!isCorrect && correctKey && (
            <>
              <SelectField label="Why did this go wrong?" value={errorType}
                onChange={(e) => setErrorType(e.target.value as QuestionErrorType | "")}>
                <option value="">Pick an error type (recommended)</option>
                {ERROR_TYPES.map((t) => <option key={t} value={t}>{ERROR_TYPE_LABEL[t]}</option>)}
              </SelectField>
              <div className="stack gap6">
                <span className="field-label">Confidence in this material now (press 1–5)</span>
                <div className="row" role="group" aria-label="Confidence in this material">
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <button type="button" key={n} className={`filter-pill ${confidence === n ? "on" : ""}`}
                      aria-label={`Confidence ${n} of 5`} aria-pressed={confidence === n}
                      onClick={() => setConfidence(n)}>{n}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {provider && (
              <>
                <GhostButton disabled={aiBusy} onClick={() => runAi("simple")}><Sparkles size={ICON_SIZE.body} /> Explain simply</GhostButton>
                {!isCorrect && picked && <GhostButton disabled={aiBusy} onClick={() => runAi("why-wrong")}><Sparkles size={ICON_SIZE.body} /> Why was I wrong?</GhostButton>}
                <GhostButton disabled={aiBusy} onClick={() => runAi("hook")}><Sparkles size={ICON_SIZE.body} /> Memory hook</GhostButton>
              </>
            )}
          </div>
          {aiBusy && <div className="sub">Thinking locally…</div>}
          {aiText && (
            <div className="question-explanation">
              <b>{provider?.info.label}:</b> {aiText}
            </div>
          )}
          <QuestionAttachmentsPanel
            questionId={question.id}
            attachments={(question.attachments ?? []).filter((attachment) => attachment.role !== "exhibit")}
            onChange={(noteImages) => {
              // The question's own exhibits stay with the stem; this panel manages note images only.
              const next = [...exhibits, ...noteImages];
              const value = next.length ? next : undefined;
              setPool((current) => current.map((item) => item.id === question.id ? { ...item, attachments: value } : item));
              s.updateQuestion(question.id, { attachments: value });
            }}
          />
        </>
      )}
      </section>
      <TutorUtilityDock
        activePanel={activePanel}
        setActivePanel={(panel) => {
          setActivePanel(panel);
          if (panel && panel !== "help") dismissTip();
        }}
        annotationTool={annotationTool}
        setAnnotationTool={(tool) => {
          setAnnotationTool(tool);
          if (tool) dismissTip();
          setAnnotationStatus(tool?.kind === "highlight" ? `${tool.tone} highlight mode active.` : tool?.kind === "eraser" ? "Eraser mode active." : "Annotation tool off.");
        }}
        annotationStatus={annotationStatus}
        hasAnnotations={annotations.length > 0}
        onClearAnnotations={clearAnnotations}
        questionId={question.id}
        note={question.notes}
        onSaveNote={(notesValue) => {
          const trimmed = notesValue.trim() || undefined;
          setPool((current) => current.map((item) => item.id === question.id ? { ...item, notes: trimmed } : item));
          s.updateQuestion(question.id, { notes: trimmed });
        }}
        calculator={calculatorValue}
        onCalculatorChange={setCalculatorValue}
        readingScale={readingScale}
        readingScaleMin={READING_SCALE_MIN}
        readingScaleMax={READING_SCALE_MAX}
        onReadingScale={adjustReadingScale}
        onResetReadingScale={resetReadingScale}
        tipVisible={tipVisible}
        onDismissTip={dismissTip}
        onResetTips={resetTips}
      />
      </main>
    </Modal>
  );
}

/** Per-question pacing from the seconds recorded while answering. */
function PacingPanel({ session }: { session: QuizSession }) {
  const summary = summarizePacing(session);
  if (!summary) return null;
  const max = Math.max(summary.targetSeconds, ...summary.questions.map((question) => question.seconds));
  return (
    <section className="quiz-pacing" aria-labelledby="quiz-pacing-heading">
      <div className="quiz-pacing-head">
        <b id="quiz-pacing-heading"><Timer size={ICON_SIZE.body} aria-hidden="true" /> Pacing</b>
        <span className="sub">{pacingInsight(summary)}</span>
      </div>
      <div className="quiz-pacing-stats">
        <span><b>{formatSeconds(summary.averageSeconds)}</b><small>average</small></span>
        <span><b>{formatSeconds(summary.medianSeconds)}</b><small>median</small></span>
        <span><b>{summary.overTarget}/{summary.measured}</b><small>over {formatSeconds(summary.targetSeconds)}{summary.timed ? "" : " (typical exam pace)"}</small></span>
        <span><b>{summary.slowest.map((question) => `Q${question.position}`).join(", ")}</b><small>slowest</small></span>
      </div>
      <div className="quiz-pacing-strip" role="img" aria-label={`Seconds per question: ${summary.questions.map((question) => `Q${question.position} ${question.seconds}s`).join(", ")}`}>
        <i className="quiz-pacing-target" style={{ bottom: `${(summary.targetSeconds / max) * 100}%` }} />
        {summary.questions.map((question) => (
          <span
            key={question.questionId}
            className={`${question.overTarget ? "over" : ""} ${question.correct === false ? "wrong" : question.correct ? "right" : ""}`}
            style={{ height: `${Math.max(4, (question.seconds / max) * 100)}%` }}
            title={`Q${question.position}: ${formatSeconds(question.seconds)}${question.correct === undefined ? "" : question.correct ? " · correct" : " · missed"}`}
          />
        ))}
      </div>
    </section>
  );
}
