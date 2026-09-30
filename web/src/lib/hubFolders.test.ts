// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const invoke = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { openHubFolder, safeFolderLink, validFolderPath } = await import("./hubFolders");
afterEach(() => { vi.unstubAllGlobals(); invoke.mockClear(); });
it("accepts only explicit local paths and safe web protocols", () => {
  for (const path of ["/Users/me/Study", "~/Documents/Study", "C:\\Study"]) expect(validFolderPath(path)).toBe(true);
  for (const path of ["javascript:alert(1)", "relative", "/Users/me/../other", "/tmp/\nfile"]) expect(validFolderPath(path)).toBe(false);
  expect(safeFolderLink("https://example.org")).toBe("https://example.org/");
  expect(safeFolderLink("mailto:hello@example.org")).toBe("mailto:hello@example.org");
  expect(safeFolderLink("obsidian://open?vault=Study")).toBeUndefined();
  expect(safeFolderLink("file:///tmp")).toBeUndefined();
  expect(safeFolderLink("javascript:alert(1)")).toBeUndefined();
});
it("uses the validated native command and a truthful browser fallback", async () => {
  await expect(openHubFolder("/tmp")).rejects.toThrow("desktop app");
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  try {
    await openHubFolder("/tmp", true);
    expect(invoke).toHaveBeenCalledWith("hub_folder_open", { path: "/tmp", reveal: true });
    await expect(openHubFolder("/tmp/../private")).rejects.toThrow("absolute local folder");
    expect(invoke).toHaveBeenCalledOnce();
  } finally { delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; }
});
