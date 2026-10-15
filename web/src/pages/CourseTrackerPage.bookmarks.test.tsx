// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import type { Resource } from "../lib/types";
import { AcademicBookmarkImporter, TrackerBookmarkLinks, TrackerItemBookmarkLinks } from "./CourseTrackerPage.bookmarks";
import { academicBookmarkOwnerKey } from "../lib/course-engine/bookmarkEvidence";

const URL_A = "https://sgu1.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=12345678-1234-4567-890a-bcdef0123456";
const URL_B = "https://sgu1.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=abcdef01-2345-6789-abcd-1234567890ab";
const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><DT><A HREF="${URL_A}&amp;start=345">DM DLA 7 - Lipid Transport</A>
<DT><A HREF="${URL_A}">DM DLA 7 duplicate</A>
<DT><A HREF="${URL_B}">NB Lecture 65 - Sensory Motor</A>
<DT><A HREF="https://sgu1.hosted.panopto.com/Panopto/Pages/Auth/Login.aspx">Login</A>
<DT><A HREF="javascript:alert(1)">Unsafe</A></DL>`;

function mockBookmarkFile(source = html) {
  const file = new File([source], "bookmarks.html", { type: "text/html" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(source) });
  return file;
}

beforeEach(() => {
  useStore.setState(makeSeed());
  useStore.setState({ resources: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Course Tracker authorized Panopto bookmarks workflow", () => {
  it("previews only canonical recording URLs and asks to resolve ambiguous NB modules", async () => {
    const { container } = render(<AcademicBookmarkImporter />);
    fireEvent.click(screen.getByText("Import study video bookmarks"));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [mockBookmarkFile()] } });
    expect(await screen.findByText(/2 distinct recording links found/)).toBeTruthy();
    expect(container.textContent).toContain("1 duplicate links collapsed");
    expect(screen.getByText("DM DLA 7 - Lipid Transport")).toBeTruthy();
    expect(screen.getByText("NB Lecture 65 - Sensory Motor")).toBeTruthy();
    const choices = within(container).getByLabelText("Course for NB Lecture 65 - Sensory Motor") as HTMLSelectElement;
    expect(choices.value).toBe("");
    expect([...choices.options].some(option => option.text.includes("Term 2 / BPM 501 / NB2"))).toBe(true);
    expect(choices.options.length).toBe(4); // unassigned + NB1 + NB2 + NB3
    // Previewing never creates content in the user's account.
    expect(useStore.getState().resources).toEqual([]);
  });

  it("saves only new references as private Resources and never overwrites existing notes", async () => {
    const existing: Resource = { id: "old", title: "My old recording", url: URL_A, created: "2025-01-01",
      category: "Personal", note: "Do not overwrite this study note", tags: ["favorite-source"] };
    useStore.setState({ resources: [existing] });
    const { container } = render(<AcademicBookmarkImporter />);
    fireEvent.click(screen.getByText("Import study video bookmarks"));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [mockBookmarkFile()] } });
    expect(await screen.findByText(/2 distinct recording links found/)).toBeTruthy();
    const select = screen.getByLabelText("Course for NB Lecture 65 - Sensory Motor");
    fireEvent.change(select, { target: { value: academicBookmarkOwnerKey("Term 2", "BPM 501", "NB2") } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 new links to my Resources" }));
    await waitFor(() => expect(useStore.getState().resources.some((entry) => entry.url === URL_B)).toBe(true));
    const saved = useStore.getState().resources.find((entry) => entry.url === URL_B)!;
    expect(saved.tags).toContain("academic:owner:term2/bpm501/nb2");
    expect(saved.tags).toContain("axom:unverified-school-week");
    expect(useStore.getState().resources.find((entry) => entry.id === existing.id)).toEqual(existing);
    expect(useStore.getState().resources.filter((entry) => entry.url === URL_B)).toHaveLength(1);
  });



  it("surfaces NB3 folder hints but applies them only after an explicit review action", async () => {
    const folderHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Term 2</H3><DL>
      <DT><H3>NB3</H3><DL><DT><A HREF="${URL_B}">NB Lecture 65 - Synthetic Neuroscience</A>
      </DL></DL></DL>`;
    const { container } = render(<AcademicBookmarkImporter />);
    fireEvent.click(screen.getByText("Import study video bookmarks"));
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [mockBookmarkFile(folderHtml)] } });
    await screen.findByText(/1 distinct recording links found/);
    const select = screen.getByLabelText("Course for NB Lecture 65 - Synthetic Neuroscience") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByText(/Bookmark folder suggests NB3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use 1 folder suggestions" }));
    expect(select.value).toBe("term2/bpm501/nb3");
    fireEvent.click(screen.getByRole("button", { name: "Save 1 new links to my Resources" }));
    await waitFor(() => expect(useStore.getState().resources.some((item) => item.url === URL_B)).toBe(true));
    expect(useStore.getState().resources.find((item) => item.url === URL_B)?.tags)
      .toContain("academic:owner:term2/bpm501/nb3");
  });


  it("links a video to one explicitly chosen source-template tracker activity, preserving study progress", async () => {
    const before = {
      id: "nb3-65", path: "Term 2/BPM 501/NB3/Week 4",
      label: "NB Lecture 65 Sensory Motor", templateKey: "nb3|lecture|65",
      activity: "lecture" as const, kind: "Lecture" as const, passes: 3, ankiPasses: 2,
      yield: "none" as const, updated: "2026-10-13T08:00:00.000Z",
    };
    useStore.setState({ tracker: [before] });
    const folderHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Term 2</H3><DL>
      <DT><H3>NB3</H3><DL><DT><A HREF="${URL_B}">NB Lecture 65 - Synthetic Neuroscience</A>
      </DL></DL></DL>`;
    const { container } = render(<AcademicBookmarkImporter />);
    fireEvent.click(screen.getByText("Import study video bookmarks"));
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [mockBookmarkFile(folderHtml)] } });
    await screen.findByText(/1 distinct recording links found/);
    fireEvent.click(screen.getByRole("button", { name: "Use 1 folder suggestions" }));
    const activity = screen.getByLabelText("Tracker activity for NB Lecture 65 - Synthetic Neuroscience") as HTMLSelectElement;
    expect(activity.value).toBe("");
    expect(activity.options).toHaveLength(2);
    fireEvent.change(activity, { target: { value: before.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 new links to my Resources" }));
    await waitFor(() => expect(useStore.getState().resources.some((entry) =>
      entry.tags.includes("academic:tracker:nb3-65"))).toBe(true));
    expect(useStore.getState().tracker).toEqual([before]);
    render(<TrackerItemBookmarkLinks itemId="nb3-65" />);
    expect(screen.getByRole("link", { name: "Recording: NB Lecture 65 - Synthetic Neuroscience" })).toBeTruthy();
    render(<TrackerItemBookmarkLinks itemId="another-tracker-item" />);
    expect(screen.getAllByRole("link", { name: "Recording: NB Lecture 65 - Synthetic Neuroscience" })).toHaveLength(1);
  });

  it("respects an explicit keep-unassigned choice even for an obvious module prefix", async () => {
    const { container } = render(<AcademicBookmarkImporter />);
    fireEvent.click(screen.getByText("Import study video bookmarks"));
    const content = `<DL><DT><A HREF="${URL_A}">DM DLA 7 - Amino Acid Metabolism</A></DL>`;
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [mockBookmarkFile(content)] } });
    await screen.findByText(/1 distinct recording links found/);
    const choice = screen.getByLabelText("Course for DM DLA 7 - Amino Acid Metabolism") as HTMLSelectElement;
    expect(choice.value).toBe("term2/bpm501/dm");
    fireEvent.change(choice, { target: { value: "" } });
    expect(choice.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save 1 new links to my Resources" }));
    await waitFor(() => expect(useStore.getState().resources.some((item) => item.url === URL_A)).toBe(true));
    const saved = useStore.getState().resources.find((item) => item.url === URL_A)!;
    expect(saved.tags).toContain("axom:unassigned-course");
    expect(saved.tags).not.toContain("academic:owner:term2/bpm501/dm");
  });

  it("keeps course-specific academic video links separate in the tracker", () => {
    useStore.setState({ terms: [{ id: "t2", name: "Term 2" }], courses: [
      { id: "core", termId: "t2", code: "BPM 501", name: "Core", files: 0, modules: [{ id: "nb", name: "NB2" }] },
      { id: "elective", termId: "t2", code: "ELECTIVE", name: "Elective", files: 0, modules: [{ id: "nb", name: "NB Block 2" }] },
    ], resources: [
      { id: "one", created: "2026-01-01", title: "BPM source", url: URL_A, category: "Academic videos",
        tags: ["axom:academic-panopto", "academic:owner:term2/bpm501/nb2"] },
      { id: "two", created: "2026-01-01", title: "Elective source", url: URL_B, category: "Academic videos",
        tags: ["axom:academic-panopto", "academic:owner:term2/elective/nb2"] },
    ] });
    const { rerender } = render(<TrackerBookmarkLinks scope="Term 2/BPM 501/NB2/Week 2" />);
    expect(screen.getByText("BPM source")).toBeTruthy();
    expect(screen.queryByText("Elective source")).toBeNull();
    rerender(<TrackerBookmarkLinks scope="Term 2/NB2/Week 2" />);
    expect(screen.queryByText("BPM source")).toBeNull();
    rerender(<TrackerBookmarkLinks scope="Term 2/ELECTIVE/NB2/Week 2" />);
    expect(screen.queryByText("BPM source")).toBeNull();
    expect(screen.getByText("Elective source")).toBeTruthy();
  });
});
