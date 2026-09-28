// ===========================================================================
// The AXOM Guide: ask how to do something and AXOM shows you where. Matches
// come from the local topic map as you type (offline, no AI needed); with an
// AI provider on, Ask adds a written answer. "Show me" hands the topic to the
// pointer, which walks to the page and rings the control to click.
// ===========================================================================
import { useId, useMemo, useState, type FormEvent } from "react";
import { Compass, RefreshCw, Sparkles } from "lucide-react";
import { Modal } from "../ui/Modal";
import { GButton } from "../ui/primitives";
import { resolveActiveProvider } from "../../lib/ai";
import { askGuide, GUIDE_QUESTION_MAX, type GuideAnswer } from "../../lib/guide/ask";
import { matchGuideTopics, POPULAR_GUIDE_TOPICS } from "../../lib/guide/match";
import type { GuideTopic } from "../../lib/guide/topics";
import { ICON_SIZE } from "../../lib/iconSize";

export function GuideAssistant({ route, onClose, onStart }: {
  /** Current route id, so an AI answer knows where the learner is. */
  route: string;
  onClose: () => void;
  onStart: (topic: GuideTopic) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<(GuideAnswer & { label: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const provider = useMemo(() => resolveActiveProvider(), []);
  const matches = useMemo(() => matchGuideTopics(query).map((match) => match.topic), [query]);
  const typed = query.trim().length > 0;
  const topics = answer?.topics.length ? answer.topics : typed ? matches : POPULAR_GUIDE_TOPICS;
  const heading = answer ? "Where to go" : typed ? (matches.length ? "Best matches" : "") : "Popular";

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!provider || !typed || busy) return;
    setBusy(true);
    setError("");
    try {
      setAnswer({ ...await askGuide(provider, query, { route }), label: provider.info.label });
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "The AI guide is unavailable."} Showing the closest matches instead.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="AXOM Guide" onClose={onClose} className="guide-modal">
      <form className="guide-form" onSubmit={ask} role="search">
        <label className="sr-only" htmlFor={inputId}>Ask how to do something in AXOM</label>
        <Compass size={ICON_SIZE.emphasis} className="guide-form-icon" aria-hidden="true" />
        <input
          id={inputId}
          className="field guide-input"
          value={query}
          maxLength={GUIDE_QUESTION_MAX}
          placeholder="How do I… make Anki cards from my notes?"
          autoComplete="off"
          onChange={(event) => { setQuery(event.target.value); setAnswer(null); setError(""); }}
        />
        {provider && (
          <GButton type="submit" variant="primary" disabled={busy || !typed}>
            {busy ? <RefreshCw size={ICON_SIZE.body} className="spin" aria-hidden="true" /> : <Sparkles size={ICON_SIZE.body} aria-hidden="true" />} Ask
          </GButton>
        )}
      </form>

      <div aria-live="polite">
        {answer && (
          <div className="guide-answer">
            <p>{answer.text}</p>
            <span className="sub">{answer.label}</span>
          </div>
        )}
        {error && <p className="sub guide-error" role="alert">{error}</p>}
      </div>

      {heading && <div className="field-label guide-heading">{heading}</div>}
      <ul className="guide-topics">
        {topics.map((topic) => (
          <li key={topic.id} className="guide-topic">
            <div className="grow stack">
              <b>{topic.title}</b>
              <span className="sub">{topic.summary}</span>
            </div>
            <GButton size="sm" onClick={() => onStart(topic)}>
              {topic.settingsTab ? "Open settings" : "Show me"}
            </GButton>
          </li>
        ))}
      </ul>
      {typed && !topics.length && (
        <p className="sub">
          {provider ? "No direct match. Press Ask for a written answer." : "No direct match. Try other words, or turn on AI in Settings → Advanced for written answers."}
        </p>
      )}
      <p className="sub guide-footnote">Tip: press Ctrl + / (⌘ + / on Mac) to open the guide from anywhere.</p>
    </Modal>
  );
}
