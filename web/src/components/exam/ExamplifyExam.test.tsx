// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { ExamSimulator } from "../questions/ExamSimulator";

function q(id: string, correctKey = "B"): QuestionRecord {
  return {
    id, source: "manual", stem: `Stem for ${id}: which is right?`,
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }, { key: "D", text: "Delta" }],
    correctKey, correctAnswerText: "Beta", explanation: `Because ${id}.`, status: "unseen", tags: [], attempts: [],
    createdAt: "2026-07-10T00:00:00.000Z", updatedAt: "2026-07-10T00:00:00.000Z",
  };
}
const pool = [q("q1"), q("q2"), q("q3"), q("q4"), q("q5")];

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ ...makeSeed(), questions: pool });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const exam = (props: Partial<Parameters<typeof ExamSimulator>[0]> = {}) => {
  const onFinish = vi.fn();
  const onSuspend = vi.fn();
  const view = render(<ExamSimulator skin="examsoft" mode="exam" pool={pool} title="Renal quiz" onFinish={onFinish} onSuspend={onSuspend} {...props} />);
  return { ...view, onFinish, onSuspend };
};
const rail = () => screen.getByRole("navigation", { name: "Question list" });
const number = (name: string | RegExp) => within(rail()).getByRole("button", { name });
const choice = (name: string) => screen.getByRole("radio", { name });

