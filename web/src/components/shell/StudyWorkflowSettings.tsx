// Settings > Personalization > How you study, in the setup style (JD, Ideas 4:
// "How do you study and the settings as a whole needs a full rehaul like the
// setup style"). The same tiles, segments and summary as setup, bound to the
// saved study workflow; the rarely changed parts sit behind More options.
import { useId } from "react";
import {
  BookOpen, Brain, Layers, Library, ListChecks, Mic, NotebookPen, PenLine, Plus, Sparkles, SquareStack, type LucideIcon,
} from "lucide-react";
import { cardSystemFor } from "../../lib/cardSystem";
import { DEFAULT_STUDY_WORKFLOW, normalizeStudyWorkflow, toggleStudyMethod, type StudyMethodId } from "../../lib/studyPreferences";
import { useStore } from "../../lib/store";
import { ChoiceSegment, ChoiceSummary, ChoiceTiles } from "../ui/Choice";
import { StudyMethodFollowUps } from "./StudyMethodFollowUps";
import { StudyTextSuggestions } from "./StudyTextSuggestions";

const METHODS: Array<{ id: StudyMethodId; label: string; detail: string; icon: LucideIcon }> = [
  { id: "lecture-passes", label: "Lecture review", detail: "Passes over lectures", icon: BookOpen },
  { id: "practice-questions", label: "Practice questions", detail: "Q-banks, school or your own", icon: ListChecks },
  { id: "anki", label: "Anki", detail: "Spaced repetition", icon: Layers },
  { id: "noji", label: "Noji", detail: "Flashcards", icon: Sparkles },
  { id: "quizlet", label: "Quizlet", detail: "Flashcards", icon: SquareStack },
  { id: "remnote", label: "RemNote", detail: "Notes and cards", icon: NotebookPen },
  { id: "notes", label: "Notes", detail: "Concept notes", icon: PenLine },
  { id: "teach-aloud", label: "Teach aloud", detail: "Explain it to learn it", icon: Mic },
  { id: "recall", label: "Recall sessions", detail: "Blank-page recall", icon: Brain },
  { id: "external-resource", label: "Resources", detail: "UWorld, AMBOSS, videos", icon: Library },
  { id: "custom", label: "Something else", detail: "Tell AXOM below", icon: Plus },
];

const KINDS = ["Lecture", "DLA", "PQ"] as const;

export function StudyWorkflowSettings() {
  const store = useStore();
  const titleId = useId();
  const workflow = normalizeStudyWorkflow(store.profile.studyWorkflow ?? DEFAULT_STUDY_WORKFLOW);
  const enabled = (workflow.methods ?? []).filter((method) => method.enabled).map((method) => method.id);
  const passes = workflow.lecturePasses ?? 2;
  const cards = cardSystemFor(workflow);

  function save(patch: Partial<typeof workflow>) {
    store.updateProfile({ studyWorkflow: { ...workflow, configured: true, ...patch } });
  }
  function setKindPasses(kind: (typeof KINDS)[number], value: number | undefined) {
    const current = { ...workflow.itemKindDefaults };
    if (value === undefined) {
      const { lecturePasses: _dropped, ...rest } = current[kind] ?? {};
      current[kind] = rest;
    } else {
      current[kind] = { ...current[kind], lecturePasses: value };
    }
    save({ itemKindDefaults: current });
  }

  const tracker = [
    enabled.includes("lecture-passes") ? `${passes} ${passes === 1 ? "pass" : "passes"} per lecture` : "",
    cards ? `${cards.label} rounds` : "No flashcard rounds",
    enabled.includes("practice-questions") ? "question sets" : "",
  ].filter(Boolean);

  return (
    <div className="settings-stack study-settings">
      <section className="settings-card" aria-labelledby={titleId}>
        <div className="settings-card-head">
          <span className="settings-card-icon"><BookOpen size={16} aria-hidden="true" /></span>
          <div>
            <h4 id={titleId}>How you study</h4>
            <p>Pick everything that is part of your routine. Course Tracker, suggestions and follow-ups are built from it; nothing is forced, not even Anki.</p>
          </div>
        </div>

        <ChoiceTiles
          multiple
          compact
          columns="fluid"
          label="Study methods"
          options={METHODS}
          selected={enabled}
          onToggle={(id) => store.updateProfile({ studyWorkflow: toggleStudyMethod(workflow, id) })}
        />
        <ChoiceSummary live rows={[["Course Tracker shows", tracker.join(" · ")], ["Review comes back after", `${workflow.reviewAfterDays ?? 3} days`]]} className="study-settings-summary" />

        <StudyMethodFollowUps workflow={workflow} onChange={(studyWorkflow) => store.updateProfile({ studyWorkflow })} />

        <div className="study-settings-rows">
          <div className="setup-followup">
            <span className="setup-label" id={`${titleId}-passes`}>Usual lecture passes</span>
            <ChoiceSegment
              labelledBy={`${titleId}-passes`}
              options={[1, 2, 3, 4, 5, 6].map((count) => ({ value: count, label: count }))}
              value={passes}
              onChange={(lecturePasses) => save({ lecturePasses })}
            />
          </div>
          <label className="setup-inline-field">
            <span>Review again after (days)</span>
            <span className="setup-stepper">
              <input type="number" min={1} max={14} value={workflow.reviewAfterDays ?? 3}
                onChange={(event) => save({ reviewAfterDays: Math.min(14, Math.max(1, Number(event.target.value) || 3)) })} />
              <em>days</em>
            </span>
          </label>
        </div>

        <details className="setup-more">
          <summary>More options</summary>
          <div className="study-settings-more">
            <div className="setup-followup">
              <span className="setup-label">Passes by item type</span>
              <p className="setup-hint">Leave a type on Usual, or set PQ to 6 if you do six rounds of practice questions.</p>
              {KINDS.map((kind) => {
                const own = workflow.itemKindDefaults?.[kind]?.lecturePasses;
                return (
                  <div className="study-settings-kind" key={kind}>
                    <b>{kind}</b>
                    <ChoiceSegment
                      label={`${kind} default passes`}
                      options={[{ value: 0, label: "Usual" }, ...[1, 2, 3, 4, 5, 6].map((count) => ({ value: count, label: count }))]}
                      value={own ?? 0}
                      onChange={(value) => setKindPasses(kind, value || undefined)}
                    />
                  </div>
                );
              })}
            </div>
            <label className="setup-inline-field">
              <span>In your own words</span>
              <textarea rows={3} value={workflow.customContext ?? ""} placeholder="e.g. First pass on lecture day, Anki that night, a week later I redo the PQs."
                onChange={(event) => save({ customContext: event.target.value })} />
            </label>
            <p className="setup-hint">AXOM keeps this exactly as written. Suggestions below come from fixed word rules (not AI) and are never applied without you.</p>
            <StudyTextSuggestions workflow={workflow} onApply={(studyWorkflow) => store.updateProfile({ studyWorkflow })} />
          </div>
        </details>
      </section>
    </div>
  );
}
