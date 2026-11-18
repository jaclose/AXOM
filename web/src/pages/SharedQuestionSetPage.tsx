import { useEffect, useRef, useState } from "react";
import { Download, Link2 } from "lucide-react";
import { GlassCard, GButton, Tag } from "../components/ui/primitives";
import { readSharedQuestionImportProvenance } from "../lib/sharing/questionSetShare";
import { resolveShare, type ResolvedQuestionSetShare } from "../lib/sharing/supabaseSharing";
import { useStore } from "../lib/store";

export function SharedQuestionSetPage() {
  const [share, setShare] = useState<ResolvedQuestionSetShare | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewStopped, setPreviewStopped] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  // A shared-link route can change while this page stays mounted. Invalidate
  // both the pending preview and any old save UI before resolving its new token.
  // Already-issued server writes cannot be cancelled by this UI guard.
  const linkGeneration = useRef(0);
  useEffect(() => {
    const openLink = () => {
      const generation = ++linkGeneration.current;
      setShare(null);
      setError("");
      setAdded(false);
      setBusy(false);
      setPreviewStopped(false);
      const token = new URLSearchParams(location.hash.split("?")[1] ?? "").get("token");
      if (!token) {
        setError("This share link is incomplete.");
        return;
      }
      void resolveShare(token).then((resolved) => {
        if (linkGeneration.current !== generation) return;
        setShare(resolved);
        const imported = useStore.getState().questionSets.some((questionSet) => {
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

  function stopPreview() {
    // The server request may still settle, but its UI result is now obsolete.
    ++linkGeneration.current;
    setPreviewStopped(true);
    setError("");
    setShare(null);
  }

  function retryPreview() {
    setPreviewAttempt((attempt) => attempt + 1);
  }

  async function add() {
    if (!share || busy || added) return;
    const generation = linkGeneration.current;
    setBusy(true);
    setError("");
    try {
      const result = await useStore.getState().commitSharedQuestionSetImport({
        snapshot: share.snapshot,
        identity: { shareId: share.id, contentDigest: share.contentDigest },
      });
      if (!result.ok) throw new Error(result.message);
      if (linkGeneration.current === generation) setAdded(true);
    } catch (cause) {
      if (linkGeneration.current === generation) {
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
          <GButton variant="primary" onClick={() => void add()} disabled={added || busy}>
            <Download />{added ? "Already in this AXOM" : busy ? "Saving…" : "Add to my AXOM"}
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
