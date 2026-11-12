import { useCallback, useEffect, useRef, useState } from "react";
import { loadSupabase, readStoredSession } from "../account/supabase";
import { useAccount } from "../account/accountStore";
import type { Preference } from "./model";
export interface PrivacyRequest { id: string; kind: "export" | "deletion"; status: string; scheduled_for?: string; expires_at?: string; failure_code?: string }
export interface CommunicationsSettings {
  preferences: Preference[]; identity: { accent: string; theme: "dark" | "light" }; history: { id: string; type: string; status: string; created_at: string; sent_at?: string }[];
  privacy: PrivacyRequest[]; admin: boolean; deliveryMode: string; deletionEnabled: boolean; hasProtectedCopy: boolean;
}
// A cached SDK session is not proof of bearer identity. Compare the JWT subject
// to the initiating UI account, then send the exact captured credential to Edge.
// Edge validates its signature; this client check prevents inadvertent retargeting.
function bearerSubject(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub ? claims.sub.toLowerCase() : null;
  } catch {
    return null;
  }
}
export async function communicationsRequest<T>(action: string, body: object = {}): Promise<T> {
  // Private settings/history/admin reads and export operations belong to the
  // initiating account. SDK loading or late responses must not retarget data.
  const isAccountExport = action === "request-export" || action === "export-link";
  const isAccountBound = isAccountExport || action === "settings";
  const initiatingUserId = isAccountBound ? useAccount.getState().user?.id : undefined;
  // Capture *before* the lazy SDK await, including a possible auth refresh.
  // A stale or foreign persisted credential cannot authorize the UI intent.
  const initiatingSession = isAccountBound ? readStoredSession() : null;
  const initiatingBearer = initiatingSession?.access_token ?? "";
  let accountChanged = false;
  // Observe intermediate A -> B -> A transitions, not only the final ID.
  // The account store is synchronous; subscribe before the first await.
  const unsubscribe = isAccountBound && typeof useAccount.subscribe === "function"
    ? useAccount.subscribe(state => {
      if (state.user?.id !== initiatingUserId) accountChanged = true;
    })
    : () => {};
  const assertBoundOwner = () => {
    if (isAccountBound && (!initiatingUserId || accountChanged || useAccount.getState().user?.id !== initiatingUserId ||
        !initiatingSession || initiatingSession.user.id.toLowerCase() !== initiatingUserId.toLowerCase() ||
        bearerSubject(initiatingBearer) !== initiatingUserId.toLowerCase() ||
        readStoredSession()?.access_token !== initiatingBearer)) {
      throw new Error("Your account changed. Refresh private account data from the active account.");
    }
  };
  try {
    assertBoundOwner();
    const client = await loadSupabase();
    assertBoundOwner();
    if (!client) throw new Error("Connect an AXOM account to manage email delivery. Local previews remain available.");
    let options: { body: object; headers?: { Authorization: string } } = { body };
    if (isAccountBound) {
      // The shared SDK may be B while Zustand renders A. Pin the verified
      // initiating bearer; Edge independently authenticates and scopes it.
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      assertBoundOwner();
      if (sessionError || !session || session.user.id.toLowerCase() !== initiatingUserId!.toLowerCase() ||
          session.access_token !== initiatingBearer ||
          bearerSubject(session.access_token) !== initiatingUserId!.toLowerCase()) {
        throw new Error("Your account session changed. Sign in again before accessing private account data.");
      }
      options = { body, headers: { Authorization: `Bearer ${initiatingBearer}` } };
    }
    const { data, error } = await client.functions.invoke(`communications?action=${encodeURIComponent(action)}`, options);
    // A response under the old owner cannot report success after a handoff.
    // A request already dispatched is not cancelled by this client-side guard.
    assertBoundOwner();
    if (error) {
      if ("context" in error && error.context instanceof Response) {
        const response = await error.context.json().catch(() => null) as { error?: string } | null;
        // Parsing is another asynchronous boundary: A may switch to B, or A -> B -> A,
        // while the error body is consumed. Never surface A's server text to B.
        assertBoundOwner();
        if (response?.error) throw new Error(response.error);
      }
      throw new Error("Communications could not be reached. Check your connection and try again.");
    }
    if (data?.error) throw new Error(String(data.error)); return data as T;
  } finally {
    unsubscribe();
  }
}
export function useCommunications() {
  const userId = useAccount(s => s.user?.id);
  const [ownedData, setOwnedData] = useState<{ userId: string; value: CommunicationsSettings } | null>(null);
  const account = useRef(userId); account.current = userId;
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!userId) { setOwnedData(null); setError("Sign in to manage email delivery. You can preview your local reports below."); return; }
    setLoading(true); setError("");
    try { const result = await communicationsRequest<CommunicationsSettings>("settings"); if (account.current === userId) setOwnedData({ userId, value: result }); } catch (e) { if (account.current === userId) setError(e instanceof Error ? e.message : "Unable to load communications."); } finally { if (account.current === userId) setLoading(false); }
  }, [userId]);
  useEffect(() => { setOwnedData(null); void reload(); }, [reload]);
  // Account changes render before the clearing effect runs. Bind every result
  // to the account that fetched it so a prior account can never flash onscreen.
  const data = ownedData && ownedData.userId === userId ? ownedData.value : null;
  return { data, loading, error, reload };
}
