// Stale-deploy detection, shared by the route boundary and lazy shell parts.
// A tab left open across a deploy asks for hashed chunks the host no longer
// serves; browsers word that failure differently.
export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed|MIME type of "text\/html"/i.test(text);
}
