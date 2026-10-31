// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { OfficialSguClinicalCatalogReview } from "./CourseTrackerPage.officialCatalog";

beforeEach(() => { useStore.setState(makeSeed()); });
afterEach(cleanup);

describe("published clinical course overview", () => {
  it("shows current PCM course codes with source links and preserves the old local labels until reviewed", () => {
    const previous = structuredClone({
      terms: useStore.getState().terms,
      courses: useStore.getState().courses,
      tracker: useStore.getState().tracker,
    });
    const { container } = render(<OfficialSguClinicalCatalogReview />);
    fireEvent.click(screen.getByText("Published curriculum overview"));
    expect(container.textContent).toContain("PCM 500");
    expect(container.textContent).toContain("PCM 501");
    expect(container.textContent).toContain("PPM 500/501");
    expect(container.textContent).toContain("NMI");
    expect(container.textContent).toContain("MI");
    expect(container.textContent).toContain("Term 4 · PCM 500 · 20 published instructional weeks");
    expect(container.textContent).toContain("Term 5 · PCM 501 · 16 published instructional weeks");
    const links = screen.getAllByRole("link", { name: "View published source" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://catalog.sgu.edu/principles-of-clinical-medicine/pcm-500",
      "https://catalog.sgu.edu/principles-of-clinical-medicine/pcm-501",
    ]);
    expect(container.textContent).toContain("not published exact class dates");
    expect({
      terms: useStore.getState().terms,
      courses: useStore.getState().courses,
      tracker: useStore.getState().tracker,
    }).toEqual(previous);
  });
});
