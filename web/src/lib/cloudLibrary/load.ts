import { useStore } from "../store";
import { prepareCourseTemplate } from "../course-engine/templateLibrary";
import { parseCourseTemplate } from "../course-engine/templateParse";
import { moduleKey } from "../course-engine/vocabulary";
import { loadPreparedCourse, withPreparedCourses } from "../bookshelf/preparedCourses";
import { buildCourseBooks } from "../bookshelf/courseBooks";
import { CURRICULA } from "../curricula";
import { readPreparedBank } from "../privateLibrary/install";
import { readImageInfo, sha256 } from "../question-content/assets";
import { saveBank } from "../question-content/bankImport";
import type { ReviewedImportStore } from "../questionImportSave";
import { assessBank } from "../question-content/assessBank";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import type { PracticeSelection } from "../bookshelf/questionBankBooks";
import type { CatalogCourse, CatalogEntry } from "./model";
import { catalogClient, readCloudFile } from "./client";
const decode=(bytes:Uint8Array)=>new TextDecoder("utf-8",{fatal:true}).decode(bytes);
let activeLoad:Promise<unknown>|undefined;
async function exclusively<T>(work:()=>Promise<T>):Promise<T> {
  if(activeLoad)throw new Error("Another course or quiz is being prepared. Wait for it to finish.");
  const run=work();activeLoad=run;
  try{return await run;}finally{if(activeLoad===run)activeLoad=undefined;}
}
async function sessionGuard(signal:AbortSignal) {
  const client=await catalogClient(), initial=await client.auth.getSession();
  if(initial.error)throw new Error("Your account session could not be verified.");
  const id=initial.data.session?.user.id??null;
  let changed=false;
  const subscription=client.auth.onAuthStateChange((_event,next)=>{if((next?.user.id??null)!==id)changed=true;});
  const assert=()=>{signal.throwIfAborted();if(changed)throw new Error("The signed-in account changed. Restart this action in the intended account.");};
  return {assert,close:()=>subscription.data.subscription.unsubscribe(),verify:async()=>{
    assert();const latest=await client.auth.getSession();
    if(latest.error || (latest.data.session?.user.id??null)!==id)changed=true;
    assert();
  }};
}
function guardedStore(assert:()=>void):ReviewedImportStore {
  const state=useStore.getState();
  return new Proxy(state,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);
    return typeof value==="function" ? (...args:unknown[])=>{assert();return Reflect.apply(value,target,args);} : value;
  }});
}
/** Explicit course activation. Merely browsing the shared catalog never enrolls a learner. */
export function loadCloudCourse(course:CatalogCourse,signal:AbortSignal):Promise<string> {
  return exclusively(async()=>{
    const templates=course.entries.filter(e=>e.kind==="template");
    if(!templates.length)throw new Error("This course has no published template yet.");
    const guard=await sessionGuard(signal);
    try {
      const documents=[];
      for(const entry of templates) {
        const raw=decode(await readCloudFile(entry.release_id,entry.payload_path,signal));
        const section=parseCourseTemplate(raw,entry.source_label);
        if(moduleKey(section.module)!==moduleKey(entry.module) || (section.term && moduleKey(section.term)!==moduleKey(entry.term))
          || section.items.length!==entry.activity_count || section.problems.length)throw new Error("Published template metadata does not match its activities. Publisher review is required.");
        documents.push(await prepareCourseTemplate(raw,entry.source_label));
      }
      await guard.verify();const checkpoint=getVaultWriteCheckpoint();
      for(const document of documents){guard.assert();const state=useStore.getState();if(!state.documents.some(d=>d.id===document.id))state.addDocument(document);}
      await flushLocalVaultWrites();assertVaultWritesSince(checkpoint);guard.assert();
      const s=useStore.getState();
      const books=withPreparedCourses(buildCourseBooks({terms:s.terms,courses:s.courses,tracker:s.tracker,questions:s.questions,sets:s.questionSets,curricula:CURRICULA}),s.documents,s.tracker);
      const ids=new Set(documents.map(d=>d.id));
      const matches=books.filter(b=>moduleKey(b.term)===moduleKey(course.term) && moduleKey(b.module)===moduleKey(course.module) && b.templateIds?.some(id=>ids.has(id)));
      if(matches.length!==1)throw new Error("The published course scope needs review. Its template is saved; use Customize Weeks & Activities rather than guessing a term.");
      await guard.verify();const result=await loadPreparedCourse(matches[0],guard.assert);guard.assert();
      if(result.status==="failed")throw new Error(result.message||"The course could not be saved.");
      return result.status==="nothing-to-save" ? "This course is already in your tracker. Progress was preserved." : "Course loaded. Your progress is saved on this device.";
    } finally {guard.close();}
  });
}
/** Reuse canonical import, assets and attempts. Download only the requested banks. */
export function prepareCloudQuiz(input:readonly CatalogEntry[],wanted:number,signal:AbortSignal):Promise<PracticeSelection> {
  return exclusively(async()=>{
    const entries=[...new Map(input.map(e=>[`${e.release_id}:${e.id}`,e])).values()];
    if(!entries.length || entries.some(e=>e.kind!=="bank"))throw new Error("Select at least one question set.");
    if(entries.length>50)throw new Error("Select up to 50 collections per preparation. Already saved sets can be combined afterward.");
    if(!Number.isSafeInteger(wanted)||wanted<1||wanted>500)throw new Error("Choose between 1 and 500 questions.");
    const module=entries[0].module,term=entries[0].term;
    if(entries.some(e=>e.module!==module||e.term!==term))throw new Error("Use one course scope for this quiz. Cross-course mixing is available from your saved sets.");
    const guard=await sessionGuard(signal);
    try {
      const prepared=[];let totalBytes=0;
      for(const entry of entries) {
        const read=async(path:string)=>{
          guard.assert();const bytes=await readCloudFile(entry.release_id,path,signal);totalBytes+=bytes.length;
          if(totalBytes>128*1024*1024)throw new Error("This selection is too large to prepare at once. Choose fewer sets; your library is unchanged.");
          return bytes;
        };
        const bank=readPreparedBank(JSON.parse(decode(await read(entry.payload_path))));
        if(moduleKey(bank.pkg.manifest.course.name)!==moduleKey(module) || `Term ${bank.pkg.manifest.course.term}`!==term || bank.pkg.manifest.course.week!==entry.week)throw new Error("Published question scope does not match its catalog entry.");
        const files:File[]=[],byName=new Map<string,string>();
        for(const asset of new Map(bank.pkg.questions.flatMap(q=>q.assets).map(a=>[a.id,a])).values()) {
          if(!asset.checksum)throw new Error("A published image is missing its checksum.");
          const old=byName.get(asset.filename);if(old&&old!==asset.checksum)throw new Error("Ambiguous image filenames require publisher review.");if(old)continue;
          byName.set(asset.filename,asset.checksum);
          const bytes=await read(`${entry.payload_path.slice(0,entry.payload_path.lastIndexOf("/"))}/assets/${asset.filename}`),image=readImageInfo(bytes);
          if(!image||bytes.length>8*1024*1024||(image.width??0)*(image.height??0)>64000000||(await sha256(bytes)).replace(/^sha256:/,"")!==asset.checksum.replace(/^sha256:/,""))throw new Error("Published image validation failed.");
          files.push(new File([new Uint8Array(bytes).buffer],asset.filename,{type:image.mimeType}));
        }
        const assessment=assessBank(bank.pkg,bank.issues,files);
        if(assessment.counts.ready!==entry.question_count||assessment.counts.ready!==bank.pkg.questions.length)throw new Error("Published question readiness changed. This set needs publisher review.");
        prepared.push({bank,files,assessment});
      }
      const setIds=new Set<string>(),questionIds=new Set<string>();
      const checkpoint=getVaultWriteCheckpoint();
      for(const{bank,files,assessment}of prepared) {
        await guard.verify();
        const result=await saveBank(bank.pkg,assessment.issues,files,{
          library:()=>{guard.assert();return useStore.getState();},store:()=>{guard.assert();return guardedStore(guard.assert);},
        },{sourceText:bank.sourceText,sourceBytes:bank.sourceBytes,notes:bank.notes});
        if(result.status==="failed")throw new Error("The selected set could not be saved. Previously saved content and progress remain intact.");
        for(const section of result.sections){if(section.setId)setIds.add(section.setId);for(const id of section.savedIds)questionIds.add(id);}
      }
      await guard.verify();await flushLocalVaultWrites();assertVaultWritesSince(checkpoint);
      if(!setIds.size||!questionIds.size)throw new Error("No verified questions are available from this selection.");
      const week=entries.every(e=>e.week===entries[0].week)?entries[0].week:null;
      return{module,...(week!=null?{week}:{}),setIds:[...setIds],count:Math.min(wanted,questionIds.size)};
    } finally {guard.close();}
  });
}
