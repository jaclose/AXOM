// @vitest-environment node
import { test } from "vitest";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { indexLibraryZip as index } from "./zipIndex";
async function zip(paths=['catalog.json']) { const z=new JSZip(); for(const p of paths) z.file(p,'{}',{createFolders:false}); return z.generateAsync({type:'uint8array',compression:'DEFLATE'}); }
function central(b: Uint8Array) {const v=new DataView(b.buffer,b.byteOffset,b.byteLength); return v.getUint32(b.length-6,true);}
test('indexes a root catalog in a real deflated ZIP',async()=>assert.equal(index(await zip())[0].path,'catalog.json'));
test('recognizes nested library with UTF-8 names',async()=>assert.equal(index(await zip(['é/catalog.json','é/source/Quiz #1.pdf'])).length,2));
test('recognizes multi-bank original format without catalog',async()=>assert.equal(index(await zip(['root/a/manifest.json','root/b/manifest.json'])).length,2));
test('accepts directory entries',async()=>{const z=new JSZip(); z.file('root/catalog.json','{}'); assert.equal(index(await z.generateAsync({type:'uint8array'})).length,1);});
test('rejects all truncated prefixes safely',async()=>{const b=await zip(); for(let i=0;i<b.length;i++) assert.throws(()=>index(b.subarray(0,i)));});
test('rejects duplicate file names before JSZip overwrites them',async()=>{const b=await zip(['catalog.json','catAlog.json']); const text=Buffer.from(b).toString('latin1').replaceAll('catAlog.json','catalog.json'); assert.throws(()=>index(Uint8Array.from(Buffer.from(text,'latin1'))),/duplicate/);});
test('rejects case collisions',async()=>assert.rejects(async()=>index(await zip(['catalog.json','CATALOG.json'])),/conflicting/));
test('rejects traversal even though JSZip normally sanitizes it',async()=>assert.rejects(async()=>index(await zip(['../catalog.json'])),/unsafe/));
test('rejects changed local vs central filenames',async()=>{const b=await zip(); b[30]=65; assert.throws(()=>index(b),/unsupported/);});
test('rejects encrypted flags',async()=>{const b=await zip(); b[central(b)+8]|=1; assert.throws(()=>index(b),/unsupported/);});
test('rejects ZIP64 sentinel and guides folder selection',async()=>{const b=await zip(); new DataView(b.buffer).setUint32(central(b)+24,0xffffffff,true); assert.throws(()=>index(b),/folder/);});
test('rejects oversized declared expansion before inflate',async()=>{const b=await zip(); new DataView(b.buffer).setUint32(central(b)+24,200*1024*1024,true); assert.throws(()=>index(b),/size/);});
test('rejects symlink entries',async()=>{const b=await zip(); new DataView(b.buffer).setUint32(central(b)+38,0xa1ff0000,true); assert.throws(()=>index(b),/unsupported/);});
test('rejects a PDF renamed zip',()=>assert.throws(()=>index(new TextEncoder().encode('%PDF-1.7 bad zipped filename')),/unsupported/));
