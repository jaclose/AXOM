// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseImport, toPortableState } from "../lib/backup";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { HubFoldersPage } from "./HubFoldersPage";
import { PremedExperienceLogPage } from "./PremedExperienceLogPage";

const previous = {
  folders: useStore.getState().folders,
  premedExperiences: useStore.getState().premedExperiences,
};

afterEach(() => {
  cleanup();
  useStore.setState(previous);
});

describe("links restored from a backup", () => {
  it("renders web links but never script links in Hub Folders or the experience log", () => {
    const safe = "https://example.edu/course";
    const script = "javascript:alert(document.domain)";
    const seed = makeSeed();
    seed.folders = [safe, script].map((link, index) => ({
      id: `folder-${index}`, name: `Folder ${index}`, group: "Shared", link, sortOrder: index,
    }));
    seed.premedExperiences = [safe, script].map((evidenceLink, index) => ({
      id: `entry-${index}`, date: "2026-10-01", kind: "Clinical" as const, title: `Entry ${index}`, organization: "Clinic",
      hours: 2, verified: false, reflection: "", evidenceLink, created: "2026-10-01T12:00:00.000Z",
    }));
    const imported = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(seed) }));
    useStore.setState({ folders: imported.folders, premedExperiences: imported.premedExperiences });

    for (const Page of [HubFoldersPage, PremedExperienceLogPage]) {
      const { container, unmount } = render(<Page />);
      const hrefs = [...container.querySelectorAll("a[href]")].map((anchor) => anchor.getAttribute("href") ?? "");
      expect(hrefs, Page.name).toContain(safe);
      expect(hrefs.filter((href) => /^\s*javascript:/i.test(href)), Page.name).toEqual([]);
      unmount();
    }
  });
});
