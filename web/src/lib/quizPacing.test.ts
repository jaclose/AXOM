import { describe, expect, it } from "vitest";
import { formatSeconds, pacingInsight, summarizePacing } from "./quizPacing";

const answers = [
  { questionId: "q1", flagged: false, correct: true, seconds: 40 },
  { questionId: "q2", flagged: false, correct: true, seconds: 50 },
  { questionId: "q3", flagged: false, correct: false, seconds: 200 },
  { questionId: "q4", flagged: false, correct: false, seconds: 150 },
  { questionId: "q5", flagged: false, seconds: undefined },
];

describe("quiz pacing", () => {
  it("summarizes recorded seconds against the timed budget", () => {
    const summary = summarizePacing({ timed: true, timeLimitSeconds: 400, questionIds: ["q1", "q2", "q3", "q4", "q5"], answers })!;
    expect(summary).toMatchObject({ targetSeconds: 80, averageSeconds: 110, medianSeconds: 100, overTarget: 2, measured: 4 });
    expect(summary.slowest.map((question) => question.position)).toEqual([3, 4, 2]);
    expect(summary.speedAccuracy).toEqual({ faster: 100, slower: 0 });
    expect(pacingInsight(summary)).toMatch(/Over pace.*slower questions were less accurate/);
  });

  it("uses a stated default pace for untimed blocks and handles missing timing", () => {
    expect(summarizePacing({ timed: false, questionIds: ["q1"], answers: [answers[0]] })?.targetSeconds).toBe(90);
    expect(summarizePacing({ timed: false, questionIds: ["q5"], answers: [answers[4]] })).toBeNull();
    expect(formatSeconds(45)).toBe("45s");
    expect(formatSeconds(190)).toBe("3m 10s");
    expect(formatSeconds(120)).toBe("2m");
  });
});
