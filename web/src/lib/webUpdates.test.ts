// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.axom.info/"}
import { afterEach, describe, expect, it, vi } from "vitest";
import { activateWaitingWebUpdate } from "./webUpdates";

afterEach(() => { vi.unstubAllGlobals(); });

function stubRegistration(registration: ServiceWorkerRegistration | undefined) {
  const getRegistration = vi.fn(async () => registration);
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  return getRegistration;
}

function activeWorker() {
  return { state: "activated" } as ServiceWorker;
}

describe("web update activation without losing the current page", () => {
  it("rejects when the old worker remains active and no replacement was staged", async () => {
    const old = activeWorker();
    const update = vi.fn(async () => undefined);
    const getRegistration = stubRegistration({
      active: old, installing: null, waiting: null, update,
    } as unknown as ServiceWorkerRegistration);

    await expect(activateWaitingWebUpdate()).rejects.toThrow(/could not be staged/i);
    expect(update).toHaveBeenCalledOnce();
    expect(getRegistration).toHaveBeenCalledOnce();
  });

  it("allows a browser without an installed worker to refresh through the network", async () => {
    stubRegistration(undefined);
    await expect(activateWaitingWebUpdate()).resolves.toBeUndefined();
  });

  it("accepts a different worker already activated during registration.update", async () => {
    const old = activeWorker();
    const next = activeWorker();
    const registration = {
      active: old, installing: null, waiting: null,
      update: vi.fn(async () => { registration.active = next; }),
    };
    stubRegistration(registration as unknown as ServiceWorkerRegistration);
    await expect(activateWaitingWebUpdate()).resolves.toBeUndefined();
    expect(registration.update).toHaveBeenCalledOnce();
  });

  it("activates an installed waiting worker and waits for its state transition", async () => {
    const listeners = new Set<() => void>();
    const waiting = {
      state: "installed",
      addEventListener: vi.fn((_type: string, listener: () => void) => { listeners.add(listener); }),
      removeEventListener: vi.fn((_type: string, listener: () => void) => { listeners.delete(listener); }),
      postMessage: vi.fn(() => { waiting.state = "activated"; for (const listener of listeners) listener(); }),
    };
    stubRegistration({
      active: activeWorker(), waiting, installing: null,
      update: vi.fn(async () => undefined),
    } as unknown as ServiceWorkerRegistration);
    await expect(activateWaitingWebUpdate()).resolves.toBeUndefined();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "AXOM_ACTIVATE_UPDATE" });
    expect(waiting.removeEventListener).toHaveBeenCalled();
  });

  it("keeps a redundant installing worker from being treated as a staged update", async () => {
    stubRegistration({
      active: activeWorker(), waiting: null,
      installing: {
        state: "redundant",
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      },
      update: vi.fn(async () => undefined),
    } as unknown as ServiceWorkerRegistration);
    await expect(activateWaitingWebUpdate()).rejects.toThrow(/could not be staged/i);
  });
});
