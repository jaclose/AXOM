// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STARTUP_INTRO_ENABLED_KEY,
  STARTUP_INTRO_MAX_MS,
  STARTUP_INTRO_SESSION_KEY,
  pickFilmSource,
  startStartupIntro,
} from "./startupIntro";
import type { StartupIntro } from "./startupIntro";
import { CINEMATICS, CINEMATIC_LEDGER_KEY, writeCinematicPreferences } from "./cinematics";

let players: StartupIntro[];
function start(native = false) {
  const player = startStartupIntro({ native });
  players.push(player);
  return player;
}
function overlay() { return document.querySelector<HTMLElement>(".axom-startup-intro"); }
function film() { return document.querySelector<HTMLVideoElement>(".axom-startup-intro video")!; }
function root() { return document.getElementById("root")!; }

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  players = [];
  document.body.innerHTML = '<div id="root"><button>Setup</button></div>';
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  players.forEach((player) => player.dismiss());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("bounded startup cinematic", () => {
  it("plays silent inline local media without awaiting or mutating workspace readiness", () => {
    const savedWorkspace = '{"profile":{"onboarded":false}}';
    localStorage.setItem("workspace-fixture", savedWorkspace);
    start();
    expect(film().muted).toBe(true);
    expect(film().defaultMuted).toBe(true);
    expect(film().playsInline).toBe(true);
    expect(film().src).toMatch(/\/cinematics\/luster-slow-sweep\.mp4$/);
    expect(film().poster).toMatch(/\/cinematics\/luster-slow-sweep-poster\.jpg$/);
    expect(film().play).toHaveBeenCalledOnce();
    expect(film().classList.contains("axom-startup-intro__film--playing")).toBe(false);
    film().dispatchEvent(new Event("playing"));
    expect(film().classList.contains("axom-startup-intro__film--playing")).toBe(true);
    expect(root().textContent).toBe("Setup");
    expect(root().hasAttribute("inert")).toBe(true);
    expect(localStorage.getItem("workspace-fixture")).toBe(savedWorkspace);
  });

  it("finishes and releases media, input, and timers at a hard deadline even if decoding hangs", async () => {
    const player = start();
    const video = film();
    await vi.advanceTimersByTimeAsync(STARTUP_INTRO_MAX_MS - 1);
    expect(overlay()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await expect(player.finished).resolves.toBeUndefined();
    expect(overlay()).toBeNull();
    expect(root().hasAttribute("inert")).toBe(false);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.hasAttribute("src")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("crossfades on video end but never extends the hard deadline", async () => {
    start();
    await vi.advanceTimersByTimeAsync(STARTUP_INTRO_MAX_MS - 50);
    film().dispatchEvent(new Event("ended"));
    expect(overlay()?.classList.contains("axom-startup-intro--leaving")).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(overlay()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a completed film with a bounded short fade", async () => {
    const player = start();
    film().dispatchEvent(new Event("ended"));
    await vi.advanceTimersByTimeAsync(160);
    await player.finished;
    expect(overlay()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["click", "Escape"])("skips on %s and consumes the gesture", async (gesture) => {
    const player = start();
    const bubbled = vi.fn();
    window.addEventListener(gesture === "click" ? "click" : "keydown", bubbled);
    try {
      const event = gesture === "click"
        ? new MouseEvent("click", { bubbles: true, cancelable: true })
        : new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      (gesture === "click" ? overlay()! : window).dispatchEvent(event);
      await player.finished;
      expect(event.defaultPrevented).toBe(true);
      expect(bubbled).not.toHaveBeenCalled();
      expect(overlay()).toBeNull();
      expect(root().hasAttribute("inert")).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      window.removeEventListener(gesture === "click" ? "click" : "keydown", bubbled);
    }
  });

  it("persists an explicit disable and starts no media when disabled", async () => {
    const player = start();
    const disable = overlay()!.querySelectorAll("button")[1];
    disable.click();
    await player.finished;
    expect(localStorage.getItem(STARTUP_INTRO_ENABLED_KEY)).toBe("false");
    const next = start(true);
    await next.finished;
    expect(overlay()).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("plays once per day by default and leaves navigation untouched", async () => {
    const first = start();
    first.dismiss();
    expect(sessionStorage.getItem(STARTUP_INTRO_SESSION_KEY)).toBe("1");
    const again = start();
    await again.finished;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.dispatchEvent(new Event("focus"));
    expect(overlay()).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });

  it("does not use the web session marker for a native startup", () => {
    writeCinematicPreferences({ frequency: "always" });
    sessionStorage.setItem(STARTUP_INTRO_SESSION_KEY, "1");
    const first = start(true);
    expect(overlay()).not.toBeNull();
    first.dismiss();
    start(true);
    expect(overlay()).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("skips media entirely for reduced motion, without stealing input", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const focused = root().querySelector("button")!;
    focused.focus();
    const existingTimers = vi.getTimerCount();
    const player = start();
    await player.finished;
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(root().hasAttribute("inert")).toBe(false);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(existingTimers);
  });

  it("fails open immediately on missing media or unsupported codecs", async () => {
    const player = start();
    film().dispatchEvent(new Event("error"));
    await player.finished;
    expect(overlay()).toBeNull();
    expect(root().hasAttribute("inert")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails open when autoplay is rejected", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error("Autoplay denied"));
    const player = start();
    await player.finished;
    expect(overlay()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes immediately for a bootstrap error, and late media events stay inert", async () => {
    const player = start();
    const video = film();
    const detachedOverlay = overlay()!;
    player.dismiss();
    player.dismiss();
    video.dispatchEvent(new Event("ended"));
    detachedOverlay.querySelectorAll("button")[1].click();
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(escape);
    await player.finished;
    expect(escape.defaultPrevented).toBe(false);
    expect(localStorage.getItem(STARTUP_INTRO_ENABLED_KEY)).toBeNull();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still opens and skips when both storage APIs are blocked", async () => {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
      vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    }
    const player = start();
    expect(overlay()).not.toBeNull();
    overlay()!.querySelectorAll("button")[1].click();
    await player.finished;
    expect(overlay()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves an existing inert state and cleans up on page exit", async () => {
    root().setAttribute("inert", "");
    const player = start();
    window.dispatchEvent(new Event("pagehide"));
    await player.finished;
    expect(overlay()).toBeNull();
    expect(root().hasAttribute("inert")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("plays the update film once, with a caption, on the first open after an update", async () => {
    localStorage.setItem(CINEMATIC_LEDGER_KEY, JSON.stringify({ lastSeenVersion: "0.0.1", lastPlayedDay: "2000-01-01" }));
    const player = startStartupIntro({ native: true, version: "0.0.2" });
    players.push(player);
    expect(film().src).toMatch(/luster-push-sweep\.mp4$/);
    expect(overlay()!.querySelector(".axom-startup-intro__caption")?.textContent).toBe("Updated to v0.0.2");
    player.dismiss();
    players.push(startStartupIntro({ native: true, version: "0.0.2" }));
    expect(overlay()).toBeNull();
  });

  it("previews a chosen film immediately, whatever the schedule", () => {
    writeCinematicPreferences({ frequency: "never" });
    players.push(startStartupIntro({ native: true, preview: { film: CINEMATICS["edge-glint"] } }));
    expect(film().src).toMatch(/luster-edge-glint\.mp4$/);
  });

  it.each([
    [["hvc1"], /\/startup\/axom-ident-hevc10\.mp4$/],
    [["vp09"], /\/startup\/axom-ident-vp9\.webm$/],
    [["hvc1", "vp09"], /\/startup\/axom-ident-hevc10\.mp4$/],
    [[], /\/startup\/axom-ident\.mp4$/],
  ])("plays the ident's banding-free 10-bit cut when the engine decodes %j", (codecs, expected) => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation(
      (type) => (codecs.some((codec) => type.includes(codec)) ? "probably" : ""),
    );
    players.push(startStartupIntro({ native: true, preview: { film: CINEMATICS["brand-ident"] } }));
    expect(film().src).toMatch(expected);
  });

  it("falls back to a film's H.264 source when codec probing throws or it has no alternates", () => {
    const video = document.createElement("video");
    vi.spyOn(video, "canPlayType").mockImplementation(() => { throw new Error("unsupported"); });
    expect(pickFilmSource(video, CINEMATICS["brand-ident"])).toBe("startup/axom-ident.mp4");
    expect(pickFilmSource(video, CINEMATICS["slow-sweep"])).toBe(CINEMATICS["slow-sweep"].src);
  });

  it("honors AXOM's own reduced-motion setting, not only the OS", async () => {
    document.documentElement.dataset.motion = "reduce";
    try {
      const player = start();
      await player.finished;
      expect(overlay()).toBeNull();
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    } finally {
      delete document.documentElement.dataset.motion;
    }
  });
});
