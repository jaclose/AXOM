/** The two hosted origins have separate browser storage. Keep navigation optional. */
export function otherWorkspaceUrl(hostname: string): string | null {
  return hostname.toLowerCase() === "axom.info" ? "https://www.axom.info/?app=1" : null;
}
