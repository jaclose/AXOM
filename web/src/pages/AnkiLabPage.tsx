import { useMemo, useState } from "react";
import { Wand2, Copy, Check, Download, Save, Sparkles, Layers, FolderDown } from "lucide-react";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { dueCards } from "../lib/ankiCards";
import { GlassCard, GButton, PanelHeader, Tag } from "../components/ui/primitives";
import { Field, SelectField, TextAreaField } from "../components/ui/Modal";
import { CardVault } from "../components/anki/CardVault";
import { CardReviewMode } from "../components/anki/CardReviewMode";
import { AiCardGenerator } from "../components/anki/AiCardGenerator";
import { ICON_SIZE } from "../lib/iconSize";

type CardStyle = "cloze" | "qa" | "image";
type NoteType = "Basic" | "Basic and reversed" | "Cloze" | "Custom";

interface DraftCard {
  id: string;
  noteType: NoteType;
  cardType: "Cloze" | "Basic" | "Image occlusion";
  front: string;
  back: string;
  tags: string;
  source: string;
  difficulty: "Foundational" | "Medium" | "Hard";
  quality: number;
  reason: string;
}

const STYLE_LABEL: Record<CardStyle, string> = {
  cloze: "Cloze (facts)", qa: "Q&A (concepts)", image: "Image occlusion (diagrams)",
};

type LabTab = "vault" | "review" | "generate" | "prompt";

export function AnkiLabPage() {
  const [tab, setTab] = useState<LabTab>("vault");
  const dueCount = useStore((st) => dueCards(st.ankiCards ?? []).length);
  const cardCount = useStore((st) => (st.ankiCards ?? []).length);

  return (
    <>
      <GlassCard pad>
        <div className="row gap12" style={{ alignItems: "center" }}>
          <span className="folder-icon" style={{ color: "var(--purple)" }}><Wand2 size={ICON_SIZE.control} /></span>
          <div className="grow">
            <div style={{ fontSize: 18, fontWeight: 800 }}>Anki Lab</div>
            <div className="sub">Persistent card vault, in-app spaced review, reviewed AI generation, and the classic prompt studio.</div>
          </div>
          <Tag tone={dueCount ? "orange" : "green"}>{dueCount ? `${dueCount} due` : `${cardCount} cards`}</Tag>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {([
            ["vault", "Card vault", "anki-tab-vault"],
            ["review", `Review${dueCount ? ` (${dueCount})` : ""}`, "anki-tab-review"],
            ["generate", "AI generate", "anki-tab-generate"],
            ["prompt", "Prompt studio", "anki-tab-prompt"],
          ] as Array<[LabTab, string, string]>).map(([id, label, guide]) => (
            <button key={id} className={`filter-pill ${tab === id ? "on" : ""}`} onClick={() => setTab(id)} data-guide={guide}>{label}</button>
          ))}
        </div>
      </GlassCard>
      {tab === "vault" && <CardVault />}
      {tab === "review" && <CardReviewMode />}
      {tab === "generate" && <AiCardGenerator onOpenAiSettings={() => useUi.getState().requestSettings("ai")} />}
      {tab === "prompt" && <PromptStudio />}
    </>
  );
}

