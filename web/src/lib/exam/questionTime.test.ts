import { describe, expect, it } from "vitest";
import {
  NO_QUESTION_TIME, closeVisit, formatQuestionTime, openVisit, questionTimesFrom, recordedSeconds, sealQuestion, secondsOn,
} from "./questionTime";

const T0 = 1_800_000_000_000;
const at = (seconds: number) => T0 + seconds * 1000;

describe("time spent on a question (the shared rules)", () => {
  it("counts the question on screen, from when it is shown until the learner leaves it", () => {
    let times = openVisit(NO_QUESTION_TIME, "q1", at(0));
    expect(secondsOn(times, "q1", at(30))).toBe(30);
    times = openVisit(times, "q2", at(47));
    expect(secondsOn(times, "q1", at(500))).toBe(47);
    expect(secondsOn(times, "q2", at(60))).toBe(13);
    expect(secondsOn(times, "q3", at(60))).toBe(0);
  });

  it("adds visits up when the learner comes back", () => {
    let times = openVisit(NO_QUESTION_TIME, "q1", at(0));
    times = openVisit(times, "q2", at(20));
    times = openVisit(times, "q1", at(50));
    times = closeVisit(times, at(65));
    expect(secondsOn(times, "q1", at(999))).toBe(35);
    expect(secondsOn(times, "q2", at(999))).toBe(30);
  });

  it("is right the moment an answer is revealed, and stops there", () => {
    let times = openVisit(NO_QUESTION_TIME, "q1", at(0));
    times = sealQuestion(times, "q1", at(47));
    // The time shown with the explanation is the time taken to answer, at once.
    expect(recordedSeconds(times, "q1", at(47))).toBe(47);
    // Reading the explanation for a minute, leaving and coming back add nothing.
    expect(recordedSeconds(times, "q1", at(107))).toBe(47);
    times = openVisit(times, "q2", at(107));
    times = openVisit(times, "q1", at(130));
    times = closeVisit(times, at(190));
    expect(recordedSeconds(times, "q1", at(190))).toBe(47);
    expect(sealQuestion(times, "q1", at(200))).toBe(times);
  });

  it("does not count time while nothing is on screen (suspended, or AXOM hidden)", () => {
    let times = openVisit(NO_QUESTION_TIME, "q1", at(0));
    times = closeVisit(times, at(10));
    expect(times.open).toBeUndefined();
    // Away for ten minutes, then back on the same question.
    times = openVisit(times, "q1", at(610));
    expect(secondsOn(times, "q1", at(615))).toBe(15);
    expect(closeVisit(closeVisit(times, at(620)), at(900))).toEqual(closeVisit(times, at(620)));
  });

  it("keeps fractions while adding and rounds only what is written down", () => {
    let times = NO_QUESTION_TIME;
    for (let visit = 0; visit < 4; visit += 1) {
      times = openVisit(times, "q1", at(visit * 10));
      times = closeVisit(times, at(visit * 10 + 0.4));
    }
    // Four visits of 0.4 s are 1.6 s, not four zeros.
    expect(secondsOn(times, "q1", at(100))).toBeCloseTo(1.6, 5);
    expect(recordedSeconds(times, "q1", at(100))).toBe(2);
  });

  it("never counts backwards when the device clock jumps", () => {
    let times = openVisit(NO_QUESTION_TIME, "q1", at(100));
    expect(secondsOn(times, "q1", at(40))).toBe(0);
    times = closeVisit(times, at(40));
    expect(secondsOn(times, "q1", at(40))).toBe(0);
  });

  it("starts from times recorded earlier, ignoring anything that is not a positive number", () => {
    const times = questionTimesFrom({ q1: 12.5, q2: 0, q3: undefined, q4: Number.NaN, q5: -3 }, ["q1", "q1"]);
    expect(times).toEqual({ seconds: { q1: 12.5 }, sealed: ["q1"] });
    expect(secondsOn(openVisit(times, "q1", at(0)), "q1", at(60))).toBe(12.5);
  });

  it("shows a time the same way everywhere", () => {
    expect(formatQuestionTime(0)).toBe("00:00");
    expect(formatQuestionTime(46.6)).toBe("00:47");
    expect(formatQuestionTime(725)).toBe("12:05");
    expect(formatQuestionTime(3729)).toBe("1:02:09");
    expect(formatQuestionTime(-5)).toBe("00:00");
  });
});
