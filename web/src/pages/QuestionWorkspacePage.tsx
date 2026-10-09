// ===========================================================================
// Question Bank — the flagship study engine. Import Center → Source Library →
// Question Sets → Block Builder → Results, in one tabbed surface. Uploaded
// files become reusable question ecosystems: parse → review → save → block →
// results → weakness intelligence.
// ===========================================================================
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle, BarChart3, BookOpen, FileInput, Files, ListFilter,
  Microscope, Play, RotateCcw, Sparkles, HelpCircle, MonitorPlay } from "lucide-react";
import { useStore } from "../lib/store";
import {
  analyzeQuestionStyle, dueQuestions, errorPatterns, questionCollectionMetrics,
  questionMappingStatus, summarizeQuestionMappings, weakTopics,
  ERROR_TYPE_LABEL,
  type QuestionRecord,
} from "../lib/questions";
import type { QuizBlock, QuizFilters, QuizMode } from "../lib/quiz";
import type { QuestionSet, SourceDocument } from "../lib/library";
import { GlassCard, PanelHeader, EmptyState } from "../components/ui/primitives";
import { ImportPanel, parseStoredDocument, type ImportSeed } from "../components/questions/ImportPanel";
import { ExamRunner } from "../components/questions/ExamRunner";
import { EXAM_SKINS, blockCounts, readSuspendedBlock } from "../lib/examSim";
import { PerformancePanel } from "../components/questions/PerformancePanel";
import { AnalysisPanel } from "../components/questions/AnalysisPanel";
import { QuestionDetailModal } from "../components/questions/QuestionDetailModal";
import { SourceLibrary, QuestionSetList } from "../components/questions/LibraryPanels";
import { BlockBuilder } from "../components/questions/BlockBuilder";
import { QuestionBankLibrary } from "../components/questions/QuestionBankLibrary";
import type { BankLocation } from "../components/questions/CourseBankBrowser";
import { BankBrowser } from "../components/questions/BankBrowser";
import { AxomBrandLockup } from "../components/ui/BrandMark";
import { coachWeakness, resolveActiveProvider } from "../lib/ai";
import { pushToast } from "../lib/toast";
import { ModuleTour, type ModuleTourStep } from "../components/shell/ModuleTour";
import { ICON_SIZE } from "../lib/iconSize";
import { STORAGE_KEYS } from "../lib/brand";

const NO_QUESTIONS: QuestionRecord[] = [];
const NO_SETS: QuestionSet[] = [];
const NO_DOCUMENTS: SourceDocument[] = [];

export const QUESTION_BANK_TOUR_STEPS: readonly ModuleTourStep[] = [
  { target: "qb-import", title: "Import", body: "Bring in a supported file or paste question text. Saving a source first is always available when you want to review it later." },
  { target: "qb-mappings", title: "Inspect mappings", body: "AXOM separates supported answers from uncertain ones. Inspect only the mappings that need a decision before trusting them in practice." },
  { target: "qb-practice", title: "Build or start a block", body: "Start the recommended block or open saved sets and Block Builder when you want tighter filters." },
  { target: "qb-feedback", title: "Understand feedback", body: "After an answer, feedback separates the result, explanation, and source evidence so you can repair the question without rewriting attempts." },
] as const;

type BankTab = "overview" | "import" | "sets" | "library" | "blocks" | "bank" | "insights";

const ALL_TABS: Array<[BankTab, string]> = [
  ["overview", "Command Center"],
  ["import", "Import"],
  ["sets", "Question Sets"],
  ["library", "Source Library"],
  ["blocks", "Block Builder"],
  ["bank", "Bank"],
  ["insights", "Insights"],
];

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface RunnerLaunch {
  mode: QuizMode;
  simulate?: boolean;
  retakeIds?: string[];
  presetFilters?: Partial<QuizFilters>;
  presetTimed?: boolean;
  blockId?: string;
}

