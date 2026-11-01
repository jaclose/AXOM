// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseImport, toPortableState } from "../lib/backup";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { CoursesPage } from "./CoursesPage";
import { HubFoldersPage } from "./HubFoldersPage";
import { PremedExperienceLogPage } from "./PremedExperienceLogPage";

afterEach(cleanup);

// A shared or crafted backup can put any string in a link field, and React 18 still
// renders javascript: hrefs, which would run with this origin's vault and session.
describe("links restored from a backup", () => {
  it("open web pages and never run script", () => {
    const safe = "https://example.edu/course";
    const script = "javascript:alert(document.domain)";
    const seed = makeSeed();
    seed.courses = seed.courses.slice(0, 2).map((course, index) => ({ ...course, link: index ? script : safe }));
    seed.folders = [safe, script].map((link, index) => ({ id: `folder-${index}`, name: `Folder ${index}`, group: "Shared", link, sortOrder: index }));
    seed.premedExperiences = [safe, script].map((evidenceLink, index) => ({
      id: `entry-${index}`, date: "2026-10-01", kind: "Clinical" as const, title: `Entry ${index}`, organization: "Clinic",
      hours: 2, verified: false, reflection: "", evidenceLink, created: "2026-10-01T12:00:00.000Z",
    }));
    useStore.setState(parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(seed) })));

    for (const Page of [CoursesPage, HubFoldersPage, PremedExperienceLogPage]) {
      const { container, unmount } = render(<Page />);
      const hrefs = [...container.querySelectorAll("a[href]")].map((anchor) => anchor.getAttribute("href") ?? "");
      expect(hrefs, Page.name).toContain(safe);
      expect(hrefs.filter((href) => /^\s*javascript:/i.test(href)), Page.name).toEqual([]);
      unmount();
    }
  });
});
