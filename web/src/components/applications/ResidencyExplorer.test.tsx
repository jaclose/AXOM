// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { buildResidencyDataset, programsFromAcgmeRows } from "../../lib/residencyPrograms";
import { ResidencyExplorer } from "./ResidencyExplorer";

const source = { url: "https://acgmecloud.org/analytics/explore-public-data/program-search", retrievedAt: "2026-09-26T12:00:00Z" };
const dataset = buildResidencyDataset(programsFromAcgmeRows([
  { ProgramCode: "0140311024", SpecialtyName: "Internal medicine", IsSubspecialty: "0", ProgramName: "Example IM Program", ProgramStateName: "New York" },
  { ProgramCode: "0200000001", SpecialtyName: "Anesthesiology", IsSubspecialty: "0", ProgramName: "Boston Anesthesia", ProgramStateName: "Massachusetts" },
], source).programs, "2026-09-26T12:00:00Z");

function respond(status: number, body?: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? "missing" : JSON.stringify(body), {
    status,
    headers: { "content-type": body === undefined ? "text/html" : "application/json" },
  })));
}

beforeEach(() => useStore.setState(makeSeed()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ResidencyExplorer", () => {
  it("shows the honest not-collected state when no dataset exists", async () => {
    respond(404);
    render(<ResidencyExplorer empty={<p>Dataset not collected yet</p>} />);
    expect(await screen.findByText("Dataset not collected yet")).toBeTruthy();
  });

  it("lists, filters, and saves ACGME programs with unknown requirements stated plainly", async () => {
    respond(200, dataset);
    render(<ResidencyExplorer empty={<p>empty</p>} />);
    expect(await screen.findByText("Example IM Program")).toBeTruthy();
    expect(screen.getAllByText(/not captured yet — check the program site/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Specialty"), { target: { value: "Anesthesiology" } });
    await waitFor(() => expect(screen.queryByText("Example IM Program")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save Boston Anesthesia" }));
    expect(useStore.getState().profile.applicationResearch?.find((entry) => entry.schoolId === "acgme-0200000001")?.shortlisted).toBe(true);
  });
});
