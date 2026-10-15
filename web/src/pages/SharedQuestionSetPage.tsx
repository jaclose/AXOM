import { useEffect, useState } from "react";
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

  useEffect(() => {
    const token = new URLSearchParams(location.hash.split("?")[1] ?? "").get("token");
    if (!token) {
      setError("This share link is incomplete.");
      return;
    }
    let active = true;
    void resolveShare(token).then((resolved) => {
      if (!active) return;
      setShare(resolved);
      const imported = useStore.getState().questionSets.some((questionSet) => {
        const provenance = readSharedQuestionImportProvenance(questionSet);
        return provenance?.shareId === resolved.id && provenance.contentDigest === resolved.contentDigest;
      });
      setAdded(imported);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "This share is unavailable.");
    });
    return () => { active = false; };
  }, []);

  async function add() {
    if (!share || busy || added) return;
    setBusy(true);
    setError("");
    try {
      const result = await useStore.getState().commitSharedQuestionSetImport({
        snapshot: share.snapshot,
        identity: { shareId: share.id, contentDigest: share.contentDigest },
      });
      if (!result.ok) throw new Error(result.message);
      setAdded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The shared set could not be imported safely.");
    } finally {
      setBusy(false);
    }
  }

  const snapshot = share?.snapshot;
  return (
    <GlassCard pad className="account-card">
      <Tag tone="neutral"><Link2 />Unlisted Question Set link</Tag>
      <h1>{snapshot?.title ?? "Shared Question Set"}</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!snapshot && !error ? <p role="status">Opening shared set…</p> : snapshot ? (
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
    </GlassCard>
  );
}
