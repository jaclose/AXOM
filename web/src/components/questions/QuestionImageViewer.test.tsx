// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "../ui/Modal";
import { QuestionImageViewer } from "./QuestionImageViewer";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("question-image-viewer__viewport") ? 320 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("question-image-viewer__viewport") ? 600 : 0;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function open() {
  return render(<QuestionImageViewer src="blob:source-ecg" alt="Source ECG" width={1662} height={201} onClose={vi.fn()} />);
}

it("magnifies a wide ECG beyond the phone viewport with bounded controls and resets both scroll axes", () => {
  const rendered = open();
  const dialog = screen.getByRole("dialog", { name: "Source ECG" });
  expect(rendered.container.contains(dialog)).toBe(false);
  const image = within(dialog).getByRole("img", { name: "Source ECG" });
  const viewport = within(dialog).getByRole("region", { name: "Image detail" });
  expect(image.style.width).toBe("320px");
  expect(screen.getByRole("button", { name: "Zoom out" })).toHaveProperty("disabled", true);
  const enlarge = screen.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 10; i++) fireEvent.click(enlarge);
  expect(image.style.width).toBe("2560px");
  expect(screen.getByLabelText("Image zoom").textContent).toBe("800%");
  expect(enlarge).toHaveProperty("disabled", true);
  viewport.scrollLeft = 900; viewport.scrollTop = 120;
  fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  expect(image.style.width).toBe("320px");
  expect(viewport.scrollLeft).toBe(0); expect(viewport.scrollTop).toBe(0);
});

it("supports keyboard zoom and panning without overriding browser zoom shortcuts", () => {
  open();
  const viewport = screen.getByRole("region", { name: "Image detail" });
  viewport.focus();
  fireEvent.keyDown(viewport, { key: "+" });
  expect(screen.getByLabelText("Image zoom").textContent).toBe("150%");
  const before = viewport.scrollLeft;
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  expect(viewport.scrollLeft).toBe(before + 80);
  fireEvent.keyDown(viewport, { key: "+", ctrlKey: true });
  expect(screen.getByLabelText("Image zoom").textContent).toBe("150%");
  fireEvent.keyDown(viewport, { key: "0" });
  expect(screen.getByLabelText("Image zoom").textContent).toBe("100%");
  expect(viewport.scrollLeft).toBe(0);
});

it("keeps answer, flag, submit, and confidence shortcuts from reaching the quiz behind the viewer", () => {
  const quizShortcut = vi.fn();
  window.addEventListener("keydown", quizShortcut);
  try {
    fireEvent.keyDown(window, { key: "A" });
    expect(quizShortcut).toHaveBeenCalledOnce();
    quizShortcut.mockClear();
    open();
    const viewport = screen.getByRole("region", { name: "Image detail" });
    viewport.focus();
    for (const key of ["A", "J", "M", "Enter", "1", "5"]) fireEvent.keyDown(viewport, { key });
    fireEvent.keyDown(viewport, { key: "A", shiftKey: true });
    expect(quizShortcut).not.toHaveBeenCalled();
    const browserZoom = new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true, cancelable: true });
    fireEvent(viewport, browserZoom);
    expect(browserZoom.defaultPrevented).toBe(false);
    expect(quizShortcut).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Image zoom").textContent).toBe("100%");
  } finally {
    window.removeEventListener("keydown", quizShortcut);
  }
});

function pointer(element: HTMLElement, type: string, pointerType: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 100 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  fireEvent(element, event);
  return event;
}

it("pans by mouse drag and leaves touch gestures to the browser", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  const viewport = screen.getByRole("region", { name: "Image detail" });
  const before = viewport.scrollLeft;
  pointer(viewport, "pointerdown", "mouse", 200);
  pointer(viewport, "pointermove", "mouse", 140);
  expect(viewport.scrollLeft).toBe(before + 60);
  pointer(viewport, "pointerup", "mouse", 140);
  const after = viewport.scrollLeft;
  expect(pointer(viewport, "pointerdown", "touch", 200).defaultPrevented).toBe(false);
  pointer(viewport, "pointermove", "touch", 100);
  expect(viewport.scrollLeft).toBe(after);
});

it("traps all viewer controls and closes only the top image dialog on Escape", () => {
  function Nested() {
    const [parent, setParent] = useState(true);
    const [image, setImage] = useState(false);
    return parent && <Modal title="Question details" onClose={() => setParent(false)}>
      <button onClick={() => setImage(true)}>Enlarge source</button>
      {image && <QuestionImageViewer src="blob:source-ecg" alt="Source ECG" width={1662} height={201} onClose={() => setImage(false)} />}
    </Modal>;
  }
  render(<Nested />);
  const opener = screen.getByRole("button", { name: "Enlarge source" });
  opener.focus(); fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Source ECG" });
  const viewport = within(dialog).getByRole("region", { name: "Image detail" });
  const close = within(dialog).getByRole("button", { name: "Close" });
  expect(document.activeElement).toBe(close);
  viewport.focus(); fireEvent.keyDown(viewport, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(viewport);
  fireEvent.keyDown(viewport, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Source ECG" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Question details" })).toBeTruthy();
  expect(document.activeElement).toBe(opener);
});
