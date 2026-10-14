// @vitest-environment jsdom
// One-off, local-only integration test. Isolated Vitest workspace, never the
// user's running AXOM desktop process or authenticated cloud account.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { File as NativeFile, Blob as NativeBlob } from "node:buffer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { openEmptyWorkspace, closeWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { installPrivateLibrary, readCatalog } from "./install";
import { PRIVATE_REVIEW_DOCUMENT, PRIVATE_LIBRARY_DOCUMENT } from "./types";
const root=join(process.cwd(),"../artifacts/qbank-6way-20261014/role-2-prepared/portable-B1");
const read=async(path:string) => new Uint8Array(readFileSync(join(root,path)));
beforeEach(async()=>{await openEmptyWorkspace(); vi.stubGlobal("File",NativeFile);vi.stubGlobal("Blob",NativeBlob);});
afterEach(async()=>{await closeWorkspace();vi.unstubAllGlobals();});
describe.skipIf(process.env.ROLE2_PRIVATE_PREPARED !== "1")("real B1 private portable package lifecycle",()=>{
it("installs all 18 source originals and review records, no unverified QBank questions",async()=>{
const catalog=readCatalog(JSON.parse(readFileSync(join(root,"catalog.json"),"utf8")));
expect(catalog.sources).toHaveLength(18);
const progress:string[]=[];
const installed=await installPrivateLibrary(read,(message)=>progress.push(message));
expect(installed.questionIds).toHaveLength(0);
expect(installed.setIds).toHaveLength(0);
const state=useStore.getState();
expect(state.questions).toHaveLength(0);
expect(state.documents.filter(doc=>doc.fileType===PRIVATE_REVIEW_DOCUMENT)).toHaveLength(18);
expect(state.documents.filter(doc=>doc.fileType===PRIVATE_LIBRARY_DOCUMENT)).toHaveLength(1);
expect(state.documents.filter(doc=>doc.id.startsWith("private-source-"))).toHaveLength(18);
await reloadWorkspace();
expect(useStore.getState().documents.filter(doc=>doc.fileType===PRIVATE_REVIEW_DOCUMENT)).toHaveLength(18);
const second=await installPrivateLibrary(read);
expect(second.questionIds).toHaveLength(0);
await reloadWorkspace();
expect(useStore.getState().documents.filter(doc=>doc.fileType===PRIVATE_REVIEW_DOCUMENT)).toHaveLength(18);
console.log("B1_LOCAL_INSTALL_RECEIPT",JSON.stringify({sourceDocuments:18,reviewDocuments:18,questionRecords:0,
 localReloadVerified:true,cloudReadbackVerified:false,attempts:2}));
});
});
