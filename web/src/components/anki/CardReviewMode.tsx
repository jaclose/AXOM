// ===========================================================================
// In-app card review — the due queue with front → reveal → rate (again/hard/
// good/easy). Scheduling is the lightweight SM-2 flavor in lib/ankiCards;
// serious long-term review still belongs in Anki via export, and this never
// pretends otherwise. Keys follow Anki: Space/Enter reveals, 1–4 rate.
// With AI on, a coach can explain the card, offer a memory hook, or propose
// a sharper rewrite that is applied only when accepted.
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { Lightbulb, Sparkles, WandSparkles } from "lucide-react";
import { useStore } from "../../lib/store";
import { dueCards, type AnkiCard, type ReviewRating } from "../../lib/ankiCards";
import { cardMnemonic, explainCard, resolveActiveProvider, sharpenCard, type CardRewrite } from "../../lib/ai";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { pushToast } from "../../lib/toast";

const NO_CARDS: AnkiCard[] = [];

const RATINGS: Array<{ rating: ReviewRating; label: string; hint: string; key: string }> = [
  { rating: "again", label: "Again", hint: "10 min", key: "1" },
  { rating: "hard", label: "Hard", hint: "shorter step", key: "2" },
  { rating: "good", label: "Good", hint: "normal step", key: "3" },
  { rating: "easy", label: "Easy", hint: "longer step", key: "4" },
];

/** Render cloze text with deletions hidden (front) or revealed (back). */
function clozeText(text: string, revealed: boolean): string {
  return text.replace(/\{\{c\d+::([^}]+?)(?:::[^}]*)?\}\}/g, (_, answer: string) => (revealed ? `[${answer}]` : "[…]"));
}

type CoachState =
  | { kind: "idle" }
  | { kind: "busy"; action: string }
  | { kind: "text"; title: string; text: string }
  | { kind: "rewrite"; rewrite: CardRewrite };

