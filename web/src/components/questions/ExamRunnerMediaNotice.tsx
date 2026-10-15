import type { MediaGateState } from "../../lib/exam/useMediaGate";

const REASON: Record<string, string> = {
  "missing-metadata": "Source figure not linked to a saved attachment",
  "missing-bytes": "Image unavailable locally or through your authorized account",
  "size-mismatch": "Figure size no longer matches its saved record",
  "type-mismatch": "Figure format differs from the saved source",
  "wrong-question": "Figure belongs to a different question",
  "checksum-mismatch": "Figure bytes differ from the original source checksum",
  "invalid-checksum": "Source checksum is invalid",
  "crypto-unavailable": "Cryptographic verification is unavailable",
  "decode-failed": "Figure could not be decoded as an image",
  timeout: "Restoring the image took too long",
  "lookup-failed": "Media storage could not be read",
};

/** Never display protected source text or assume a cloud sync receipt. */
export function ExamRunnerMediaNotice({ state, onRetry }: {
  state: MediaGateState;
  onRetry?: () => void;
}) {
  if (state.phase === "idle") return null;
  const blocked = state.phase === "blocked";
  const reasons = blocked
    ? [...new Set(state.result.issues.map((issue) => REASON[issue.code] ?? issue.code))]
    : [];
  return <div className="qb-required-media-status" role="status" aria-live="polite" aria-busy={!blocked}>
    <strong>{blocked ? "Essential clinical figures are not ready" : "Checking figures before practice"}</strong>
    <p>{blocked
      ? `${state.result.available} of ${state.result.total} essential image references are available. ${state.result.blockedQuestionIds.length} question${state.result.blockedQuestionIds.length === 1 ? "" : "s"} cannot be scored safely.`
      : `${state.progress.checked} of ${state.progress.total} required image references checked. Waiting does not count as a submitted answer.`}</p>
    {blocked && <>
      {reasons.length > 0 && <ul>{reasons.slice(0, 5).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      <p>Reconnect or restore the original source and its figures, then verify again. The selected question IDs and study progress remain unchanged.</p>
      {onRetry && <button type="button" onClick={onRetry}>Retry required figures</button>}
    </>}
  </div>;
}
