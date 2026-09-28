// ===========================================================================
// AI card generation (directive §11) — provider-gated, small batches, quality
// flags on every draft, and a mandatory approve/reject review before anything
// enters the vault. With no provider configured this renders setup guidance,
// never a fake button.
// ===========================================================================
import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Check, X } from "lucide-react";
import { useStore } from "../../lib/store";
import {
  checkProviderHealth, generateCardDrafts, loadAiSettings, resolveActiveProvider, TASK_LIMITS,
  type CardGenerationStyle, type GeneratedCardDraft,
} from "../../lib/ai";
import { newSchedule, reviewCardQuality, type CardQualityFlag } from "../../lib/ankiCards";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../ui/primitives";
import { Field, SelectField, TextAreaField } from "../ui/Modal";
import { pushToast } from "../../lib/toast";
import { hashGenerationInput, saveAiGeneration } from "../../lib/aiGenerations";
import { ICON_SIZE } from "../../lib/iconSize";

const STYLES: Array<{ id: CardGenerationStyle; label: string }> = [
  { id: "concise", label: "Concise" },
  { id: "detailed", label: "Detailed" },
  { id: "cloze-heavy", label: "Cloze-heavy" },
  { id: "clinical-vignette-heavy", label: "Clinical vignettes" },
  { id: "exam-style", label: "Exam-style" },
  { id: "mechanism-focused", label: "Mechanism-focused" },
  { id: "image-labeling", label: "Image-labeling placeholders" },
];

interface DraftWithFlags extends GeneratedCardDraft {
  flags: CardQualityFlag[];
  accepted: boolean;
}

