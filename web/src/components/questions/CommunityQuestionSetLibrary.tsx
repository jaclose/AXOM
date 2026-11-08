import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, Download, Heart, RefreshCw, Search } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { readSharedQuestionImportProvenance } from "../../lib/sharing/questionSetShare";
import {
  loadQuestionSetLibraryPreview, searchQuestionSetLibrary, setQuestionSetLibraryLike,
  type LibraryQuestionSet, type LibraryQuestionSetPreview,
} from "../../lib/sharing/questionSetLibrary";
import { useStore } from "../../lib/store";
import { Modal } from "../ui/Modal";
import { GButton, GlassCard, GhostButton, PanelHeader, Tag } from "../ui/primitives";
import "../../styles/question-set-library.css";

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

export function CommunityQuestionSetLibrary() {
  const accountId = useAccount(state => state.user?.id);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
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

  useEffect(() => {
    setSets([]); setPreview(undefined); setPreviewAccountId(undefined);
    setPreviewError(""); setImported(false); setOpening(false); setImporting(false);
    setLiking(undefined); setOffset(0);
  }, [accountId]);

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
    setOffset(0);
    setSearch(input.trim());
    setRefresh(value => value + 1);
  }
  async function open(id: string) {
    if (!accountId || opening || useAccount.getState().user?.id !== accountId) return;
    const openedBy = accountId;
    const session = observeAccountSession(openedBy, () => {
      setPreview(undefined); setPreviewAccountId(undefined);
      setPreviewError(""); setOpening(false);
    });
    if (!session.current()) { session.stop(); return; }
    setPreview(undefined); setPreviewAccountId(undefined);
    setPreviewError(""); setOpening(true); setImported(false);
    try {
      const result = await loadQuestionSetLibraryPreview(openedBy, id);
      // A resolved request cannot reopen a prior account's preview after a
      // session switch. The server already scopes access; also scope the UI.
      if (!session.current()) return;
      setPreviewAccountId(openedBy);
      setPreview(result);
      setImported(useStore.getState().questionSets.some(set => {
        const provenance = readSharedQuestionImportProvenance(set);
        return provenance?.shareId === result.id && provenance.contentDigest === result.contentDigest;
      }));
    } catch (cause) {
      if (session.current())
        setPreviewError(cause instanceof Error ? cause.message : "This set could not be opened.");
    } finally {
      if (session.current()) setOpening(false);
      session.stop();
    }
  }
  async function add() {
    if (!preview || !accountId || previewAccountId !== accountId
      || useAccount.getState().user?.id !== accountId || importing || imported) return;
    const importingAccount = accountId;
    const session = observeAccountSession(importingAccount, () => {
      setImporting(false); setPreview(undefined); setPreviewAccountId(undefined);
      setPreviewError(""); setImported(false);
    });
    if (!session.current()) { session.stop(); return; }
    setImporting(true); setPreviewError("");
    try {
      const result = await useStore.getState().commitSharedQuestionSetImport({
        snapshot: preview.snapshot,
        identity: { shareId: preview.id, contentDigest: preview.contentDigest },
        // Revalidate the originating account at the vault commit boundary.
        accountGuard: {
          accountId: importingAccount,
          isCurrentAccount: id => id === importingAccount && session.current(),
        },
      });
      // A local import already started cannot be undone here. Never present
      // its completion as an import authorized by a subsequently active account.
      if (!session.current()) return;
      if (!result.ok) throw new Error(result.message);
      setImported(true);
    } catch (cause) {
      if (session.current())
        setPreviewError(cause instanceof Error ? cause.message : "The set could not be added. Your saved work is unchanged.");
    } finally {
      if (session.current()) setImporting(false);
      session.stop();
    }
  }
  async function like(set: LibraryQuestionSet) {
    if (!accountId || useAccount.getState().user?.id !== accountId || liking) return;
    const likingAccount = accountId;
    const session = observeAccountSession(likingAccount, () => {
      setLiking(undefined); setSets([]); setError("");
      setRefresh(value => value + 1);
    });
    if (!session.current()) { session.stop(); return; }
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
      if (session.current()) setLiking(undefined);
      session.stop();
    }
  }

  const activePreview = accountId && previewAccountId === accountId
    && useAccount.getState().user?.id === accountId ? preview : undefined;

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
        <input id="qsl-search-input" type="search" value={input} maxLength={100} onChange={event => setInput(event.target.value)} placeholder="Search title, topic or contributor" />
        <GButton size="sm" type="submit" disabled={loading}>Search</GButton>
      </form>
      {loading && <p role="status">Loading Question Sets…</p>}
      {error && <p role="alert" className="qsl-error">{error}</p>}
      {!loading && !error && sets.length === 0 && <div className="qsl-empty"><BookOpen size={24} aria-hidden="true" /><b>No sets found</b><p>Try another topic. Approved learner sets will appear here.</p></div>}
      <div className="qsl-grid">{sets.map(set => <article key={set.id} className="qsl-card">
        <div className="qsl-card-top"><span>LEARNER COLLECTION</span><Tag tone="neutral">{set.questionCount} {set.questionCount === 1 ? "question" : "questions"}</Tag></div>
        <h3>{set.title}</h3>
        <p>{set.credit ? `By ${set.credit}` : "Shared by an AXOM learner"}</p>
        <div className="qsl-tags">{set.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div>
        <div className="qsl-card-actions">
          <GButton size="sm" onClick={() => void open(set.id)}>Preview set</GButton>
          <GhostButton disabled={liking === set.id} aria-label={`${set.liked ? "Unlike" : "Like"} ${set.title}`}
            aria-pressed={set.liked} onClick={() => void like(set)}><Heart size={16} fill={set.liked ? "currentColor" : "none"} aria-hidden="true" /> {set.likes}</GhostButton>
        </div>
      </article>)}</div>
      {more && <GButton disabled={loading} onClick={() => setOffset(value => value + 24)}>Load more sets</GButton>}
      <p className="sub">Import copies the reviewed listing into your private AXOM. It does not connect your attempts, notes or files to the contributor.</p>
    </>}
    {(opening || activePreview || previewError) && <Modal title={activePreview?.snapshot.title ?? "Question Set preview"} onClose={importing ? () => {} : () => { setPreview(undefined); setPreviewError(""); }}>
      <div className="qsl-preview stack gap12" aria-busy={opening || importing}>
        {opening && <p role="status">Opening this Question Set…</p>}
        {activePreview && <>
          <p>{activePreview.snapshot.questions.length} {activePreview.snapshot.questions.length === 1 ? "question" : "questions"} · {activePreview.snapshot.tags.join(" · ") || "No topic tags"}</p>
          <p className="sub">Preview the first three questions. Check their sources while studying.</p>
          <ol>{activePreview.snapshot.questions.slice(0, 3).map(question => <li key={question.id}>
            <b>{question.stem}</b>
            <ul>{question.options.map(option => <li key={option.key}>{option.key}. {option.text}</li>)}</ul>
            {question.citation && <small>Source: {question.citation}</small>}
          </li>)}</ol>
          <GButton variant="primary" disabled={importing || imported} onClick={() => void add()}>
            <Download size={16} aria-hidden="true" /> {imported ? "Already in my AXOM" : importing ? "Saving…" : "Add to my AXOM"}
          </GButton>
        </>}
        {previewError && <p role="alert" className="qsl-error">{previewError}</p>}
      </div>
    </Modal>}
  </GlassCard>;
}