export function QuestionWorkspacePage() {
  const s = useStore();
  const questions = s.questions ?? NO_QUESTIONS;
  const questionSets = s.questionSets ?? NO_SETS;
  const documents = s.documents ?? NO_DOCUMENTS;
  const [tab, setTab] = useState<BankTab>(() => questionSets.length ? "sets" : "overview");
  const [bankView, setBankView] = useState<"books" | "weeks">("books");
  const [bankLocation, setBankLocation] = useState<BankLocation>();
  const [open, setOpen] = useState<QuestionRecord | null>(null);
  const [showStyle, setShowStyle] = useState(false);
  const [runner, setRunner] = useState<RunnerLaunch | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.quizActiveSession) ?? "null") as { mode?: QuizMode; poolIds?: string[] } | null;
      return saved?.mode && saved.poolIds?.length ? { mode: saved.mode } : null;
    } catch { return null; }
  });
  const [importSeed, setImportSeed] = useState<ImportSeed | null>(null);
  const [importEntry, setImportEntry] = useState<"file" | "paste">("file");
  const [bankReview, setBankReview] = useState<{ ids?: string[]; key: number }>({ key: 0 });
  const [coach, setCoach] = useState<{ diagnosis: string; suggestedBlock: string } | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [moduleTourOpen, setModuleTourOpen] = useState(false);
  const [suspendedSim, setSuspendedSim] = useState(() => readSuspendedBlock());
  const entryRef = useRef<HTMLDivElement>(null);
  const provider = useMemo(() => resolveActiveProvider(), []);

  const isFirstUse = questionSets.length === 0 && questions.length === 0;
  const runnableQuestions = useMemo(() => questions.filter((question) =>
    question.options.length >= 2 && questionMappingStatus(question) === "ready"), [questions]);
  const due = useMemo(() => dueQuestions(runnableQuestions), [runnableQuestions]);
  const incorrect = runnableQuestions.filter((question) => question.status === "incorrect");
  const weak = useMemo(() => weakTopics(questions, 5), [questions]);
  const patterns = useMemo(() => errorPatterns(questions).slice(0, 5), [questions]);
  const style = useMemo(() => (showStyle ? analyzeQuestionStyle(questions) : null), [showStyle, questions]);
  const collectionMetrics = useMemo(() => questionCollectionMetrics(questions), [questions]);
  const mapping = useMemo(() => summarizeQuestionMappings(questions), [questions]);
  const runnable = runnableQuestions.length;
  const unseen = runnableQuestions.filter((question) => question.attempts.length === 0).length;
  const lastSession = useMemo(() => (s.quizSessions ?? [])
    .map((session, index) => ({ session, index, time: timestamp(session.startedAt) }))
    .sort((a, b) => {
      if (a.time !== undefined && b.time !== undefined) return b.time - a.time || a.index - b.index;
      if (a.time !== undefined) return -1;
      if (b.time !== undefined) return 1;
      return a.index - b.index;
    })[0]?.session, [s.quizSessions]);
  const highConfidenceMisses = questions.filter((q) =>
    q.status === "incorrect" && (q.confidence ?? 0) >= 4).length;
  const recentImprovement = useMemo(() => {
    const attempts = questions.flatMap((question) => question.attempts)
      .filter((attempt) => attempt.status === "correct" || attempt.status === "incorrect")
      .sort((a, b) => a.at.localeCompare(b.at));
    if (attempts.length < 4) return undefined;
    const size = Math.min(10, Math.floor(attempts.length / 2));
    const recent = attempts.slice(-size);
    const previous = attempts.slice(-size * 2, -size);
    const pct = (items: typeof attempts) => Math.round((items.filter((attempt) => attempt.status === "correct").length / items.length) * 100);
    return pct(recent) - pct(previous);
  }, [questions]);
  const slowest = useMemo(() => {
    const byCategory = new Map<string, { seconds: number; count: number }>();
    for (const question of questions) {
      const category = question.category ?? question.system;
      if (!category) continue;
      for (const attempt of question.attempts) {
        if (!attempt.timeSpentSeconds) continue;
        const value = byCategory.get(category) ?? { seconds: 0, count: 0 };
        value.seconds += attempt.timeSpentSeconds;
        value.count += 1;
        byCategory.set(category, value);
      }
    }
    return [...byCategory.entries()]
      .map(([category, value]) => ({ category, seconds: Math.round(value.seconds / value.count) }))
      .sort((a, b) => b.seconds - a.seconds)[0];
  }, [questions]);

  const visibleTabs = useMemo(() => {
    if (!isFirstUse) return ALL_TABS.map(([id, label]) => [id, tabLabel(id, label, questionSets.length, documents.length, questions.length, s.quizBlocks?.length ?? 0)] as [BankTab, string]);
    const tabs: Array<[BankTab, string]> = [
      ["overview", "Overview"],
      ["import", "Import"],
    ];
    if (documents.length > 0) tabs.push(["library", `Source Library (${documents.length})`]);
    return tabs;
  }, [documents.length, isFirstUse, questionSets.length, questions.length, s.quizBlocks?.length]);

  useEffect(() => {
    const scroller = entryRef.current?.closest(".surface-scroll") as HTMLElement | null;
    if (!scroller) return;
    scroller.scrollTop = 0;
  }, []);

  useEffect(() => {
    if (!visibleTabs.some(([id]) => id === tab)) setTab("overview");
  }, [tab, visibleTabs]);

  function runSet(set: QuestionSet) {
    setRunner({ mode: "tutor", presetFilters: { setIds: [set.id], count: Math.min(set.questionIds.length, 20) } });
  }
  function runBlock(block: QuizBlock) {
    setRunner({ mode: block.mode, presetFilters: block.filters, presetTimed: block.timed, blockId: block.id });
  }
  function generateFrom(doc: SourceDocument) {
    setImportSeed({ reference: { title: doc.title, text: doc.rawText } });
    setImportEntry("file");
    setTab("import");
  }

  function parseFrom(doc: SourceDocument) {
    const result = parseStoredDocument(doc);
    setImportSeed({
      drafts: result.drafts,
      warnings: result.warnings,
      rawText: doc.rawText,
      fileName: doc.fileName,
      fileType: doc.fileType,
      title: doc.title,
      sourceDocumentId: doc.id,
      sizeBytes: doc.sizeBytes,
      pageTexts: doc.pageTexts,
      checksum: doc.checksum,
      source: doc.fileType.toLowerCase().includes("pdf") ? "pdf" : "imported",
    });
    setImportEntry("file");
    setTab("import");
  }

  function openImport(entry: "file" | "paste" = "file") {
    setImportSeed(null);
    setImportEntry(entry);
    setTab("import");
  }

  function openMappingReview(ids = mapping.issueQuestionIds) {
    setBankReview((current) => ({ ids, key: current.key + 1 }));
    setTab("bank");
  }

  function selectTab(nextTab: BankTab) {
    if (nextTab === "bank") setBankReview((current) => ({ key: current.key + 1 }));
    setTab(nextTab);
  }

  function launchRecommended() {
    if (lastSession) {
      setRunner({ mode: lastSession.mode, presetFilters: lastSession.filters, presetTimed: lastSession.timed });
    } else if (due.length > 0) {
      setRunner({ mode: "tutor", retakeIds: due.slice(0, 20).map((question) => question.id) });
    } else if (unseen > 0) {
      setRunner({ mode: "tutor", presetFilters: { status: "unused", count: Math.min(unseen, 10) } });
    } else if (runnable > 0) {
      setRunner({ mode: "tutor" });
    } else {
      openImport();
    }
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % visibleTabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + visibleTabs.length) % visibleTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = visibleTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = visibleTabs[next][0];
    selectTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`question-bank-tab-${nextTab}`)?.focus());
  }

  async function runWeaknessCoach() {
    if (!provider || !incorrect.length) return;
    setCoachBusy(true);
    try {
      setCoach(await coachWeakness(provider, {
        missed: incorrect.map((question) => ({
          stem: question.stem,
          category: question.category ?? question.system,
          errorType: question.errorType,
        })),
      }));
    } catch (error) {
      pushToast({ title: "Weakness coach failed", body: error instanceof Error ? error.message : "Unknown error.", tone: "warn" });
    } finally {
      setCoachBusy(false);
    }
  }

  const stats = [
    {
      label: "Current mastery",
      value: collectionMetrics.currentMasteryPct === null ? "—" : `${collectionMetrics.currentMasteryPct}%`,
      note: `${collectionMetrics.currentMasteryQuestions} latest scored question${collectionMetrics.currentMasteryQuestions === 1 ? "" : "s"}`,
      icon: Microscope,
    },
    {
      label: "Attempt accuracy",
      value: collectionMetrics.historicalAccuracyPct === null ? "—" : `${collectionMetrics.historicalAccuracyPct}%`,
      note: "all scored attempts",
      icon: BarChart3,
    },
    {
      label: "Questions attempted",
      value: collectionMetrics.completed,
      note: `of ${collectionMetrics.total} active`,
      icon: BookOpen,
    },
    {
      label: "Total attempts",
      value: collectionMetrics.historicalAttemptCount,
      note: `${questionSets.length} saved set${questionSets.length === 1 ? "" : "s"}`,
      icon: ListFilter,
    },
  ];

  return (
    <>
      <div
        ref={entryRef}
        className={`qb-hero ${tab === "sets" ? "qb-course-header" : "tx-marble"} ${isFirstUse ? "qb-first-use" : "qb-returning-hero"}`}
        data-tour="question-bank-entry"
      >
        <div className="qb-hero-inner">
          <div className="qb-hero-head">
            <div className="stack qb-heading-copy">
              <AxomBrandLockup layout="horizontal" size="sm" subtitle="Study engine" markFramed />
              <h1 className="qb-page-title">Question Bank</h1>
              <p className="qb-lede">
                {isFirstUse
                  ? "Turn lecture files and question documents into reliable practice sets."
                  : "Continue the right set, resolve uncertain mappings, and understand what your attempts are showing."}
              </p>
            </div>
            <div className="qb-hero-actions" data-module-tour="qb-import">
              {isFirstUse ? (
                <>
                  <button className="qb-cta primary" onClick={() => openImport("file")}>
                    <FileInput size={ICON_SIZE.emphasis} /> Import Questions
                  </button>
                  <button className="qb-cta ghost" onClick={() => openImport("paste")}>
                    <Files size={ICON_SIZE.body} /> Paste text
                  </button>
                </>
              ) : (
                <>
                  <button className="qb-cta primary" onClick={launchRecommended}>
                    <Play size={ICON_SIZE.emphasis} /> {lastSession ? "Continue last session" : runnable ? "Start practice" : "Import questions"}
                  </button>
                  <button className="qb-cta ghost" onClick={() => openImport("file")}>
                    <FileInput size={ICON_SIZE.body} /> Import
                  </button>
                </>
              )}
              <button className="qb-cta ghost" onClick={() => setModuleTourOpen(true)} aria-label="Open Question Bank help tour">
                <HelpCircle size={ICON_SIZE.body} /> Help
              </button>
            </div>
          </div>
          {isFirstUse ? (
            <p className="qb-format-note">PDF, DOCX, TXT, Markdown, CSV, JSON, or pasted text.</p>
          ) : (
            <p className="qb-session-note">
              {lastSession
                ? `Starts a new ${lastSession.mode} block with the same filters as your last session.${mapping.issueCount > 0 ? ` ${mapping.issueCount} mapping issue${mapping.issueCount === 1 ? "" : "s"} also need review.` : ""}`
                : mapping.issueCount > 0
                  ? `${mapping.issueCount} mapping issue${mapping.issueCount === 1 ? "" : "s"} should be checked before the next block.`
                  : "Your most useful next action is ready below."}
            </p>
          )}
        </div>
      </div>

      <div className="qb-segment" role="tablist" aria-label="Question Bank sections">
        {visibleTabs.map(([id, label], index) => (
          <button
            key={id}
            id={`question-bank-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={tab === id ? `question-bank-panel-${id}` : undefined}
            tabIndex={tab === id ? 0 : -1}
            className={`qb-seg ${tab === id ? "on" : ""}`}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {label}
          </button>
        ))}
      </div>

      <section
        id={`question-bank-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`question-bank-tab-${tab}`}
        className="qb-tabpanel"
      >
      {tab === "overview" && (
        isFirstUse ? (
          <section className="qb-first-process" aria-labelledby="question-bank-process-title">
            <div>
              <span className="qb-eyebrow">How it works</span>
              <h2 id="question-bank-process-title">From source to understanding</h2>
            </div>
            <ol>
              <li><b>Import a source</b><span>Use a file or paste existing question text.</span></li>
              <li data-module-tour="qb-mappings"><b>Review uncertain mappings</b><span>Confirm only the answers the importer flags.</span></li>
              <li data-module-tour="qb-practice"><b>Practice the finalized set</b><span>Build mastery from scored attempts and explanations.</span></li>
            </ol>
          </section>
        ) : (
        <div className="stack gap16">
          {questionSets.length > 0 && (
            <QuestionSetList
              recent
              compact
              limit={3}
              onRunSet={runSet}
          onRunSets={(sets) => setRunner({ mode: "tutor", presetFilters: { setIds: sets.map((set) => set.id), count: 20 } })}
              onReviewIssues={openMappingReview}
            />
          )}

          {mapping.issueCount > 0 && (
            <section className="qb-mapping-alert" aria-labelledby="mapping-review-title" aria-live="polite" data-module-tour="qb-mappings">
              <div className="qb-mapping-icon" aria-hidden="true"><AlertTriangle size={ICON_SIZE.emphasis} /></div>
              <div className="grow">
                <h2 id="mapping-review-title">{mapping.issueCount} question{mapping.issueCount === 1 ? "" : "s"} need review</h2>
                <p>
                  <b>{mapping.unresolved} Unresolved</b> · {mapping.reviewSuggested} Review suggested · {mapping.ready} Ready
                </p>
              </div>
              <button className="filter-pill" onClick={() => openMappingReview()}>Review issues</button>
            </section>
          )}

          <section className="qb-next-card glass-liquid" aria-labelledby="recommended-next-title" data-module-tour="qb-practice">
            <div className="qb-next-copy">
              <span className="qb-eyebrow">Recommended next</span>
              <h2 id="recommended-next-title">{due.length ? `Review ${Math.min(due.length, 20)} due questions` : incorrect.length ? `Retry ${Math.min(incorrect.length, 20)} misses` : unseen ? "Start an unseen tutor block" : runnable ? "Start a focused practice block" : "Import another clean set"}</h2>
              <p>{due.length
                ? "These questions are scheduled to resurface now. A short tutor block keeps the review loop moving."
                : incorrect.length
                  ? "Turn recent misses into a focused block, classify the error, and repair the pattern."
                  : unseen
                    ? "Mapped questions are ready to study. Start small and let the performance data build."
                    : runnable
                      ? "Choose a short block and keep your current mastery signal fresh."
                      : "Every import enters the same review-gated workflow."}</p>
            </div>
            <button className="filter-pill on qb-begin-button" onClick={launchRecommended}><Play size={ICON_SIZE.body} /> Begin</button>
          </section>

          <section aria-label="Question Bank performance" className="qb-stats">
            {stats.map((stat) => (
              <div key={stat.label} className="qb-stat glass-liquid">
                <span className="qb-stat-icon"><stat.icon size={ICON_SIZE.body} /></span>
                <span className="qb-stat-value">{stat.value}</span>
                <span className="qb-stat-label">{stat.label}</span>
                <span className="qb-stat-note">{stat.note}</span>
              </div>
            ))}
          </section>

          <div className="qb-loop-grid" aria-label="Today's AXOM study loop">
            <button className="qb-loop-card" disabled={!due.length} onClick={() => setRunner({ mode: "tutor", retakeIds: due.slice(0, 20).map((q) => q.id) })}>
              <ListFilter size={ICON_SIZE.emphasis} /><b>Review due</b><span>{due.length ? `${due.length} ready now` : "Nothing due"}</span>
            </button>
            <button className="qb-loop-card" disabled={!incorrect.length} onClick={() => setRunner({ mode: "tutor", retakeIds: incorrect.slice(0, 20).map((q) => q.id) })}>
              <RotateCcw size={ICON_SIZE.emphasis} /><b>Retry incorrects</b><span>{incorrect.length ? `${incorrect.length} misses to repair` : "No current misses"}</span>
            </button>
            <button className="qb-loop-card" disabled={!weak[0]} onClick={() => weak[0] && setRunner({ mode: "tutor", presetFilters: { status: "all", count: 15, categories: [weak[0].topic] } })}>
              <Microscope size={ICON_SIZE.emphasis} /><b>Weak-topic block</b><span>{weak[0]?.topic ?? "Needs more attempts"}</span>
            </button>
            <button className="qb-loop-card qb-sim-card" disabled={!runnable && !suspendedSim} onClick={() => setRunner({ mode: suspendedSim?.mode ?? "exam", simulate: true })}>
              <MonitorPlay size={ICON_SIZE.emphasis} /><b>{suspendedSim ? "Resume suspended block" : "Exam simulator"}</b>
              <span>{suspendedSim ? `${EXAM_SKINS[suspendedSim.skin].label} · ${blockCounts(suspendedSim.poolIds, suspendedSim.items).answered}/${suspendedSim.poolIds.length} answered` : "UWorld · USMLE/NBME · ExamSoft interfaces"}</span>
            </button>
            <button className="qb-loop-card" onClick={() => openImport("file")}>
              <FileInput size={ICON_SIZE.emphasis} /><b>Import questions</b><span>Review uncertainty, not every line</span>
            </button>
          </div>

          <div className="qb-command-grid qb-secondary-intelligence">
            <GlassCard className="qb-insight-card">
              <span className="qb-eyebrow">Live insight</span>
              <div className="stack gap12" style={{ marginTop: 12 }}>
                <div><b>{weak[0]?.topic ?? "No weak category yet"}</b><div className="sub">Weakest category</div></div>
                <div><b>{patterns[0] ? ERROR_TYPE_LABEL[patterns[0].errorType] : "Classify a miss to begin"}</b><div className="sub">Repeated error pattern</div></div>
                <div><b>{highConfidenceMisses || "None"}</b><div className="sub">High-confidence misses</div></div>
                <div><b>{slowest ? `${slowest.category} · ${slowest.seconds}s` : "No timing data yet"}</b><div className="sub">Slowest category</div></div>
                <div><b>{recentImprovement === undefined ? "Needs more attempts" : `${recentImprovement >= 0 ? "+" : ""}${recentImprovement} points`}</b><div className="sub">Recent improvement</div></div>
                {provider && incorrect.length > 0 && (
                  <button className="filter-pill" disabled={coachBusy} onClick={() => void runWeaknessCoach()}>
                    <Sparkles size={ICON_SIZE.microInline} /> {coachBusy ? "Analyzing misses…" : "Ask weakness coach"}
                  </button>
                )}
              </div>
            </GlassCard>

            <div className="qb-library-strip" aria-label="Question Bank libraries">
              <button className="qb-library-link" onClick={() => setTab("sets")}><b>Question Sets</b><span>{questionSets.length} saved</span></button>
              <button className="qb-library-link" onClick={() => setTab("library")}><b>Source Documents</b><span>{documents.length} available</span></button>
              <button className="qb-library-link" onClick={() => setTab("blocks")}><b>Saved Blocks</b><span>{(s.quizBlocks ?? []).length} reusable</span></button>
            </div>
          </div>

          {coach && (
            <GlassCard className="qb-ai-coach">
              <PanelHeader title="AI weakness coach" sub={`${provider?.info.label} · grounded in your saved misses; suggestion only`} />
              <p>{coach.diagnosis}</p>
              <div className="question-explanation"><b>Suggested next block:</b> {coach.suggestedBlock}</div>
            </GlassCard>
          )}
        </div>
        )
      )}

      {tab === "import" && (
        <ImportPanel
          key={`${importSeed?.sourceDocumentId ?? importSeed?.reference?.title ?? importSeed?.fileName ?? "plain"}-${importEntry}`}
          seed={importSeed}
          initialTab={importEntry}
          onFinalized={(result) => {
            setImportSeed(null);
            setTab(result.setId ? "sets" : "library");
          }}
        />
      )}
      {tab === "sets" && <>
        <div className="cb-view-switch" role="group" aria-label="Question bank view">
          <button aria-pressed={bankView === "books"} onClick={() => setBankView("books")}>Bookshelf</button>
          <button aria-pressed={bankView === "weeks"} onClick={() => setBankView("weeks")}>Browse weeks</button>
        </div>
        {bankView === "books" ? <QuestionBankLibrary onImport={() => setTab("import")} onCreate={() => setRunner({ mode: "tutor" })}
          onOpenBank={(book, week) => { setBankLocation({ module: book.module, courseId: book.courseId, week }); setBankView("weeks"); }}
          onPractice={(selection) => { setBankView("weeks"); setBankLocation(selection); setRunner({ mode: "tutor", presetFilters: { setIds: selection.setIds, count: selection.count } }); }} /> :
        <QuestionSetList key={JSON.stringify(bankLocation)} initialScope={bankLocation}
          onRunSet={runSet}
          onRunSets={(sets) => setRunner({ mode: "tutor", presetFilters: { setIds: sets.map((set) => set.id), count: 20 } })}
          onReviewIssues={openMappingReview}
          onReviewMisses={(ids) => ids.length && setRunner({ mode: "tutor", retakeIds: ids })}
          onOpenInsights={() => setTab("insights")}
        />
      }</>}
      {tab === "library" && <SourceLibrary onParseFrom={parseFrom} onGenerateFrom={generateFrom} />}
      {tab === "blocks" && <BlockBuilder onRunBlock={runBlock} onNewBlock={() => setRunner({ mode: "tutor" })} />}

      {tab === "bank" && (
        <BankBrowser
          key={bankReview.key}
          onOpen={setOpen}
          initialMode={bankReview.ids ? "mapping-review" : "all"}
          questionIds={bankReview.ids}
        />
      )}

      {tab === "insights" && (
        <>
          <AnalysisPanel onPractice={(ids) => ids.length && setRunner({ mode: "tutor", retakeIds: ids })} />
          {/* The older breakdowns stay available, one step back from the findings. */}
          <details className="qb-breakdowns">
            <summary>Session history and breakdowns</summary>
          <div className="grid grid-2">
            <PerformancePanel onRetakeMissed={(ids) => setRunner({ mode: "tutor", retakeIds: ids })} />
            <GlassCard>
              <PanelHeader title="Error patterns" sub="Why you miss, not just how often — the taxonomy surfaces repeat behavior." />
              {patterns.length === 0 ? (
                <EmptyState title="No classified errors yet" hint="When you miss a question, pick an error type — patterns appear after a few." />
              ) : (
                <div className="stack gap6">
                  {patterns.map((p) => (
                    <div key={p.errorType} className="row">
                      <span className="grow">{ERROR_TYPE_LABEL[p.errorType]}</span>
                      <span className="dim">{p.count}× · {Math.round(p.share * 100)}%</span>
                    </div>
                  ))}
                  {weak.length > 0 && (
                    <div className="sub" style={{ marginTop: 6 }}>
                      Weakest topics: {weak.map((w) => `${w.topic} (${Math.round(w.missRate * 100)}% missed)`).join(" · ")}
                    </div>
                  )}
                </div>
              )}
            </GlassCard>
          </div>
          <GlassCard>
            <PanelHeader
              title="Faculty style analyzer"
              sub="Broad structural patterns of this question set — hedged observations, never claims about intent."
              action={<button className="filter-pill" onClick={() => setShowStyle((v) => !v)}>{showStyle ? "Hide" : "Analyze"}</button>}
            />
            {!showStyle && <div className="sub">Runs locally over your saved questions.</div>}
            {style && (
              <div className="stack gap6">
                <div className="sub">Sample: {style.sampleSize} questions{style.reliable ? "" : " (small — treat as hints)"}</div>
                {style.findings.map((f, i) => (
                  <div key={i} className="stack" style={{ gap: 2 }}>
                    <b style={{ fontSize: 13 }}>{f.observation}</b>
                    <span className="sub">{f.detail}</span>
                  </div>
                ))}
                <div className="sub">{style.suggestion}</div>
              </div>
            )}
          </GlassCard>
          </details>
        </>
      )}
      </section>

      {open && <QuestionDetailModal question={open} onClose={() => setOpen(null)} />}
      {runner && (
        <ExamRunner
          mode={runner.mode}
          retakeIds={runner.retakeIds}
          presetFilters={runner.presetFilters}
          presetTimed={runner.presetTimed}
          blockId={runner.blockId}
          simulate={runner.simulate}
          onClose={() => { setRunner(null); setSuspendedSim(readSuspendedBlock()); }}
        />
      )}
      {moduleTourOpen && (
        <ModuleTour name="Question Bank" route="questions" steps={QUESTION_BANK_TOUR_STEPS} onExit={() => setModuleTourOpen(false)} />
      )}
    </>
  );
}

function tabLabel(
  id: BankTab,
  label: string,
  setCount: number,
  documentCount: number,
  questionCount: number,
  blockCount: number,
): string {
  if (id === "sets") return `${label} (${setCount})`;
  if (id === "library") return `${label} (${documentCount})`;
  if (id === "bank") return `${label} (${questionCount})`;
  if (id === "blocks") return `${label} (${blockCount})`;
  return label;
}
