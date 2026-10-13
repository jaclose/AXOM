import { useCallback, useEffect, useRef, useState } from "react";
import { cloudConfigured, loadSupabase } from "../account/supabase";
import { listCloudCatalog, type CloudCatalog } from "./client";
export type CatalogState =
  | { status: "loading"; identity: string }
  | { status: "unconfigured"; identity: string }
  | { status: "error"; identity: string; message: string }
  | { status: "ready"; identity: string; catalog: CloudCatalog; signedIn: boolean };

/** Metadata is fetched from the same authenticated catalog on every supported client.
 * Clear the previous user's metadata immediately on an identity change. */
export function useCloudCatalog() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<CatalogState>({ status: cloudConfigured() ? "loading" : "unconfigured", identity: "initial" });
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    if (!cloudConfigured()) { setState({ status: "unconfigured", identity: "none" }); return; }
    const controller = new AbortController(), current = ++generation.current;
    let unsubscribe: (() => void) | undefined;
    let identity: string | undefined;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const present = () => !controller.signal.aborted && current === generation.current;
    const run = async () => {
      try {
        const client = await loadSupabase();
        if (!client || !present()) return;
        const session = await client.auth.getSession();
        // The view may have closed while auth held its lock. Do not subscribe
        // after cleanup or allow a stale refresh to replace the current view.
        if (!present()) return;
        if (session.error) throw new Error("Sign-in could not be checked. Retry the library without changing your saved work.");
        identity = session.data.session?.user.id ?? "anonymous";
        setState({ status: "loading", identity });
        // Supabase callbacks must not await another auth request while the auth lock is held.
        const subscription = client.auth.onAuthStateChange((_event, next) => {
          const nextId = next?.user.id ?? "anonymous";
          if (identity !== undefined && nextId !== identity && present()) {
            controller.abort();
            setState({ status: "loading", identity: nextId });
            scheduled = setTimeout(refresh, 0);
          }
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
        const catalog = await listCloudCatalog(controller.signal);
        if (present()) setState({ status: "ready", identity, catalog, signedIn: identity !== "anonymous" });
      } catch (error) {
        if (present()) setState({ status: "error", identity: identity ?? "unknown", message: error instanceof Error ? error.message : "The library could not be loaded." });
      }
    };
    void run();
    return () => { controller.abort(); unsubscribe?.(); if (scheduled) clearTimeout(scheduled); };
  }, [revision, refresh]);
  return { state, refresh };
}
