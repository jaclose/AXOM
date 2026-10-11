import { describe, expect, it, vi, afterEach } from "vitest";
import { desktopRelease, fetchDesktopRelease } from "./releases";
const asset = (name = "AXOM-aarch64.dmg", url = "https://github.com/jaclose/AXOM/releases/download/v1/AXOM-aarch64.dmg") => ({ name, browser_download_url: url, size: 12345 });
const release = (assets = [asset()]) => ({ tag_name: "v1", prerelease: true, draft: false, assets });
afterEach(() => vi.unstubAllGlobals());
describe("desktop release discovery", () => {
  it("shows only published installer assets, including preview releases", () => {
    const result = desktopRelease([{ ...release(), draft: true }, { ...release(), tag_name: "feed", assets: [asset("latest.json")] }, release()]);
    expect(result?.version).toBe("v1");
    expect(result?.prerelease).toBe(true);
    expect(result?.downloads[0].platform).toBe("macOS · ARM64");
  });
  it("never turns unknown, empty or external assets into downloads", () => {
    expect(desktopRelease([])).toBeNull();
    expect(desktopRelease([release([asset("a.dmg", "javascript:alert(1)"), asset("b.exe", "https://example.com/b.exe"), { ...asset(), size: 0 }])])).toBeNull();
    expect(() => desktopRelease({ message: "rate limited" })).toThrow("unexpected");
  });
  it("exposes backend failures for an actionable retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(fetchDesktopRelease(new AbortController().signal)).rejects.toThrow("Try again");
  });
});
