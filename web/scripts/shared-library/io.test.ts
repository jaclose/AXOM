// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateReader, publicationIO } from "./io";
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "axom-catalog-io-")); roots.push(root);
  const source = join(root, "source"), out = join(root, "publication");
  await mkdir(source); await writeFile(join(source, "catalog.json"), "original");
  return { root, source, out };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("private publication filesystem boundaries", () => {
  it("never writes into or around the source collection", async () => {
    const f = await fixture();
    for (const out of [f.source, join(f.source, "nested"), f.root]) await expect(publicationIO(f.source, out)).rejects.toThrow(/non-overlapping/);
    expect(await readFile(join(f.source, "catalog.json"), "utf8")).toBe("original");
  });
  it("refuses a symlink into the original collection", async () => {
    const f = await fixture(); await symlink(f.source, f.out);
    await expect(publicationIO(f.source, f.out)).rejects.toThrow(/non-overlapping/);
  });
  it("keeps published artifacts out of Git worktrees", async () => {
    const f = await fixture(); await mkdir(join(f.out, ".git"), { recursive: true });
    await expect(publicationIO(f.source, join(f.out, "private"))).rejects.toThrow(/Git/);
  });
  it("reads and writes separate private roots and refuses escaping links", async () => {
    const f = await fixture(), io = await publicationIO(f.source, f.out);
    expect(new TextDecoder().decode(await io.read("catalog.json"))).toBe("original");
    await io.write("templates/test.txt", new TextEncoder().encode("copy"));
    expect(await readFile(join(f.out, "templates/test.txt"), "utf8")).toBe("copy");
    await writeFile(join(f.root, "outside.txt"), "private");
    await symlink(join(f.root, "outside.txt"), join(f.source, "link.txt"));
    const reader = await privateReader(f.source);
    await expect(reader("link.txt")).rejects.toThrow(/escapes/);
    await expect(io.write("../escape", new Uint8Array(1))).rejects.toThrow(/Unsafe/);
  });
});
