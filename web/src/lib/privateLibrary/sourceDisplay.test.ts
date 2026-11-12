import { describe, expect, it } from "vitest";
import { preparedSourcePresentation } from "./sourceDisplay";
const source = { name: "RHPS 06 PQ - Respiratory Pharmacology.pdf", module: "RHPS" };
function review(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ pkg: { manifest: {
    bank: { title: "Respiratory Pharmacology Practice Questions", discipline: "Pharmacology" },
    course: { name: "RHPS", term: 5, week: 2 },
    source: { filename: source.name, sourceWeekDeclared: false },
    ...overrides,
  } } });
}
describe("prepared source presentation", () => {
  it("prefers the bank's domain title without changing original identity or provisional week", () => {
    expect(preparedSourcePresentation(source, review())).toEqual({
      title: "Respiratory Pharmacology Practice Questions",
      scope: "RHPS · Term 5 · Week 2 (provisional) · Pharmacology",
      originalName: source.name,
    });
  });
  it("distinguishes source-declared from proposed weeks", () => {
    const explicit = review({ source: { filename: source.name, sourceWeekDeclared: true } });
    expect(preparedSourcePresentation(source, explicit).scope).toBe("RHPS · Term 5 · Week 2 · Pharmacology");
  });
  it("rejects malformed control characters in the proposed display title", () => {
    const bad = review({ bank: { title: "Respiratory\nPharmacology", discipline: "Pharmacology" } });
    expect(preparedSourcePresentation(source, bad).title).toBe(source.name);
  });
  it("does not trust titles for a different original document or module", () => {
    expect(preparedSourcePresentation(source, review({ source: { filename: "Other.pdf" } })).title).toBe(source.name);
    expect(preparedSourcePresentation(source, review({ course: { name: "DERS", term: 4, week: 1 } })).title).toBe(source.name);
  });
  it("falls back safely for malformed, absent, and incomplete review records", () => {
    expect(preparedSourcePresentation(source, "not json").title).toBe(source.name);
    expect(preparedSourcePresentation(source).title).toBe(source.name);
    expect(preparedSourcePresentation(source, JSON.stringify({ pkg: { manifest: { bank: { title: "Other" } } } })).title).toBe(source.name);
  });
  it("does not display an invented valid week for unknown source provenance", () => {
    const info = preparedSourcePresentation(source, review({ course: { name: "RHPS", term: 5, week: 0 } }));
    expect(info.scope).toBe("RHPS · Term 5 · Pharmacology");
  });
});
