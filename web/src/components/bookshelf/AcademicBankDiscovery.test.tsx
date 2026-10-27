// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AcademicBankDiscovery } from "./AcademicBankDiscovery";

const course = (id: string, term: string, module: string) => ({ id, term, module, title: module, visibility: "shared",
  review_status: "approved", current_revision_id: id, owned: false, ready_questions: 4, review_questions: 0 });
vi.mock("../../lib/account/accountStore", () => ({
  useAccount: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: "learner-1" } }),
}));
vi.mock("../../lib/academicLibrary/useAcademicCatalog", () => ({
  useAcademicCatalog: () => ({ loading: false, error: "", more: false, loadMore: vi.fn(), retry: vi.fn(), courses: [
    course("goer", "Term 5", "GOER"), course("cpr1", "Term 1", "CPR 1"), course("ftm1", "Term 1", "FTM 1"), course("ncrs", "Term 4", "NCRS"),
  ] }),
}));

describe("QBank study by course", () => {
  afterEach(cleanup);
  it("groups courses by term in curriculum order", () => {
    render(<AcademicBankDiscovery />);
    const region = screen.getByRole("region", { name: "Available question banks" });
    const terms = within(region).getAllByRole("region");
    expect(terms.map(term => term.getAttribute("aria-labelledby") && within(term).getByRole("heading", { level: 3 }).textContent))
      .toEqual(["Term 1", "Term 4", "Term 5"]);
    expect(within(terms[0]).getAllByRole("button").map(button => button.getAttribute("data-course-id"))).toEqual(["ftm1", "cpr1"]);
    expect(within(terms[0]).getByText("2 courses")).toBeTruthy();
  });
});
