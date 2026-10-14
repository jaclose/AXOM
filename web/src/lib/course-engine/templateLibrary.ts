import { sha256Hex } from "../checksum";
import type { SourceDocument } from "../library";
import { moduleKey } from "./vocabulary";
import { parseCourseTemplate, type CourseTemplateSection } from "./templateParse";

export const COURSE_TEMPLATE_FORMAT = "axom-course-template";
export interface SavedCourseTemplate {
  document: SourceDocument;
  section: CourseTemplateSection;
}

/** Template versions use the existing document vault and travel in workspace backups. */
export async function prepareCourseTemplate(text: string, fileName: string, now = new Date().toISOString()): Promise<SourceDocument> {
  const section = parseCourseTemplate(text, fileName);
  if (!section.module || !section.items.length) throw new Error(`${fileName}: no course activities could be read. Use a module heading and one activity per line with its kind in brackets.`);
  // A partially parsed template can silently omit required work. The document
  // vault must not record it as an installable template until every input line
  // is either accounted for or explicitly repaired by the student.
  if (section.problems.length) {
    throw new Error(`${fileName}: fix ${section.problems.length} template issue${section.problems.length === 1 ? "" : "s"} before saving. ${section.problems.slice(0, 3).join(" ")}`);
  }
  const checksum = await sha256Hex(text);
  if (!checksum) throw new Error("This browser cannot identify template versions securely. Open AXOM on localhost or HTTPS and try again.");
  return {
    id: `course-template-${checksum}`, fileType: COURSE_TEMPLATE_FORMAT, fileName,
    title: `${section.term ? `${section.term} · ` : ""}${section.module} · ${section.title || "Course activities"}`,
    uploadedAt: now, rawText: text, sizeBytes: new TextEncoder().encode(text).byteLength,
    checksum, tags: ["course-template"], linkedQuestionSetIds: [], libraryOnly: true,
  };
}

export function savedCourseTemplates(documents: readonly SourceDocument[]): SavedCourseTemplate[] {
  return documents.filter((document) => document.fileType === COURSE_TEMPLATE_FORMAT && typeof document.rawText === "string")
    .map((document) => ({ document, section: parseCourseTemplate(document.rawText, document.fileName) }))
    .filter(({ section }) => section.module && section.items.length)
    .sort((a, b) => b.document.uploadedAt.localeCompare(a.document.uploadedAt) || a.document.id.localeCompare(b.document.id));
}

export function courseTemplateFamily(section: CourseTemplateSection): string {
  return `${section.term ?? ""}|${moduleKey(section.module)}|${section.title.trim().toLocaleLowerCase("en")}${section.context ? `|${section.context.academicTerm ?? ""}|${section.context.cohort ?? ""}` : ""}`;
}

export function courseTemplateVersions(templates: readonly SavedCourseTemplate[]): SavedCourseTemplate[][] {
  const groups = new Map<string, SavedCourseTemplate[]>();
  for (const template of templates) {
    const key = courseTemplateFamily(template.section);
    groups.set(key, [...(groups.get(key) ?? []), template]);
  }
  return [...groups.values()].map(versions => versions.sort((a, b) =>
    (b.section.context?.sourceRevision ?? "").localeCompare(a.section.context?.sourceRevision ?? "") || b.document.uploadedAt.localeCompare(a.document.uploadedAt)))
    .sort((a, b) => a[0].document.title.localeCompare(b[0].document.title));
}
