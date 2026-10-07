// ===========================================================================
// One exam block, running. The React side of lib/exam/engine: it owns the
// block (through the reducer), the wall clock, the store writes (flags and
// highlights live on the question) and the keys every interface shares. Each
// interface (UWorld / NBME in ExamSimulator, Examplify in ExamplifyExam) is a
// renderer over what this returns, so none of them can record an answer, a
// flag or a second differently from the others.
// ===========================================================================
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react";
import type { QuestionRecord } from "../../lib/questions";
import { questionMappingStatus } from "../../lib/questions";
import type { QuizAnswer } from "../../lib/quiz";
import { useStore } from "../../lib/store";
import { readExamSimPrefs, writeExamSimPrefs, type ExamSimPrefs, type ExamSkin, type ReviewFilter, type SuspendedBlock } from "../../lib/examSim";
import {
  blockAnswers, countBlock, elapsedSeconds as blockElapsedSeconds, examReducer, itemSeconds, itemState, navigatorEntries, resumeBlock,
  reviewBlock, shownResult, startBlock, suspendBlock, type BlockCounts, type ExamBlock, type ItemResult, type ItemState, type NavigatorEntry,
} from "../../lib/exam/engine";
import { EXAM_PROFILES, matchesAnyChord, type ExamProfile } from "../../lib/exam/profiles";
import { createTextAnnotationWithIntegrity, removeTextAnnotationById, type QuestionTextAnnotation } from "../../lib/questionAnnotations";

/** The key AXOM trusts for scoring: only a question whose answer mapping is confirmed has one. */
export function trustedKey(question: QuestionRecord | undefined): string | undefined {
  return question && questionMappingStatus(question) === "ready" ? question.correctKey : undefined;
}

export interface FinishedBlock {
  answers: readonly QuizAnswer[];
  startedAt: string;
  elapsedSeconds?: number;
}

export interface ExamBlockOptions {
  skin: ExamSkin;
  mode: "exam" | "tutor";
  pool: QuestionRecord[];
  timeLimitSeconds?: number;
  resume?: SuspendedBlock;
  /** A finished block to read through: nothing can change and every result is shown. */
  review?: FinishedBlock;
  onFinish: (answers: QuizAnswer[], meta: { startedAt: string; elapsedSeconds: number }) => void;
  onSuspend: (block: SuspendedBlock) => void;
}

export type AnnotationTool = "highlight" | "erase" | null;

export interface ExamBlockApi {
  profile: ExamProfile;
  block: ExamBlock;
  pool: QuestionRecord[];
  /** True while a finished block is being read through. */
  reviewing: boolean;
  question: QuestionRecord | undefined;
  index: number;
  item: ItemState;
  counts: BlockCounts;
  entries: NavigatorEntry[];
  /** The trusted key of the item on screen, and whether its result may be shown. */
  correctKey: string | undefined;
  revealed: boolean;
  result: ItemResult | undefined;
  /** Whole seconds spent on the item on screen. */
  seconds: number;
  elapsedSeconds: number;
  /** Seconds left in a timed block; undefined when untimed. */
  remaining: number | undefined;
  lowTime: boolean;
  /** The five-minute warning is showing. */
  alarm: boolean;
  dismissAlarm: () => void;

  go: (index: number) => void;
  next: () => void;
  previous: () => void;
  pick: (key: string) => void;
  strike: (key: string) => void;
  mark: () => void;
  reveal: () => void;
  setNotes: (text: string) => void;

  /** How ending is going: nothing, the confirmation, or the item review screen with a filter. */
  confirmEnd: boolean;
  setConfirmEnd: (open: boolean) => void;
  itemReview: ReviewFilter | null;
  setItemReview: (filter: ReviewFilter | null) => void;
  requestEnd: () => void;
  finish: () => void;
  suspend: () => void;

  prefs: ExamSimPrefs;
  setPrefs: (patch: Partial<ExamSimPrefs>) => void;
  tool: AnnotationTool;
  setTool: (tool: AnnotationTool | ((current: AnnotationTool) => AnnotationTool)) => void;
  annotations: QuestionTextAnnotation[];
  onSelection: (range: { startOffset: number; endOffset: number } | null) => void;
  onDeleteAnnotation: (annotationId: string) => void;

