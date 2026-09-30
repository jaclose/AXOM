// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { notificationDestination, notify } from "./notify";

const shown: FakeNotification[] = [];
class FakeNotification {
  static permission = "granted";
  static requestPermission = vi.fn();
  onclick?: () => void;
  close = vi.fn();
  constructor(public title: string, public options?: NotificationOptions) { shown.push(this); }
}
beforeEach(() => { localStorage.clear(); shown.length = 0; FakeNotification.permission = "granted"; vi.stubGlobal("Notification", FakeNotification); });
afterEach(() => vi.unstubAllGlobals());

it("deduplicates an event across concurrent calls and persisted reload history", async () => {
  const result = await Promise.all([notify("Rest finished", "Wake gently", { dedupeKey: "rest-1", route: "productivity" }), notify("Rest finished", "Wake gently", { dedupeKey: "rest-1" })]);
  expect(result).toEqual([true, false]);
  expect(await notify("Rest finished", "Wake gently", { dedupeKey: "rest-1" })).toBe(false);
  expect(shown).toHaveLength(1);
});
it("routes a browser click to its useful destination and closes the notification", async () => {
  vi.spyOn(window, "focus").mockImplementation(() => undefined);
  await notify("Rest finished", undefined, { route: "productivity", action: "rest" });
  const listener = vi.fn();
  window.addEventListener("axom:notification-open", listener);
  shown[0].onclick?.();
  expect(location.hash).toBe("#productivity");
  expect(listener).toHaveBeenCalled();
  expect(shown[0].close).toHaveBeenCalledOnce();
  window.removeEventListener("axom:notification-open", listener);
});
it("never prompts from delivery and rejects arbitrary destinations", async () => {
  FakeNotification.permission = "denied";
  expect(await notify("Notice")).toBe(false);
  expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  expect(notificationDestination({ route: "https://evil.test", action: "execute" })).toEqual({ route: undefined, action: undefined });
});
