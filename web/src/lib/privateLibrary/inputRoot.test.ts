// @vitest-environment node
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveLibraryInputRoot as resolve, safeInputPath as safe, INPUT_MAX_FILE_BYTES as MAX } from "./inputRoot";
const entries = (...paths: string[]) => paths.map(path => ({ path, byteSize: 1 }));
function catalog(...paths: string[]) {
  const result = resolve(entries(...paths));
  if (result.kind !== "catalog") throw new Error("Expected a catalog root");
  return result;
}
test('accepts catalog at root', () => assert.deepEqual(resolve(entries('catalog.json','banks/a.json')), {kind:'catalog', prefix:'', catalogPath:'catalog.json'}));
test('accepts wrapped catalog without making the user select the inner folder', () => assert.equal(catalog('Downloads/My Library/catalog.json','Downloads/My Library/banks/a.json').prefix,'Downloads/My Library/'));
test('detects original manifest-based multi-bank export without a catalog', () => assert.deepEqual(resolve(entries('GOER/a/manifest.json','GOER/b/manifest.json')),{kind:'native-packages',manifestPaths:['GOER/a/manifest.json','GOER/b/manifest.json']}));
test('single root-level native package works', () => assert.equal(resolve(entries('manifest.json','questions.json')).kind,'native-packages'));
test('does not silently select between two catalogs', () => assert.throws(() => resolve(entries('a/catalog.json','b/catalog.json')), /Several/));
test('does not ignore a sibling bank beside a nested catalog', () => assert.throws(() => resolve(entries('a/catalog.json','b/manifest.json')), /separately/));
test('ignores Mac resource metadata', () => assert.equal(catalog('__MACOSX/x/catalog.json','x/catalog.json','.DS_Store').prefix,'x/'));
test('rejects empty selection', () => assert.throws(() => resolve([]), /empty/));
test('routes plain PDFs to the actual file importer instead of asking for JSON', () => assert.throws(() => resolve(entries('GOER.pdf')), /Import files/));
test('safe local filenames retain hashes and spaces', () => assert.equal(safe('source/GOER IMCQ #1.pdf'),'source/GOER IMCQ #1.pdf'));
test('rejects traversal, absolute paths, Windows drives and controls', () => { for (const p of ['../a','/a','a/../b','a/./b','a//b','C:/file','a\\b','a\0b','a\nb']) assert.throws(()=>safe(p)); });
test('rejects exact duplicate paths', () => assert.throws(()=>resolve(entries('catalog.json','catalog.json')),/duplicate/));
test('rejects case collisions across platforms', () => assert.throws(()=>resolve(entries('catalog.json','CATALOG.json')),/conflicting/));
test('rejects Unicode-normalization collisions', () => assert.throws(()=>resolve(entries('é/manifest.json','e\u0301/manifest.json')),/duplicate/));
test('rejects invalid or oversized declared lengths', () => { for (const byteSize of [-1,NaN,Infinity,1.1,MAX+1]) assert.throws(()=>resolve([{path:'catalog.json',byteSize}])); });
test('rejects too many files before reading bytes', () => assert.throws(()=>resolve(Array.from({length:30001},(_,i)=>({path:`f${i}`,byteSize:0}))),/too many/));
test('rejects expanded total even when each file is allowed', () => assert.throws(()=>resolve(Array.from({length:17},(_,i)=>({path:`f${i}`,byteSize:MAX}))),/expanded/));
