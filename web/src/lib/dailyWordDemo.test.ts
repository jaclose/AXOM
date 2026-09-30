import { describe, expect, it } from "vitest";
import { buildDemoTimeline, demoFrameAt, DEMO_ANSWER, DEMO_GUESS } from "./dailyWordDemo";

describe("daily word how-to timeline", () => {
  const { frames, duration, evaluations } = buildDemoTimeline(8659);

  it("teaches green, yellow and grey on the sample word, then reveals the answer and clears", () => {
    expect(evaluations[0]).toEqual(["correct", "present", "absent", "present", "correct"]);
    const captions = frames.map((frame) => frame.caption);
    expect(captions[0]).toContain("8,659");
    expect(captions).toContain("Green: the right letter in the right spot.");
    expect(captions).toContain("Yellow: in the word, but in another spot.");
    expect(captions).toContain("Grey: not in the word at all.");
    expect(frames.at(-1)).toMatchObject({ rows: ["", ""], caption: "Your turn." });
    expect(frames.find((frame) => frame.scored[1])?.rows).toEqual([DEMO_GUESS, DEMO_ANSWER]);
  });

  it("points each colour caption at a tile of that colour", () => {
    for (const frame of frames.filter((item) => item.focusCol !== null)) {
      const kind = frame.caption.startsWith("Green") ? "correct" : frame.caption.startsWith("Yellow") ? "present" : "absent";
      expect(evaluations[0][frame.focusCol!]).toBe(kind);
    }
  });

  it("is quick and ordered", () => {
    expect(duration).toBeLessThan(10_000);
    expect(frames.every((frame, index) => index === 0 || frame.at > frames[index - 1].at)).toBe(true);
    expect(demoFrameAt(frames, 0).caption).toBe(frames[0].caption);
    expect(demoFrameAt(frames, duration).caption).toBe("Your turn.");
  });

  it("uses no em-dashes in its copy", () => {
    for (const frame of frames) expect(frame.caption).not.toMatch(/[—–]/);
  });
});