export function CardReviewMode() {
  const s = useStore();
  const cards = s.ankiCards ?? NO_CARDS;
  const [revealed, setRevealed] = useState(false);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [doneCount, setDoneCount] = useState(0);
  const [coach, setCoach] = useState<CoachState>({ kind: "idle" });
  const provider = useMemo(() => resolveActiveProvider(), []);

  const queue = useMemo(() => dueCards(cards), [cards]);
  const card = queue[0];

  function rate(rating: ReviewRating) {
    if (!card) return;
    s.reviewAnkiCard(card.id, rating, Date.now() - shownAt, `${card.id}:${shownAt}`);
    setRevealed(false);
    setShownAt(Date.now());
    setDoneCount((n) => n + 1);
    setCoach({ kind: "idle" });
  }

  useEffect(() => {
    if (!card) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        if (target?.closest("button")) return;
        setRevealed(true);
        event.preventDefault();
      } else if (revealed) {
        const match = RATINGS.find((item) => item.key === event.key);
        if (match) { rate(match.rating); event.preventDefault(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function runCoach(action: "explain" | "hook" | "sharpen") {
    if (!provider || !card) return;
    setCoach({ kind: "busy", action });
    try {
      if (action === "sharpen") {
        setCoach({ kind: "rewrite", rewrite: await sharpenCard(provider, card) });
      } else {
        const text = action === "explain" ? await explainCard(provider, card) : await cardMnemonic(provider, card);
        setCoach({ kind: "text", title: action === "explain" ? "Why this is true" : "Memory hook", text });
      }
    } catch (error) {
      setCoach({ kind: "idle" });
      pushToast({ title: "AI coach unavailable", body: error instanceof Error ? error.message : "Unknown error.", tone: "warn" });
    }
  }

  function acceptRewrite(rewrite: CardRewrite) {
    if (!card) return;
    s.updateAnkiCard(card.id, {
      front: rewrite.front,
      back: rewrite.back,
      extra: [card.extra, `Previous version: ${card.front} → ${card.back}`].filter(Boolean).join("\n"),
    });
    setCoach({ kind: "idle" });
    pushToast({ title: "Card updated", body: "The previous wording is kept in the card's extra field.", tone: "success" });
  }

  if (!card) {
    return (
      <GlassCard>
        <PanelHeader title="Review queue" sub="Due cards, scheduled by your ratings." />
        <EmptyState
          title={doneCount > 0 ? `Queue clear — ${doneCount} reviewed` : "Nothing due right now"}
          hint={cards.length === 0
            ? "Add cards to the vault first; they become due immediately."
            : "Come back when the schedule surfaces the next batch. That's the system working."}
        />
      </GlassCard>
    );
  }

  const isCloze = card.type === "cloze";

  return (
    <GlassCard>
      <PanelHeader
        title="Review queue"
        sub={`${queue.length} due · ${doneCount} done this sitting · Space reveals, 1–4 rate`}
        action={card.aiGenerated ? <Tag tone="purple">AI-generated — verify against source</Tag> : undefined}
      />
      <div className="review-face">
        <div className="review-front">{isCloze ? clozeText(card.front, revealed) : card.front}</div>
        {revealed && (
          <>
            {!isCloze && <div className="review-back">{card.back}</div>}
            {card.extra && <div className="sub" style={{ whiteSpace: "pre-wrap" }}>{card.extra}</div>}
            {card.source && <div className="sub">Source: {card.source}</div>}
          </>
        )}
      </div>
      <div className="row" style={{ justifyContent: "center", marginTop: 14, gap: 8, flexWrap: "wrap" }}>
        {!revealed ? (
          <GButton variant="primary" onClick={() => setRevealed(true)}>Show answer</GButton>
        ) : (
          RATINGS.map(({ rating, label, hint, key }) => (
            <GButton key={rating} variant={rating === "good" ? "primary" : "default"} onClick={() => rate(rating)} aria-keyshortcuts={key}>
              {label} <span className="dim" style={{ fontSize: 11 }}>{hint} · {key}</span>
            </GButton>
          ))
        )}
      </div>

      {revealed && provider && (
        <section className="review-coach" aria-label="AI card coach">
          <div className="review-coach-actions">
            <span className="review-coach-label"><Sparkles size={ICON_SIZE.microInline} aria-hidden="true" /> Coach · {provider.info.label}</span>
            <GhostButton onClick={() => void runCoach("explain")} disabled={coach.kind === "busy"}><Lightbulb size={ICON_SIZE.body} /> Explain</GhostButton>
            <GhostButton onClick={() => void runCoach("hook")} disabled={coach.kind === "busy"}><Sparkles size={ICON_SIZE.body} /> Memory hook</GhostButton>
            <GhostButton onClick={() => void runCoach("sharpen")} disabled={coach.kind === "busy"}><WandSparkles size={ICON_SIZE.body} /> Sharpen card</GhostButton>
          </div>
          {coach.kind === "busy" && <p className="sub" role="status">Thinking…</p>}
          {coach.kind === "text" && (
            <div className="review-coach-output" role="status">
              <b>{coach.title}</b>
              <p>{coach.text}</p>
              <small>AI suggestion — check it against your source.</small>
            </div>
          )}
          {coach.kind === "rewrite" && (
            <div className="review-coach-output" role="status">
              <b>Suggested rewrite</b>
              <dl>
                <div><dt>Front</dt><dd>{coach.rewrite.front}</dd></div>
                <div><dt>Back</dt><dd>{coach.rewrite.back || "—"}</dd></div>
              </dl>
              {coach.rewrite.why && <small>{coach.rewrite.why}</small>}
              <div className="row gap8">
                <GButton size="sm" variant="primary" onClick={() => acceptRewrite(coach.rewrite)}>Use this version</GButton>
                <GhostButton onClick={() => setCoach({ kind: "idle" })}>Keep mine</GhostButton>
              </div>
            </div>
          )}
        </section>
      )}
    </GlassCard>
  );
}
