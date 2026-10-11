import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { safeCatalogPath } from "../../src/lib/cloudLibrary/model";
function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
async function rejectRepositoryOutput(path: string): Promise<void> {
  let parent = resolve(path);
  while (true) {
    try { await lstat(resolve(parent, ".git")); throw new Error("Choose a private output directory outside Git checkouts."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const next = dirname(parent); if (next === parent) break; parent = next;
  }
}
/** Read only descendants of a selected real directory. Never follow an escaping link. */
export async function privateReader(root: string) {
  const base = await realpath(root);
  return async (path: string): Promise<Uint8Array> => {
    const target = await realpath(resolve(base, safeCatalogPath(path)));
    if (!within(base, target)) throw new Error("A source path escapes its selected directory.");
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error("Unsupported source file size/type.");
      return new Uint8Array(await handle.readFile());
    } finally { await handle.close(); }
  };
}
export async function publicationIO(source: string, output: string) {
  const sourceRoot = await realpath(source), requested = resolve(output);
  await rejectRepositoryOutput(requested);
  // Resolve the nearest existing ancestor before creating anything, including symlinks.
  let existing = requested;
  for (;;) {
    try { await lstat(existing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(existing) === existing) throw error;
      existing = dirname(existing);
    }
  }
  const resolvedOutput = resolve(await realpath(existing), relative(existing, requested));
  if (within(sourceRoot, resolvedOutput) || within(resolvedOutput, sourceRoot)) {
    throw new Error("Source and output must be separate, non-overlapping directories. Originals are read-only.");
  }
  await rejectRepositoryOutput(resolvedOutput);
  await mkdir(resolvedOutput, { recursive: true, mode: 0o700 });
  const root = await realpath(resolvedOutput);
  if (within(sourceRoot, root) || within(root, sourceRoot)) throw new Error("Output overlaps read-only source material.");
  return {
    read: await privateReader(sourceRoot),
    write: async (path: string, bytes: Uint8Array) => {
      const target = resolve(root, safeCatalogPath(path));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      if (!within(root, await realpath(dirname(target)))) throw new Error("Output path escapes the private directory.");
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
    },
  };
}