export function AiCardGenerator({ onOpenAiSettings }: { onOpenAiSettings: () => void }) {
  const s = useStore();
  const [health, setHealth] = useState<{ ok: boolean; detail: string } | null>(null);
  const [material, setMaterial] = useState("");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState("");
  const [style, setStyle] = useState<CardGenerationStyle>("concise");
  const [maxCards, setMaxCards] = useState("6");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<DraftWithFlags[]>([]);
  const [promptVersion, setPromptVersion] = useState("");
  const settings = loadAiSettings();
  const tooLong = material.length > TASK_LIMITS.materialChars;

  useEffect(() => {
    let stopped = false;
    checkProviderHealth().then((result) => { if (!stopped) setHealth(result); });
    return () => { stopped = true; };
  }, []);

  async function generate() {
    const provider = resolveActiveProvider();
    if (!provider) return;
    setBusy(true);
    try {
      const requestedMaxCards = Math.max(1, Math.min(TASK_LIMITS.maxCards, Number(maxCards) || 6));
      const result = await generateCardDrafts(provider, {
        material,
        topic: topic || undefined,
        style,
        maxCards: requestedMaxCards,
        source: source || undefined,
      });
      const existing = s.ankiCards ?? [];
      setPromptVersion(result.promptVersion);
      setDrafts(result.drafts.map((d) => ({
        ...d,
        flags: reviewCardQuality({ type: d.type, front: d.front, back: d.back, source: d.source, aiGenerated: true }, existing),
        accepted: true,
      })));
      void saveAiGeneration({
        kind: "flashcards",
        title: topic.trim() || source.trim() || "AI flashcards",
        inputHash: hashGenerationInput({ material, topic, source, style, maxCards: requestedMaxCards }),
        model: settings.mode === "local" ? settings.localModel : provider.info.label,
        promptVersion: result.promptVersion,
        content: result.drafts,
        metadata: {
          provider: provider.info.label,
          sourceReference: source || undefined,
          topic: topic || undefined,
          style,
          warnings: result.warnings,
        },
      });
      if (result.warnings.length) {
        pushToast({ title: "Some drafts were dropped", body: result.warnings.slice(0, 2).join(" "), tone: "warn" });
      }
    } catch (err) {
      pushToast({ title: "Generation failed", body: err instanceof Error ? err.message : "Unknown error.", tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  function saveAccepted() {
    const provider = resolveActiveProvider();
    const accepted = drafts.filter((d) => d.accepted);
    const result = s.addAnkiCards(accepted.map((d) => ({
      type: d.type,
      front: d.front,
      back: d.back,
      extra: d.extra,
      tags: [...d.tags, "ai-generated"],
      source: d.source ?? source ?? undefined,
      aiGenerated: true,
      generation: { provider: provider?.info.label ?? "unknown", promptVersion },
      schedule: newSchedule(),
    })));
    pushToast({
      title: `${result.saved} card${result.saved === 1 ? "" : "s"} added to the vault`,
      body: result.errors.length ? `Skipped: ${result.errors.join(" ")}` : "They're due now in the review queue.",
      tone: result.saved ? "success" : "warn",
    });
    setDrafts([]);
  }

  const providerReady = health?.ok && (settings.mode === "local" ? Boolean(settings.localModel) : true);

  return (
    <GlassCard data-guide="anki-ai-generator">
      <PanelHeader
        title="Generate cards with AI"
        sub="Small reviewed batches, quality over volume. Every draft is editable and nothing saves without your approval."
        action={health && (
          <Tag tone={providerReady ? "green" : "orange"}>
            {settings.mode === "mock" ? "Demo mode" : settings.mode === "local" ? "Local AI" : settings.mode === "cloud" ? "AXOM Cloud AI" : "AI off"}
          </Tag>
        )}
      />

      {!providerReady ? (
        <EmptyState
          title="No AI provider is active"
          hint={health?.detail ?? "Checking provider…"}
          icon={<Sparkles size={ICON_SIZE.emphasis} />}
        />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <TextAreaField label="Study material (notes, objectives, an explanation…)" rows={5}
            value={material} onChange={(e) => setMaterial(e.target.value)} />
          {material.length > 0 && (
            <p className="sub" style={tooLong ? { color: "var(--grade-orange)" } : undefined}>
              {material.length.toLocaleString()} / {TASK_LIMITS.materialChars.toLocaleString()} characters{tooLong ? ". Split it into smaller sections." : ""}
            </p>
          )}
          <div className="grid grid-2">
            <Field label="Topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} />
            <Field label="Source reference" value={source} onChange={(e) => setSource(e.target.value)} placeholder="lecture 39, textbook ch. 4…" />
            <SelectField label="Style" value={style} onChange={(e) => setStyle(e.target.value as CardGenerationStyle)}>
              {STYLES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
            </SelectField>
            <Field label={`Max cards (≤${TASK_LIMITS.maxCards})`} type="number" min={1} max={TASK_LIMITS.maxCards} value={maxCards}
              onChange={(e) => setMaxCards(e.target.value)} />
          </div>
          <div className="row">
            <GButton variant="primary" disabled={busy || !material.trim() || tooLong} onClick={generate}>
              {busy ? <RefreshCw size={ICON_SIZE.body} className="spin" /> : <Sparkles size={ICON_SIZE.body} />} {busy ? "Generating…" : "Generate drafts"}
            </GButton>
          </div>
        </div>
      )}

      {!providerReady && (
        <div className="row" style={{ marginTop: 10 }}>
          <GhostButton onClick={onOpenAiSettings}>Open AI settings</GhostButton>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="stack" style={{ gap: 10, marginTop: 16 }}>
          <div className="spread">
            <span className="field-label">Review {drafts.length} drafts — uncheck what you don't want</span>
            <GButton size="sm" variant="primary" disabled={!drafts.some((d) => d.accepted)} onClick={saveAccepted}>
              <Check size={ICON_SIZE.body} /> Save {drafts.filter((d) => d.accepted).length} to vault
            </GButton>
          </div>
          {drafts.map((d, i) => (
            <div key={i} className={`card-row ${d.accepted ? "" : "suspended"}`}>
              <button
                className="grow stack card-row-main"
                onClick={() => setDrafts((all) => all.map((x, j) => (j === i ? { ...x, accepted: !x.accepted } : x)))}
              >
                <span style={{ fontWeight: 600 }}>{d.front}</span>
                {d.back && <span className="sub">{d.back}</span>}
                {d.flags.length > 0 && (
                  <span className="sub" style={{ color: "var(--grade-orange)" }}>
                    {d.flags.map((f) => f.message).join(" · ")}
                  </span>
                )}
              </button>
              <Tag tone="purple">AI</Tag>
              {d.accepted ? <Check size={ICON_SIZE.body} /> : <X size={ICON_SIZE.body} className="dim" />}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
