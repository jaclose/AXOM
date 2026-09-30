// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { shellBusy } from "./shellBusy";

afterEach(() => { document.body.innerHTML = ""; });

describe("shellBusy", () => {
  it("is quiet on a plain page and busy under any first-run layer, check-in or rest", () => {
    expect(shellBusy()).toBe(false);
    for (const cls of ["modal-scrim", "guide-offer", "tour-tip", "promise-stage", "coach-bubble", "game-checkin", "focus-checkin", "rest-overlay"]) {
      document.body.innerHTML = `<div class="${cls}"></div>`;
      expect(shellBusy(), cls).toBe(true);
    }
  });

  it("counts a focused text field as busy, and can ignore its own layer", () => {
    document.body.innerHTML = `<input id="field" /><div class="coach-bubble" id="mine"></div>`;
    expect(shellBusy(document.getElementById("mine"))).toBe(false);
    (document.getElementById("field") as HTMLInputElement).focus();
    expect(shellBusy(document.getElementById("mine"))).toBe(true);
  });
});
