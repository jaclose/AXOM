// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOUNDSCAPES } from "../../lib/soundscapes/presets";
import { SoundscapeStage } from "./SoundscapeStage";

vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(cleanup);

describe("SoundscapeStage", () => {
  it("draws the plain ring on cards and the sound orb on the large stage, never both", () => {
    const card = render(<SoundscapeStage preset={SOUNDSCAPES["gamma-40"]} animate={false} />);
    expect(card.container.querySelector(".pulse-ring")).toBeTruthy();
    expect(card.container.querySelector("canvas.sound-orb")).toBeNull();
    card.unmount();

    const hero = render(<SoundscapeStage preset={SOUNDSCAPES["gamma-40"]} animate={false} orb label="40 Hz Gamma visual" />);
    expect(hero.container.querySelector("canvas.sound-orb")).toBeTruthy();
    expect(hero.container.querySelector(".pulse-ring")).toBeNull();
    // The orb is decoration: the stage carries the label, the canvas is hidden from assistive tech.
    expect(hero.container.querySelector("canvas.sound-orb")?.getAttribute("aria-hidden")).toBe("true");
    expect(hero.getByRole("img", { name: "40 Hz Gamma visual" })).toBeTruthy();
  });

  it("survives an empty Your sounds shelf", () => {
    const view = render(<SoundscapeStage preset={SOUNDSCAPES.yours} animate={false} orb />);
    expect(view.container.querySelector(".soundscape-stage")).toBeTruthy();
  });
});
