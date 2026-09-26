/** No eager store import: startup must reject newer schemas before hydration. */
export function createHydrationGate() {
  let status: "pending" | "ready" | "failed" = "pending";
  let failure: unknown;
  const listeners = new Set<() => void>();
  return {
    start() { status = "pending"; failure = undefined; },
    finish(error?: unknown) {
      failure = error;
      status = error ? "failed" : "ready";
      listeners.forEach((listener) => listener());
    },
    wait(timeoutMs = 20_000): Promise<void> {
      return new Promise((resolve, reject) => {
        const finish = () => {
          if (status === "pending") return;
          clearTimeout(timer);
          listeners.delete(finish);
          if (status === "ready") resolve();
          else reject(failure instanceof Error ? failure : new Error("The saved workspace could not be loaded."));
        };
        const timer = setTimeout(() => {
          listeners.delete(finish);
          reject(new Error("Your saved workspace is taking too long to load. Close other AXOM windows and try again. Do not clear your local data."));
        }, timeoutMs);
        listeners.add(finish);
        finish();
      });
    },
  };
}

export const storeHydration = createHydrationGate();
