import { AlertTriangle, BarChart3, Edit3, Play, RotateCcw, Share2 } from "lucide-react";
import type { ReactNode } from "react";
import type { QuestionSet, QuestionSetMetrics } from "../../lib/library";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

export function QuestionSetCard({
  set,
  metrics,
  onStart,
  onReviewIssues,
  onReviewMisses,
  onEdit,
  onInsights,
  onShare,
  compact = false,
  children,
}: {
  set: QuestionSet;
  metrics: QuestionSetMetrics;
  onStart: () => void;
  onReviewIssues?: () => void;
  onReviewMisses?: () => void;
  onEdit?: () => void;
  onInsights?: () => void;
  onShare?: () => void;
  compact?: boolean;
  children?: ReactNode;
}) {
  const mastery = metrics.currentMasteryPct === null ? "—" : `${metrics.currentMasteryPct}%`;
  const attemptAccuracy = metrics.historicalAccuracyPct === null ? "—" : `${metrics.historicalAccuracyPct}%`;
  const confidence = metrics.importConfidence === null ? "Legacy" : `${metrics.importConfidence}%`;
  const mappingIssueCount = metrics.mapping?.issueCount ?? metrics.needsReview;
  const partial = metrics.completed > 0 && metrics.remaining > 0;
  const primaryAction = mappingIssueCount > 0 && onReviewIssues
    ? { label: "Review issues", icon: <AlertTriangle size={ICON_SIZE.body} />, onClick: onReviewIssues }
    : { label: partial ? "Continue" : "Start", icon: <Play size={ICON_SIZE.body} />, onClick: onStart };

  return (
    <article className={`qset-card glass-liquid ${compact ? "compact" : ""}`}>
      <div className="qset-card-head">
        <div className="stack qset-title-wrap">
          <span className="qset-kicker">
            {metrics.sourceTitle ?? (set.sourceDocumentIds.length
              ? `${set.sourceDocumentIds.length} source${set.sourceDocumentIds.length === 1 ? "" : "s"}`
              : "Question set")}
          </span>
          <h3>{set.title}</h3>
          <div className="row wrap gap6">
            {metrics.category && <Tag tone="neutral">{metrics.category}</Tag>}
            {!compact && set.aiEnhanced && <Tag tone="purple">AI digest</Tag>}
            {mappingIssueCount > 0 && <Tag tone="orange">{mappingIssueCount} mapping issue{mappingIssueCount === 1 ? "" : "s"}</Tag>}
          </div>
        </div>
        <div className={`qset-accuracy ${metrics.currentMasteryTone}`} aria-label={metrics.currentMasteryPct === null ? "No current mastery attempts yet" : `${metrics.currentMasteryPct}% current mastery`}>
          <strong>{mastery}</strong>
          <span>Current mastery</span>
        </div>
      </div>

      <div
        className="qset-metric-strip"
        aria-label="Question set progress"
        style={compact ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : undefined}
      >
        <span><b>{metrics.total}</b> total questions</span>
        <span><b>{metrics.completed}/{metrics.total}</b> questions attempted</span>
        {!compact && <span><b>{metrics.remaining}</b> remaining</span>}
        {!compact && <span><b>{confidence}</b> import</span>}
      </div>

      <div className="qset-progress-copy">
        <span>Attempt accuracy {attemptAccuracy} · {metrics.historicalAttemptCount} total attempt{metrics.historicalAttemptCount === 1 ? "" : "s"}</span>
        <span>{metrics.lastStudiedAt ? `Last studied ${formatDate(metrics.lastStudiedAt)}` : "Not studied yet"}</span>
      </div>
      <div className={`qset-progress ${metrics.currentMasteryTone}`} role="progressbar" aria-label={`${metrics.completed} of ${metrics.total} questions attempted`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={metrics.completionPct}>
        <span style={{ width: `${metrics.completionPct}%` }} />
      </div>

      {!compact && children}

      <div className="qset-actions">
        <GButton size="sm" variant="primary" onClick={primaryAction.onClick}>{primaryAction.icon} {primaryAction.label}</GButton>
        {!compact && onReviewMisses && (
          <GhostButton disabled={metrics.missedQuestionIds.length === 0} onClick={onReviewMisses}>
            <RotateCcw size={ICON_SIZE.body} /> Review misses
          </GhostButton>
        )}
        {!compact && onEdit && <GhostButton onClick={onEdit}><Edit3 size={ICON_SIZE.body} /> Edit</GhostButton>}
        {!compact && onInsights && <GhostButton onClick={onInsights}><BarChart3 size={ICON_SIZE.body} /> Insights</GhostButton>}
        {!compact && onShare && <GhostButton onClick={onShare}><Share2 size={ICON_SIZE.body} /> Share</GhostButton>}
      </div>
    </article>
  );
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed);
}
