import { afterEach, describe, expect, it, vi } from "vitest";
import { createHydrationGate } from "./storeHydration";

afterEach(() => vi.useRealTimers());
describe("startup hydration gate", () => {
  it("does not expose setup or run startup writers before saved data is ready", async () => {
    const gate = createHydrationGate();
    const mounted = vi.fn();
    const ready = gate.wait().then(mounted);
    await Promise.resolve();
    expect(mounted).not.toHaveBeenCalled();
    gate.finish();
    await ready;
    expect(mounted).toHaveBeenCalledOnce();
  });
  it("handles hydration completing before bootstrap subscribes", async () => {
    const gate = createHydrationGate();
    gate.finish();
    await expect(gate.wait()).resolves.toBeUndefined();
  });
  it("fails closed when hydration fails rather than persisting the seed", async () => {
    const gate = createHydrationGate();
    gate.finish(new Error("storage unavailable"));
    await expect(gate.wait()).rejects.toThrow("storage unavailable");
  });
  it("provides a bounded recovery path for a hung vault", async () => {
    vi.useFakeTimers();
    const gate = createHydrationGate();
    const pending = expect(gate.wait(100)).rejects.toThrow("taking too long");
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    gate.finish();
    await expect(gate.wait()).resolves.toBeUndefined();
  });
});
