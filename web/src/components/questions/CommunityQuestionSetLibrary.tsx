import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, Download, Heart, Play, RefreshCw, Search } from "lucide-react";
import type { QuestionSet } from "../../lib/library";
import { useAccount } from "../../lib/account/accountStore";
import { readSharedQuestionImportProvenance } from "../../lib/sharing/questionSetShare";
import {
  authorizeQuestionSetLibraryImport, loadQuestionSetLibraryPreview, searchQuestionSetLibrary, setQuestionSetLibraryLike,
  type LibraryQuestionSet, type LibraryQuestionSetPreview,
} from "../../lib/sharing/questionSetLibrary";
import { useStore } from "../../lib/store";
import { Modal } from "../ui/Modal";
import { GButton, GlassCard, GhostButton, PanelHeader, Tag } from "../ui/primitives";
import "../../styles/question-set-library.css";

/**
 * Published visual:* tags are planning metadata, not ordinary subject tags
 * or proof that a diagram has passed medical/licensing review. Keep them
 * searchable in the immutable snapshot, but label them accurately in UI.
 */
const PUBLIC_VISUAL_INTENTS: Readonly<Record<string, string>> = {
  "anatomical-schematic": "anatomical schematic",
  "histology-micrograph": "histology micrograph",
  "pathology-comparison": "pathology comparison",
  "gross-pathology-specimen": "gross pathology specimen",
  "microbiology-image": "microbiology image",
  "mechanism-diagram": "mechanism diagram",
};
const topicTags = (tags: readonly string[]) => tags.filter(tag => !tag.startsWith("visual:"));

function VisualIntentNote({ tags }: { tags: readonly string[] }) {
  // An unknown or prototype-inherited tag must not hide a later valid hint
  // or render as a clinical label. Show at most three distinct known intents.
  const recognized: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith("visual:intent:")) continue;
    const kind = tag.slice("visual:intent:".length);
    if (!Object.prototype.hasOwnProperty.call(PUBLIC_VISUAL_INTENTS, kind)) continue;
    const label = PUBLIC_VISUAL_INTENTS[kind];
    if (recognized.includes(label)) continue;
    recognized.push(label);
    if (recognized.length === 3) break;
  }
  if (!recognized.length) return null; // Unknown metadata is not medical evidence.
  const keywords = tags.filter(tag => tag.startsWith("visual:keyword:"))
    .map(tag => tag.slice("visual:keyword:".length))
    .filter(keyword => keyword.length >= 3 && keyword.length <= 49).slice(0, 3);
  return <p className="sub">Visual intent metadata: {recognized.join(", ")}{keywords.length ? ` · ${keywords.join(", ")}` : ""}.
    No diagram is included. Medical accuracy and media rights require separate review.</p>;
}

// A user can sign out and return to the same account while an async request is
// pending. Account-ID equality alone cannot authorize that older operation.
// Subscribe for the operation lifetime, without coupling QBank to cloud sync.
function observeAccountSession(accountId: string, onRevoked: () => void) {
  let revoked = useAccount.getState().user?.id !== accountId;
  const unsubscribe = useAccount.subscribe(state => {
    if (!revoked && state.user?.id !== accountId) {
      revoked = true;
      // Clear pending UI immediately; a batched A → B → A transition may
      // never produce the accountId effect's intermediate render.
      onRevoked();
    }
  });
  return {
    current: () => !revoked && useAccount.getState().user?.id === accountId,
    stop: unsubscribe,
  };
}

