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
  const client = await loadSupabase(); if (!client) throw new Error("Connect an AXOM account to manage email delivery. Local previews remain available.");
  const { data, error } = await client.functions.invoke(`communications?action=${encodeURIComponent(action)}`, { body });
  if (error) {
    if ("context" in error && error.context instanceof Response) { const response = await error.context.json().catch(() => null) as { error?: string } | null; if (response?.error) throw new Error(response.error); }
    throw new Error("Communications could not be reached. Check your connection and try again.");
  }
  if (data?.error) throw new Error(String(data.error)); return data as T;
}
export function useCommunications() {
  const userId = useAccount(s => s.user?.id); const [data, setData] = useState<CommunicationsSettings | null>(null);
  const account = useRef(userId); account.current = userId;
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!userId) { setData(null); setError("Sign in to manage email delivery. You can preview your local reports below."); return; }
    setLoading(true); setError("");
    try { const result = await communicationsRequest<CommunicationsSettings>("settings"); if (account.current === userId) setData(result); } catch (e) { if (account.current === userId) setError(e instanceof Error ? e.message : "Unable to load communications."); } finally { if (account.current === userId) setLoading(false); }
  }, [userId]);
  useEffect(() => { setData(null); void reload(); }, [reload]);
  return { data, loading, error, reload };
}
