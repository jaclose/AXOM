import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, HardDrive, ShieldCheck } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { loadSupabase } from "../../lib/account/supabase";
import {
  inspectLocalVaultRecoveryCopies,
  type LocalVaultRecoveryCopy,
  type LocalVaultRecoveryInspection,
  type LocalVaultUnverifiedScopedFallback,
} from "../../lib/localVault";
import { GButton, Tag } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";

type Candidate = (LocalVaultRecoveryCopy | LocalVaultUnverifiedScopedFallback) & { unverified: boolean };
type Inspection = { accountId: string; result: LocalVaultRecoveryInspection };

const sourceNames: Record<Candidate["source"], string> = {
  indexeddb: "Active device vault",
  "indexeddb-scoped": "Retained account vault",
  "local-fallback": "Marked offline copy",
  "local-fallback-scoped-unverified": "Unverified account-local copy",
};

const reasonNames: Record<LocalVaultRecoveryInspection["reviewReasons"][number], string> = {
  "trusted-copies-diverge": "Saved versions contain different work",
  "unverified-owner-scoped-copy": "A separate unverified local copy needs manual review",
  "other-owner-or-unverifiable-bytes": "Other-account or unreadable records may exist",
  "storage-source-unreadable": "A storage source could not be inspected",
};

function candidates(inspection: LocalVaultRecoveryInspection): Candidate[] {
  const trusted = inspection.copies.map((copy) => ({ ...copy, unverified: false }));
  return inspection.unverifiedScopedFallback
    ? [...trusted, { ...inspection.unverifiedScopedFallback, unverified: true }]
    : trusted;
}

/**
 * Local inspection is not authentication. Verify with Supabase's remote
 * getUser(), then separately confirm the app did not switch accounts while
 * that network operation was pending. Do not use cached getSession() as proof.
 */
async function assertVerifiedAccount(accountId: string): Promise<void> {
  const current = useAccount.getState();
  if (current.phase !== "signed-in" || current.user?.id !== accountId) {
    throw new Error("Your account changed. Sign in again before inspecting recovery copies.");
  }
  const supabase = await loadSupabase();
  if (!supabase) throw new Error("Account verification is unavailable. Use the normal portable backup.");
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== accountId) {
    throw new Error("The account could not be verified. No recovery data was exported.");
  }
  const latest = useAccount.getState();
  if (latest.phase !== "signed-in" || latest.user?.id !== accountId) {
    throw new Error("Your account changed while verification was running. No recovery data was exported.");
  }
}

/**
 * Opt-in forensic export only. These raw persisted strings are NOT validated
 * portable backups and do not contain separately stored image/media bytes.
 * Nothing is uploaded, restored, merged, deleted or written to local storage.
 */
