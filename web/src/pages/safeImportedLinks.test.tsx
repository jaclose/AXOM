// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlueprintWorkbench } from "../components/blueprints/BlueprintWorkbench";
import { BLUEPRINTS } from "../lib/blueprintCatalog";
import { instantiateBlueprint } from "../lib/blueprintInstall";
import { externalLinkHref } from "../lib/resourceUtils";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { CourseTrackerPage } from "./CourseTrackerPage";
import { CoursesPage } from "./CoursesPage";

const safeSource = "https://example.edu/source";
const unsafeSource = "javascript:alert(document.domain)";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function installWithSavedLinks() {
  const install = instantiateBlueprint(BLUEPRINTS[0]);
  install.nodes = [
    {
      ...install.nodes[0], id: "safe-node", objective: "Safe source objective", sourceUrl: safeSource,
      resourceLinks: [
        { label: "Web handout", url: "example.edu/handout", kind: "official" },
        { label: "Unsafe handout", url: "data:text/html,<script>alert(1)</script>", kind: "official" },
      ],
    },
    {
      ...install.nodes[1], id: "unsafe-node", objective: "Unsafe source objective", sourceUrl: unsafeSource,
      resourceLinks: [],
    },
    {
      ...install.nodes[2], id: "malformed-node", objective: "Malformed source objective", sourceUrl: 42 as unknown as string,
      resourceLinks: [{ label: "Malformed handout", url: { href: unsafeSource } as unknown as string, kind: "official" }],
    },
  ];
  useStore.setState({ blueprintInstalls: [install] });
  return install;
}

beforeEach(() => {
  useStore.setState(makeSeed());
  vi.stubGlobal("localStorage", memoryStorage());
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saved external links", () => {
  it("keeps web destinations and rejects script, data, and local-file URLs", () => {
    expect(externalLinkHref(" example.edu/course ")).toBe("https://example.edu/course");
    expect(externalLinkHref("http://example.edu/course")).toBe("http://example.edu/course");
    for (const url of [unsafeSource, "data:text/html,test", "file:///tmp/private", "vbscript:msgbox(1)", "java\tscript:alert(1)", "not a valid domain", " "]) {
      expect(externalLinkHref(url), url).toBeUndefined();
    }
    for (const value of [null, 42, true, [], { href: unsafeSource }]) {
      expect(externalLinkHref(value as unknown as string)).toBeUndefined();
    }
  });

  it("opens a saved course web link and offers edit for an unsafe course link", () => {
    const seed = makeSeed();
    const termId = seed.terms[0].id;
    useStore.setState({
      terms: seed.terms,
      courses: [
        { id: "safe-course", termId, code: "SAFE", name: "Safe course", files: 0, modules: [], link: safeSource },
        { id: "unsafe-course", termId, code: "UNSAFE", name: "Unsafe course", files: 0, modules: [], link: unsafeSource },
        { id: "malformed-course", termId, code: "MALFORMED", name: "Malformed course", files: 0, modules: [], link: { href: unsafeSource } as unknown as string },
      ],
    });
    const { container } = render(<CoursesPage />);
    const cards = container.querySelectorAll(".course-card");
    expect(within(cards[0] as HTMLElement).getByRole("link", { name: /Open/ }).getAttribute("href")).toBe(safeSource);
    expect(within(cards[1] as HTMLElement).queryByRole("link", { name: /Open/ })).toBeNull();
    fireEvent.click(within(cards[1] as HTMLElement).getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(cards[2] as HTMLElement).queryByRole("link", { name: /Open/ })).toBeNull();
    expect(within(cards[2] as HTMLElement).getByRole("button", { name: "Open" })).toBeTruthy();
  });

  it("shows only safe blueprint source links in the Course Tracker", () => {
    installWithSavedLinks();
    const { container } = render(<CourseTrackerPage />);
    const tree = screen.getByLabelText("Installed blueprints");
    fireEvent.click(within(tree).getByRole("button", { name: /Step 1/ }));
    fireEvent.click(within(tree).getByRole("button", { name: /Step 1 Master Blueprint/ }));
    const rows = container.querySelectorAll(".bp-tracker-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: /Source/ }).getAttribute("href")).toBe(safeSource);
    expect(within(rows[1] as HTMLElement).queryByRole("link", { name: /Source/ })).toBeNull();
    expect(within(rows[2] as HTMLElement).queryByRole("link", { name: /Source/ })).toBeNull();
  });

  it("shows saved blueprint resources without activating unsafe links", () => {
    installWithSavedLinks();
    const { container } = render(<BlueprintWorkbench mode="usmle" initialLane="step1" />);
    fireEvent.click(screen.getByRole("button", { name: /Continue Step 1/ }));
    fireEvent.click(container.querySelector(".bp-macro-cat") as HTMLElement);
    const rows = container.querySelectorAll(".bp-macro-node");
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button"));
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: /source audited/i }).getAttribute("href")).toBe(safeSource);
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: /Web handout/ }).getAttribute("href")).toBe("https://example.edu/handout");
    expect(within(rows[0] as HTMLElement).getByText("Unsafe handout")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).queryByRole("link", { name: /Unsafe handout/ })).toBeNull();
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button"));
    expect(within(rows[1] as HTMLElement).queryByRole("link", { name: /source audited/i })).toBeNull();
    fireEvent.click(within(rows[2] as HTMLElement).getByRole("button"));
    expect(within(rows[2] as HTMLElement).queryByRole("link", { name: /source audited/i })).toBeNull();
    expect(within(rows[2] as HTMLElement).getByText("Malformed handout")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).queryByRole("link", { name: /Malformed handout/ })).toBeNull();
  });
});
