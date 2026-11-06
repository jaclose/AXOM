import { saveAndVerifyLocalWorkspace } from "./localVault";
import { useStore } from "./store";

/** Explicit, non-destructive retry of the live Zustand workspace. */
export async function retryLocalWorkspaceSave(): Promise<void> {
  await saveAndVerifyLocalWorkspace(() => {
    const state = useStore.getState();
    const options = useStore.persist.getOptions();
    return JSON.stringify({
      state: options.partialize ? options.partialize(state) : state,
      version: options.version,
    });
  });
}
