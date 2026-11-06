import { saveAndVerifyLocalWorkspace } from "./localVault";
import { useStore } from "./store";

/** Explicit, non-destructive retry of the live Zustand workspace. */
export async function retryLocalWorkspaceSave(): Promise<void> {
  const serializeCurrent = () => {
    const state = useStore.getState();
    const options = useStore.persist.getOptions();
    return JSON.stringify({
      state: options.partialize ? options.partialize(state) : state,
      version: options.version,
    });
  };

  let attempted = "";
  await saveAndVerifyLocalWorkspace(() => {
    attempted = serializeCurrent();
    return attempted;
  });

  // The bytes that read back may be valid but already stale if another edit
  // occurred during the asynchronous read. Do not toast a false confirmation.
  if (serializeCurrent() !== attempted) {
    throw new Error("The workspace changed during verification. Newer edits are not yet confirmed saved. Keep AXOM open and retry.");
  }
}
