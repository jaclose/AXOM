import { useCallback, useEffect, useRef, useState } from "react";
import { loadSupabase, readStoredSession } from "../account/supabase";
import { parseActorSession } from "./actorSession";
import { useAccount } from "../account/accountStore";
import type { Preference } from "./model";
export interface PrivacyRequest { id: string; kind: "export" | "deletion"; status: string; scheduled_for?: string; expires_at?: string; failure_code?: string }
export interface CommunicationsSettings {
  preferences: Preference[]; identity: { accent: string; theme: "dark" | "light" }; history: { id: string; type: string; status: string; created_at: string; sent_at?: string }[];
  privacy: PrivacyRequest[]; admin: boolean; deliveryMode: string; deletionEnabled: boolean; hasProtectedCopy: boolean;
}
export async function communicationsRequest<T>(action: string, body: object = {}): Promise<T> {
  // Destructive intent is captured synchronously, before the lazy SDK boundary.
  // The server independently checks these claims against its verified bearer.
  const stored = action === "request-deletion" ? readStoredSession() : null;
  const actor = action === "request-deletion" ? parseActorSession(stored?.access_token ?? "") : null;
  const current = action === "request-deletion" ? useAccount.getState() : null;
  if (action === "request-deletion" &&
      (!actor || !stored || stored.user.id.toLowerCase() !== actor.userId ||
       current?.phase !== "signed-in" || current.user?.id.toLowerCase() !== actor.userId)) {
    throw new Error("Sign in again before confirming account deletion.");
  }
  let invalidated = false;
  const unsubscribe = actor ? useAccount.subscribe(state => {
    if (state.phase !== "signed-in" || state.user?.id.toLowerCase() !== actor.userId) invalidated = true;
  }) : null;
  const assertIntent = () => {
    if (actor && (invalidated || useAccount.getState().phase !== "signed-in" ||
        useAccount.getState().user?.id.toLowerCase() !== actor.userId)) {
      throw new Error("The signed-in account changed. Confirm deletion again after signing in.");
    }
  };
  try {
    const client = await loadSupabase();
    if (!client) throw new Error("Connect an AXOM account to manage email delivery. Local previews remain available.");
    if (actor) {
      assertIntent();
      // A different B bearer or fresh A session cannot inherit the old intent.
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      assertIntent();
      const sdkActor = parseActorSession(session?.access_token ?? "");
      if (sessionError || !session || !sdkActor ||
          session.user.id.toLowerCase() !== actor.userId ||
          sdkActor.userId !== actor.userId || sdkActor.sessionId !== actor.sessionId) {
        throw new Error("Your session changed. Sign in again before confirming deletion.");
      }
    }
    const payload = actor ? { ...body, actorUserId: actor.userId, actorSessionId: actor.sessionId } : body;
    const { data, error } = await client.functions.invoke(`communications?action=${encodeURIComponent(action)}`, { body: payload });
    assertIntent();
    if (error) {
      if ("context" in error && error.context instanceof Response) { const response = await error.context.json().catch(() => null) as { error?: string } | null; if (response?.error) throw new Error(response.error); }
      throw new Error("Communications could not be reached. Check your connection and try again.");
    }
    if (data?.error) throw new Error(String(data.error));
    return data as T;
  } finally {
    unsubscribe?.();
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
