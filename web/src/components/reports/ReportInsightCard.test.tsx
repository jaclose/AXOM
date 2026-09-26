// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReportMetric } from "../../lib/reports";
import { ReportInsightCard } from "./ReportInsightCard";

const metric: ReportMetric = {
  id: "consistency",
  label: "Consistency",
  value: "75%",
  note: "3/4 days",
  numerator: 3,
  denominator: 4,
  period: "4 eligible days",
  sourceLabel: "Activity log",
  sourceRecordIds: ["a"],
  calculation: "3 ÷ 4",
  interpretation: "Activity appeared on most eligible days.",
  action: "Keep one small repeatable action",
  state: "ready",
};

afterEach(cleanup);

describe("ReportInsightCard", () => {
  it("keeps the number and its meaning visible without hover", () => {
    render(<ReportInsightCard icon={<span />} metric={metric} insight={{ change: "Up 10%", strongestContributor: "Questions" }} />);
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("Activity appeared on most eligible days.")).toBeTruthy();
    const article = screen.getByText("75%").closest("article")!;
    fireEvent.mouseEnter(article);
    expect(screen.getByRole("button", { name: /how this is calculated/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Up 10%")).toBeNull();
  });

  it("opens the calculation on click, closes on Escape, and shows plain-language details", () => {
    render(<ReportInsightCard icon={<span />} metric={metric} insight={{ change: "Up 10%", strongestContributor: "Questions" }} />);
    const trigger = screen.getByRole("button", { name: /show how this is calculated/ });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Up 10%")).toBeTruthy();
    expect(screen.getByText("3 ÷ 4")).toBeTruthy();
    expect(screen.getByText("Activity log · 1 record")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
