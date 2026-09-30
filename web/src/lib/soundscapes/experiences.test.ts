// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { EXPERIENCES, EXPERIENCE_ALLOW, EXPERIENCE_SANDBOX, experienceUrl, nextExperience } from "./experiences";
import { FOCUS_SPACE_KEY, useFocusSpace } from "./focusSpaces";

beforeEach(() => { localStorage.clear(); useFocusSpace.getState().close(); });

it("accepts only reviewed catalog entries, with source and rights evidence", () => {
  expect(EXPERIENCES).toHaveLength(20);
  expect(new Set(EXPERIENCES.map((site) => site.id)).size).toBe(20);
  for (const site of EXPERIENCES) {
    expect(new URL(site.url).protocol).toBe("https:");
    expect(new URL(site.licenseUrl).protocol).toBe("https:");
    expect(site.license).toBeTruthy();
    expect(experienceUrl(`site:${site.id}`)).toBe(site.url);
  }
  for (const id of ["https://example.com", "javascript:alert(1)", "site:../../private", "site:unknown"]) {
    expect(experienceUrl(id)).toBeUndefined();
    useFocusSpace.getState().select(id);
    expect(useFocusSpace.getState().open).toBe(false);
  }
  expect(EXPERIENCE_SANDBOX).not.toMatch(/allow-(top-navigation|popups|forms)/);
  expect(EXPERIENCE_ALLOW).toContain("camera 'none'");
});

it("cycles through each experience exactly once and preserves the current view size", () => {
  useFocusSpace.getState().select(`site:${EXPERIENCES[0].id}`, true);
  const visited = new Set<string>();
  for (let i = 0; i < EXPERIENCES.length; i++) {
    visited.add(useFocusSpace.getState().selected);
    useFocusSpace.getState().next();
  }
  expect(visited.size).toBe(20);
  expect(useFocusSpace.getState()).toMatchObject({ selected: `site:${EXPERIENCES[0].id}`, compact: true });
  expect(nextExperience(`site:${EXPERIENCES[0].id}`, -1)).toBe(EXPERIENCES.at(-1));
  expect(localStorage.getItem(FOCUS_SPACE_KEY)).toBe(`site:${EXPERIENCES[0].id}`);
  useFocusSpace.getState().close();
  expect(useFocusSpace.getState().open).toBe(false);
});
