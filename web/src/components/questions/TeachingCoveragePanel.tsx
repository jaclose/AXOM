import { ArrowRight, CheckCircle2, Image, Layers3, ListChecks, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { ICON_SIZE } from "../../lib/iconSize";
import { summarizeQuestionTeachingCoverage } from "../../lib/questionTeachingCoverage";
import { useStore } from "../../lib/store";
import { GlassCard, GButton, PanelHeader } from "../ui/primitives";

function CoverageMetric({ label, value, total, icon: Icon }: {
  label: string; value: number; total: number; icon: typeof CheckCircle2;
}) {
  const percent = total ? Math.round(value / total * 100) : 0;
  return <div className="teaching-coverage-metric">
    <div><Icon size={ICON_SIZE.body} aria-hidden="true" /><span>{label}</span><b>{value}/{total}</b></div>
    <div className="teaching-coverage-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <span style={{ width: `${percent}%` }} />
    </div>
  </div>;
}
export function TeachingCoveragePanel({ onReview }: { onReview: (questionIds: string[]) => void }) {
  const questions = useStore((state) => state.questions ?? []);
  const documents = useStore((state) => state.documents ?? []);
  const coverage = useMemo(() => summarizeQuestionTeachingCoverage(questions, documents), [questions, documents]);
  const queued = coverage.improvementQueueIds.length;

  return <GlassCard className="teaching-coverage-panel">
    <PanelHeader title="Teaching coverage" sub="A review-gated layer beside the original question." />
    <p className="teaching-coverage-principle"><ShieldCheck size={ICON_SIZE.body} aria-hidden="true" />
      Source questions stay unchanged. AXOM tracks which ready questions still need an explanation, choice-level teaching, or reviewed depth.
    </p>
    <div className="teaching-coverage-grid">
      <CoverageMetric label="Core explanation" value={coverage.withExplanation} total={coverage.ready} icon={CheckCircle2} />
      <CoverageMetric label="Every choice explained" value={coverage.withCompleteChoiceTeaching} total={coverage.ready} icon={ListChecks} />
      <CoverageMetric label="Reviewed source depth" value={coverage.withReviewedDepth} total={coverage.ready} icon={Layers3} />
      <CoverageMetric label="Teaching visual linked" value={coverage.withTeachingVisuals} total={coverage.ready} icon={Image} />
    </div>
    <div className="teaching-coverage-queue">
      <div><span className="field-label">Upgrade queue</span><b>{queued} ready question{queued === 1 ? "" : "s"}</b>
        <p>{coverage.proposalsToReview
          ? `${coverage.proposalsToReview} teaching proposal${coverage.proposalsToReview === 1 ? " is" : "s are"} waiting for human review. Source-checked imports stay gated until approval.`
          : "Missing layers are queued deterministically. No answer or explanation is invented."}</p></div>
      <GButton variant="primary" size="sm" disabled={!queued} onClick={() => onReview(coverage.improvementQueueIds)}>
        Review queue <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
      </GButton>
    </div>
  </GlassCard>;
}
