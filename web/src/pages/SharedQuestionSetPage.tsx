import { useEffect, useRef, useState } from "react";
import { Download, Link2 } from "lucide-react";
import { GlassCard, GButton, Tag } from "../components/ui/primitives";
import { useAccount } from "../lib/account/accountStore";
import { readSharedQuestionImportProvenance } from "../lib/sharing/questionSetShare";
import { resolveShare, type ResolvedQuestionSetShare } from "../lib/sharing/supabaseSharing";
import { useStore } from "../lib/store";

// A signed-in account must first own the device workspace it is editing.
// Auth identity is published before the asynchronous protected-vault restore,
// so user ID alone is not a sufficient write-readiness condition. Guest
// imports are available only after authentication has settled as signed-out.
function canImportIntoWorkspace(state: ReturnType<typeof useAccount.getState>): boolean {
  if (!state.user) return state.phase === "signed-out" || state.phase === "unconfigured";
  return state.phase === "signed-in"
    && state.link === "linked"
    && !state.busy
    && !state.applyingRemote
    && !state.restoreOffer;
}

export function SharedQuestionSetPage() {
  const [share, setShare] = useState<ResolvedQuestionSetShare | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewStopped, setPreviewStopped] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [importReady, setImportReady] = useState(() => canImportIntoWorkspace(useAccount.getState()));

  // A shared-link route can change while this page stays mounted. Invalidate
  // both the pending preview and any old save UI before resolving its new token.
  // Already-issued server writes cannot be cancelled by this UI guard.
  const linkGeneration = useRef(0);
  // Once a write has observed a vault-readiness loss, its authorization is
  // permanently revoked even if the same account finishes restoring later.
  const writeRevocation = useRef(0);
  const resolvedToken = useRef<string | null>(null);
  const resolvedAccountId = useRef<string | null>(null);

  // Auth changes can occur without a route change, and A → B → A can be
  // batched before React renders B. Immediately revoke the old preview and
  // any pending import authorization at each observed identity transition.
  useEffect(() => {
    let observedAccount = useAccount.getState().user?.id ?? null;
    let previouslyReady = canImportIntoWorkspace(useAccount.getState());
    const unsubscribe = useAccount.subscribe((state) => {
      const ready = canImportIntoWorkspace(state);
      if (previouslyReady && !ready) ++writeRevocation.current;
      previouslyReady = ready;
      setImportReady(ready);
      const currentAccount = state.user?.id ?? null;
      if (currentAccount === observedAccount) return;
      observedAccount = currentAccount;
      ++linkGeneration.current;
      resolvedToken.current = null;
      resolvedAccountId.current = null;
      setShare(null);
      setAdded(false);
      setBusy(false);
      setError("");
      setPreviewStopped(false);
      setPreviewAttempt((attempt) => attempt + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const openLink = () => {
      const generation = ++linkGeneration.current;
      resolvedToken.current = null;
      resolvedAccountId.current = null;
      setShare(null);
      setError("");
      setAdded(false);
      setBusy(false);
      setPreviewStopped(false);
      const token = new URLSearchParams(location.hash.split("?")[1] ?? "").get("token");
      const openedBy = useAccount.getState().user?.id ?? null;
      if (!token) {
        setError("This share link is incomplete.");
        return;
      }
      void resolveShare(token).then((resolved) => {
        if (linkGeneration.current !== generation) return;
        resolvedToken.current = token;
        resolvedAccountId.current = openedBy;
        setShare(resolved);
        // Never derive the incoming account's membership from a different,
        // not-yet-restored device vault. Reconcile once this vault is ready.
        const imported = canImportIntoWorkspace(useAccount.getState())
          && useStore.getState().questionSets.some((questionSet) => {
            const provenance = readSharedQuestionImportProvenance(questionSet);
            return provenance?.shareId === resolved.id && provenance.contentDigest === resolved.contentDigest;
          });
        setAdded(imported);
      }).catch((cause) => {
        if (linkGeneration.current === generation) {
          setError(cause instanceof Error ? cause.message : "This share is unavailable.");
        }
      });
    };
    window.addEventListener("hashchange", openLink);
    openLink();
    return () => {
      ++linkGeneration.current;
      window.removeEventListener("hashchange", openLink);
    };
  }, [previewAttempt]);

  // The resolved share may arrive before a newly signed-in learner's vault
  // finishes restoring. Reconcile the badge when that vault replaces its
  // question-set membership, not just when the bearer link first resolves.
  // This is UI state only; the durable Store import retains its own guard.
  useEffect(() => {
    if (!share) return;
    const generation = linkGeneration.current;
    const token = resolvedToken.current;
    const accountId = resolvedAccountId.current;
    const reconcile = (questionSets: ReturnType<typeof useStore.getState>["questionSets"]) => {
      if (
        linkGeneration.current !== generation
        || resolvedToken.current !== token
        || resolvedAccountId.current !== accountId
        || (useAccount.getState().user?.id ?? null) !== accountId
      ) return;
      if (!canImportIntoWorkspace(useAccount.getState())) {
        setAdded(false);
        return;
      }
      setAdded(questionSets.some((questionSet) => {
        const provenance = readSharedQuestionImportProvenance(questionSet);
        return provenance?.shareId === share.id && provenance.contentDigest === share.contentDigest;
      }));
    };
    reconcile(useStore.getState().questionSets);
    return useStore.subscribe((state, previous) => {
      if (state.questionSets !== previous.questionSets) reconcile(state.questionSets);
    });
  }, [share, importReady]);

  function stopPreview() {
    // The server request may still settle, but its UI result is now obsolete.
    ++linkGeneration.current;
    resolvedToken.current = null;
    resolvedAccountId.current = null;
    setPreviewStopped(true);
    setError("");
    setShare(null);
  }

  function retryPreview() {
    setPreviewAttempt((attempt) => attempt + 1);
  }

  async function add() {
    if (!share || busy || added) return;
    // Recheck synchronously in case a store transition preceded React's
    // disabled-button render. An unlinked/restoring vault is not writable.
    if (!canImportIntoWorkspace(useAccount.getState())) {
      setError("Finish connecting your account workspace before importing this shared set.");
      return;
    }
    const currentToken = new URLSearchParams(location.hash.split("?")[1] ?? "").get("token");
    const accountAtPreview = resolvedAccountId.current;
    const currentAccount = useAccount.getState().user?.id ?? null;
    if (!resolvedToken.current || currentToken !== resolvedToken.current || currentAccount !== accountAtPreview) {
      // pushState/replaceState do not emit hashchange. Never import the preview
      // for a different link, even when the router has not remounted this page.
      ++linkGeneration.current;
      resolvedToken.current = null;
      resolvedAccountId.current = null;
      setShare(null);
      setAdded(false);
      setBusy(false);
      setError("");
      setPreviewAttempt((attempt) => attempt + 1);
      return;
    }
    const generation = linkGeneration.current;
    const writeEpoch = writeRevocation.current;
    const selectedToken = currentToken;
    // Give the local guest workspace an explicit, revocable guard identity too.
    // The store checks this callback before and during its durable write.
    const guardedAccountId = accountAtPreview ?? "local-guest-session";
    setBusy(true);
    setError("");
    try {
      const result = await useStore.getState().commitSharedQuestionSetImport({
        snapshot: share.snapshot,
        identity: { shareId: share.id, contentDigest: share.contentDigest },
        accountGuard: {
          accountId: guardedAccountId,
          isCurrentAccount: (id) => id === guardedAccountId
            && linkGeneration.current === generation
            && writeRevocation.current === writeEpoch
            && (useAccount.getState().user?.id ?? null) === accountAtPreview
            && canImportIntoWorkspace(useAccount.getState())
            && new URLSearchParams(location.hash.split("?")[1] ?? "").get("token") === selectedToken,
        },
      });
      if (!result.ok) throw new Error(result.message);
      if (linkGeneration.current === generation && writeRevocation.current === writeEpoch) setAdded(true);
    } catch (cause) {
      if (linkGeneration.current === generation && writeRevocation.current === writeEpoch) {
        setError(cause instanceof Error ? cause.message : "The shared set could not be imported safely.");
      }
    } finally {
      if (linkGeneration.current === generation) setBusy(false);
    }
  }

  const snapshot = share?.snapshot;
  return (
    <GlassCard pad className="account-card">
      <Tag tone="neutral"><Link2 />Unlisted Question Set link</Tag>
      <h1>{snapshot?.title ?? "Shared Question Set"}</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!snapshot && !error ? (
        <p role="status">{previewStopped ? "Shared set preview stopped. Retry when ready." : "Opening shared set…"}</p>
      ) : snapshot ? (
        <>
          <p>{snapshot.questions.length} questions · fixed ordered membership</p>
          <p className="sub">
            Import includes question content and safe tags only. It does not connect your workspace to the owner or import their attempts, notes, annotations, analytics, or private sources.
          </p>
          <div className="backup-note">
            Anyone with this link can open and import the snapshot. Do not share restricted or private source material.
          </div>
          {!importReady ? (
            <p role="status">
              {useAccount.getState().user
                ? "Finish connecting your account workspace in Account before importing this set."
                : "Checking your account session before importing this set."}
            </p>
          ) : null}
          <GButton variant="primary" onClick={() => void add()} disabled={added || busy || !importReady}>
            <Download />{!importReady ? "Add to my AXOM" : added ? "Already in this AXOM" : busy ? "Saving…" : "Add to my AXOM"}
          </GButton>
        </>
      ) : null}
      {!snapshot && !error && !previewStopped ? (
        <GButton onClick={stopPreview}>Stop loading</GButton>
      ) : null}
      {!snapshot && (previewStopped || error) ? (
        <GButton onClick={retryPreview}>Retry opening</GButton>
      ) : null}
    </GlassCard>
  );
}