  /** Keys every interface shares (move, flag, choose, strike, tutor submit). True when the key was used. */
  handleKey: (event: KeyboardEvent) => boolean;
  rootRef: RefObject<HTMLDivElement>;
  stemRef: RefObject<HTMLDivElement | null>;
}

export function useExamBlock({ skin, mode, pool, timeLimitSeconds, resume, review, onFinish, onSuspend }: ExamBlockOptions): ExamBlockApi {
  const profile = EXAM_PROFILES[skin];
  const updateQuestion = useStore((s) => s.updateQuestion);
  const ids = useMemo(() => pool.map((question) => question.id), [pool]);
  const byId = useMemo(() => new Map(pool.map((question) => [question.id, question])), [pool]);
  const correctKeyFor = useCallback((id: string) => trustedKey(byId.get(id)), [byId]);

  const [block, dispatch] = useReducer(examReducer, undefined, () => {
    if (review) return reviewBlock({ ids, answers: review.answers, mode, startedAt: review.startedAt, elapsedSeconds: review.elapsedSeconds });
    return resume ? resumeBlock(resume, ids, Date.now()) : startBlock({ ids, mode, now: Date.now() });
  });
  const [now, setNow] = useState(() => Date.now());
  const [prefs, setPrefsState] = useState<ExamSimPrefs>(() => readExamSimPrefs());
  const [tool, setTool] = useState<AnnotationTool>(profile.highlighter === "always" ? "highlight" : null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [itemReview, setItemReview] = useState<ReviewFilter | null>(null);
  const [alarm, setAlarm] = useState(false);
  const [annotationsById, setAnnotationsById] = useState<Record<string, QuestionTextAnnotation[]>>(() => Object.fromEntries(pool.map((q) => [q.id, q.annotations ?? []])));
  const alerted = useRef(false);
  const finished = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stemRef = useRef<HTMLDivElement | null>(null);

  const reviewing = block.phase === "review";
  const index = block.index;
  const question = pool[index];
  const item = itemState(block, question?.id);
  const counts = countBlock(block);
  const entries = useMemo(() => navigatorEntries(block, correctKeyFor), [block, correctKeyFor]);
  const correctKey = trustedKey(question);
  const result = question ? shownResult(block, question.id, correctKey) : undefined;
  const revealed = result !== undefined;
  const elapsed = blockElapsedSeconds(block, now);
  const remaining = timeLimitSeconds !== undefined && !reviewing ? Math.max(0, timeLimitSeconds - elapsed) : undefined;
  const lowTime = remaining !== undefined && remaining <= 300;

  const setPrefs = useCallback((patch: Partial<ExamSimPrefs>) => setPrefsState((current) => {
    const next = { ...current, ...patch };
    writeExamSimPrefs(next);
    return next;
  }), []);

  // Exam focus: hide AXOM's own overlays (dock, toasts, check-ins) while the block is open.
  useEffect(() => {
    document.body.classList.add("exam-sim-active");
    rootRef.current?.focus();
    return () => document.body.classList.remove("exam-sim-active");
  }, []);

  useEffect(() => {
    if (reviewing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [reviewing]);

  // An item's time only runs while it can be seen (lib/exam/questionTime, rule 4).
  useEffect(() => {
    const onVisibility = () => dispatch({ type: document.hidden ? "hide" : "show", now: Date.now() });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // A new item on screen: read from its top, with the stem in focus.
  useEffect(() => {
    stemRef.current?.focus({ preventScroll: true });
    const body = rootRef.current?.querySelector<HTMLElement>("[data-exam-scroll]");
    if (body) body.scrollTop = 0;
  }, [index]);

  const finish = useCallback(() => {
    if (finished.current || reviewing) return;
    finished.current = true;
    const at = Date.now();
    onFinish(blockAnswers(block, at, correctKeyFor), { startedAt: block.startedAt, elapsedSeconds: blockElapsedSeconds(block, at) });
  }, [block, correctKeyFor, onFinish, reviewing]);

  const suspend = useCallback(() => {
    if (finished.current || reviewing) return;
    finished.current = true;
    onSuspend(suspendBlock(block, Date.now(), { skin, timeLimitSeconds }));
  }, [block, onSuspend, reviewing, skin, timeLimitSeconds]);

  // Time is up: the block ends, exactly like the real thing.
  useEffect(() => {
    if (remaining === 0) finish();
    if (remaining !== undefined && remaining <= 300 && remaining > 0 && prefs.fiveMinuteAlert && !alerted.current && (timeLimitSeconds ?? 0) > 600) {
      alerted.current = true;
      setAlarm(true);
    }
  }, [remaining, finish, prefs.fiveMinuteAlert, timeLimitSeconds]);

  const requestEnd = useCallback(() => {
    if (reviewing) return;
    if (profile.ending === "item-review") setItemReview("all");
    else setConfirmEnd(true);
  }, [profile.ending, reviewing]);

  const go = useCallback((target: number) => dispatch({ type: "go", index: target, now: Date.now() }), []);
  const next = useCallback(() => {
    if (index + 1 < ids.length) go(index + 1);
    else requestEnd();
  }, [go, ids.length, index, requestEnd]);
  const previous = useCallback(() => go(index - 1), [go, index]);
  const pick = useCallback((key: string) => dispatch({ type: "pick", key, toggle: profile.repickClears }), [profile.repickClears]);
  const strike = useCallback((key: string) => dispatch({ type: "strike", key }), []);
  const reveal = useCallback(() => dispatch({ type: "reveal", now: Date.now() }), []);
  const setNotes = useCallback((text: string) => dispatch({ type: "note", text }), []);
  const mark = useCallback(() => {
    if (!question || reviewing) return;
    dispatch({ type: "mark" });
    // A flag belongs to the question, so it is there in the bank after the block.
    updateQuestion(question.id, { marked: !item.marked });
  }, [item.marked, question, reviewing, updateQuestion]);

  // --- highlighting (persists on the question, like the rest of AXOM) -----------
  const annotations = useMemo(() => (question ? (annotationsById[question.id] ?? []).filter((annotation) => annotation.target === "stem") : []), [annotationsById, question]);
  const onSelection = useCallback((range: { startOffset: number; endOffset: number } | null) => {
    if (!question || !range || tool !== "highlight") return;
    const created = createTextAnnotationWithIntegrity({
      id: `annotation-${crypto.randomUUID()}`,
      target: "stem",
      sourceText: question.stem,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      tone: prefs.highlightColor,
      now: new Date().toISOString(),
      existingAnnotations: annotationsById[question.id] ?? [],
    });
    if (created.status !== "created") return;
    setAnnotationsById((current) => ({ ...current, [question.id]: created.annotations }));
    updateQuestion(question.id, { annotations: created.annotations });
    window.getSelection()?.removeAllRanges();
  }, [annotationsById, prefs.highlightColor, question, tool, updateQuestion]);
  const onDeleteAnnotation = useCallback((annotationId: string) => {
    if (!question) return;
    const remaining = removeTextAnnotationById(annotationsById[question.id] ?? [], annotationId);
    setAnnotationsById((current) => ({ ...current, [question.id]: remaining }));
    updateQuestion(question.id, { annotations: remaining });
  }, [annotationsById, question, updateQuestion]);

  const handleKey = useCallback((event: KeyboardEvent): boolean => {
    if (matchesAnyChord(event, profile.keys.next)) { next(); return true; }
    if (matchesAnyChord(event, profile.keys.previous)) { previous(); return true; }
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (matchesAnyChord(event, profile.keys.flag)) { mark(); return true; }
    if (event.key === "Enter" && mode === "tutor" && !reviewing) {
      if (revealed) next(); else reveal();
      return true;
    }
    const letter = event.key.toUpperCase();
    if (/^[A-J]$/.test(letter) && question?.options.some((option) => option.key === letter)) {
      if (event.shiftKey) strike(letter); else pick(letter);
      return true;
    }
    return false;
  }, [mark, mode, next, pick, previous, profile.keys, question, reveal, revealed, reviewing, strike]);

  return {
    profile, block, pool, reviewing, question, index, item, counts, entries, correctKey, revealed, result,
    seconds: question ? itemSeconds(block, question.id, now) : 0,
    elapsedSeconds: elapsed, remaining, lowTime,
    alarm, dismissAlarm: () => setAlarm(false),
    go, next, previous, pick, strike, mark, reveal, setNotes,
    confirmEnd, setConfirmEnd, itemReview, setItemReview, requestEnd, finish, suspend,
    prefs, setPrefs, tool, setTool, annotations, onSelection, onDeleteAnnotation,
    handleKey, rootRef, stemRef,
  };
}
