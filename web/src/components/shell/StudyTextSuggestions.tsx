import { useEffect, useId, useMemo, useRef, useState } from "react";
import { applyStudySuggestion, applyStudySuggestions, interpretStudyText } from "../../lib/studyInterpretation";
import type { StudyWorkflowPreferences } from "../../lib/studyPreferences";
import { GButton } from "../ui/primitives";

/**
 * Confirmation-only suggestions derived from the learner's "Other" text with
 * fixed rules. Nothing applies without a click, the text itself is never
 * changed, and an applied suggestion disappears because it is now true.
 */
export function StudyTextSuggestions({ workflow, onApply }: {
  workflow: StudyWorkflowPreferences;
  onApply: (next: StudyWorkflowPreferences) => void;
}) {
  const titleId = useId();
  const regionRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const suggestions = useMemo(() => interpretStudyText(workflow.customContext ?? "", workflow), [workflow]);

  // Applying removes the focused row. Keep keyboard users in place by moving
  // focus to the next remaining Apply button, or to this region when none remain.
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    const buttons = regionRef.current?.querySelectorAll<HTMLButtonElement>("button[data-study-suggestion]");
    const next = buttons && buttons.length > 0 ? buttons[Math.min(index, buttons.length - 1)] : regionRef.current;
    next?.focus();
  }, [suggestions]);

  function applyOne(index: number) {
    const suggestion = suggestions[index];
    pendingFocus.current = index;
    setAnnouncement(`Applied: ${suggestion.label}.`);
    onApply(applyStudySuggestion(workflow, suggestion));
  }

  function applyAll() {
    pendingFocus.current = 0;
    setAnnouncement(`Applied ${suggestions.length} suggestions.`);
    onApply(applyStudySuggestions(workflow, suggestions));
  }

  return (
    <div className="study-suggestions-region" ref={regionRef} tabIndex={-1}>
      <p className="study-suggestions-status" role="status">{announcement}</p>
      {suggestions.length > 0 && (
        <section className="study-suggestions" aria-labelledby={titleId}>
          <div className="study-suggestions-head">
            <div>
              <div id={titleId} className="study-suggestions-title">Suggestions from your words</div>
              <div className="sub">Found with fixed word rules, not AI. Nothing changes until you choose Apply.</div>
            </div>
            {suggestions.length > 1 && <GButton type="button" size="sm" onClick={applyAll}>Apply all</GButton>}
          </div>
          <ul className="study-suggestion-list">
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.id} className="study-suggestion">
                <span>
                  <b>{suggestion.label}</b>
                  <small>You wrote “{suggestion.evidence}”</small>
                </span>
                <GButton type="button" size="sm" data-study-suggestion="" aria-label={`Apply: ${suggestion.label}`} onClick={() => applyOne(index)}>
                  Apply
                </GButton>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
