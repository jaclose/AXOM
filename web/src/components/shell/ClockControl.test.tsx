// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CLOCK_PREFERENCES } from "../../lib/seed";
import type { ClockPrecision, ClockTicker } from "../../lib/clock";
import { AnalogClock, ClockControl, unwrapAngle } from "./ClockControl";

function manualTicker(initial: string) {
  let snapshot = new Date(initial).getTime();
  const listeners = new Map<() => void, ClockPrecision>();
  const ticker: ClockTicker = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribe(listener, precision) {
      listeners.set(listener, precision);
      return () => { listeners.delete(listener); };
    },
    reconcile: () => {},
  };
  return {
    ticker,
    listeners,
    set(value: string) {
      snapshot = new Date(value).getTime();
      [...listeners.keys()].forEach((listener) => listener());
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ClockControl", () => {
  it("renders a compact accessible trigger and labelled non-modal clock popover", () => {
    const source = manualTicker("2026-07-12T14:05:06.000Z");
    render(
      <ClockControl
        clockPreferences={{ ...DEFAULT_CLOCK_PREFERENCES, showDate: true, showTimezoneLabel: true }}
        timeZonePreference={{ mode: "custom", customTimezone: "America/Grenada" }}
        onOpenPreferences={() => {}}
        locale="en-US"
        ticker={source.ticker}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Open clock, 10:05 AM, America\/Grenada/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    expect(document.querySelector("[aria-live]")).toBeNull();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Clock" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBe(dialog);
    expect(within(dialog).getByText("America/Grenada")).toBeTruthy();
    expect(within(dialog).getByText("Sun, Jul 12, 2026")).toBeTruthy();
    expect(dialog.querySelector("svg.analog-clock")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close clock" }));
  });

  it("closes on Escape or outside pointer input and returns focus to the trigger", () => {
    const source = manualTicker("2026-07-12T14:05:06.000Z");
    render(
      <div>
        <ClockControl
          clockPreferences={DEFAULT_CLOCK_PREFERENCES}
          timeZonePreference={{ mode: "custom", customTimezone: "America/Grenada" }}
          onOpenPreferences={() => {}}
          locale="en-US"
          ticker={source.ticker}
        />
        <button>Outside</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: /Open clock/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("hands off to Clock preferences without nesting another dialog", () => {
    const source = manualTicker("2026-07-12T14:05:06.000Z");
    const onOpenPreferences = vi.fn();
    render(
      <ClockControl
        clockPreferences={DEFAULT_CLOCK_PREFERENCES}
        timeZonePreference={{ mode: "system" }}
        onOpenPreferences={onOpenPreferences}
        ticker={source.ticker}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open clock/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clock preferences" }));
    expect(onOpenPreferences).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not subscribe when hidden and upgrades precision only for visible seconds", () => {
    const source = manualTicker("2026-07-12T14:05:06.000Z");
    const { rerender } = render(
      <ClockControl
        clockPreferences={{ ...DEFAULT_CLOCK_PREFERENCES, enabled: false }}
        timeZonePreference={{ mode: "system" }}
        onOpenPreferences={() => {}}
        ticker={source.ticker}
      />,
    );
    expect(source.listeners.size).toBe(0);
    rerender(
      <ClockControl
        clockPreferences={{ ...DEFAULT_CLOCK_PREFERENCES, enabled: true, showAnalogSeconds: true }}
        timeZonePreference={{ mode: "system" }}
        onOpenPreferences={() => {}}
        ticker={source.ticker}
      />,
    );
    expect([...source.listeners.values()]).toEqual(["minute"]);
    fireEvent.click(screen.getByRole("button", { name: /Open clock/ }));
    expect([...source.listeners.values()]).toEqual(["second"]);
  });

  it("updates the isolated clock child without rerendering its parent", () => {
    const source = manualTicker("2026-07-12T14:05:06.000Z");
    let parentRenders = 0;
    function Parent() {
      parentRenders += 1;
      return (
        <ClockControl
          clockPreferences={{ ...DEFAULT_CLOCK_PREFERENCES, showDigitalSeconds: true }}
          timeZonePreference={{ mode: "custom", customTimezone: "America/Grenada" }}
          onOpenPreferences={() => {}}
          locale="en-US"
          ticker={source.ticker}
        />
      );
    }
    render(<Parent />);
    expect(screen.getByText("10:05:06 AM")).toBeTruthy();
    act(() => source.set("2026-07-12T14:05:07.000Z"));
    expect(screen.getByText("10:05:07 AM")).toBeTruthy();
    expect(parentRenders).toBe(1);
  });

  it("marks analog motion reduced when the device requests reduced motion", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const source = manualTicker("2026-07-12T14:05:06.000Z");
    render(
      <ClockControl
        clockPreferences={{ ...DEFAULT_CLOCK_PREFERENCES, showAnalogSeconds: true }}
        timeZonePreference={{ mode: "system" }}
        onOpenPreferences={() => {}}
        ticker={source.ticker}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open clock/ }));
    expect(document.querySelector(".analog-clock")?.classList.contains("reduced")).toBe(true);
  });

  it("rotates hands around the dial center with one CSS transform (no double pivot)", () => {
    render(<AnalogClock date={new Date("2026-07-12T14:15:30.000Z")} timeZone="UTC" showSeconds />);
    const hands = [...document.querySelectorAll<SVGLineElement>(".analog-clock-hand")];
    expect(hands).toHaveLength(3);
    for (const hand of hands) {
      expect(hand.getAttribute("transform")).toBeNull();
      expect(hand.style.transform).toMatch(/^rotate\(-?\d+(\.\d+)?deg\)$/);
    }
    expect(document.querySelector<SVGLineElement>(".analog-clock-hand.minute")?.style.transform).toBe("rotate(93deg)");
  });

  it("unwraps hand angles so midnight/hour boundaries move forward", () => {
    expect(unwrapAngle(undefined, 354)).toBe(354);
    expect(unwrapAngle(354, 0)).toBe(360);
    expect(unwrapAngle(360, 6)).toBe(366);
    expect(unwrapAngle(726, 0)).toBe(720);
    expect(unwrapAngle(90, 96)).toBe(96);
  });
});
