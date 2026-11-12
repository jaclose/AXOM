import { useCallback, useEffect, useRef, useState } from "react";
import { loadSupabase } from "../account/supabase";
import { useAccount } from "../account/accountStore";
import type { Preference } from "./model";
export interface PrivacyRequest { id: string; kind: "export" | "deletion"; status: string; scheduled_for?: string; expires_at?: string; failure_code?: string }
export interface CommunicationsSettings {
  preferences: Preference[]; identity: { accent: string; theme: "dark" | "light" }; history: { id: string; type: string; status: string; created_at: string; sent_at?: string }[];
  privacy: PrivacyRequest[]; admin: boolean; deliveryMode: string; deletionEnabled: boolean; hasProtectedCopy: boolean;
}
export async function communicationsRequest<T>(action: string, body: object = {}): Promise<T> {
  // An export is initiated by one signed-in account. SDK loading may finish
  // after that account signs out or another learner signs in. Never retarget
  // the already-clicked request to the account that happens to be current.
  const isAccountExport = action === "request-export";
  const initiatingUserId = isAccountExport ? useAccount.getState().user?.id : undefined;
  let accountChanged = false;
  // Observe intermediate A -> B -> A transitions, not only the final ID.
  // The account store is synchronous; subscribe before the first await.
  const unsubscribe = isAccountExport && typeof useAccount.subscribe === "function"
    ? useAccount.subscribe(state => {
      if (state.user?.id !== initiatingUserId) accountChanged = true;
    })
    : () => {};
  const assertExportOwner = () => {
    if (isAccountExport && (!initiatingUserId || accountChanged || useAccount.getState().user?.id !== initiatingUserId)) {
      throw new Error("Your account changed. Request the export again from the active account.");
    }
  };
  try {
    assertExportOwner();
    const client = await loadSupabase();
    assertExportOwner();
    if (!client) throw new Error("Connect an AXOM account to manage email delivery. Local previews remain available.");
    const { data, error } = await client.functions.invoke(`communications?action=${encodeURIComponent(action)}`, { body });
    // A response under the old owner cannot report success after a handoff.
    // A request already dispatched is not cancelled by this client-side guard.
    assertExportOwner();
    if (error) {
      if ("context" in error && error.context instanceof Response) { const response = await error.context.json().catch(() => null) as { error?: string } | null; if (response?.error) throw new Error(response.error); }
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