export function CommunityQuestionSetLibrary({ onPractice }: { onPractice?: (set: QuestionSet) => void }) {
  const accountId = useAccount(state => state.user?.id);
  // Search text is private account activity. Switching A → B must hide A's
  // input immediately and must never send A's submitted query in B's RPC,
  // even before the account-change reset effect has committed.
  const [query, setQuery] = useState<{ owner: string | undefined; input: string; search: string }>({
    owner: accountId, input: "", search: "",
  });
  const input = query.owner === accountId ? query.input : "";
  const search = query.owner === accountId ? query.search : "";
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [sets, setSets] = useState<LibraryQuestionSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState<LibraryQuestionSetPreview>();
  // A fetched snapshot belongs to the session that opened it. An old click
  // handler must not import it into a different account before React rerenders.
  const [previewAccountId, setPreviewAccountId] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [liking, setLiking] = useState<string>();
  // React may not have committed the disabled state when a second click runs.
  // Reserve the mutation synchronously, and release it only for its own request.
  const likingOperation = useRef<symbol | null>(null);
  // A second same-frame import click cannot reuse an earlier consent or receipt.
  const importOperation = useRef<symbol | null>(null);
  // Preview requests may overlap before React commits `opening`. Keep the
  // selected preview's auth observer alive after loading: a completed preview
  // must also be revoked by an A → B → A session round trip before import.
  const previewRequest = useRef<{ token: symbol; stop: () => void } | null>(null);
  function cancelPendingPreview() {
    previewRequest.current?.stop();
    previewRequest.current = null;
  }

  useEffect(() => {
    cancelPendingPreview();
    setQuery({ owner: accountId, input: "", search: "" });
    setSets([]); setPreview(undefined); setPreviewAccountId(undefined);
    setPreviewError(""); setImported(false); setOpening(false); setImporting(false);
    setLiking(undefined); setOffset(0);
  }, [accountId]);

  // Never retain an auth subscription for an abandoned preview on unmount.
  useEffect(() => () => {
    previewRequest.current?.stop(); previewRequest.current = null;
    importOperation.current = null;
  }, []);

  useEffect(() => {
    let alive = true;
    if (!accountId) {
      setSets([]); setMore(false); setLoading(false); setError("");
      return;
    }
    // Search results carry account-specific like state. A sign-out and
    // sign-in round trip can occur without an intervening React render, so
    // effect cleanup alone cannot invalidate the earlier response.
    const session = observeAccountSession(accountId, () => {
      if (!alive) return;
      setSets([]); setMore(false); setLoading(false); setError("");
    });
    if (!session.current()) {
      session.stop();
      setSets([]); setMore(false); setLoading(false); setError("");
      return;
    }
    if (offset === 0) setSets([]);
    setLoading(true); setError("");
    void searchQuestionSetLibrary(accountId, search, offset).then(page => {
      if (!alive || !session.current()) return;
      setSets(current => offset === 0 ? page : [...current, ...page.filter(item => !current.some(existing => existing.id === item.id))]);
      setMore(page.length === 24 && offset < 1000);
    }).catch(cause => {
      if (alive && session.current())
        setError(cause instanceof Error ? cause.message : "The library could not be loaded.");
    }).finally(() => {
      if (alive && session.current()) setLoading(false);
      session.stop();
    });
    return () => { alive = false; session.stop(); };
  }, [accountId, search, offset, refresh]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || useAccount.getState().user?.id !== accountId) return;
    setOffset(0);
    setQuery({ owner: accountId, input, search: input.trim() });
    setRefresh(value => value + 1);
  }
  async function open(id: string) {
    if (!accountId || useAccount.getState().user?.id !== accountId) return;
    // A second selection supersedes the first immediately, including in the
    // same React batch. It must not inherit the previous result or error.
    cancelPendingPreview();
    const operation = Symbol("community-preview");
    const openedBy = accountId;
    const session = observeAccountSession(openedBy, () => {
      if (previewRequest.current?.token !== operation) return;
      cancelPendingPreview();
      setPreview(undefined); setPreviewAccountId(undefined);
      setPreviewError(""); setOpening(false);
    });
    if (!session.current()) { session.stop(); return; }
    previewRequest.current = { token: operation, stop: session.stop };
    const isCurrent = () => previewRequest.current?.token === operation && session.current();
    setPreview(undefined); setPreviewAccountId(undefined);
    setPreviewError(""); setOpening(true); setImported(false);
    let accepted = false;
    try {
      const result = await loadQuestionSetLibraryPreview(openedBy, id);
      // Both the account session and the selected request must remain current.
      // A late first selection or dismissed modal cannot reopen itself.
      if (!isCurrent()) return;
      setPreviewAccountId(openedBy);
      setPreview(result);
      setImported(useStore.getState().questionSets.some(set => {
        const provenance = readSharedQuestionImportProvenance(set);
        return provenance?.shareId === result.id && provenance.contentDigest === result.contentDigest;
      }));
      // Keep the observer until the accepted preview is closed, replaced,
      // revoked, or unmounted. Account-ID equality is not session authority.
      accepted = true;
    } catch (cause) {
      if (isCurrent())
        setPreviewError(cause instanceof Error ? cause.message : "This set could not be opened.");
    } finally {
      if (previewRequest.current?.token === operation) {
        if (!accepted) cancelPendingPreview();
        if (session.current()) setOpening(false);
      } else {
        session.stop();
      }
    }
  }
  async function add() {
    if (!preview || preview.status !== "approved" || !accountId || previewAccountId !== accountId
      || useAccount.getState().user?.id !== accountId || importing || imported || importOperation.current) return;
    const selected = preview;
    const selectedToken = previewRequest.current?.token;
    if (!selectedToken) return;
    const operation = Symbol("community-import");
    importOperation.current = operation;
    const importingAccount = accountId;
    const session = observeAccountSession(importingAccount, () => {
      if (importOperation.current !== operation) return;
      importOperation.current = null;
      setImporting(false); setPreview(undefined); setPreviewAccountId(undefined);
      setPreviewError(""); setImported(false);
    });
    const isAuthorized = () => importOperation.current === operation
      && previewRequest.current?.token === selectedToken && session.current();
    if (!isAuthorized()) {
      if (importOperation.current === operation) importOperation.current = null;
      session.stop(); return;
    }
    setImporting(true); setPreviewError("");
    let listingRevalidated = false;
    try {
      // The import RPC binds the exact approved snapshot and revision under
      // one SQL row lock. A same-content rejection/reapproval cannot reuse
      // an earlier preview, and the returned payload is revalidated locally.
      const current = await authorizeQuestionSetLibraryImport(importingAccount, selected);
      if (!isAuthorized()) return;
      if (current.status !== "approved" || current.id !== selected.id
        || current.reviewRevision !== selected.reviewRevision
        || current.contentDigest !== selected.contentDigest)
        throw new Error("This reviewed Question Set changed. Close the preview and reopen the current listing.");
      listingRevalidated = true;
      const result = await useStore.getState().commitSharedQuestionSetImport({
        snapshot: current.snapshot,
        identity: { shareId: current.id, contentDigest: current.contentDigest },
        // A superseded preview or revoked account cannot start a vault write.
        accountGuard: {
          accountId: importingAccount,
          isCurrentAccount: id => id === importingAccount && isAuthorized(),
        },
      });
      if (!isAuthorized()) return;
      if (!result.ok) throw new Error(result.message);
      setImported(true);
    } catch (cause) {
      if (isAuthorized()) {
        // Failed publication revalidation invalidates the old reviewed copy.
        // No stale snapshot can be imported merely by retrying the button.
        if (!listingRevalidated) {
          setPreview(undefined); setPreviewAccountId(undefined);
          cancelPendingPreview();
        }
        setPreviewError(cause instanceof Error ? cause.message : "The set could not be added. Your saved work is unchanged.");
      }
    } finally {
      const wasLatest = importOperation.current === operation;
      if (wasLatest) importOperation.current = null;
      if (wasLatest && session.current()) setImporting(false);
      session.stop();
    }
  }
  async function like(set: LibraryQuestionSet) {
    if (!accountId || useAccount.getState().user?.id !== accountId || liking || likingOperation.current) return;
    const operation = Symbol("community-like");
    likingOperation.current = operation;
    const likingAccount = accountId;
    const session = observeAccountSession(likingAccount, () => {
      // An account change revokes the old mutation without blocking the next
      // session. A late old completion must not unlock a newer request.
      if (likingOperation.current === operation) likingOperation.current = null;
      setLiking(undefined); setSets([]); setError("");
      setRefresh(value => value + 1);
    });
    if (!session.current()) {
      if (likingOperation.current === operation) likingOperation.current = null;
      session.stop(); return;
    }
    setLiking(set.id); setError("");
    try {
      await setQuestionSetLibraryLike(accountId, set.id, !set.liked);
      if (!session.current()) return;
      setSets(current => current.map(item => item.id === set.id
        ? { ...item, liked: !item.liked, likes: item.likes + (item.liked ? -1 : 1) } : item));
    } catch (cause) {
      if (session.current())
        setError(cause instanceof Error ? cause.message : "Your like could not be saved.");
    } finally {
      if (likingOperation.current === operation) likingOperation.current = null;
      if (session.current()) setLiking(undefined);
      session.stop();
    }
  }

  const activePreview = accountId && previewAccountId === accountId
    && useAccount.getState().user?.id === accountId ? preview : undefined;
  // The modal shows only three questions, but source coverage must reflect
  // the entire reviewed publication, including questions not shown below.
  // This is a citation-presence count, never an academic verification score.
  const previewCitationTotal = activePreview?.snapshot.questions.length ?? 0;
  const previewCitationCount = activePreview?.snapshot.questions.filter(question => Boolean(question.citation?.trim())).length ?? 0;
  // A general explanation is not evidence for every choice. Count only
  // questions with an actual, nonblank rationale for each recorded option.
  // This is presence metadata, not an assertion of medical correctness.
  const previewCompleteRationaleCount = activePreview?.snapshot.questions.filter(question => {
    const recorded = Object.entries(question.choiceRationales ?? {});
    return question.options.length > 0 && question.options.every(option => recorded.some(([key, rationale]) =>
      key.trim().toUpperCase() === option.key.trim().toUpperCase() && Boolean(rationale.trim())));
  }).length ?? 0;

  function practiceImportedSet() {
    if (!activePreview || !onPractice || !imported || importing
      || useAccount.getState().user?.id !== previewAccountId || !previewRequest.current) return;
    // Resolve the saved copy again at click time, so deletion or a replaced
    // local set cannot launch a stale imported membership.
    const set = useStore.getState().questionSets.find(candidate => {
      const receipt = readSharedQuestionImportProvenance(candidate);
      return receipt?.shareId === activePreview.id && receipt.contentDigest === activePreview.contentDigest;
    });
    if (!set) {
      setImported(false);
      setPreviewError("This saved set is no longer in your library. Add it again to practice.");
      return;
    }
    cancelPendingPreview();
    setPreview(undefined); setPreviewAccountId(undefined); setPreviewError("");
    onPractice(set);
  }

  return <GlassCard pad className="qsl-library">
    <PanelHeader headingLevel={2} title="Find a Question Set"
      sub="Learner sets beyond AXOM's course collection. Each is reviewed before listing."
      action={<GButton size="sm" disabled={!accountId || loading} onClick={() => { setOffset(0); setRefresh(value => value + 1); }}>
        <RefreshCw size={16} aria-hidden="true" /> Refresh
      </GButton>} />
    {!accountId ? <p>Sign in through Account to search and save learner Question Sets.</p> : <>
      <form className="qsl-search" onSubmit={submitSearch} role="search">
        <label className="sr-only" htmlFor="qsl-search-input">Search Community Question Sets</label>
        <Search size={17} aria-hidden="true" />
        <input id="qsl-search-input" type="search" value={input} maxLength={100} onChange={event => setQuery(current => ({
          owner: accountId, input: event.target.value,
          search: current.owner === accountId ? current.search : "",
        }))} placeholder="Search title, topic or contributor" />
        <GButton size="sm" type="submit" disabled={loading}>Search</GButton>
      </form>
      {loading && <p role="status">Loading Question Sets…</p>}
      {error && <p role="alert" className="qsl-error">{error}</p>}
      {!loading && !error && sets.length === 0 && <div className="qsl-empty"><BookOpen size={24} aria-hidden="true" /><b>No sets found</b><p>Try another topic. Approved learner sets will appear here.</p></div>}
      <div className="qsl-grid">{sets.map(set => <article key={set.id} className="qsl-card">
        <div className="qsl-card-top"><span>LEARNER COLLECTION</span><Tag tone="neutral">{set.questionCount} {set.questionCount === 1 ? "question" : "questions"}</Tag></div>
        <h3>{set.title}</h3>
        <p>{set.credit ? `By ${set.credit}` : "Shared by an AXOM learner"}</p>
        {/* Authored topic tags can contain the correct answer. They remain
            searchable, but are not rendered before an explicit reveal. */}
        <div className="qsl-card-actions">
          <GButton size="sm" onClick={() => void open(set.id)}>Preview set</GButton>
          <GhostButton disabled={liking === set.id} aria-label={`${set.liked ? "Unlike" : "Like"} ${set.title}`}
            aria-pressed={set.liked} onClick={() => void like(set)}><Heart size={16} fill={set.liked ? "currentColor" : "none"} aria-hidden="true" /> {set.likes}</GhostButton>
        </div>
      </article>)}</div>
      {more && <GButton disabled={loading} onClick={() => setOffset(value => value + 24)}>Load more sets</GButton>}
      <p className="sub">Import copies the reviewed listing into your private AXOM. It does not connect your attempts, notes or files to the contributor.</p>
    </>}
    {(opening || activePreview || previewError) && <Modal title={activePreview?.snapshot.title ?? "Question Set preview"} onClose={importing ? () => {} : () => {
      cancelPendingPreview(); setOpening(false); setPreview(undefined); setPreviewAccountId(undefined); setPreviewError("");
    }}>
      <div className="qsl-preview stack gap12" aria-busy={opening || importing}>
        {opening && <p role="status">Opening this Question Set…</p>}
        {activePreview && <>
          <p>{activePreview.snapshot.questions.length} {activePreview.snapshot.questions.length === 1 ? "question" : "questions"} · Topic tags hidden until reveal</p>
          <details className="qsl-preview-teaching">
            <summary tabIndex={0}>Reveal set topic tags</summary>
            <p>{topicTags(activePreview.snapshot.tags).join(" · ") || "No topic tags"}</p>
          </details>
          <p className="sub">Preview the first three questions. Recorded citations and visual hints may reveal answers; open a question's teaching notes to inspect them.</p>
          {previewCitationCount < previewCitationTotal && <p className="qsl-preview-source-warning">
            Source citations recorded for {previewCitationCount} of {previewCitationTotal} questions. The first-three preview may not show every citation gap. A recorded citation does not establish medical accuracy.
          </p>}
          {previewCompleteRationaleCount < previewCitationTotal && <p className="qsl-preview-source-warning">
            Choice-by-choice rationales recorded for all options in {previewCompleteRationaleCount} of {previewCitationTotal} questions. The first-three preview may not show every rationale gap. Recorded text is not a substitute for source verification.
          </p>}
          <ol>{activePreview.snapshot.questions.slice(0, 3).map((question, index) => <li key={question.id}>
            <b>{question.stem}</b>
            <ul>{question.options.map(option => <li key={option.key}>{option.key}. {option.text}</li>)}</ul>
            {question.citation
              ? <small>Source citation recorded. Reveal teaching notes to inspect it.</small>
              : <small className="qsl-preview-source-warning">No source citation is included for this question. Verify its answer and teaching notes against the original material.</small>}
            <details className="qsl-preview-teaching">
              <summary tabIndex={0}>Reveal recorded answer and teaching notes<span className="sr-only"> for question {index + 1}</span></summary>
              <div className="stack gap8">
                {question.citation && <small>Source: {question.citation}</small>}
                <VisualIntentNote tags={question.tags} />
                {question.correctKey
                  ? <p><b>Submitted answer: {question.correctKey.trim()}</b> · {question.options.find(option => option.key.trim().toUpperCase() === question.correctKey?.trim().toUpperCase())?.text}</p>
                  : <p>No recorded answer key. Do not infer one from the explanation.</p>}
                {(question.explanation?.startsWith("AXOM AI-assisted explanation")
                  || Object.values(question.choiceRationales ?? {}).some(rationale => rationale.startsWith("AXOM AI-assisted rationale")))
                  && <p className="qsl-preview-ai-warning">AI-assisted teaching text. Model provenance is retained; verify the medical claims against the cited source.</p>}
                {question.explanation && <p>{question.explanation}</p>}
                {question.choiceRationales && <ul>{question.options.flatMap(option => {
                  // A reviewed snapshot may use different casing for a
                  // choice and its rationale. Match normalized own keys only:
                  // direct property lookup can read inherited Object members.
                  const rationale = Object.entries(question.choiceRationales ?? {})
                    .find(([key]) => key.trim().toUpperCase() === option.key.trim().toUpperCase())?.[1];
                  return rationale ? [<li key={option.key}><b>{option.key}. {option.text}</b> <span>{rationale}</span></li>] : [];
                })}</ul>}
                {question.explanation && (!question.choiceRationales || Object.keys(question.choiceRationales).length === 0)
                  && <p className="sub">No choice-by-choice rationales were included. Check each distractor against the original source.</p>}
                {question.explanation && question.choiceRationales && Object.keys(question.choiceRationales).length > 0
                  && question.options.some(option => !Object.keys(question.choiceRationales ?? {})
                    .some(key => key.trim().toUpperCase() === option.key.trim().toUpperCase()))
                  && <p className="sub">Some answer choices lack recorded rationales. Check those choices against the original source.</p>}
                {!question.explanation && (!question.choiceRationales || Object.keys(question.choiceRationales).length === 0)
                  && <p className="sub">No teaching rationale was included in this approved snapshot.</p>}
              </div>
            </details>
          </li>)}</ol>
          <GButton variant="primary" disabled={importing || imported} onClick={() => void add()}>
            <Download size={16} aria-hidden="true" /> {imported ? "Already in my AXOM" : importing ? "Saving…" : "Add to my AXOM"}
          </GButton>
          {imported && onPractice && <>
            <p role="status">Saved in your library. Your answers and progress stay in your private workspace.</p>
            <GButton variant="primary" onClick={practiceImportedSet}>
              <Play size={16} aria-hidden="true" /> Practice this set
            </GButton>
          </>}
        </>}
        {previewError && <p role="alert" className="qsl-error">{previewError}</p>}
      </div>
    </Modal>}
  </GlassCard>;
}
