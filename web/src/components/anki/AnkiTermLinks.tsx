import { useMemo, useState } from "react";
import { Check, Download, Layers, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { useStore } from "../../lib/store";
import { ankiClientFromSettings } from "../../lib/anki/linkSettings";
import { buildCourseCatalog } from "../../lib/anki/courseAdapter";
import {
  availableModuleWeeks, axomTagForScope, createTermDecks, previewPremadeUnsuspend, termDeckPaths, unsuspendPreviewedCards,
  type AnkiCourseScope, type PremadeScopeLink, type TermDeckReceipt, type UnsuspendPreview, type UnsuspendReceipt,
} from "../../lib/anki/termLinks";
import { ankiScopeKey, removeTermLink, saveTermLink, useTermLinks } from "../../lib/anki/termLinkStore";
import { ICON_SIZE } from "../../lib/iconSize";
import { GlassCard, GButton, PanelHeader, Tag } from "../ui/primitives";

type ScopeKind = AnkiCourseScope["kind"];

function downloadReceipt(receipt: UnsuspendReceipt) {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `axom-anki-unsuspend-${receipt.completedAtUtc.slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AnkiTermLinks() {
  const terms = useStore((state) => state.terms);
  const courses = useStore((state) => state.courses);
  const tracker = useStore((state) => state.tracker);
  const cards = useStore((state) => state.ankiCards);
  const savedLinks = useTermLinks();
  const boardCount = terms.filter((term) => term.name.toLowerCase() === "boards").length;
  const catalog = useMemo(() => buildCourseCatalog({ terms, courses, tracker }), [terms, courses, tracker]);

  const [termId, setTermId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [week, setWeek] = useState(0);
  const [kind, setKind] = useState<ScopeKind>("term");
  const [deckName, setDeckName] = useState("");
  const [tag, setTag] = useState("");
  const [profile, setProfile] = useState("");
  const [decks, setDecks] = useState<string[]>([]);
  const [preview, setPreview] = useState<UnsuspendPreview | null>(null);
  const [receipt, setReceipt] = useState<UnsuspendReceipt | null>(null);
  const [termReceipt, setTermReceipt] = useState<TermDeckReceipt | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedTerm = terms.find((term) => term.id === termId) ?? terms[0];
  const termCourses = courses.filter((course) => course.termId === selectedTerm?.id);
  const selectedCourse = termCourses.find((course) => course.id === courseId) ?? termCourses[0];
  const selectedModule = selectedCourse?.modules.find((module) => module.id === moduleId) ?? selectedCourse?.modules[0];
  const weeks = selectedModule ? availableModuleWeeks(catalog, selectedModule.id) : [];
  const selectedWeek = weeks.includes(week) ? week : weeks[0];
  const paths = selectedTerm ? termDeckPaths(catalog, selectedTerm.id) : [];
  const localCardCount = (cards ?? []).filter((card) => termCourses.some((course) => course.id === card.courseId)).length;
  const scope: AnkiCourseScope | null = !selectedTerm ? null : kind === "term"
    ? { kind: "term", termId: selectedTerm.id }
    : !selectedCourse || !selectedModule ? null : kind === "module"
      ? { kind: "module", termId: selectedTerm.id, courseId: selectedCourse.id, moduleId: selectedModule.id }
      : selectedWeek === undefined ? null
        : { kind: "week", termId: selectedTerm.id, courseId: selectedCourse.id, moduleId: selectedModule.id, week: selectedWeek };
  const link: PremadeScopeLink | null = scope ? { scope, deckName, tag } : null;
  const currentSaved = scope ? savedLinks.find((item) => ankiScopeKey(item.scope) === ankiScopeKey(scope)) : undefined;

  function clearPreview() {
    setPreview(null);
    setReceipt(null);
    setConfirmed(false);
    setMessage("");
    setError("");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Anki could not complete the request."); }
    finally { setBusy(false); }
  }

  function selectSavedLink(saved: PremadeScopeLink) {
    setTermId(saved.scope.termId);
    setKind(saved.scope.kind);
    setCourseId(saved.scope.kind === "term" ? "" : saved.scope.courseId);
    setModuleId(saved.scope.kind === "term" ? "" : saved.scope.moduleId);
    setWeek(saved.scope.kind === "week" ? saved.scope.week : 0);
    setDeckName(saved.deckName);
    setTag(saved.tag);
    clearPreview();
  }

  return (
    <div className="stack gap12">
      <GlassCard pad>
        <PanelHeader title="Term decks" sub="Preview your AXOM course structure. Creating decks adds empty folders in Anki and moves no cards."
          action={<Tag tone="neutral"><Layers size={ICON_SIZE.microInline} /> {terms.length - boardCount} terms{boardCount ? " + Boards" : ""}</Tag>} />
        {!selectedTerm || paths.length === 0 ? (
          <p className="sub">Set up your terms and courses in Course Tracker first.</p>
        ) : (
          <div className="stack gap12">
            <label className="stack gap6">
              <span className="field-label">AXOM term</span>
              <select className="field" value={selectedTerm.id} onChange={(event) => { setTermId(event.target.value); setCourseId(""); setModuleId(""); setWeek(0); clearPreview(); }}>
                {terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
              </select>
            </label>
            <div className="sub">{termCourses.length} courses · {termCourses.reduce((sum, course) => sum + course.modules.length, 0)} modules · {localCardCount} AXOM cards</div>
            <details>
              <summary>Preview {paths.length} deck paths</summary>
              <ul>{paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
            </details>
            <div className="row wrap gap8">
              <GButton size="sm" onClick={() => run(async () => {
                const client = ankiClientFromSettings();
                const active = await client.call<string>("getActiveProfile");
                const names = await client.call<string[]>("deckNames");
                setProfile(active); setDecks(names); setMessage(`Connected to Anki profile ${active}.`);
              })} disabled={busy}>
                <RefreshCw size={ICON_SIZE.body} /> {profile ? "Refresh Anki" : "Connect to Anki"}
              </GButton>
              <GButton variant="primary" onClick={() => run(async () => {
                const result = await createTermDecks(ankiClientFromSettings(), catalog, selectedTerm.id, profile || undefined);
                setTermReceipt(result); setProfile(result.profile);
                setMessage(`${result.created.length} term decks created and ${result.paths.length} paths verified in Anki.`);
              })} disabled={busy || !profile}>
                <Layers size={ICON_SIZE.body} /> Create term decks
              </GButton>
              {profile && <Tag tone="green"><Check size={ICON_SIZE.microInline} /> {profile}</Tag>}
            </div>
            {termReceipt && <p className="sub" role="status">{termReceipt.created.length} new paths. Existing Anki cards and decks stayed in place.</p>}
          </div>
        )}
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="AnKing links" sub="Connect one AXOM term, module, or tracked week to an exact tag in a premade deck. Preview before any card changes."
          action={<Tag tone="neutral"><Link2 size={ICON_SIZE.microInline} /> {savedLinks.length} saved</Tag>} />
        {!selectedTerm ? <p className="sub">Add a term in Course Tracker to create a link.</p> : (
          <div className="stack gap12">
            <div className="gap12" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))" }}>
              <label className="stack gap6 grow"><span className="field-label">AXOM scope</span>
                <select className="field" value={kind} onChange={(event) => { setKind(event.target.value as ScopeKind); clearPreview(); }}>
                  <option value="term">Entire term</option><option value="module">Module</option><option value="week">Week</option>
                </select>
              </label>
              {kind !== "term" && <>
                <label className="stack gap6 grow"><span className="field-label">Course</span>
                  <select className="field" value={selectedCourse?.id ?? ""} onChange={(event) => { setCourseId(event.target.value); setModuleId(""); setWeek(0); clearPreview(); }}>
                    {termCourses.map((course) => <option key={course.id} value={course.id}>{course.code || course.name}</option>)}
                  </select>
                </label>
                <label className="stack gap6 grow"><span className="field-label">Module</span>
                  <select className="field" value={selectedModule?.id ?? ""} onChange={(event) => { setModuleId(event.target.value); setWeek(0); clearPreview(); }}>
                    {(selectedCourse?.modules ?? []).map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
                  </select>
                </label>
              </>}
              {kind === "week" && <label className="stack gap6 grow"><span className="field-label">Tracked week</span>
                <select className="field" value={selectedWeek ?? ""} disabled={!weeks.length} onChange={(event) => { setWeek(Number(event.target.value)); clearPreview(); }}>
                  {weeks.map((value) => <option key={value} value={value}>Week {value}</option>)}
                </select>
              </label>}
            </div>
            {kind === "week" && !weeks.length && <p className="sub" role="status">This module has no tracked week yet. Load its course plan in Course Tracker first.</p>}
            <div className="gap12" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))" }}>
              <label className="stack gap6 grow"><span className="field-label">Premade deck in Anki</span>
                <input className="field" list="anki-premade-decks" value={deckName} onChange={(event) => { setDeckName(event.target.value); clearPreview(); }} placeholder="Choose an exact deck name" />
                <datalist id="anki-premade-decks">{decks.map((name) => <option key={name} value={name} />)}</datalist>
              </label>
              <label className="stack gap6 grow"><span className="field-label">Exact AnKing tag</span>
                <input className="field" value={tag} onChange={(event) => { setTag(event.target.value); clearPreview(); }} placeholder="Paste the tag from Anki" spellCheck={false} />
              </label>
            </div>
            {scope && <p className="sub">AXOM scope tag: <code>{axomTagForScope(catalog, scope)}</code>. Link it to your chosen AnKing deck and tag. Cards keep their deck, tags, review history, and schedule.</p>}
            <div className="row wrap gap8">
              <GButton size="sm" onClick={() => { if (!link) return; saveTermLink(link); setMessage("Link saved on this device."); }} disabled={!link || !deckName.trim() || !tag.trim() || /\s/.test(tag.trim()) || busy}>
                <Link2 size={ICON_SIZE.body} /> {currentSaved ? "Update link" : "Save link"}
              </GButton>
              <GButton variant="primary" onClick={() => run(async () => {
                if (!link) throw new Error("Choose a complete AXOM scope first.");
                const result = await previewPremadeUnsuspend(ankiClientFromSettings(), catalog, link);
                setPreview(result); setReceipt(null); setConfirmed(false); setProfile(result.profile);
                setMessage(`${result.cardIds.length} suspended cards match in ${result.profile}.`);
              })} disabled={!link || busy}>
                <ShieldCheck size={ICON_SIZE.body} /> Preview suspended cards
              </GButton>
              {currentSaved && <GButton size="sm" onClick={() => { removeTermLink(currentSaved.scope); clearPreview(); setMessage("Saved link removed from this device."); }}>Remove saved link</GButton>}
            </div>
            {preview && <div className="stack gap8" role="region" aria-label="AnKing card preview">
              <b>{preview.cardIds.length} suspended cards match</b>
              <span className="sub">Profile: {preview.profile}. Only these exact card IDs can be unsuspended.</span>
              <details><summary>Show exact card IDs</summary><div className="mono" style={{ maxHeight: 160, overflow: "auto", overflowWrap: "anywhere" }}>{preview.cardIds.join(", ") || "None"}</div></details>
              <label className="row gap8"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!preview.cardIds.length || busy} />
                <span>I checked the matching cards and want to unsuspend them in Anki.</span></label>
              <GButton variant="primary" onClick={() => run(async () => {
                const result = await unsuspendPreviewedCards(ankiClientFromSettings(), catalog, preview);
                setReceipt(result); setPreview(null); setConfirmed(false);
                setMessage(result.complete ? `${result.unsuspendedCardIds.length} cards unsuspended and verified.` : `${result.unsuspendedCardIds.length} cards changed; ${result.stillSuspendedCardIds.length} remain. Refresh before retrying.`);
              })} disabled={!confirmed || busy || !preview.cardIds.length}>Unsuspend previewed cards</GButton>
            </div>}
            {receipt && <div className="row wrap gap8" role="status">
              <Tag tone={receipt.complete ? "green" : "orange"}>{receipt.unsuspendedCardIds.length} verified unsuspended</Tag>
              <GButton size="sm" onClick={() => downloadReceipt(receipt)}><Download size={ICON_SIZE.body} /> Download receipt</GButton>
            </div>}
            {receipt?.error && <p className="sub" role="alert">Anki stopped early: {receipt.error}</p>}
            {message && <p className="sub" role="status">{message}</p>}
            {error && <p className="sub" role="alert">{error}</p>}
            {savedLinks.some((item) => item.scope.termId === selectedTerm.id) && <details>
              <summary>Saved links for {selectedTerm.name}</summary>
              <div className="stack gap8">
                {savedLinks.filter((item) => item.scope.termId === selectedTerm.id).map((item) => <div key={ankiScopeKey(item.scope)} className="row wrap gap8">
                  <span className="grow">{item.scope.kind === "week" ? `Week ${item.scope.week}` : item.scope.kind === "module" ? "Module" : "Term"} · {item.deckName} · <code>{item.tag}</code></span>
                  <GButton size="sm" onClick={() => selectSavedLink(item)}>Use</GButton>
                </div>)}
              </div>
            </details>}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
