import { createHash } from "node:crypto";
import { readManifest, readQuestionsFile } from "../../src/lib/question-content/packageJson";
import { assessBank } from "../../src/lib/question-content/assessBank";
import { readImageInfo } from "../../src/lib/question-content/assets";
import type { PackageIssue, PackageQuestion } from "../../src/lib/question-content/package";
import type { PreparedBank, PrivateLibraryCatalog } from "../../src/lib/privateLibrary/types";
import { parseCourseTemplate } from "../../src/lib/course-engine/templateParse";
import { moduleKey } from "../../src/lib/course-engine/vocabulary";
import { CURRICULA } from "../../src/lib/curricula";
import { MAX_CATALOG_FILE_BYTES, safeCatalogPath, parseEntry, parseCatalogFile, type CatalogEntry, type CatalogFile } from "../../src/lib/cloudLibrary/model";

export type Audience = "public" | "authenticated" | "restricted";
type Entry = Omit<CatalogEntry, "release_id">;
type FileRow = Omit<CatalogFile, "release_id" | "storage_path">;
export interface PlanBody {
  format: "axom-shared-publication"; schemaVersion: 1;
  catalog_key: string; version: string; title: string; audience: Audience;
  rights_reference: string; grant_user_ids: string[]; entries: Entry[]; files: FileRow[];
}
export interface PublicationPlan { body: PlanBody; release_id: string; manifest_sha256: string; }
export interface CoverageRow { source: string; status: "ready" | "held" | "duplicate" | "excluded"; questions?: number; reason?: string; }
export interface PrepareOptions { catalogKey: string; version: string; title: string; audience: Audience; rightsReference: string; grantUserIds?: string[]; }
export interface PreparationIO { read: (path: string) => Promise<Uint8Array>; write: (path: string, bytes: Uint8Array) => Promise<void>; }
export const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const leaf = (name: string) => name.replace(/\\/g,"/").split("/").pop() || "source";
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function releaseId(hash: string): string { const h = hash.slice(0,32).split(""); h[12]="8"; h[16]="8"; const s=h.join(""); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }
function canonicalBody(body: PlanBody): PlanBody {
  return { format: "axom-shared-publication", schemaVersion: 1, catalog_key: body.catalog_key, version: body.version,
    title: body.title, audience: body.audience, rights_reference: body.rights_reference,
    grant_user_ids: [...new Set(body.grant_user_ids)].sort(), entries: [...body.entries].sort((a,b)=>a.id.localeCompare(b.id)), files: [...body.files].sort((a,b)=>a.path.localeCompare(b.path)) };
}
export function sealPlan(body: PlanBody): PublicationPlan {
  const canonical = canonicalBody(body), sha = digest(JSON.stringify(canonical));
  return { body: canonical, release_id: releaseId(sha), manifest_sha256: sha };
}
export function validatePlan(value: unknown): PublicationPlan {
  const p = value as PublicationPlan;
  if (!p || p.body?.format !== "axom-shared-publication" || p.body.schemaVersion !== 1 || !Array.isArray(p.body.entries)
      || !Array.isArray(p.body.files) || !Array.isArray(p.body.grant_user_ids)) throw new Error("Unsupported publication plan.");
  const b = p.body;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(b.catalog_key) || typeof b.version !== "string" || !b.version.trim() || b.version.length>100
      || typeof b.title !== "string" || !b.title.trim() || b.title.length>240 || typeof b.rights_reference !== "string"
      || !b.rights_reference.trim() || b.rights_reference.length>1000 || !["public","authenticated","restricted"].includes(b.audience)
      || b.grant_user_ids.some(id=>typeof id !== "string" || !uuid.test(id)) || (b.audience === "restricted" && !b.grant_user_ids.length)) throw new Error("A reviewed audience and rights reference are required.");
  if (!b.entries.length || b.entries.length>10000 || !b.files.length || b.files.length>30000) throw new Error("Invalid publication size.");
  const sealed = sealPlan(b);
  if (sealed.release_id !== p.release_id || sealed.manifest_sha256 !== p.manifest_sha256) throw new Error("The publication plan changed. Prepare and review it again.");
  const paths = new Set<string>(), ids = new Set<string>();
  for (const f of b.files) { parseCatalogFile({ ...f, release_id: p.release_id, storage_path: `${p.release_id}/${f.path}` }); if (paths.has(f.path)) throw new Error("Duplicate asset path."); paths.add(f.path); }
  for (const e of b.entries) { parseEntry({ ...e, release_id:p.release_id }); if (ids.has(e.id) || !paths.has(e.payload_path)) throw new Error("Duplicate entry or missing payload."); ids.add(e.id); }
  return sealed;
}
function courseTerm(module: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const terms = new Set(CURRICULA.flatMap(c=>c.terms.flatMap(t=>t.courses.some(course=>course.modules.some(m=>moduleKey(m)===moduleKey(module))) ? [t.name] : [])));
  return terms.size===1 ? [...terms][0] : undefined;
}
function readBank(bytes: Uint8Array): PreparedBank {
  const input = JSON.parse(decode(bytes)) as PreparedBank, issues: PackageIssue[] = [];
  const manifest = readManifest(input?.pkg?.manifest, issues);
  const questions = readQuestionsFile({ schemaVersion: 1, bankId: manifest?.bank.id, questions: input?.pkg?.questions }, issues);
  if (!manifest || !questions || !Array.isArray(input.issues) || issues.some(i=>i.severity === "error" && !i.questionId)) throw new Error("Bank structure requires review.");
  return { ...input, pkg: { manifest, questions: questions.questions }, issues: [...input.issues,...issues] };
}
/** Build only verified selected content. No network access and no learner state. */
export async function preparePublication(io: PreparationIO, options: PrepareOptions): Promise<{ plan: PublicationPlan; coverage: CoverageRow[] }> {
  const catalog = JSON.parse(decode(await io.read("catalog.json"))) as PrivateLibraryCatalog;
  if (catalog?.format !== "axom-private-library" || catalog.schemaVersion!==1 || !Array.isArray(catalog.templates) || !Array.isArray(catalog.sources)
      || catalog.templates.length>10000 || catalog.sources.length>10000) throw new Error("Unsupported prepared collection.");
  const files = new Map<string, FileRow>(), entries = new Map<string, Entry>(), coverage: CoverageRow[] = [];
  const put = async (path: string, bytes: Uint8Array, mime: string) => {
    safeCatalogPath(path);
    if (!bytes.length || bytes.length>MAX_CATALOG_FILE_BYTES) throw new Error("A publication file exceeds the bounded file size; split or review this source.");
    const sha256 = digest(bytes), old = files.get(path);
    if (old && old.sha256!==sha256) throw new Error("Conflicting publication assets.");
    if (!old) await io.write(path, bytes);
    files.set(path, { path, sha256, byte_size: bytes.length, mime_type: mime });
  };
  for (const item of catalog.templates) {
    try {
      const bytes = await io.read(safeCatalogPath(item.file));
      if (digest(bytes)!==item.checksum) throw new Error("Template checksum mismatch.");
      const section = parseCourseTemplate(decode(bytes),leaf(item.name)), term = courseTerm(section.module, section.term);
      if (!section.items.length || section.problems.length || !term) throw new Error("Template activities or course/term mapping need review.");
      const path = `templates/${item.checksum}.txt`, id = `template-${item.checksum}`;
      await put(path,bytes,"text/plain");
      entries.set(id,{ id,kind:"template",title:`${section.module} · ${section.title || "Course activities"}`,module:section.module,term,week:null,
        question_count:0,image_question_count:0,activity_count:section.items.length,payload_path:path,source_label:leaf(item.name) });
      coverage.push({ source:leaf(item.name),status:"ready" });
    } catch(error) { coverage.push({ source:leaf(item.name),status:"held",reason:error instanceof Error?error.message:"Template preparation failed." }); }
  }
  for (const source of catalog.sources) {
    if (source.status === "duplicate-linked") { coverage.push({source:leaf(source.name),status:"duplicate"}); continue; }
    if (!source.bankFile) { coverage.push({source:leaf(source.name),status:"excluded",reason:source.status}); continue; }
    try {
      const path = safeCatalogPath(source.bankFile), bank = readBank(await io.read(path));
      const names = bank.pkg.questions.flatMap(q=>q.assets.map(a=>({name:a.filename})));
      const assessment = assessBank(bank.pkg,bank.issues,names), accepted: PackageQuestion[] = [];
      if (assessment.issues.some(i=>i.severity==="error" && !i.questionId)) throw new Error("Bank-level validation failed.");
      if (!/^[a-f0-9]{64}$/.test(source.checksum)) throw new Error("Source checksum is missing.");
      const base = `banks/${source.checksum}`, originalBase = path.slice(0,path.lastIndexOf("/"));
      for (const question of bank.pkg.questions) {
        if (assessment.verdicts.get(question.id)?.readiness!=="ready") continue;
        try {
          const q = structuredClone(question), pending: {path:string;bytes:Uint8Array;mime:string}[] = [];
          for (const asset of q.assets) {
            const bytes = await io.read(safeCatalogPath(`${originalBase}/assets/${asset.filename}`)), image = readImageInfo(bytes), sha = digest(bytes);
            if (!image || bytes.length>8*1024*1024 || (asset.checksum && asset.checksum.replace(/^sha256:/,"")!==sha)) throw new Error("Missing or damaged source image.");
            const extension = ({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"} as Record<string,string>)[image.mimeType];
            if (!extension) throw new Error("Unsupported source image type.");
            asset.filename = `${sha}.${extension}`; asset.checksum=`sha256:${sha}`; asset.mimeType=image.mimeType; asset.byteSize=bytes.length;
            if (asset.sourceFile) asset.sourceFile=leaf(asset.sourceFile);
            pending.push({path:`${base}/assets/${asset.filename}`,bytes,mime:image.mimeType});
          }
          q.source.filename=leaf(q.source.filename);
          // Do not copy local paths or arbitrary source-processing notes to the platform.
          q.provenance={method:q.provenance.method,sourceChecksum:q.provenance.sourceChecksum ?? `sha256:${source.checksum}`,
            ...(q.provenance.tool?{tool:q.provenance.tool}:{}),...(q.provenance.createdAt?{createdAt:q.provenance.createdAt}:{})};
          for (const file of pending) await put(file.path,file.bytes,file.mime);
          accepted.push(q);
        } catch { /* This candidate remains held; verified siblings may still publish. */ }
      }
      if (!accepted.length) { coverage.push({source:leaf(source.name),status:"held",questions:0,reason:"No questions passed source-key and asset validation."}); continue; }
      const acceptedIds=new Set(accepted.map(q=>q.id));
      const manifest=structuredClone(bank.pkg.manifest); manifest.source.filename=leaf(manifest.source.filename);
      const pkg={manifest,questions:accepted};
      const issues=assessment.issues.filter(i=>!i.questionId || acceptedIds.has(i.questionId));
      const reassessed=assessBank(pkg,issues,accepted.flatMap(q=>q.assets.map(a=>({name:a.filename}))));
      if (reassessed.counts.ready!==accepted.length) throw new Error("Filtered publication did not retain question readiness.");
      // Decode can trace these verified excerpts. Full original documents are not uploaded here.
      const rawText=accepted.map(q=>`Source: ${q.source.filename}${q.source.page?` page ${q.source.page}`:""}\n${q.stem.map(b=>b.type==="text"?b.text:"").filter(Boolean).join("\n")}`).join("\n\n");
      const payload: PreparedBank={pkg,issues,sourceText:{rawText},sourceBytes:new TextEncoder().encode(rawText).length,notes:["Published verified excerpts. Original document remains with its publisher."]};
      const payloadPath=`${base}/bank.json`, id=`bank-${source.checksum}`;
      await put(payloadPath,encode(payload),"application/json");
      entries.set(id,{id,kind:"bank",title:manifest.bank.title,module:manifest.course.name,term:`Term ${manifest.course.term}`,week:manifest.course.week,
        question_count:accepted.length,image_question_count:accepted.filter(q=>q.assets.some(a=>["question","stem","choice"].includes(a.role))).length,
        activity_count:0,payload_path:payloadPath,source_label:leaf(source.name)});
      coverage.push({source:leaf(source.name),status:"ready",questions:accepted.length,reason:accepted.length<bank.pkg.questions.length?`${bank.pkg.questions.length-accepted.length} other candidates remain held.`:undefined});
    } catch(error) { coverage.push({source:leaf(source.name),status:"held",reason:error instanceof Error?error.message:"Bank preparation failed."}); }
  }
  const body:PlanBody={format:"axom-shared-publication",schemaVersion:1,catalog_key:options.catalogKey,version:options.version,title:options.title,
    audience:options.audience,rights_reference:options.rightsReference,grant_user_ids:options.grantUserIds??[],entries:[...entries.values()],files:[...files.values()]};
  const plan=validatePlan(sealPlan(body));
  await io.write("publication-plan.json",encode(plan));
  await io.write("publication-coverage.json",encode(coverage));
  return {plan,coverage};
}
