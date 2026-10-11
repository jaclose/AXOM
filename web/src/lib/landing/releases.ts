export const RELEASES_URL = "https://github.com/jaclose/AXOM/releases";
export const RELEASES_API = "https://api.github.com/repos/jaclose/AXOM/releases?per_page=20";
export interface DesktopDownload { name: string; url: string; size: number; platform: string }
export interface DesktopRelease { version: string; prerelease: boolean; downloads: DesktopDownload[] }
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Use only real, published installer assets from this repository. Never guess a download URL. */
export function desktopRelease(data: unknown): DesktopRelease | null {
  if (!Array.isArray(data)) throw new Error("The release service returned an unexpected response.");
  for (const release of data) {
    if (!record(release) || release.draft || typeof release.tag_name !== "string" || !Array.isArray(release.assets)) continue;
    const downloads: DesktopDownload[] = [];
    for (const asset of release.assets) {
      if (!record(asset) || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string"
        || typeof asset.size !== "number" || asset.size <= 0) continue;
      const platform = /\.dmg$/i.test(asset.name) ? "macOS" : /\.(exe|msi)$/i.test(asset.name) ? "Windows" : /\.(AppImage|deb)$/i.test(asset.name) ? "Linux" : null;
      if (!platform) continue;
      try {
        const url = new URL(asset.browser_download_url);
        if (url.protocol !== "https:" || url.host !== "github.com" || !url.pathname.startsWith("/jaclose/AXOM/releases/download/")) continue;
      } catch { continue; }
      const architecture = /aarch64|arm64/i.test(asset.name) ? " · ARM64" : /x64|x86_64|amd64/i.test(asset.name) ? " · Intel / AMD" : "";
      downloads.push({ name: asset.name, url: asset.browser_download_url, size: asset.size, platform: platform + architecture });
    }
    if (downloads.length) return { version: release.tag_name, prerelease: Boolean(release.prerelease), downloads };
  }
  return null;
}

export async function fetchDesktopRelease(signal: AbortSignal): Promise<DesktopRelease | null> {
  const response = await fetch(RELEASES_API, { signal, headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error("We couldn’t check desktop releases. Try again or open the release page.");
  return desktopRelease(await response.json());
}
