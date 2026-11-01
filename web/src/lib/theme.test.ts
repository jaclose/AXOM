// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./brand";
import {
  applyThemePreference,
  installThemeSync,
  isThemePreference,
  readThemePreference,
  resolveThemePreference,
  setThemePreference,
} from "./theme";

describe("theme preference", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, String(value)); },
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })));
    document.head.innerHTML = '<meta name="theme-color" content="#0d0d0e">';
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-preference");
    document.documentElement.removeAttribute("style");
  });

  it("accepts only light, dark, and system and falls back deterministically", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(readThemePreference({ getItem: () => "sepia" })).toBe("system");
    expect(readThemePreference({ getItem: () => { throw new Error("blocked"); } })).toBe("system");
  });

  it("resolves system without overriding explicit choices", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  it("keeps data-theme, color-scheme, and theme-color consistent", () => {
    expect(applyThemePreference("light", document, true)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    // Midnight's light paper: the default palette until someone picks one.
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#f8f9fc");
  });

  it("persists only the small preference and still applies when storage is blocked", () => {
    const storage = { setItem: vi.fn() };
    setThemePreference("dark", { storage, window, document });
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.themePreference, "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    expect(() => setThemePreference("light", {
      storage: { setItem: () => { throw new Error("blocked"); } },
      window,
      document,
    })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("reacts to OS changes only while the system preference is active", () => {
    let mediaListener: (() => void) | undefined;
    const media = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => { mediaListener = listener; },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(media);
    localStorage.setItem(STORAGE_KEYS.themePreference, "system");
    const cleanup = installThemeSync(window);
    expect(document.documentElement.dataset.theme).toBe("light");
    Object.defineProperty(media, "matches", { configurable: true, value: true });
    mediaListener?.();
    expect(document.documentElement.dataset.theme).toBe("dark");

    setThemePreference("light", { window, document });
    expect(document.documentElement.dataset.theme).toBe("light");
    Object.defineProperty(media, "matches", { configurable: true, value: false });
    mediaListener?.();
    expect(document.documentElement.dataset.theme).toBe("light");
    cleanup();
  });

  it("applies valid cross-tab changes and treats invalid values as system", () => {
    const media = {
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(media);
    const cleanup = installThemeSync(window);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.themePreference, newValue: "light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEYS.themePreference, newValue: "sepia" }));
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    cleanup();
  });
});
