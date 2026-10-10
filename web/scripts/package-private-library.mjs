// Portable private content, separate from the application release and public Git.
import JSZip from "jszip";
import process from "node:process";
import console from "node:console";
import { createReadStream, createWriteStream, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
const [root, destination] = process.argv.slice(2);
if (!root || !destination) throw new Error("Provide a prepared private directory and output .zip path.");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const zip = new JSZip();
const paths = new Set(["catalog.json", ...catalog.templates.map(t => t.file)]);
for (const source of catalog.sources) if (source.originalFile) paths.add(source.originalFile);
for (const source of catalog.sources) if (source.bankFile) {
  paths.add(source.bankFile);
  const assets = `${source.bankFile.slice(0, source.bankFile.lastIndexOf("/"))}/assets`;
  try { for (const name of readdirSync(join(root, assets))) paths.add(`${assets}/${name}`); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
// Open each file only when its ZIP entry is consumed, bounding memory and file handles.
for (const path of paths) zip.file(path, Readable.from((async function* () {
  for await (const chunk of createReadStream(join(root, path))) yield chunk;
})()));
await pipeline(zip.generateNodeStream({ streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 4 } }), createWriteStream(destination, { flags: "wx", mode: 0o600 }));
console.log(JSON.stringify({ version: catalog.version, files: paths.size, templates: catalog.templates.length, sources: catalog.sources.length, ready: catalog.sources.reduce((n,s) => n+s.ready,0), review: catalog.sources.reduce((n,s) => n+s.review,0) }));