function PromptStudio() {
  const s = useStore();
  const [sourceItem, setSourceItem] = useState("");
  const [topic, setTopic] = useState("");
  const [system, setSystem] = useState("");
  const [maxCards, setMaxCards] = useState("20");
  const [styles, setStyles] = useState<Set<CardStyle>>(new Set(["cloze", "qa"]));
  const [content, setContent] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localCards, setLocalCards] = useState<DraftCard[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [noteType, setNoteType] = useState<NoteType>("Cloze");
  const [customFields, setCustomFields] = useState("Front,Back,Tags");

  // step 2 — paste AI output, export an Anki-importable file
  const [aiOut, setAiOut] = useState("");

  const lectures = s.tracker.filter((t) => (t.kind === "Lecture" || t.kind === "DLA") && !isBoardPrepSource(t.path, t.label));

  function toggleStyle(st: CardStyle) {
    setStyles((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return next;
    });
  }

  const prompt = useMemo(
    () => buildPrompt({ topic: topic || sourceLabel(lectures, sourceItem), system, maxCards, styles, content }),
    [topic, sourceItem, system, maxCards, styles, content, lectures],
  );

  function copyPrompt() {
    navigator.clipboard?.writeText(prompt);
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  }
  function savePrompt() {
    s.addPrompt({ title: `Anki cards — ${topic || sourceLabel(lectures, sourceItem) || "lecture"}`, category: "Anki", tags: ["anki", "generated"], body: prompt });
    setSaved(true); setTimeout(() => setSaved(false), 1400);
  }
  function downloadTxt() {
    download(`axom-anki-prompt.txt`, prompt, "text/plain");
  }
  function generateLocalCards() {
    const result = makeLocalCards({
      topic: topic || sourceLabel(lectures, sourceItem),
      system,
      maxCards: Number(maxCards) || 20,
      styles,
      noteType,
      content,
    });
    setLocalCards(result.cards);
    setWarnings(result.warnings);
  }
  function updateCard(id: string, patch: Partial<DraftCard>) {
    setLocalCards((cards) => cards.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  }
  function deleteCard(id: string) {
    setLocalCards((cards) => cards.filter((card) => card.id !== id));
  }
  function tsvBody(filter?: "Cloze" | "Basic") {
    if (aiOut.trim()) return toTsv(aiOut, system);
    const filtered = filter === "Cloze"
      ? localCards.filter((card) => card.noteType === "Cloze")
      : filter === "Basic"
        ? localCards.filter((card) => card.noteType !== "Cloze")
        : localCards;
    return cardsToTsv(filtered, customFields);
  }
  function exportTsv(filter?: "Cloze" | "Basic") {
    download(`axom-anki-${filter ? filter.toLowerCase().replace(/\s+/g, "-") : "review"}-import.txt`, tsvBody(filter), "text/plain");
  }
  function exportCsv(filter?: "Cloze" | "Basic") {
    download(`axom-anki-${filter ? filter.toLowerCase().replace(/\s+/g, "-") : "review"}-import.csv`, tsvToCsv(tsvBody(filter)), "text/csv");
  }
  const clozeCount = localCards.filter((card) => card.noteType === "Cloze").length;
  const basicCount = localCards.filter((card) => card.noteType !== "Cloze").length;

  return (
    <>
      <div className="grid grid-2">
        <GlassCard pad>
          <PanelHeader title="1 · Describe the source" sub="High-yield, not exhaustive — a sane deck beats a 500-card dump" />
          <div className="stack gap12">
            <SelectField label="From a tracked item (optional)" value={sourceItem} onChange={(e) => { setSourceItem(e.target.value); }}>
              <option value="">— none / paste below —</option>
              {lectures.map((l) => <option key={l.id} value={l.id}>{l.kind}: {l.label}</option>)}
            </SelectField>
            <div className="row gap12">
              <Field label="Topic / title" placeholder="NB 58 Emotions" value={topic} onChange={(e) => setTopic(e.target.value)} />
              <Field label="System tag" placeholder="Neuro" value={system} onChange={(e) => setSystem(e.target.value)} />
            </div>
            <div className="row gap12">
              <Field label="Max cards" type="number" value={maxCards} onChange={(e) => setMaxCards(e.target.value)} />
              <div className="grow">
                <span className="field-label">Card styles</span>
                <div className="row wrap gap6" style={{ marginTop: 6 }}>
                  {(Object.keys(STYLE_LABEL) as CardStyle[]).map((st) => (
                    <button key={st} className={`filter-pill ${styles.has(st) ? "on" : ""}`} onClick={() => toggleStyle(st)}>{STYLE_LABEL[st]}</button>
                  ))}
                </div>
              </div>
            </div>
            <TextAreaField label="Paste lecture / DLA / slide text" rows={7}
              placeholder="Paste the lecture notes or slide text here. (Slides & PDFs as direct uploads are a planned integration — for now, copy the text in.)"
              value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="row wrap gap8">
              <SelectField label="Default note type" value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
                <option>Basic</option>
                <option>Basic and reversed</option>
                <option>Cloze</option>
                <option>Custom</option>
              </SelectField>
              <Field label="Custom fields" placeholder="Front,Back,Tags" value={customFields} onChange={(e) => setCustomFields(e.target.value)} />
            </div>
            <GButton variant="primary" onClick={generateLocalCards} disabled={!content.trim()}>
              <Sparkles size={ICON_SIZE.body} /> Generate local draft cards
            </GButton>
          </div>
        </GlassCard>

        <GlassCard pad>
          <PanelHeader title="2 · Generated AI prompt" sub="Paste into Claude/ChatGPT — tuned for Anki import"
            action={
              <div className="row gap6">
                <GButton size="sm" onClick={copyPrompt}>{copied ? <><Check size={ICON_SIZE.body} /> Copied</> : <><Copy size={ICON_SIZE.body} /> Copy</>}</GButton>
                <GButton size="sm" onClick={savePrompt} title="Save to Prompt Library">{saved ? <Check size={ICON_SIZE.body} /> : <Save size={ICON_SIZE.body} />}</GButton>
                <GButton size="sm" onClick={downloadTxt} title="Download .txt"><Download size={ICON_SIZE.body} /></GButton>
              </div>} />
          <pre className="code-block">{prompt}</pre>
        </GlassCard>
      </div>

      <GlassCard pad>
        <PanelHeader title="3 · Browser-local draft cards" sub="Rule-based local generator for fast first drafts before AI polish" />
        {warnings.length > 0 && (
          <div className="stack gap8" style={{ marginBottom: 12 }}>
            {warnings.map((warning) => <div key={warning} className="form-warning">{warning}</div>)}
          </div>
        )}
        {localCards.length === 0 ? (
          <div className="dim">Paste lecture text and click Generate local draft cards.</div>
        ) : (
          <div className="anki-drafts">
            {localCards.map((card) => (
              <div className="draft-card" key={card.id}>
                <div className="row wrap gap6" style={{ justifyContent: "space-between" }}>
                  <div className="row wrap gap6">
                    <Tag tone={card.noteType === "Cloze" ? "purple" : "cyan"}>{card.noteType}</Tag>
                    <Tag tone="green">Q{card.quality}/10</Tag>
                    <Tag tone="neutral">{card.difficulty}</Tag>
                  </div>
                  <button type="button" className="tiny-link danger" onClick={() => deleteCard(card.id)}>Delete</button>
                </div>
                <TextAreaField label={card.noteType === "Cloze" ? "Text" : "Front"} rows={2}
                  value={card.front} onChange={(e) => updateCard(card.id, { front: e.target.value })} />
                {card.noteType !== "Cloze" && (
                  <TextAreaField label="Back" rows={2} value={card.back} onChange={(e) => updateCard(card.id, { back: e.target.value })} />
                )}
                <Field label="Tags" value={card.tags} onChange={(e) => updateCard(card.id, { tags: e.target.value })} />
                <div className="sub">{card.reason} · Source: {card.source}</div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="4 · Export to Anki" sub="Paste AI output or export the local draft cards"
          action={
            <div className="row gap6">
              <GButton size="sm" variant="primary" disabled={!aiOut.trim() && !localCards.length} onClick={() => exportTsv()}><Download size={ICON_SIZE.body} /> Review TSV</GButton>
              <GButton size="sm" disabled={!clozeCount} onClick={() => exportCsv("Cloze")}><Download size={ICON_SIZE.body} /> Cloze CSV</GButton>
              <GButton size="sm" disabled={!basicCount} onClick={() => exportCsv("Basic")}><Download size={ICON_SIZE.body} /> Basic CSV</GButton>
            </div>} />
        <TextAreaField label="Paste the cards the AI returned (Front : Back, or cloze text, one per line)"
          rows={6} placeholder={"What neurotransmitter is most implicated in depression? : Serotonin\n{{c1::Serotonin}} is the main monoamine targeted by SSRIs."}
          value={aiOut} onChange={(e) => setAiOut(e.target.value)} />
        <div className="sub" style={{ marginTop: 10 }}>
          In Anki: <b>File - Import</b>, set <b>Field separator: Tab</b>, allow HTML, and choose Basic, Cloze, or your custom note type.
          CSV exports are separated by note type so Cloze and Basic cards do not get mixed into the wrong Anki note type.
          Columns: <span className="mono">Front/Text, Back/Extra, Tags, Source, Difficulty, Card type</span>.
        </div>
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="5 · Your own card style & note types"
          sub="Load the AXOM / MADCOW glass card style, or build a custom note type"
          action={<a className="gbtn sm" href="https://drive.google.com/drive/u/0/folders/19_3nrTD66v_oCIKlruFVidirdCAIe8yp" target="_blank" rel="noreferrer noopener"><FolderDown size={ICON_SIZE.body} /> Get the Anki style</a>} />
        <div className="anki-guide">
          <div className="anki-guide-col">
            <div className="anki-guide-h">Install the styled deck</div>
            <ol className="import-steps">
              <li><b>Step 1:</b> Download the matching CSV above: Cloze for cloze notes, Basic for Q&A.</li>
              <li><b>Step 2:</b> Open Anki. [Screenshot placeholder: Anki home screen]</li>
              <li><b>Step 3:</b> Create/select the correct note type. [Screenshot placeholder: Manage Note Types]</li>
              <li><b>Step 4:</b> Match fields: Front/Text, Back/Extra, Tags, Source, Difficulty, Card type. [Screenshot placeholder: Field mapping screen]</li>
              <li><b>Step 5:</b> Apply the card styling/template from the drive. [Screenshot placeholder: Card template screen]</li>
              <li><b>Step 6:</b> Import. [Screenshot placeholder: Anki import screen]</li>
              <li><b>Step 7:</b> Review cards before studying; delete weak cards before they enter your reviews.</li>
            </ol>
          </div>
          <div className="anki-guide-col">
            <div className="anki-guide-h">Make your own note type</div>
            <ol className="import-steps">
              <li><b>Tools → Manage Note Types → Add</b> → clone <i>Basic</i> or <i>Cloze</i>, name it.</li>
              <li>Select it → <b>Fields…</b> to add fields (e.g. <span className="mono">Front, Back, Extra, Source, Tags</span>).</li>
              <li><b>Cards…</b> → edit the <i>Front</i>/<i>Back</i> templates and paste CSS into <b>Styling</b> for the glass look.</li>
              <li>When importing, set <b>Field separator</b> (Comma for .csv, Tab for .txt) and map columns to your fields.</li>
            </ol>
          </div>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>Drop me screenshots of your build and I'll bake the exact field map + styling steps into this guide.</div>
      </GlassCard>

      <GlassCard pad>
        <div className="sugg">
          <Sparkles size={ICON_SIZE.emphasis} style={{ color: "var(--cyan)" }} />
          <div className="grow">
            <div className="sugg-title">Planned: one-click generation</div>
            <div className="sugg-reason">Connect an AI key and drop a slide PDF to generate + auto-export decks. For now the prompt flow keeps it free, private, and offline.</div>
          </div>
          <Tag tone="neutral"><Layers size={ICON_SIZE.microInline} /> roadmap</Tag>
        </div>
      </GlassCard>
    </>
  );
}

function sourceLabel(lectures: { id: string; label: string }[], id: string): string {
  return lectures.find((l) => l.id === id)?.label ?? "";
}

function isBoardPrepSource(path: string, label: string): boolean {
  return /\b(step\s*[123]|step\s*2\s*ck|cbse|usmle|nbme|shelf|mcat|pre[-\s]?med)\b/i.test(`${path} ${label}`);
}

function buildPrompt({
  topic, system, maxCards, styles, content,
}: {
  topic: string; system: string; maxCards: string; styles: Set<CardStyle>; content: string;
}): string {
  const styleLines: string[] = [];
  if (styles.has("cloze")) styleLines.push("• Cloze deletions for discrete facts (one fact per card; prefer cloze over basic).");
  if (styles.has("qa")) styleLines.push("• Basic Q&A for concepts, mechanisms, and “why” reasoning.");
  if (styles.has("image")) styleLines.push("• For any diagram/figure, write an image-occlusion note describing what to occlude.");
  const tag = system ? ` Tag every card with "${system}".` : "";

  return `You are my medical-school study partner. Make high-yield Anki cards from the material below.

TOPIC: ${topic || "(see content)"}
LIMIT: at most ${maxCards || "20"} cards — only the highest-yield, testable facts. Do NOT pad the deck; a focused deck beats an exhaustive one (overload causes burnout).

CARD STYLES:
${styleLines.join("\n") || "• Cloze for facts; Q&A for concepts."}

RULES:
- One idea per card. Be precise and exam-relevant (USMLE-style).
- No fluff, no duplicates, no trivia.
- Output in a format I can paste straight into Anki:
  - Basic cards as:  Front : Back   (one per line)
  - Cloze cards as:  {{c1::answer}} embedded in the sentence (one per line)
- After the cards, add a one-line "Tag:" suggestion.${tag}

MATERIAL:
"""
${content || "(paste lecture / DLA / slide text here)"}
"""`;
}

// Lines that are slide boilerplate, headings, citations, codes — never cards.
const NOISE_RE: RegExp[] = [
  /copyright|all rights reserved|may not be copied|downloadable files|strictly illegal|permitted to make|view only files|alterations to the documents/i,
  /st\.?\s*george'?s university|school of medicine/i,
  /^(learning objectives?|road ?map|summary|outline|overview|terminology|notable|key concept)\b/i,
  /^som\.mk|^[a-z]{2,}\.\d|\bmicr\.\d|\.bpm\d/i,            // objective / module codes
  /https?:\/\/|www\.|\.com\b|\.org\b|\.gov\b|doi:|et al\.?|\bvolume:|\bissue:/i, // urls / citations
  /pubmed|sciencedirect|researchgate|libretexts|chegg|pinterest|theconversation|mdpi|wikipedia|microbiologykey|basicmedicalkey|lookfordiagnosis|textbookofbacteriology/i,
  /@\w+\.\w+/,                                              // emails
  /^(under investigation|adapted from|source|figure|fig\.?|table)\b/i,
];

function isNoise(l: string): boolean {
  if (l.length < 24) return true;
  const letters = l.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 12) return true;
  const lower = (l.match(/[a-z]/g) || []).length;
  if (lower < letters.length * 0.35) return true; // mostly caps → heading/title/code
  if ((l.match(/[A-Z]/g) || []).length > 6 && /^[A-Z][^a-z]*$/.test(l.split(" ")[0] || "")) return true;
  return NOISE_RE.some((re) => re.test(l));
}

function preprocessLectureText(content: string): string[] {
  return content
    .split(/\n+/)
    .map((l) => l.replace(/^(\d+[.)]\s*|[-*•✓▪–]\s*)/, "").trim())
    .map((l) => l.replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((line, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === line.toLowerCase()) === index)
    .filter((line) => !isNoise(line));
}

function analyzeContent(content: string, selectedSystem: string, topic: string): { warnings: string[]; correctedSystem?: string } {
  const haystack = `${topic} ${content}`.toLowerCase();
  const detected =
    /\b(bacter|lps|endotoxin|exotoxin|capsule|flora|virulence|colonization|infection|type iii|secretion system)\b/.test(haystack)
      ? "Microbiology::Bacteriology"
      : /\b(virus|viral|capsid|enveloped|replication|rna virus|dna virus)\b/.test(haystack)
        ? "Microbiology::Virology"
        : /\b(neuron|synapse|brain|spinal|cortex|neurotransmitter)\b/.test(haystack)
          ? "Neuro"
          : "";
  const warnings: string[] = [];
  const detectedParts = tagify(detected).split("::");
  const detectedTail = detectedParts[detectedParts.length - 1]?.toLowerCase() ?? "";
  if (selectedSystem && detected && !tagify(selectedSystem).toLowerCase().includes(detectedTail)) {
    warnings.push(`System tag check: your selected tag “${selectedSystem}” may not match the pasted content. Suggested tag: ${detected}.`);
  }
  if (!content.trim()) warnings.push("Paste lecture/DLA text first. The local generator does not invent cards from empty content.");
  return { warnings, correctedSystem: detected && !selectedSystem ? detected : undefined };
}

function conceptCards(content: string, styles: Set<CardStyle>, tag: string, topic: string): DraftCard[] {
  const text = content.toLowerCase();
  const cards: DraftCard[] = [];
  const addCloze = (front: string, reason: string, difficulty: DraftCard["difficulty"] = "Medium") => {
    if (styles.has("cloze")) cards.push(scoreCard(makeDraftCard({
      noteType: "Cloze", cardType: "Cloze", front, back: "", tags: tag, source: topic || "detected concept", difficulty, quality: 0, reason,
    })));
  };
  const addBasic = (front: string, back: string, reason: string, difficulty: DraftCard["difficulty"] = "Medium") => {
    if (styles.has("qa")) cards.push(scoreCard(makeDraftCard({
      noteType: "Basic", cardType: "Basic", front, back, tags: tag, source: topic || "detected concept", difficulty, quality: 0, reason,
    })));
  };

  if (/\bcolonization\b/.test(text)) {
    addCloze("{{c1::Colonization}} is the presence of microorganisms on body surfaces without tissue invasion or host damage.", "High-yield microbiology definition.");
  }
  if (/\binfection\b/.test(text)) {
    addCloze("{{c1::Infection}} involves microbial invasion and multiplication within host tissues.", "High-yield microbiology definition.");
  }
  if (/\bnormal flora|microbiota|commensal\b/.test(text)) {
    addBasic("How does normal flora prevent pathogen colonization?", "By nutrient competition, attachment-site exclusion, and antimicrobial production.", "Mechanism/consequence card.");
  }
  if (/\basplenic|spleen|encapsulated\b/.test(text)) {
    addBasic("Why are asplenic patients especially susceptible to encapsulated bacteria?", "The spleen is important for IgM-mediated clearance and opsonization of encapsulated organisms.", "Classic clinical association.");
  }
  if (/\blipid a|lps|endotoxin|tlr4|septic shock|dic\b/.test(text)) {
    addCloze("{{c1::Lipid A}} of LPS is the endotoxin component that activates TLR4 and can trigger septic shock/DIC.", "Mechanism plus clinical implication.", "Hard");
  }
  if (/\blysogenic conversion|temperate bacteriophage|bacteriophage|phage\b/.test(text)) {
    addBasic("What is lysogenic conversion?", "Acquisition or spread of virulence factors, such as exotoxins, through temperate bacteriophages.", "Mechanism vocabulary with exam relevance.");
  }
  if (/\btype iii|type 3|secretion system|inject/i.test(content)) {
    addCloze("{{c1::Type III secretion systems}} inject bacterial effector proteins directly into host cells.", "High-yield virulence mechanism.", "Hard");
  }
  if (/\bexotoxin|endotoxin\b/.test(text)) {
    addBasic("Compare exotoxins and endotoxins.", "Exotoxins are secreted protein toxins from Gram-positive or Gram-negative bacteria and are often highly specific. Endotoxin is Lipid A of Gram-negative LPS, released during lysis or shedding, activating TLR4 and inflammation.", "Compare/contrast framework.", "Hard");
  }
  return cards;
}

function scoreCard(card: DraftCard): DraftCard {
  const text = `${card.front} ${card.back}`.toLowerCase();
  let score = 5;
  if (/\bwhy|how|compare|mechanism|cause|leads to|activates|inhibits|prevents|results in\b/.test(text)) score += 2;
  if (/\bclinical|susceptible|shock|dic|opsonization|virulence|toxin|host|tissue|immune\b/.test(text)) score += 1.5;
  if (/\{\{c1::[^}]{3,80}\}\}/.test(card.front)) score += 1;
  if (card.front.length < 28 || card.front.length > 280) score -= 1.5;
  if (card.back.length > 420) score -= 1;
  if (NOISE_RE.some((re) => re.test(text))) score -= 4;
  if (/^(what is|define)\s+[a-z]{1,3}\??$/i.test(card.front)) score -= 2;
  return {
    ...card,
    quality: Math.max(1, Math.min(10, Math.round(score))),
    difficulty: card.difficulty || inferDifficulty(text),
  };
}

function inferDifficulty(value: string): DraftCard["difficulty"] {
  const hardTerms = /\b(tlr4|dic|opsonization|lysogenic|secretion system|pathogenesis|virulence|immunoglobulin|effector)\b/i;
  if (hardTerms.test(value)) return "Hard";
  if (value.length > 150 || /\bbecause|therefore|whereas|compare\b/i.test(value)) return "Medium";
  return "Foundational";
}

const CLOZE_VERB = /\b(is|are|causes?|inhibits?|stimulates?|activates?|presents? with|results? in|leads? to|increases?|decreases?|treats?|produces?|mediates?|requires?|prevents?|degrades?|enhances?|binds?|consists? of|refers? to)\b/i;

/** Cloze the ANSWER (the phrase after a key verb), never the subject. */
function pickCloze(line: string): string | null {
  const m = line.match(CLOZE_VERB);
  if (m && m.index !== undefined) {
    const after = line.slice(m.index + m[0].length).trim();
    const answer = after.split(/[,;:(]| - /)[0].trim().replace(/[.]+$/, "").trim();
    if (answer.length >= 4 && answer.split(/\s+/).length <= 9 && /[a-z]/i.test(answer)) {
      return line.replace(answer, `{{c1::${answer}}}`);
    }
  }
  return null; // refuse to force a bad cloze
}

function basicType(n: NoteType): NoteType { return n === "Cloze" || n === "Custom" ? "Basic" : n; }

function makeDraftCard(card: Omit<DraftCard, "id">): DraftCard {
  return { ...card, id: crypto.randomUUID() };
}

function lineToCard(line: string, styles: Set<CardStyle>, noteType: NoteType, tag: string, source: string): DraftCard | null {
  // "Term: definition" → clean Q&A or a clozed definition
  const def = line.match(/^([A-Za-z][\w +\-/()]{2,52}):\s+(.{12,})$/);
  if (def) {
    const term = def[1].trim();
    const body = def[2].trim();
    if (styles.has("qa")) return scoreCard(makeDraftCard({ noteType: basicType(noteType), cardType: "Basic", front: `What is ${term}?`, back: body, tags: tag, source, difficulty: "Foundational", quality: 0, reason: "Definition converted into an atomic Q&A." }));
    if (styles.has("cloze")) return scoreCard(makeDraftCard({ noteType: "Cloze", cardType: "Cloze", front: `{{c1::${term}}}: ${body}`, back: "", tags: tag, source, difficulty: "Foundational", quality: 0, reason: "Definition converted into a cloze card." }));
  }
  // declarative fact → cloze the answer
  if (styles.has("cloze")) {
    const c = pickCloze(line);
    if (c) return scoreCard(makeDraftCard({ noteType: "Cloze", cardType: "Cloze", front: c, back: "", tags: tag, source, difficulty: inferDifficulty(c), quality: 0, reason: "Mechanistic/declarative fact converted into cloze." }));
  }
  return null; // no clean card from this line — skip it
}

function makeLocalCards({
  topic, system, maxCards, styles, noteType, content,
}: {
  topic: string; system: string; maxCards: number; styles: Set<CardStyle>; noteType: NoteType; content: string;
}): { cards: DraftCard[]; warnings: string[] } {
  const analysis = analyzeContent(content, system, topic);
  const tag = tagify(analysis.correctedSystem || system || topic || "AXOM");
  const seen = new Set<string>();
  const candidates: DraftCard[] = [...conceptCards(content, styles, tag, topic)];
  const lines = preprocessLectureText(content);

  for (const line of lines) {
    if (styles.has("image") && /\b(figure|diagram|table|histology|gross|microscopy|specimen|agar|gram stain|morphology)\b/i.test(line)) {
      const key = `img:${line.slice(0, 40).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(scoreCard(makeDraftCard({
        noteType: "Basic",
        cardType: "Image occlusion",
        front: `Image occlusion: ${topic || "lecture figure"}`,
        back: `Occlude the key labels/findings from: ${line}`,
        tags: `${tag} image-occlusion`,
        source: line.slice(0, 90),
        difficulty: "Medium",
        quality: 0,
        reason: "Image/diagram language detected; create this as a visual card after screenshot upload.",
      })));
      continue;
    }

    const card = lineToCard(line, styles, noteType, tag, line.slice(0, 100));
    if (!card) continue;
    candidates.push(card);
  }

  const out: DraftCard[] = [];
  for (const card of candidates.sort((a, b) => b.quality - a.quality)) {
    const key = (card.front + card.back).toLowerCase().replace(/\s+/g, " ").slice(0, 92);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
    if (out.length >= maxCards) break;
  }
  return { cards: out, warnings: analysis.warnings };
}

function tagify(value: string): string {
  return value.trim().replace(/\s+/g, "::").replace(/[^\w:-]/g, "") || "AXOM";
}

function cardsToTsv(cards: DraftCard[], customFields: string): string {
  const fields = customFields.split(",").map((f) => f.trim()).filter(Boolean);
  return cards.map((card) => {
    if (card.noteType === "Custom" && fields.length) {
      return fields.map((field) => {
        const key = field.toLowerCase();
        if (key.includes("front") || key.includes("text")) return cleanField(card.front);
        if (key.includes("back") || key.includes("extra")) return cleanField(card.back);
        if (key.includes("tag")) return cleanField(card.tags);
        if (key.includes("source")) return cleanField(card.source);
        if (key.includes("difficulty")) return card.difficulty;
        if (key.includes("type")) return card.noteType;
        return "";
      }).join("\t");
    }
    return [
      cleanField(card.front),
      cleanField(card.back),
      cleanField(card.tags),
      cleanField(card.source),
      card.difficulty,
      card.cardType,
    ].join("\t");
  }).join("\n");
}

/** Convert "Front : Back" / cloze lines into tab-separated Anki import text. */
function toTsv(text: string, system: string): string {
  const tag = tagify(system || "AXOM");
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const idx = line.indexOf(" : ");
    if (idx > -1) return `${cleanField(line.slice(0, idx))}\t${cleanField(line.slice(idx + 3))}\t${tag}\tAI paste\tMedium\tBasic`;
    return `${cleanField(line)}\t\t${tag}\tAI paste\tMedium\tCloze`; // cloze line
  }).join("\n");
}

function cleanField(value: string): string {
  return value.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

function tsvToCsv(tsv: string): string {
  return tsv.split("\n").map((row) => row.split("\t").map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
