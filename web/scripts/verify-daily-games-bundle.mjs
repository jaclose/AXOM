/* global process, URL */
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const assetsDir = new URL("../dist/assets/", import.meta.url);
const names = await readdir(assetsDir);
const scripts = names.filter((name) => name.endsWith(".js"));
const sentinel = "AXOM_WORD_LIST_SENTINEL_GENERAL_2_SCOWL_2026_02_25";
const contents = new Map();
for (const name of scripts) contents.set(name, await readFile(new URL(name, assetsDir), "utf8"));

const findSingleChunk = (label, markers) => {
  const matches = scripts.filter((name) => markers.every((marker) => contents.get(name)?.includes(marker)));
  if (matches.length !== 1) {
    throw new Error(`Daily Games bundle check: expected one ${label} chunk by content, found ${matches.length}.`);
  }
  return matches[0];
};

// Content markers survive hashing/minification and avoid coupling the check to
// Rollup's human-readable chunk-name heuristic.
const appChunk = findSingleChunk("App shell", ["Local data needs attention", "Your command center at a glance"]);
if (contents.get(appChunk)?.includes(sentinel)) {
  throw new Error("Daily Games bundle check: word-list sentinel leaked into the App chunk.");
}
const dailyWordEngineMarker = "Six-row Daily Word puzzle for";
if (contents.get(appChunk)?.includes(dailyWordEngineMarker)) {
  throw new Error("Daily Games bundle check: Daily Word engine leaked into the App chunk.");
}

const wordChunks = scripts.filter((name) => contents.get(name)?.includes(sentinel));
if (wordChunks.length !== 1) {
  throw new Error(`Daily Games bundle check: expected one isolated word-list chunk, found ${wordChunks.length}.`);
}
const gameChunk = findSingleChunk("lazy Daily Word engine", ["AXOM Daily Word", dailyWordEngineMarker]);
const doctordleChunk = findSingleChunk("lazy verified Doctordle bridge", ["Verified external destination", "independent daily diagnosis game"]);
if (gameChunk === appChunk || wordChunks.includes(appChunk) || wordChunks.includes(gameChunk)) {
  throw new Error("Daily Games bundle check: lazy game code is not isolated from the shell.");
}
const engineChunks = scripts.filter((name) => (
  contents.get(name)?.includes("The answer list cannot be empty.")
  && contents.get(name)?.includes("Complete the puzzle before sharing.")
));
if (engineChunks.length !== 1 || engineChunks[0] !== gameChunk) {
  throw new Error(`Daily Games bundle check: engine code escaped its lazy page chunk (${engineChunks.join(", ")}).`);
}

for (const name of [appChunk, gameChunk, wordChunks[0], doctordleChunk]) {
  if (!/-[A-Za-z0-9_-]{8,}\.js$/.test(name)) {
    throw new Error(`Daily Games bundle check: expected a hashed asset filename, received ${name}.`);
  }
}

const size = async (name) => (await stat(fileURLToPath(new URL(name, assetsDir)))).size;
const chunkReport = async (name) => ({
  file: name,
  bytes: await size(name),
  gzipBytes: gzipSync(contents.get(name)).byteLength,
});
const report = {
  app: await chunkReport(appChunk),
  game: await chunkReport(gameChunk),
  words: await chunkReport(wordChunks[0]),
  doctordle: await chunkReport(doctordleChunk),
};
process.stdout.write(`Daily Games bundle isolation: ${JSON.stringify(report)}\n`);
