// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DOCTORDLE_LOG, useDoctordle } from "../lib/doctordle";
import { DoctordlePage } from "./DoctordlePage";

const NOON = Date.parse("2026-09-29T16:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  localStorage.clear();
  useDoctordle.setState({ log: { ...EMPTY_DOCTORDLE_LOG } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("Doctordle external boundary", () => {
  it("links safely to the verified destination without embedding it", () => {
    const { container } = render(<DoctordlePage />);
    const link = screen.getByRole("link", { name: /open doctordle.org/i });
    expect(link.getAttribute("href")).toBe("https://doctordle.org/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/does not embed/i)).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("counts a missed case toward the AXOM streak but not the solved total", () => {
    useDoctordle.setState({ log: { ...EMPTY_DOCTORDLE_LOG, results: { 438: "solved", 439: "missed" } } });
    const { container } = render(<DoctordlePage />);
    expect(screen.getByText(/Every logged attempt counts toward your AXOM streak/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Missed it" }));
    expect(container.querySelector(".doctordle-stats")?.textContent).toBe("3 in a row3 logged1 got it");
    expect(useDoctordle.getState().log.results[440]).toBe("missed");
    fireEvent.click(screen.getByRole("button", { name: "Change to got it" }));
    expect(container.querySelector(".doctordle-stats")?.textContent).toBe("3 in a row3 logged2 got it");
    fireEvent.click(screen.getByRole("button", { name: "Change to missed it" }));
    expect(container.querySelector(".doctordle-stats")?.textContent).toBe("3 in a row3 logged1 got it");
  });
});
