import { describe, expect, it } from "vitest";
import { compactCountdown, msUntilDoctordle, msUntilLocalMidnight } from "./DailyGameNavMeta";

describe("daily game countdowns", () => {
  it("counts Daily Word to local midnight", () => {
    const now = new Date(2026, 8, 30, 20, 30);
    expect(msUntilLocalMidnight(now)).toBe(3.5 * 3_600_000);
  });

  it("counts Doctordle to 05:00 UTC, its real rollover", () => {
    expect(msUntilDoctordle(new Date(Date.UTC(2026, 8, 30, 4, 0)))).toBe(3_600_000);
    expect(msUntilDoctordle(new Date(Date.UTC(2026, 8, 30, 5, 0)))).toBe(24 * 3_600_000);
  });

  it("reads compactly", () => {
    expect(compactCountdown(3.5 * 3_600_000)).toBe("3h");
    expect(compactCountdown(38 * 60_000)).toBe("38m");
    expect(compactCountdown(5_000)).toBe("1m");
  });
});
