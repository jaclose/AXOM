// @vitest-environment jsdom
import { expect, it } from "vitest";
import { FOCUS_SPACE_KEY, useFocusSpace, validateFocusVideo } from "./focusSpaces";
it("persists the selected space without reopening an immersive view automatically", () => {
  useFocusSpace.getState().select("kelp-forest");
  expect(localStorage.getItem(FOCUS_SPACE_KEY)).toBe("kelp-forest");
  useFocusSpace.getState().close();
  expect(useFocusSpace.getState()).toMatchObject({ selected: "kelp-forest", open: false, immersive: false });
  useFocusSpace.getState().select("javascript:alert(1)");
  expect(useFocusSpace.getState().open).toBe(false);
});
it("rejects unsupported and oversized local video before accessing storage", () => {
  expect(() => validateFocusVideo({ name: "scene.mp4", type: "video/mp4", size: 1234 })).not.toThrow();
  for (const file of [{ name: "scene.html", type: "text/html", size: 1 }, { name: "scene.mp4", type: "video/mp4", size: 0 }, { name: "scene.mp4", type: "video/mp4", size: 101 * 1024 * 1024 }]) expect(() => validateFocusVideo(file)).toThrow();
});
