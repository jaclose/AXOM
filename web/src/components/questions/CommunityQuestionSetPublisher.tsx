import { useEffect, useMemo, useState } from "react";
import { BookUp2 } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { useStore } from "../../lib/store";
import { questionSetKind, type QuestionSet } from "../../lib/library";
import { questionPracticeReadiness } from "../../lib/questionFilters";
import type { QuestionRecord } from "../../lib/questions";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton, GlassCard, Tag } from "../ui/primitives";
import { QuestionSetLibrarySubmitDialog } from "./QuestionSetLibrarySubmitDialog";

const EMPTY_SETS: QuestionSet[] = [];
const EMPTY_QUESTIONS: QuestionRecord[] = [];
type AccountChoice = { accountId: string; setId: string };

/**
 * Independent Question Sets use the existing moderated Question Set Library.
 * Course/source packages continue through the academic revision publisher.
 * Never make an implicit public submission when the selection changes.
 */
export function CommunityQuestionSetPublisher({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const accountId = useAccount(state => state.user?.id);
  const sets = useStore(state => state.questionSets ?? EMPTY_SETS);
  const questions = useStore(state => state.questions ?? EMPTY_QUESTIONS);
  const [choice, setChoice] = useState<AccountChoice>();
  const [submission, setSubmission] = useState<AccountChoice>();

  useEffect(() => {
    setChoice(undefined);
    setSubmission(undefined);
  }, [accountId]);

  const eligible = useMemo(() => sets.filter(set =>
    // Missed-review collections expose personal weakness selections. Imported
    // community copies must not be silently offered for republication.
    set.questionIds?.length > 0 && questionSetKind(set) !== "review" && !set.importProvenance
  ).sort((left, right) => left.title.localeCompare(right.title)), [sets]);
  const selected = choice?.accountId === accountId
    ? eligible.find(set => set.id === choice.setId) : undefined;
  const submitting = submission?.accountId === accountId
    ? eligible.find(set => set.id === submission.setId) : undefined;

  const state = useMemo(() => {
    if (!selected) return undefined;
    const bank = new Map(questions.map(question => [question.id, question]));
    const members = selected.questionIds.map(id => bank.get(id));
    return {
      held: members.filter(question => !question || questionPracticeReadiness(question) !== "ready").length,
      media: members.filter(question => question && (
        (question.attachments?.length ?? 0) > 0 || (question.content?.assets.length ?? 0) > 0
      )).length,
    };
  }, [selected, questions]);

  return <>
    <GlassCard pad className="community-set-publisher">
      <BookUp2 size={ICON_SIZE.display} aria-hidden="true" />
      <h3>Publish a Question Set</h3>
      <p>Publish an individual saved QBank set without a course, term, module or source package. Every submission is reviewed before appearing in the shared Question Set Library.</p>
      {eligible.length === 0 ? <>
        <p>No eligible Question Sets on this device. Create or save one in Question Bank first. Private missed-review sets and previously imported community copies are not offered for republishing.</p>
        <GButton onClick={onOpenLibrary}>Open Question Bank</GButton>
      </> : <>
        <label className="community-set-field">Saved Question Set
          <select aria-label="Saved Question Set" value={selected?.id ?? ""} onChange={event => {
            setChoice(event.target.value && accountId ? { accountId, setId: event.target.value } : undefined);
          }}>
            <option value="">Choose a saved set</option>
            {eligible.map(set => <option key={set.id} value={set.id}>{set.title} · {set.questionIds.length} questions</option>)}
          </select>
        </label>
        {selected && state && <>
          <p className="community-set-facts">{selected.questionIds.length} {selected.questionIds.length === 1 ? "question" : "questions"} selected · {state.held} held · {state.media} with media</p>
          {(state.held > 0 || state.media > 0) && <p className="community-local-warning">The review dialog will block submission until missing answers are checked and unsupported media is removed.</p>}
          <Tag tone="neutral">Academic review required</Tag>
        </>}
        <GButton variant="primary" disabled={!selected || !accountId} onClick={() => {
          if (selected && accountId) setSubmission({ accountId, setId: selected.id });
        }}>Review and submit set</GButton>
        <GButton onClick={onOpenLibrary}>Open Question Bank</GButton>
      </>}
      <p className="community-set-privacy">The submission includes question text, choices, answer keys, explanations, tags and citations. Attempts, notes, analytics, files, attachments and course filing remain private. Confirm redistribution rights in the review dialog.</p>
    </GlassCard>
    {submitting && <QuestionSetLibrarySubmitDialog key={`${accountId}:${submitting.id}`}
      set={submitting} questions={questions} onClose={() => setSubmission(undefined)} />}
  </>;
}
