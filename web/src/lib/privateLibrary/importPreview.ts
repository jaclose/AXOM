import { readCatalog } from "./install";
import type { PrivateLibraryCatalog } from "./types";

/** Read-only preview. In particular, it must never call installPrivateLibrary. */
export interface PreparedLibraryPreview {
  version: string;
  sources: number;
  bankSources: number;
  templates: number;
  potentialReady: number;
  heldForReview: number;
  items: Array<{
    name: string;
    module?: string;
    ready: number;
    review: number;
    status: PrivateLibraryCatalog["sources"][number]["status"];
  }>;
}

export async function previewPreparedLibrary(read: (path: string) => Promise<Uint8Array>): Promise<PreparedLibraryPreview> {
  const bytes = await read("catalog.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("This package's catalog cannot be read. No questions were saved.");
  }
  const catalog = readCatalog(parsed);
  return {
    version: catalog.version,
    sources: catalog.sources.length,
    bankSources: catalog.sources.filter(source => Boolean(source.bankFile)).length,
    templates: catalog.templates.length,
    potentialReady: catalog.sources.reduce((count, source) => count + source.ready, 0),
    heldForReview: catalog.sources.reduce((count, source) => count + source.review, 0),
    items: catalog.sources.map(source => ({
      name: source.name,
      ...(source.module ? { module: source.module } : {}),
      ready: source.ready,
      review: source.review,
      status: source.status,
    })),
  };
}
