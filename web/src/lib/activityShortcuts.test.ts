import { describe, expect, it } from "vitest";
import { activitySignature, frequentActivityShortcuts, recentActivityShortcuts } from "./activityShortcuts";
import type { StudyLog } from "./types";

function log(id: string, type: string, ts: string, partial: Partial<StudyLog> = {}): StudyLog {
  return { id, type, ts, dayKey: "2026-07-12", minutes: 0, cards: 0, ...partial };
}

describe("activity shortcuts", () => {
  it("deduplicates recent configurations deterministically and limits to three", () => {
    const logs = [
      log("1", "Reading", "2026-07-12T10:00:00.000Z", { minutes: 30 }),
      log("2", "Reading", "2026-07-12T11:00:00.000Z", { minutes: 30, note: "private" }),
      log("3", "Questions", "2026-07-12T12:00:00.000Z", { quantity: 20, quantityKind: "questions" }),
      log("4", "Gym", "2026-07-12T13:00:00.000Z"),
      log("5", "Coding", "2026-07-12T14:00:00.000Z", { minutes: 60 }),
    ];
    expect(recentActivityShortcuts(logs).map((item) => item.label)).toEqual(["Coding", "Gym", "Questions"]);
    expect(activitySignature(logs[0])).toBe(activitySignature(logs[1]));
  });

  it("promotes only configurations used at least three times", () => {
    const logs = [
      log("1", "Reading", "2026-07-10T10:00:00.000Z", { minutes: 30 }),
      log("2", "Reading", "2026-07-11T10:00:00.000Z", { minutes: 30 }),
      log("3", "Reading", "2026-07-12T10:00:00.000Z", { minutes: 30 }),
      log("4", "Gym", "2026-07-12T11:00:00.000Z"),
      log("5", "Gym", "2026-07-12T12:00:00.000Z"),
    ];
    expect(frequentActivityShortcuts(logs)).toHaveLength(1);
    expect(frequentActivityShortcuts(logs)[0]).toMatchObject({ label: "Reading", uses: 3 });
  });

  it("hides a shortcut without altering activity history", () => {
    const logs = Array.from({ length: 3 }, (_, index) => log(String(index), "Reading", `2026-07-12T1${index}:00:00.000Z`, { minutes: 30 }));
    const signature = activitySignature(logs[0]);
    expect(recentActivityShortcuts(logs, [signature])).toEqual([]);
    expect(frequentActivityShortcuts(logs, [signature])).toEqual([]);
    expect(logs).toHaveLength(3);
  });

  it("excludes recent configurations before applying the frequent limit", () => {
    const logs = [
      ...Array.from({ length: 5 }, (_, index) => log(`r${index}`, "Recent", `2026-07-12T1${index}:00:00.000Z`, { minutes: 10 })),
      ...Array.from({ length: 4 }, (_, index) => log(`a${index}`, "Alternate", `2026-07-11T1${index}:00:00.000Z`, { minutes: 20 })),
      ...Array.from({ length: 3 }, (_, index) => log(`b${index}`, "Backup", `2026-07-10T1${index}:00:00.000Z`, { minutes: 30 })),
    ];
    const recentSignature = activitySignature(logs[0]);
    expect(frequentActivityShortcuts(logs, [], 2, 3, [recentSignature]).map((item) => item.label)).toEqual(["Alternate", "Backup"]);
  });

  it("keeps legacy card quantities distinct and refills them", () => {
    const fifty = log("50", "Anki", "2026-07-12T10:00:00.000Z", { cards: 50 });
    const hundred = log("100", "Anki", "2026-07-12T11:00:00.000Z", { cards: 100 });
    expect(activitySignature(fifty)).not.toBe(activitySignature(hundred));
    expect(recentActivityShortcuts([fifty, hundred])).toMatchObject([
      { quantity: 100, quantityKind: "cards" },
      { quantity: 50, quantityKind: "cards" },
    ]);
  });

  it("returns no shortcuts for a zero limit", () => {
    const logs = Array.from({ length: 3 }, (_, index) => log(String(index), "Reading", `2026-07-12T1${index}:00:00.000Z`));
    expect(recentActivityShortcuts(logs, [], 0)).toEqual([]);
    expect(frequentActivityShortcuts(logs, [], 0)).toEqual([]);
  });

  it("keeps activity shortcut signatures distinct when fields contain separators", () => {
    const withTypeSeparator = log("type-a", "Reading|Review", "2026-07-12T11:00:00.000Z", { trackerId: "tracker" });
    const withTrackerSeparator = log("tracker-b", "Reading", "2026-07-12T12:00:00.000Z", { trackerId: "review|tracker" });

    expect(activitySignature(withTypeSeparator)).not.toBe(activitySignature(withTrackerSeparator));
    expect(recentActivityShortcuts([withTypeSeparator, withTrackerSeparator]).map((item) => item.label))
      .toEqual(["Reading", "Reading|Review"]);
    expect(recentActivityShortcuts([withTypeSeparator, withTrackerSeparator], [activitySignature(withTypeSeparator)])
      .map((item) => item.label)).toEqual(["Reading"]);

    const repeated = [
      withTypeSeparator,
      withTrackerSeparator,
      log("type-c", "Reading|Review", "2026-07-12T13:00:00.000Z", { trackerId: "tracker" }),
      log("tracker-d", "Reading", "2026-07-12T14:00:00.000Z", { trackerId: "review|tracker" }),
    ];
    expect(frequentActivityShortcuts(repeated, [], 2, 2)).toMatchObject([
      { label: "Reading", uses: 2 },
      { label: "Reading|Review", uses: 2 },
    ]);
    expect(activitySignature(log("plain", "Reading", "2026-07-12T15:00:00.000Z", {
      trackerId: "tracker-1",
      minutes: 30,
    }))).toBe("reading|tracker-1|30|0||");
  });

  it("does not conflate backslashes with escaped shortcut delimiters", () => {
    const literalSlash = log("slash", "Reading\\|Review", "2026-07-12T11:00:00.000Z", { trackerId: "tracker" });
    const withoutSlash = log("pipe", "Reading|Review", "2026-07-12T12:00:00.000Z", { trackerId: "tracker" });
    expect(activitySignature(literalSlash)).not.toBe(activitySignature(withoutSlash));
  });

  it("continues honoring persisted legacy hidden signatures containing separators", () => {
    const withTypeSeparator = log("type-a", "Reading|Review", "2026-07-12T11:00:00.000Z", { trackerId: "tracker" });
    const withTrackerSeparator = log("tracker-b", "Reading", "2026-07-12T12:00:00.000Z", { trackerId: "review|tracker" });
    const historicallyHidden = "reading|review|tracker|0|0||";

    expect(activitySignature(withTypeSeparator)).not.toBe(historicallyHidden);
    // Under the old raw delimiter encoding, hiding either configuration hid both.
    expect(recentActivityShortcuts([withTypeSeparator, withTrackerSeparator], [historicallyHidden])).toEqual([]);
    const repeated = [
      withTypeSeparator,
      withTrackerSeparator,
      log("type-c", "Reading|Review", "2026-07-12T13:00:00.000Z", { trackerId: "tracker" }),
      log("tracker-d", "Reading", "2026-07-12T14:00:00.000Z", { trackerId: "review|tracker" }),
    ];
    expect(frequentActivityShortcuts(repeated, [historicallyHidden], 2, 2)).toEqual([]);
  });

  it("does not apply a new escaped hidden signature as another activity's legacy alias", () => {
    const hidden = log("hidden", "Reading|Review", "2026-07-12T11:00:00.000Z", { trackerId: "tracker" });
    const unrelated = log("unrelated", "Reading\\", "2026-07-12T12:00:00.000Z", { trackerId: "Review|tracker" });
    const newHiddenKey = activitySignature(hidden);

    expect(newHiddenKey).not.toBe(activitySignature(unrelated));
    expect(recentActivityShortcuts([hidden, unrelated], [newHiddenKey]).map((item) => item.label)).toEqual(["Reading\\"]);
    const repeated = [
      hidden,
      unrelated,
      log("hidden-again", "Reading|Review", "2026-07-12T13:00:00.000Z", { trackerId: "tracker" }),
      log("unrelated-again", "Reading\\", "2026-07-12T14:00:00.000Z", { trackerId: "Review|tracker" }),
    ];
    expect(frequentActivityShortcuts(repeated, [newHiddenKey], 2, 2).map((item) => item.label))
      .toEqual(["Reading\\"]);
  });


  it("orders recent suggestions by the actual instant across UTC offsets", () => {
    const laterLocal = log("local-later", "Local review", "2026-07-12T12:00:00-04:00", { minutes: 45 });
    const earlierUtc = log("utc-earlier", "UTC review", "2026-07-12T15:00:00Z", { minutes: 40 });

    expect(recentActivityShortcuts([laterLocal, earlierUtc]).map((item) => item.label))
      .toEqual(["Local review", "UTC review"]);
  });

  it("selects the truly latest use and ranks equally frequent suggestions across UTC offsets", () => {
    const logs = [
      log("a-older", "Local review", "2026-07-12T15:00:00Z", { minutes: 30 }),
      log("a-later", "Local review", "2026-07-12T12:00:00-04:00", { minutes: 30 }),
      log("b-older", "UTC review", "2026-07-12T14:00:00Z", { minutes: 45 }),
      log("b-later", "UTC review", "2026-07-12T15:30:00Z", { minutes: 45 }),
    ];

    expect(frequentActivityShortcuts(logs, [], 2, 2).map((item) => [item.label, item.lastUsedAt]))
      .toEqual([
        ["Local review", "2026-07-12T12:00:00-04:00"],
        ["UTC review", "2026-07-12T15:30:00Z"],
      ]);
  });

  it("resolves equal instants by the same stable log ID tie-breaker", () => {
    const logs = [
      log("z", "Reading", "2026-07-12T12:00:00-04:00", { minutes: 30 }),
      log("a", "Reading", "2026-07-12T16:00:00Z", { minutes: 30 }),
    ];

    expect(frequentActivityShortcuts(logs, [], 1, 2)[0].lastUsedAt)
      .toBe("2026-07-12T12:00:00-04:00");
  });

  it("keeps mixed valid and malformed timestamps consistently ordered in every input permutation", () => {
    const later = log("later", "Valid later", "2026-07-12T12:00:00-04:00");
    const earlier = log("earlier", "Valid earlier", "2026-07-12T15:00:00Z");
    const malformed = log("malformed", "Malformed timestamp", "2026-07-12T13:00:00INVALID");
    const permutations = [
      [later, earlier, malformed], [later, malformed, earlier],
      [earlier, later, malformed], [earlier, malformed, later],
      [malformed, later, earlier], [malformed, earlier, later],
    ];
    for (const records of permutations) {
      expect(recentActivityShortcuts(records).map((item) => item.label))
        .toEqual(["Valid later", "Valid earlier", "Malformed timestamp"]);
    }
  });

  it("does not treat malformed timestamps as the latest valid use or outrank valid groups", () => {
    const mixed = [
      log("invalid", "Mixed", "2030-07-12T13:00:00INVALID", { minutes: 30 }),
      log("valid-older", "Mixed", "2026-07-12T15:00:00Z", { minutes: 30 }),
      log("valid-newer", "Mixed", "2026-07-12T12:00:00-04:00", { minutes: 30 }),
    ];
    const malformedOnly = [
      log("bad-1", "Bad only", "2030-07-12T13:00:00INVALID", { minutes: 40 }),
      log("bad-2", "Bad only", "2030-07-12T14:00:00INVALID", { minutes: 40 }),
      log("bad-3", "Bad only", "2030-07-12T15:00:00INVALID", { minutes: 40 }),
    ];
    expect(frequentActivityShortcuts([...malformedOnly, ...mixed], [], 2, 3))
      .toMatchObject([
        { label: "Mixed", uses: 3, lastUsedAt: "2026-07-12T12:00:00-04:00" },
        { label: "Bad only", uses: 3, lastUsedAt: "2030-07-12T15:00:00INVALID" },
      ]);
  });

});
