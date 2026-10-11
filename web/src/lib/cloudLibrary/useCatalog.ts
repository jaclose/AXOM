import { useCallback, useEffect, useState } from "react";
import { catalogClient, listCloudCatalog, type CloudCatalog } from "./client";

export type CatalogState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; catalog: CloudCatalog; signedIn: boolean };
/** Metadata only; account changes cancel and discard the previous audience's view. */
export function useCatalog() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    let disposed = false, generation = 0, user: string | null = null;
    let pending: AbortController | undefined, subscription: { unsubscribe: () => void } | undefined;
    const load = async () => {
      const current = ++generation;
      pending?.abort(); pending = new AbortController();
      const controller = pending;
      if (!disposed) setState({ status: "loading" });
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const catalog = await listCloudCatalog(controller.signal);
        if (!disposed && current === generation) setState({ status: "ready", catalog, signedIn: user !== null });
      } catch (cause) {
        if (!disposed && current === generation) setState({ status: "error", message: controller.signal.aborted
          ? "The library took too long to respond. Retry when your connection is ready."
          : cause instanceof Error ? cause.message : "The shared library could not be loaded." });
      } finally { clearTimeout(timer); }
    };
    void catalogClient().then(async client => {
      const session = await client.auth.getSession();
      if (disposed) return;
      if (session.error) throw session.error;
      user = session.data.session?.user.id ?? null;
      subscription = client.auth.onAuthStateChange((_event, next) => {
        const id = next?.user.id ?? null;
        if (id === user || disposed) return;
        user = id; generation++; pending?.abort();
        // Do not call Supabase inside its synchronous auth callback.
        queueMicrotask(() => { if (!disposed) void load(); });
      }).data.subscription;
      await load();
    }).catch(cause => {
      if (!disposed) setState({ status: "error", message: cause instanceof Error ? cause.message : "The shared library is unavailable." });
    });
    return () => { disposed = true; generation++; pending?.abort(); subscription?.unsubscribe(); };
  }, [revision]);
  return { state, refresh };
}
