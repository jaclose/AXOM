// Stale-deploy detection, shared by the route boundary and lazy shell parts.
// A tab left open across a deploy asks for hashed chunks the host no longer
// serves; browsers word that failure differently. A screen's stylesheet fails
// the same way ("Unable to preload CSS for …/assets/…css", from Vite's preload
// helper). Retrying in place cannot help either: the failed import stays cached
// for the life of the page, so only a reload into the current build works.
export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed|Unable to preload CSS|MIME type of "text\/html"/i.test(text);
}