describe("Examplify interface", () => {
  it("lays out the exam screen: controls, tool kit, the number rail, the question, Previous and Next", () => {
    exam({ timeLimitSeconds: 1800 });
    const dialog = screen.getByRole("dialog", { name: "ExamSoft (Examplify) exam simulation" });
    expect(within(dialog).getByRole("button", { name: /Exam Controls/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Tool Kit/ })).toBeTruthy();
    expect(within(dialog).getByText("Renal quiz")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Time remaining 00:30:00/ })).toBeTruthy();
    expect(within(rail()).getAllByRole("button", { name: /^Question \d/ })).toHaveLength(5);
    expect(number("Question 1, unanswered").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /Question 1 of 5/ }).textContent).toContain("Question 1");
    expect(screen.getByRole("button", { name: "Flag question" })).toBeTruthy();
    expect(screen.getByText("Currently Selected : None")).toBeTruthy();
    expect(screen.getByText("1 of 5 questions")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
    // The mark and the name in the bar are AXOM's own.
    expect(dialog.querySelector(".xfy-brand")!.textContent).toBe("AXOM Exam");
  });

  it("selects an answer, shows it as currently selected, and clears it on a second click", () => {
    exam();
    fireEvent.click(choice("B. Beta"));
    expect(choice("B. Beta").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Currently Selected : B")).toBeTruthy();
    expect(number("Question 1, answered").className).toContain("answered");
    // The tick beside a chosen answer means chosen. It is not a verdict.
    expect(choice("B. Beta").closest(".xfy-choice")!.querySelector(".xfy-choice-side.chosen .lucide-check")).toBeTruthy();
    fireEvent.click(choice("B. Beta"));
    expect(screen.getByText("Currently Selected : None")).toBeTruthy();
    expect(number("Question 1, unanswered").className).not.toContain("answered");
  });

  it("strikes choices out with the eye, and restores them from the question's menu", () => {
    exam();
    fireEvent.click(screen.getByRole("button", { name: "Strike out choice A" }));
    fireEvent.click(screen.getByRole("button", { name: "Strike out choice D" }));
    expect(choice("A. Alpha (struck out)").closest(".xfy-choice")!.className).toContain("struck");
    expect(screen.getByRole("button", { name: "Restore choice A" }).getAttribute("aria-pressed")).toBe("true");
    // Choosing a struck-out answer brings it back.
    fireEvent.click(choice("D. Delta (struck out)"));
    expect(choice("D. Delta").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "More for this question" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore struck-out choices" }));
    expect(choice("A. Alpha").closest(".xfy-choice")!.className).not.toContain("struck");
  });

  it("flags a question: the button turns, the rail shows a flag, and the bank remembers", () => {
    exam();
    fireEvent.click(screen.getByRole("button", { name: "Flag question" }));
    expect(screen.getByRole("button", { name: "Unflag question" }).getAttribute("aria-pressed")).toBe("true");
    expect(number("Question 1, unanswered, flagged").querySelector(".xfy-num-flag")).toBeTruthy();
    expect(useStore.getState().questions.find((item) => item.id === "q1")!.marked).toBe(true);
    fireEvent.keyDown(window, { key: "f" });
    expect(screen.getByRole("button", { name: "Flag question" })).toBeTruthy();
  });

  it("jumps to any question and filters the rail by flagged, unanswered and answered", () => {
    exam();
    fireEvent.click(choice("A. Alpha"));
    fireEvent.click(number("Question 4, unanswered"));
    expect(screen.getByRole("button", { name: /Question 4 of 5/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flag question" }));
    fireEvent.click(choice("C. Gamma"));

    fireEvent.click(screen.getByRole("button", { name: /Filter questions/ }));
    const menu = screen.getByRole("menu", { name: "Show questions" });
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["All", "Flagged (1)", "Unanswered (3)", "Answered (2)"]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Unanswered (3)" }));
    expect(within(rail()).getAllByRole("button", { name: /^Question \d/ }).map((button) => button.textContent)).toEqual(["2", "3", "5"]);
    fireEvent.click(screen.getByRole("button", { name: /Filter questions/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Flagged (1)" }));
    expect(within(rail()).getAllByRole("button", { name: /^Question \d/ }).map((button) => button.textContent)).toEqual(["4"]);
    // Moving to a question the filter hides shows every question again, so the place is never lost.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(rail()).getAllByRole("button", { name: /^Question \d/ })).toHaveLength(5);
    expect(number(/Question 5/).getAttribute("aria-current")).toBe("true");
  });

  it("moves with the exam's own keys, and AXOM's", () => {
    exam();
    fireEvent.keyDown(window, { key: ".", code: "Period", ctrlKey: true });
    expect(screen.getByRole("button", { name: /Question 2 of 5/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: ">", code: "Period", metaKey: true, shiftKey: true });
    expect(screen.getByRole("button", { name: /Question 3 of 5/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    expect(screen.getByRole("button", { name: /Question 2 of 5/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: /Question 1 of 5/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: "c" });
    expect(choice("C. Gamma").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(window, { key: "A", shiftKey: true });
    expect(choice("A. Alpha (struck out)")).toBeTruthy();
  });

  it("opens the tool kit: highlighter colours, timers and alarms, text size, calculator, notes", () => {
    vi.useFakeTimers();
    exam({ timeLimitSeconds: 1800 });
    fireEvent.click(screen.getByRole("button", { name: /Tool Kit/ }));
    const kit = screen.getByRole("complementary", { name: "Tool Kit" });
    expect(within(kit).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Tools", "Calculators", "Notes"]);
    expect(within(within(kit).getByRole("radiogroup", { name: "Highlighter colour" })).getAllByRole("radio").map((dot) => dot.getAttribute("aria-label"))).toEqual(["Red", "Yellow", "Green", "Blue", "Pink"]);
    fireEvent.click(within(kit).getByRole("radio", { name: "Green" }));
    expect(JSON.parse(localStorage.getItem("axom.examSim.prefs.v1")!).highlightColor).toBe("green");
    expect(within(kit).getByText(/00:30:00 Time Remaining/)).toBeTruthy();
    fireEvent.change(within(kit).getByRole("slider", { name: "Text size" }), { target: { value: "1.4" } });
    expect(screen.getByRole("dialog", { name: /Examplify/ }).style.getPropertyValue("--xfy-scale")).toBe("1.4");

    // An alarm ten seconds from now.
    fireEvent.click(within(kit).getByRole("button", { name: /Add Alarm/ }));
    const editor = screen.getByRole("dialog", { name: "Add an alarm" });
    fireEvent.change(within(editor).getByRole("spinbutton", { name: "Minutes" }), { target: { value: "0" } });
    fireEvent.change(within(editor).getByRole("spinbutton", { name: "Seconds" }), { target: { value: "10" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Create Alarm" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { vi.advanceTimersByTime(11_000); });
    expect(screen.getByRole("alert").textContent).toContain("00:00:10 alarm");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Dismiss alarm" }));
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(within(kit).getByRole("tab", { name: "Notes" }));
    fireEvent.change(within(kit).getByRole("textbox", { name: "Exam notes" }), { target: { value: "check the anion gap" } });
    fireEvent.click(within(kit).getByRole("tab", { name: "Calculators" }));
    fireEvent.click(within(kit).getByRole("button", { name: "Close Toolkit" }));
    expect(screen.queryByRole("complementary", { name: "Tool Kit" })).toBeNull();
  });

  it("keeps the lab values as the exam's attachment, and says how the block works in a notice", () => {
    exam();
    fireEvent.click(screen.getByRole("button", { name: /Exam Controls/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Exam Attachments/ }));
    const attachment = screen.getByRole("dialog", { name: "Exam Attachment" });
    fireEvent.change(within(attachment).getByRole("searchbox", { name: "Search lab values" }), { target: { value: "tsh" } });
    expect(within(attachment).getByText("0.4–4.0 μU/mL")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Exam Attachment" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Exam Controls/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Exam Notices/ }));
    expect(within(screen.getByRole("dialog", { name: "Exam Notice" })).getByText(/5 questions, no time limit/)).toBeTruthy();
  });

  it("submits only after the learner says they are ready", () => {
    const { onFinish } = exam();
    fireEvent.click(choice("B. Beta"));
    fireEvent.click(screen.getByRole("button", { name: /Exam Controls/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Submit Exam" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/4 unanswered/)).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: "Submit" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Return to Exam" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onFinish).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Exam Controls/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Submit Exam" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("checkbox", { name: "I am ready to submit my exam" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Submit" }));
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onFinish.mock.calls[0][0].map((answer: { answerKey?: string; correct?: boolean }) => [answer.answerKey, answer.correct])).toEqual([["B", true], [undefined, false], [undefined, false], [undefined, false], [undefined, false]]);
  });

  it("suspends from Exam Controls with the block as it stands", () => {
    const { onSuspend } = exam({ timeLimitSeconds: 600 });
    fireEvent.click(choice("A. Alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Flag question" }));
    fireEvent.click(screen.getByRole("button", { name: /Exam Controls/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Suspend Exam" }));
    expect(onSuspend.mock.calls[0][0]).toMatchObject({ skin: "examsoft", mode: "exam", index: 0, timeLimitSeconds: 600 });
    expect(onSuspend.mock.calls[0][0].items.q1).toMatchObject({ answerKey: "A", marked: true, visited: true });
  });

  it("in tutor mode, marks a wrong pick with a cross and the right answer with a tick, on the choices and in the rail", () => {
    vi.useFakeTimers();
    exam({ mode: "tutor" });
    act(() => { vi.advanceTimersByTime(47_000); });
    fireEvent.click(choice("C. Gamma"));
    // Chosen, not yet checked: no verdict anywhere.
    expect(number("Question 1, answered").querySelector(".xfy-num-result")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check answer" }));
    const wrong = choice("C. Gamma").closest(".xfy-choice")!;
    expect(wrong.className).toContain("wrong");
    expect(within(wrong as HTMLElement).getByRole("img", { name: "Your answer (incorrect)" }).querySelector(".lucide-x")).toBeTruthy();
    expect(wrong.querySelector(".lucide-check")).toBeNull();
    const right = choice("B. Beta").closest(".xfy-choice")!;
    expect(within(right as HTMLElement).getByRole("img", { name: "Correct answer" }).querySelector(".lucide-check")).toBeTruthy();
    expect(screen.getByText("Your Answer : C")).toBeTruthy();
    expect(screen.getByText("Correct Answer : B")).toBeTruthy();
    expect(number("Question 1, incorrect").querySelector(".xfy-num-result.bad .lucide-x")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Explanation" })).getByText("Time spent: 00:47")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(choice("B. Beta"));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(number("Question 2, correct").querySelector(".xfy-num-result.ok .lucide-check")).toBeTruthy();
    expect(number("Question 2, correct").querySelector(".lucide-x")).toBeNull();
    // The others still give nothing away.
    expect(number("Question 3, unanswered").className).toBe("xfy-num");
  });

  it("reviews a finished block: results in the rail, filters for right and wrong, nothing changeable", () => {
    const answers = [
      { questionId: "q1", answerKey: "B", correct: true, flagged: false, seconds: 30 },
      { questionId: "q2", answerKey: "A", correct: false, flagged: true, seconds: 12 },
      { questionId: "q3", answerKey: "D", correct: false, flagged: false, seconds: 8 },
      { questionId: "q4", flagged: false, seconds: 0 },
      { questionId: "q5", answerKey: "B", correct: true, flagged: false, seconds: 21 },
    ];
    const onClose = vi.fn();
    const { onFinish } = exam({ review: { answers, startedAt: "2026-10-01T10:00:00.000Z", elapsedSeconds: 95 }, onClose });
    expect(screen.getByText("Renal quiz · Review")).toBeTruthy();
    expect(within(rail()).getAllByRole("button", { name: /^Question \d/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Question 1, correct", "Question 2, incorrect, flagged", "Question 3, incorrect", "Question 4, unanswered", "Question 5, correct",
    ]);
    expect(screen.queryByRole("button", { name: /Time (remaining|elapsed)/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Filter questions/ }));
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["All", "Flagged (1)", "Unanswered (1)", "Answered (4)", "Incorrect (2)", "Correct (2)"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Incorrect (2)" }));
    expect(within(rail()).getAllByRole("button", { name: /^Question \d/ }).map((button) => button.textContent)).toEqual(["2", "3"]);

    fireEvent.click(number("Question 2, incorrect, flagged"));
    expect(screen.getByText("Your Answer : A")).toBeTruthy();
    expect((choice("C. Gamma") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Unflag question" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByText("Your Answer : A")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Explanation" })).getByText("Because q2.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Exam Controls/ }));
    expect(screen.queryByRole("menuitem", { name: "Submit Exam" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Close Review" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("shows the five-minute alarm over the clock, and ends the block when time is up", () => {
    vi.useFakeTimers();
    const { onFinish } = exam({ timeLimitSeconds: 900 });
    act(() => { vi.advanceTimersByTime(601_000); });
    const alarm = screen.getByRole("alert");
    expect(alarm.textContent).toContain("5 minutes remaining");
    expect(alarm.closest(".xfy-clock-wrap")).toBeTruthy();
    fireEvent.click(within(alarm).getByRole("button", { name: "Dismiss alarm" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { vi.advanceTimersByTime(300_000); });
    expect(onFinish).toHaveBeenCalledOnce();
  });
});