export function RecoveryCopiesExportPanel() {
  const accountId = useAccount((state) => state.user?.id ?? null);
  const phase = useAccount((state) => state.phase);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [confirmation, setConfirmation] = useState<Candidate["source"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  // Identity changes invalidate pending network/storage work. The old request
  // may settle after the next account starts its own inspection.
  const operationSequence = useRef(0);
  const inFlightOperation = useRef<number | null>(null);

  useEffect(() => {
    operationSequence.current += 1;
    inFlightOperation.current = null;
    setBusy(false);
    setInspection(null);
    setConfirmation(null);
    setNotice(null);
    return () => {
      // Sign-out and route changes unmount this component. A network request
      // from that old instance must never resume after a later sign-in to the
      // same account, even when the account id matches again.
      operationSequence.current += 1;
      inFlightOperation.current = null;
    };
  }, [accountId, phase]);

  function beginOperation(): number | null {
    // A state update can be batched. The ref prevents rapid clicks from
    // launching overlapping requests before React renders the disabled button.
    if (inFlightOperation.current !== null) return null;
    const sequence = ++operationSequence.current;
    inFlightOperation.current = sequence;
    setBusy(true);
    return sequence;
  }

  function isCurrentOperation(sequence: number, id: string): boolean {
    const current = useAccount.getState();
    return inFlightOperation.current === sequence
      && current.phase === "signed-in"
      && current.user?.id === id;
  }

  function finishOperation(sequence: number) {
    // Never allow a late A response to unlock or overwrite B's in-flight UI.
    if (inFlightOperation.current !== sequence) return;
    inFlightOperation.current = null;
    setBusy(false);
  }

  if (!accountId || phase !== "signed-in") return null;
  const visible = inspection?.accountId === accountId ? inspection.result : null;
  const rows = visible ? candidates(visible) : [];

  async function inspect() {
    if (!accountId || busy) return;
    const sequence = beginOperation();
    if (sequence === null) return;
    setInspection(null);
    setConfirmation(null);
    setNotice(null);
    try {
      await assertVerifiedAccount(accountId);
      if (!isCurrentOperation(sequence, accountId)) return;
      const result = await inspectLocalVaultRecoveryCopies(accountId);
      if (!isCurrentOperation(sequence, accountId)) return;
      await assertVerifiedAccount(accountId);
      if (!isCurrentOperation(sequence, accountId)) return;
      setInspection({ accountId, result });
      setNotice({ text: "Read-only inspection finished. No workspace copy was changed.", error: false });
    } catch (error) {
      if (isCurrentOperation(sequence, accountId)) {
        setNotice({ text: error instanceof Error ? error.message : "Recovery inspection could not finish.", error: true });
      }
    } finally {
      finishOperation(sequence);
    }
  }

  async function download(copy: Candidate) {
    if (!accountId || busy || confirmation !== copy.source || !visible) return;
    const sequence = beginOperation();
    if (sequence === null) return;
    setNotice(null);
    try {
      await assertVerifiedAccount(accountId);
      if (!isCurrentOperation(sequence, accountId)) return;
      const fresh = await inspectLocalVaultRecoveryCopies(accountId);
      if (!isCurrentOperation(sequence, accountId)) return;
      const current = candidates(fresh).find((candidate) => candidate.source === copy.source);
      // Comparing full bytes, not the short vault fingerprint, prevents an
      // intervening tab write from turning an approved export into another copy.
      if (!current || current.value !== copy.value || current.unverified !== copy.unverified) {
        throw new Error("This saved copy changed in another tab. Inspect again before exporting it.");
      }
      await assertVerifiedAccount(accountId);
      if (!isCurrentOperation(sequence, accountId)) return;
      // The last network identity check can take long enough for another tab
      // to save a different version. Re-inspect AFTER that await and do not
      // yield again between the final byte comparison and download creation.
      // This is a best-effort sampled copy, not an atomic cross-tab snapshot.
      const finalInspection = await inspectLocalVaultRecoveryCopies(accountId);
      const finalCopy = candidates(finalInspection).find((candidate) => candidate.source === copy.source);
      if (!isCurrentOperation(sequence, accountId)) return;
      if (!finalCopy || finalCopy.value !== copy.value || finalCopy.unverified !== copy.unverified) {
        throw new Error("This saved copy changed in another tab. Inspect again before exporting it.");
      }
      const raw = new Blob([finalCopy.value], { type: "application/json" });
      const href = URL.createObjectURL(raw);
      try {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `axom-raw-recovery-${copy.source}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        anchor.click();
      } finally {
        // Allow the browser to start the download before revoking its URL.
        window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
      setConfirmation(null);
      setNotice({ text: "Sampled recovery version download started. Another tab may save a newer version afterward; this is not an import-ready backup.", error: false });
    } catch (error) {
      if (isCurrentOperation(sequence, accountId)) {
        setConfirmation(null);
        setInspection(null);
        setNotice({ text: error instanceof Error ? error.message : "Recovery export was stopped.", error: true });
      }
    } finally {
      finishOperation(sequence);
    }
  }

  return (
    <section className="account-form-panel" aria-label="Retained recovery copies">
      <div className="account-card-head">
        <HardDrive size={ICON_SIZE.emphasis} aria-hidden="true" />
        <div>
          <h5>Retained recovery copies</h5>
          <p>Inspect account-matching device copies without replacing your current workspace.</p>
        </div>
      </div>
      <p className="sub">Requires a verified online account. Raw copies may disagree or change in another tab. A download captures one inspected version, not an atomic latest snapshot; it is not a standard portable backup. Separately stored question images and other attachments are not included. Use Emergency recovery for a complete portable backup.</p>
      <GButton size="sm" disabled={busy} onClick={() => void inspect()}>
        {busy ? "Checking…" : "Inspect saved versions"}
      </GButton>
      {visible && (
        <div aria-label="Read-only recovery inspection">
          {visible.requiresExplicitReview ? (
            <p role="status"><AlertTriangle size={ICON_SIZE.body} aria-hidden="true" /> Manual review required; no version has been chosen.</p>
          ) : (
            <p role="status"><ShieldCheck size={ICON_SIZE.body} aria-hidden="true" /> No conflicting copy found among readable sources. This is not proof of cloud recovery.</p>
          )}
          {visible.reviewReasons.length > 0 && (
            <ul>{visible.reviewReasons.map((reason) => <li key={reason}>{reasonNames[reason]}</li>)}</ul>
          )}
          {rows.length === 0 && <p>No account-matching saved copies were readable here. Other storage may still contain work.</p>}
          {rows.map((copy) => (
            <div key={copy.source} className="account-inline-form">
              <div>
                <b>{sourceNames[copy.source]}</b>{" "}
                <Tag tone={copy.unverified ? "orange" : "neutral"}>{copy.unverified ? "Unverified" : "Device copy"}</Tag>
                <p className="sub">{copy.value.length.toLocaleString()} characters · Reference {copy.fingerprint}</p>
              </div>
              {confirmation === copy.source ? (
                <div>
                  <p className="sub">Download these exact raw bytes for private, manual review? They will not be restored or merged.</p>
                  <GButton size="sm" variant="primary" disabled={busy} aria-label={`Download raw copy: ${sourceNames[copy.source]}`} onClick={() => void download(copy)}>
                    <Download size={ICON_SIZE.body} aria-hidden="true" /> Download this copy
                  </GButton>
                  <GButton size="sm" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</GButton>
                </div>
              ) : (
                <GButton size="sm" disabled={busy} aria-label={`Review export: ${sourceNames[copy.source]}`} onClick={() => setConfirmation(copy.source)}>Review export</GButton>
              )}
            </div>
          ))}
        </div>
      )}
      {notice && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    </section>
  );
}
