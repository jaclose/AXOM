// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextAnnotation } from "../../lib/questionAnnotations";
import { AnnotatedQuestionText } from "./AnnotatedQuestionText";
import { QuestionAnnotationToolbar } from "./QuestionAnnotationToolbar";
import { QuestionNotesPanel } from "./QuestionNotesPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("question annotation UI", () => {
  it("exposes highlighted text through semantics, not color alone", () => {
    const text = "Highlight this durable phrase.";
    const startOffset = text.indexOf("durable");
    const annotation = createTextAnnotation({
      id: "ann-1", target: "stem", sourceText: text, startOffset,
      endOffset: startOffset + "durable".length, tone: "yellow",
      now: "2026-07-16T12:00:00.000Z",
    });
    render(<AnnotatedQuestionText text={text} annotations={[annotation]} label="Question stem" />);
    const mark = screen.getByLabelText("Highlighted text: durable");
    expect(mark.tagName).toBe("MARK");
    expect(mark.getAttribute("tabindex")).toBe("0");
    expect(mark.className).toContain("tone-yellow");
  });

  it("offers named, pressed toolbar controls and disables highlight without a selection", () => {
    render(
      <QuestionAnnotationToolbar
        activeMode={{ kind: "highlight", tone: "cyan" }}
        hasSelection={false}
        onHighlightMode={() => {}}
        onEraserMode={() => {}}
        onHighlight={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByRole("toolbar", { name: "Question annotation tools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cyan persistent highlight" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Highlight selection" })).toHaveProperty("disabled", true);
  });

  it("announces an overlap rejection through the toolbar live status", () => {
    render(
      <QuestionAnnotationToolbar
        activeMode={{ kind: "highlight", tone: "yellow" }}
        hasSelection
        onHighlightMode={() => {}}
        onEraserMode={() => {}}
        onHighlight={() => {}}
        onClear={() => {}}
        statusMessage="Highlight overlaps an existing highlight."
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Highlight overlaps an existing highlight.");
  });

  it("autosaves a question note and announces completion", async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    render(<QuestionNotesPanel questionId="q1" value="" onSave={save} />);
    fireEvent.change(screen.getByLabelText("Question note"), { target: { value: "Remember this mechanism" } });
    expect(screen.getByRole("status").textContent).toContain("Saving");
    await act(async () => vi.advanceTimersByTime(500));
    expect(save).toHaveBeenCalledWith("Remember this mechanism");
    expect(screen.getByRole("status").textContent).toContain("saved");
  });

  it("flushes an unsaved question note when the surface closes", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const view = render(<QuestionNotesPanel questionId="q1" value="" onSave={save} />);
    fireEvent.change(screen.getByLabelText("Question note"), { target: { value: "Save before advancing" } });
    view.unmount();
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("Save before advancing");
  });

  it("surfaces ambiguous highlights as repair-needed and keeps the excerpt", () => {
    const original = "prefix chosen text suffix";
    const startOffset = original.indexOf("chosen text");
    const annotation = createTextAnnotation({
      id: "ambiguous", target: "stem", sourceText: original, startOffset,
      endOffset: startOffset + "chosen text".length, tone: "yellow",
      now: "2026-07-16T12:00:00.000Z",
    });
    render(
      <AnnotatedQuestionText
        text={`${original} / ${original}`}
        annotations={[annotation]}
        label="Question stem"
        onSelection={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("1 highlight need repair: chosen text");
    expect(screen.getByLabelText("Question stem").getAttribute("tabindex")).toBe("0");
  });

  it("deletes only the focused highlight with the Delete key and restores surface focus", async () => {
    const text = "first second";
    const first = createTextAnnotation({
      id: "first", target: "stem", sourceText: text, startOffset: 0,
      endOffset: 5, tone: "yellow", now: "2026-07-16T12:00:00.000Z",
    });
    const second = createTextAnnotation({
      id: "second", target: "stem", sourceText: text, startOffset: 6,
      endOffset: 12, tone: "cyan", now: "2026-07-16T12:00:00.000Z",
    });
    const remove = vi.fn();
    const view = render(
      <AnnotatedQuestionText
        text={text}
        annotations={[first, second]}
        label="Question stem"
        onDelete={remove}
      />,
    );
    const firstMark = screen.getByLabelText("Highlighted text: first");
    firstMark.focus();
    fireEvent.keyDown(firstMark, { key: "Delete" });
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("first");
    expect(screen.getByLabelText("Highlighted text: second")).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(view.getByLabelText("Question stem"));
  });
});
