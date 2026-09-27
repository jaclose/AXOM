import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CINEMATICS,
  DEFAULT_CINEMATIC_PREFERENCES,
  decideStartupCinematic,
  isoWeekKey,
  normalizeCinematicPreferences,
  type CinematicLedger,
  type CinematicPreferences,
} from "./cinematics";

const monday = new Date(2026, 8, 21, 9, 0);
const wednesday = new Date(2026, 8, 23, 9, 0);
const nextMonday = new Date(2026, 8, 28, 9, 0);

function decide(prefs: Partial<CinematicPreferences>, ledger: CinematicLedger, now = monday, extra: { version?: string; reducedMotion?: boolean; playedThisTab?: boolean } = {}) {
  return decideStartupCinematic({
    prefs: { ...DEFAULT_CINEMATIC_PREFERENCES, ...prefs },
    ledger,
    version: extra.version ?? "1.0.0",
    now,
    reducedMotion: extra.reducedMotion ?? false,
    playedThisTab: extra.playedThisTab,
  });
}

describe("startup cinematic schedule", () => {
  it("welcomes a first run, then waits for the next day", () => {
    const first = decide({}, {});
    expect(first.decision).toMatchObject({ play: true, trigger: "first-run", film: CINEMATICS["slow-sweep"] });
    expect(decide({}, first.nextLedger).decision).toEqual({ play: false, reason: "already-played" });
    expect(decide({}, first.nextLedger, new Date(2026, 8, 22, 7)).decision).toMatchObject({ play: true, trigger: "daily" });
  });

  it("plays weekly only on the first open of each ISO week", () => {
    const { nextLedger } = decide({ frequency: "weekly" }, {});
    expect(decide({ frequency: "weekly" }, nextLedger, wednesday).decision.play).toBe(false);
    expect(decide({ frequency: "weekly" }, nextLedger, nextMonday).decision).toMatchObject({ play: true, trigger: "weekly" });
    expect(isoWeekKey(new Date(2026, 0, 1))).toBe("2026-W01");
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe("2026-W53");
  });

  it("plays the update film exactly once per new version, even in updates-only mode", () => {
    const seen: CinematicLedger = { lastSeenVersion: "1.0.0", lastPlayedDay: "2026-09-21", lastPlayedAt: monday.toISOString() };
    expect(decide({ frequency: "updates" }, seen).decision).toEqual({ play: false, reason: "not-an-update" });
    const updated = decide({ frequency: "updates" }, seen, monday, { version: "1.1.0" });
    expect(updated.decision).toMatchObject({ play: true, trigger: "update", film: CINEMATICS["push-sweep"], caption: "Updated to v1.1.0" });
    expect(updated.nextLedger.lastSeenVersion).toBe("1.1.0");
    expect(decide({ frequency: "updates" }, updated.nextLedger, monday, { version: "1.1.0" }).decision.play).toBe(false);
  });

  it("never plays when disabled or when motion is reduced, but still records the version", () => {
    const disabled = decide({ frequency: "never" }, { lastSeenVersion: "0.9.0" });
    expect(disabled.decision).toEqual({ play: false, reason: "disabled" });
    expect(disabled.nextLedger.lastSeenVersion).toBe("1.0.0");
    expect(decide({}, {}, monday, { reducedMotion: true }).decision).toEqual({ play: false, reason: "reduced-motion" });
  });

  it("plays every launch but only once per web tab", () => {
    const ledger = { lastSeenVersion: "1.0.0", lastPlayedAt: monday.toISOString(), lastPlayedDay: "2026-09-21" };
    expect(decide({ frequency: "always" }, ledger).decision.play).toBe(true);
    expect(decide({ frequency: "always" }, ledger, monday, { playedThisTab: true }).decision.play).toBe(false);
  });

  it("rotates through every film when asked", () => {
    let ledger: CinematicLedger = {};
    const seen: string[] = [];
    for (let day = 21; day < 27; day += 1) {
      const result = decide({ intro: "rotate" }, ledger, new Date(2026, 8, day, 9));
      if (result.decision.play) seen.push(result.decision.film.id);
      ledger = result.nextLedger;
    }
    expect(seen).toEqual(["slow-sweep", "push-sweep", "edge-glint", "optical-luster", "brand-ident", "slow-sweep"]);
  });

  it("ships every film's media, including higher-fidelity alternates", () => {
    const publicFile = (path: string) => fileURLToPath(new URL(`../../public/${path}`, import.meta.url));
    for (const film of Object.values(CINEMATICS)) {
      for (const path of [film.src, film.poster, ...(film.sources ?? []).map((source) => source.src)]) {
        expect(existsSync(publicFile(path)), `${film.id}: ${path}`).toBe(true);
      }
    }
  });

  it("offers the final AXOM ident with 10-bit encodings ahead of its H.264 fallback", () => {
    const ident = CINEMATICS["brand-ident"];
    expect(ident).toMatchObject({ placeholder: false, background: "#0d0d0e", durationMs: 7000, src: "startup/axom-ident.mp4" });
    expect(ident.sources?.map((source) => source.type)).toEqual([
      'video/mp4; codecs="hvc1.2.4.L120.90"',
      'video/webm; codecs="vp09.02.40.10"',
    ]);
  });

  it("repairs unknown stored preferences", () => {
    expect(normalizeCinematicPreferences({ frequency: "hourly", intro: "nope", update: "edge-glint" })).toEqual({ ...DEFAULT_CINEMATIC_PREFERENCES, update: "edge-glint" });
  });
});
