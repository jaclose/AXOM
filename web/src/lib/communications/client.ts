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
type OwnedSettings = { userId: string; generation: number; value: CommunicationsSettings };
type OwnedStatus = { userId: string; generation: number; request: number; loading: boolean; error: string };
export function useCommunications() {
  const userId = useAccount(s => s.user?.id);
  // An A→B→A transition must not resurrect a response from the first A.
  // Advance synchronously with render so the old result is hidden even before
  // the replacement settings effect runs.
  const owner = useRef({ userId, generation: 0 });
  if (owner.current.userId !== userId) {
    owner.current = { userId, generation: owner.current.generation + 1 };
  }
  const generation = owner.current.generation;
  const requestOrder = useRef(0);
  const [ownedData, setOwnedData] = useState<OwnedSettings | null>(null);
  const [ownedStatus, setOwnedStatus] = useState<OwnedStatus | null>(null);
  const reload = useCallback(async () => {
    // A previously captured reload callback cannot start a request for an
    // account that has since changed, even if its ID later becomes equal.
    if (owner.current.userId !== userId || owner.current.generation !== generation) return;
    const request = ++requestOrder.current;
    // Clear stale permissions and settings at the *start* of every refresh.
    // A failed recheck must not preserve an old administrator grant in the UI.
    setOwnedData(null);
    if (!userId) { setOwnedStatus(null); return; }
    const isCurrent = () => owner.current.userId === userId
      && owner.current.generation === generation && requestOrder.current === request;
    setOwnedStatus({ userId, generation, request, loading: true, error: "" });
    try {
      const value = await communicationsRequest<CommunicationsSettings>("settings");
      if (isCurrent()) {
        setOwnedData({ userId, generation, value });
        setOwnedStatus({ userId, generation, request, loading: false, error: "" });
      }
    } catch (e) {
      if (isCurrent()) setOwnedStatus({ userId, generation, request, loading: false,
        error: e instanceof Error ? e.message : "Unable to load communications." });
    }
  }, [userId, generation]);
  useEffect(() => { void reload(); }, [reload]);
  // Do not expose a previous generation's value, loading state or error during
  // the first render after an identity transition. Also hide all account-only
  // UI when signed out, even if an earlier request is still pending.
  const data = userId && ownedData?.userId === userId && ownedData.generation === generation
    ? ownedData.value : null;
  const status = userId && ownedStatus?.userId === userId && ownedStatus.generation === generation
    && ownedStatus.request === requestOrder.current ? ownedStatus : null;
  return {
    data,
    loading: Boolean(userId) && (!status || status.loading),
    error: !userId ? "Sign in to manage email delivery. You can preview your local reports below." : status?.error ?? "",
    reload,
  };
}
