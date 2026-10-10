// ===========================================================================
// Question performance summaries — useful numbers over charts: recent blocks,
// weakest categories, error-behavior insight, the retry queue, and an optional
// grounded AI Weakness Coach. Reads persisted QuizSession + question records.
// ===========================================================================
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useStore } from "../../lib/store";
import { scoresByCategory, sessionElapsedSeconds } from "../../lib/quiz";
import { dueQuestions, errorPatterns, ERROR_TYPE_LABEL, type QuestionRecord } from "../../lib/questions";
import { coachWeakness, resolveActiveProvider } from "../../lib/ai";
import { GlassCard, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { pushToast } from "../../lib/toast";
import { accuracyTone } from "../../lib/library";
import { ICON_SIZE } from "../../lib/iconSize";
import { SessionReviewModal } from "./SessionReviewModal";

const NO_QUESTIONS: QuestionRecord[] = [];

/** Local, keyless behavioral read: the dominant error type across misses. */
function localInsight(questions: QuestionRecord[]): string | null {
  const patterns = errorPatterns(questions);
  if (!patterns.length) return null;
  const top = patterns[0];
  if (top.share < 0.3) return null;
  return `Most of your misses (${Math.round(top.share * 100)}%) are ${ERROR_TYPE_LABEL[top.errorType].toLowerCase()} — not spread evenly across topics. Target the behavior, not just the content.`;
}

export function PerformancePanel({ onRetakeMissed }: { onRetakeMissed: (ids: string[]) => void }) {
  const questions = useStore((s) => s.questions ?? NO_QUESTIONS);
  const sessions = useStore((s) => s.quizSessions ?? []);
  const [coach, setCoach] = useState<{ diagnosis: string; suggestedBlock: string } | null>(null);
  const [coaching, setCoaching] = useState(false);
  const [reviewId, setReviewId] = useState<string>();
  const reviewSession = sessions.find((session) => session.id === reviewId);
  const provider = useMemo(() => resolveActiveProvider(), []);

  const recent = sessions.slice(0, 5);
  const byCategory = useMemo(() => scoresByCategory(sessions, questions).slice(0, 5), [sessions, questions]);
  const due = useMemo(() => dueQuestions(questions).length, [questions]);
  const insight = useMemo(() => localInsight(questions), [questions]);
  const incorrectIds = useMemo(
    () => questions.filter((q) => q.status === "incorrect").map((q) => q.id),
    [questions],
  );

  async function runCoach() {
    if (!provider) return;
    setCoaching(true);
    try {
      const missed = questions
        .filter((q) => q.status === "incorrect")
        .slice(0, 30)
        .map((q) => ({ stem: q.stem, category: q.category, errorType: q.errorType }));
      setCoach(await coachWeakness(provider, { missed }));
    } catch (err) {
      pushToast({ title: "Coaching failed", body: err instanceof Error ? err.message : "Unknown error.", tone: "warn" });
    } finally {
      setCoaching(false);
    }
  }

  return (
    <><GlassCard>
      <PanelHeader
        title="Performance"
        sub="Session history, weakest categories, error behavior, and what's due for another shot."
        action={provider && incorrectIds.length >= 3
          ? <GhostButton disabled={coaching} onClick={() => void runCoach()}><Sparkles size={ICON_SIZE.body} /> {coaching ? "Analyzing…" : "Coach"}</GhostButton>
          : undefined}
      />
      {sessions.length === 0 ? (
        <EmptyState title="No blocks completed yet" hint="Run a tutor or exam block — results land here and feed weakness detection." />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="stack gap6">
            <span className="field-label">Recent blocks</span>
            {recent.map((session) => (
              <div key={session.id} className="row wrap gap6" style={{ fontSize: 13 }}>
                <Tag tone={accuracyTone(session.score?.pct ?? null)}>
                  {session.score?.pct ?? 0}%
                </Tag>
                <span className="grow">
                  {session.mode} · {session.questionIds.length} questions
                  {session.timed ? ` · ${Math.round(sessionElapsedSeconds(session) / 60)}m` : ""}
                </span>
                <span className="dim">{session.startedAt.slice(0, 10)}</span>
                {session.endedAt && <GhostButton aria-label={`Review ${session.mode} block from ${session.startedAt.slice(0, 10)}`} onClick={() => setReviewId(session.id)}>Review answers</GhostButton>}
              </div>
            ))}
          </div>
          {byCategory.length > 0 && (
            <div className="stack gap6">
              <span className="field-label">Weakest categories</span>
              {byCategory.map((c) => (
                <div key={c.category} className="row" style={{ fontSize: 13 }}>
                  <span className="grow">{c.category}</span>
                  <span className={`grade-${accuracyTone(c.pct)}`}>
                    {c.pct}% ({c.correct}/{c.attempts})
                  </span>
                </div>
              ))}
            </div>
          )}
          {insight && !coach && (
            <div className="question-explanation"><b>Pattern:</b> {insight}</div>
          )}
          {coach && (
            <div className="stack gap6">
              <div className="question-explanation"><b>{provider?.info.label}:</b> {coach.diagnosis}</div>
              {coach.suggestedBlock && <div className="sub"><b>Try:</b> {coach.suggestedBlock}</div>}
            </div>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Tag tone={due ? "orange" : "green"}>{due} due for retry</Tag>
            {incorrectIds.length > 0 && (
              <button className="filter-pill" onClick={() => onRetakeMissed(incorrectIds.slice(0, 20))}>
                Retake {Math.min(incorrectIds.length, 20)} incorrect
              </button>
            )}
          </div>
        </div>
      )}
    </GlassCard>
    {reviewSession && <SessionReviewModal session={reviewSession} onClose={() => setReviewId(undefined)}
      onPractice={(ids) => { setReviewId(undefined); onRetakeMissed(ids); }} />}
    </>
  );
}
