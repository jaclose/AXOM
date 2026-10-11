import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { CURRICULA } from "../../src/lib/curricula";
import { parseCourseTemplate } from "../../src/lib/course-engine/templateParse";
import { moduleKey } from "../../src/lib/course-engine/vocabulary";
import { readManifest, readQuestionsFile } from "../../src/lib/question-content/packageJson";
import { assessBank } from "../../src/lib/question-content/assessBank";
import { readImageInfo } from "../../src/lib/question-content/assets";
import { blocksToPlainText } from "../../src/lib/question-content/blocks";
import { parseCloudBank, assertPublishedBank } from "../../src/lib/cloudLibrary/content";
import { parseEntry, parseCatalogFile, MAX_CATALOG_FILE_BYTES, type CatalogEntry, type CatalogFile } from "../../src/lib/cloudLibrary/model";
import type { PrivateLibraryCatalog, PreparedBank } from "../../src/lib/privateLibrary/types";
import type { PackageIssue } from "../../src/lib/question-content/package";

export interface PublicationApproval {
  catalogKey: string; version: string; title: string;
  audience: "public" | "authenticated" | "restricted";
  rightsReference: string; readerIds: string[]; sourceChecksums: string[];
}
export interface PublishPlan {
  format: "axom-academic-publish-plan"; schemaVersion: 1;
  release: { id: string; catalog_key: string; version: string; title: string; audience: PublicationApproval["audience"];
    rights_reference: string; manifest_sha256: string; expected_entries: number; expected_files: number };
  readerIds: string[]; entries: CatalogEntry[]; files: CatalogFile[];
  coverage: Array<{ checksum: string; name: string; state: "ready" | "held" | "not-approved"; ready: number; held: number; reason?: string }>;
}
export const hashBytes = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const label = (value: string) => basename(value.replace(/\\/g, "/"));
export function validateApproval(value: unknown): PublicationApproval {
  const a = value as PublicationApproval;
  if (!a || !/^[a-zA-Z0-9_-]{1,100}$/.test(a.catalogKey) || typeof a.version !== "string" || !a.version.trim() || a.version.length > 100
    || typeof a.title !== "string" || !a.title.trim() || a.title.length > 240
    || !["public","authenticated","restricted"].includes(a.audience)
    || typeof a.rightsReference !== "string" || !a.rightsReference.trim() || a.rightsReference.length > 1000
    || !Array.isArray(a.readerIds) || a.readerIds.some(id => !uuid.test(id))
    || !Array.isArray(a.sourceChecksums) || !a.sourceChecksums.length || a.sourceChecksums.some(id => !hex.test(id))) throw new Error("Provide an explicit audience, rights reference and approved source checksums. No implicit publication approval.");
  if (a.audience === "restricted" && !a.readerIds.length) throw new Error("Restricted content needs at least one authorized reader.");
  return { ...a, readerIds: [...new Set(a.readerIds)].sort(), sourceChecksums: [...new Set(a.sourceChecksums)].sort() };
}
function stableReleaseId(key: string, version: string): string {
  const h = hashBytes(JSON.stringify([key,version]));
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function readWithin(root: string, path: string, limit = MAX_CATALOG_FILE_BYTES): Promise<Uint8Array> {
  if (!path || isAbsolute(path) || /[\\\x00-\x1f]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error("Unsafe source path.");
  const base = await realpath(root), target = await realpath(resolve(base, path));
  const rel = relative(base, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Source path escapes the approved directory.");
  const info = await stat(target);
  if (!info.isFile() || info.size < 1 || info.size > limit) throw new Error("Source file exceeds the supported bound or is not a file.");
  const bytes = new Uint8Array(await readFile(target));
  if (bytes.length > limit) throw new Error("Source changed during reading.");
  return bytes;
}

/** No extraction, AI calls, uploads, personal workspace records, or source mutation.
 * Reuses the existing prepared collection and publishes only approved ready content. */
export async function preparePublication(sourceRoot: string, outputRoot: string, input: unknown): Promise<PublishPlan> {
  const approval = validateApproval(input), root = await realpath(sourceRoot), output = resolve(outputRoot);
  const rel = relative(root, output);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("Publication output must not be inside the source collection.");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const rawCatalog = JSON.parse(new TextDecoder().decode(await readWithin(root,"catalog.json"))) as PrivateLibraryCatalog;
  if (rawCatalog.format !== "axom-private-library" || rawCatalog.schemaVersion !== 1 || !Array.isArray(rawCatalog.templates) || !Array.isArray(rawCatalog.sources)) throw new Error("Unsupported prepared collection.");
  const releaseId = stableReleaseId(approval.catalogKey, approval.version), approved = new Set(approval.sourceChecksums);
  const files = new Map<string, CatalogFile>(), entries: CatalogEntry[] = [], coverage: PublishPlan["coverage"] = [];
  async function put(path: string, bytes: Uint8Array, mime: string) {
    const row = parseCatalogFile({ release_id: releaseId, path, storage_path: `${releaseId}/${path}`, sha256: hashBytes(bytes), byte_size: bytes.length, mime_type: mime });
    const target = resolve(output, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const actualParent = await realpath(dirname(target)), relativeParent = relative(await realpath(output), actualParent);
    if (relativeParent.startsWith("..") || isAbsolute(relativeParent)) throw new Error("Output directory escapes the private package.");
    try { await writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      if (hashBytes(await readWithin(output,path)) !== row.sha256) throw new Error("Output has different content. Use a new version/output folder rather than overwriting it.");
    }
    files.set(path,row); return path;
  }
  for (const template of rawCatalog.templates) {
    if (!approved.has(template.checksum)) { coverage.push({ checksum: template.checksum, name: label(template.name), state: "not-approved", ready: 0, held: 0 }); continue; }
    try {
      const bytes = await readWithin(root,template.file);
      if (hashBytes(bytes) !== template.checksum) throw new Error("Template checksum mismatch.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), name = label(template.name), section = parseCourseTemplate(text,name);
      const terms = new Set(CURRICULA.flatMap(c => c.terms.flatMap(t => t.courses.some(course => course.modules.some(m => moduleKey(m) === moduleKey(section.module))) ? [t.name] : [])));
      const term = section.term ?? (terms.size === 1 ? [...terms][0] : undefined);
      if (!term || !section.items.length || section.problems.length) throw new Error("Template term, activities or unreadable lines need review.");
      const path = await put(`templates/${template.checksum}.txt`,bytes,"text/plain");
      entries.push(parseEntry({ release_id: releaseId, id: `template-${template.checksum}`, kind: "template", title: `${section.module} · ${section.title || "Course activities"}`,
        module: section.module, term, week: null, question_count: 0, image_question_count: 0, activity_count: section.items.length, payload_path: path, source_label: name }));
      coverage.push({ checksum: template.checksum, name, state: "ready", ready: section.items.length, held: 0 });
    } catch (cause) { coverage.push({ checksum: template.checksum, name: label(template.name), state: "held", ready: 0, held: 1, reason: cause instanceof Error ? cause.message : "Template preparation failed." }); }
  }
  for (const source of rawCatalog.sources) {
    if (!source.bankFile || source.status === "duplicate-linked") continue;
    if (!approved.has(source.checksum)) { coverage.push({ checksum: source.checksum, name: label(source.name), state: "not-approved", ready: 0, held: source.review }); continue; }
    try {
      const b = JSON.parse(new TextDecoder().decode(await readWithin(root,source.bankFile,128 * 1024 * 1024))) as PreparedBank;
      const issues: PackageIssue[] = [];
      const manifest = readManifest(b?.pkg?.manifest,issues);
      const parsed = readQuestionsFile({ schemaVersion: 1, bankId: manifest?.bank.id, questions: b?.pkg?.questions },issues);
      if (!manifest || !parsed || !Array.isArray(b.issues)) throw new Error("Prepared bank cannot be read.");
      const allIssues = [...b.issues,...issues], pkg = { manifest, questions: parsed.questions };
      const initial = assessBank(pkg,allIssues,pkg.questions.flatMap(q => q.assets.map(a => ({name:a.filename}))));
      const candidates = pkg.questions.filter(q => initial.verdicts.get(q.id)?.readiness === "ready");
      const accepted = [], media = new Map<string, { bytes: Uint8Array; mime: string }>();
      for (const original of candidates) {
        const q = structuredClone(original), staged = new Map<string, { bytes: Uint8Array; mime: string }>();
        try {
          for (const asset of q.assets) {
            if (!asset.checksum || !hex.test(asset.checksum.replace(/^sha256:/,""))) throw new Error("Image checksum missing.");
            const bytes = await readWithin(root,`${source.bankFile.slice(0,source.bankFile.lastIndexOf("/"))}/assets/${asset.filename}`,8*1024*1024);
            const image = readImageInfo(bytes), sha = hashBytes(bytes);
            if (!image || sha !== asset.checksum.replace(/^sha256:/,"")) throw new Error("Image integrity failed.");
            const ext = {"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"}[image.mimeType];
            if (!ext) throw new Error("Unsupported image type.");
            asset.filename = `${sha}.${ext}`; asset.mimeType = image.mimeType;
            asset.sourceFile = asset.sourceFile ? label(asset.sourceFile) : undefined;
            staged.set(asset.filename,{bytes,mime:image.mimeType});
          }
          q.source.filename = label(q.source.filename);
          accepted.push(q); for (const [name,data] of staged) media.set(name,data);
        } catch { /* Only this question is held; never fabricate an image or bypass readiness. */ }
      }
      if (!accepted.length) { coverage.push({checksum:source.checksum,name:label(source.name),state:"held",ready:0,held:pkg.questions.length,reason:"No fully validated ready questions."}); continue; }
      const ids = new Set(accepted.map(q => q.id));
      const bank: PreparedBank = { pkg: { manifest: { ...manifest, source: {...manifest.source,filename:label(manifest.source.filename)}, questionsFile:"bank.json", assetsDirectory:"assets" }, questions:accepted },
        issues: allIssues.filter(i => !i.questionId || ids.has(i.questionId)),
        sourceText: { rawText: accepted.map(q => [`Question ${q.source.questionNumber ?? q.id}`,blocksToPlainText(q.stem),...q.choices.map(c => `${c.label}. ${blocksToPlainText(c.blocks)}`),...(q.explanation ? [blocksToPlainText(q.explanation)] : [])].join("\n")).join("\n\n") },
        sourceBytes: b.sourceBytes, notes: ["Published ready subset; held candidates and full original documents are not included."] };
      const base = `banks/${source.checksum}`;
      const entry = parseEntry({release_id:releaseId,id:`bank-${source.checksum}`,kind:"bank",title:manifest.bank.title,module:manifest.course.name,term:`Term ${manifest.course.term}`,week:manifest.course.week,
        question_count:accepted.length,image_question_count:accepted.filter(q=>q.assets.length>0).length,activity_count:0,payload_path:`${base}/bank.json`,source_label:label(source.name)});
      assertPublishedBank(entry,parseCloudBank(bank),[...media.keys()].map(name=>({name})));
      for (const [name,file] of media) await put(`${base}/assets/${name}`,file.bytes,file.mime);
      await put(entry.payload_path,new TextEncoder().encode(JSON.stringify(bank)),"application/json"); entries.push(entry);
      coverage.push({checksum:source.checksum,name:label(source.name),state:"ready",ready:accepted.length,held:pkg.questions.length-accepted.length+(b.unreadableQuestions??0)});
    } catch (cause) { coverage.push({checksum:source.checksum,name:label(source.name),state:"held",ready:0,held:source.ready+source.review,reason:cause instanceof Error?cause.message:"Bank preparation failed."}); }
  }
  const uniqueEntries = [...new Map(entries.map(e=>[e.id,e])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  // Only complete entries and their successful bank assets are publication members.
  const bankRoots = uniqueEntries.filter(e=>e.kind==='bank').map(e=>e.payload_path.slice(0,e.payload_path.lastIndexOf('/')+1));
  const payloads = new Set(uniqueEntries.map(e=>e.payload_path));
  const completeFiles = [...files.values()].filter(f=>payloads.has(f.path)||bankRoots.some(base=>f.path.startsWith(`${base}assets/`))).sort((a,b)=>a.path.localeCompare(b.path));
  if (!uniqueEntries.length) throw new Error("No approved, ready content can be published. Check the source/answer/publication review queue.");
  const fingerprint = hashBytes(JSON.stringify({approval,entries:uniqueEntries,files:completeFiles}));
  const plan: PublishPlan = {format:"axom-academic-publish-plan",schemaVersion:1,
    release:{id:releaseId,catalog_key:approval.catalogKey,version:approval.version,title:approval.title,audience:approval.audience,rights_reference:approval.rightsReference,manifest_sha256:fingerprint,expected_entries:uniqueEntries.length,expected_files:completeFiles.length},
    readerIds:approval.readerIds,entries:uniqueEntries,files:completeFiles,coverage};
  const bytes = new TextEncoder().encode(JSON.stringify(plan,null,2)+"\n");
  try { await writeFile(resolve(output,"publish-plan.json"),bytes,{flag:"wx",mode:0o600}); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code!=="EEXIST") throw cause; const previous=JSON.parse(new TextDecoder().decode(await readWithin(output,"publish-plan.json"))); if(previous.release?.manifest_sha256!==fingerprint) throw new Error("This publication version already has a different plan. Use a new version/output folder."); }
  return plan;
}
