// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  BODY_REGIONS,
  EVIDENCE_SOURCES,
  REGION_OBSERVATIONS,
  SIMULATION_STAGES,
  sourcesFor,
} from "../lib/simulator/asthmaScenario";
import { BodySimulatorPage } from "./BodySimulatorPage";

afterEach(cleanup);

describe("BodySimulatorPage", () => {
  it("lets a learner move from pathology to drug action and inspect possible effects", () => {
    render(<BodySimulatorPage />);

    expect(screen.getByRole("heading", { name: "Less room for air" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Asthma" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Inhaled albuterol/ }));
    expect(screen.getByRole("heading", { name: "Muscle relaxes; the passage opens" })).toBeTruthy();
    expect(screen.getByText(/does not cure asthma/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Inspect heart" }));
    expect(screen.getByRole("heading", { name: "Heart rhythm matters" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Viewing Inhaled albuterol, Heart: Heart rhythm matters");
    expect(screen.getByText(/Possible does not mean expected/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /MedlinePlus: Albuterol oral inhalation/ }).getAttribute("href"))
      .toBe("https://medlineplus.gov/druginfo/meds/a682145.html");

    fireEvent.click(screen.getByRole("button", { name: "Reset simulator to asthma airways" }));
    expect(screen.getByRole("heading", { name: "Less room for air" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inspect airways" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps every medical observation tied to a known primary source", () => {
    const sourceIds = new Set(EVIDENCE_SOURCES.map((source) => source.id));
    for (const stage of SIMULATION_STAGES) {
      for (const region of BODY_REGIONS) {
        const observation = REGION_OBSERVATIONS[stage.id][region.id];
        for (const id of observation.sourceIds) expect(sourceIds.has(id)).toBe(true);
        for (const source of sourcesFor(observation)) expect(source.url.startsWith("https://")).toBe(true);
      }
    }
  });
});
