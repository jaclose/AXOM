// ===========================================================================
// Images named by an import ("Attachment: ecg-12.png"). The learner adds the
// image files next to the text; each file is matched to the questions that
// name it and saved as that question's exhibit, so it shows with the stem.
// Match exact source-relative paths first, then unique basenames, and then
// unique extension-free basenames. Duplicated names never pick the first
// anatomy/ECG image silently.
// ===========================================================================
import { createQuestionAttachment, type QuestionImageAttachment } from "./questionAttachments";

/** "Figures/ECG-12.PNG" → "ecg-12.png" */
export function imageNameKey(name: string): string {
  return (name.trim().split(/[\\/]/).pop() ?? "").toLowerCase();
}

const withoutExtension = (key: string) => key.replace(/\.[a-z0-9]{2,5}$/, "");

/** Retain source-relative path when present, while matching case and slashes. */
export function imageReferenceKey(name: string): string {
  return name.trim().replace(/\\/g, "/").replace(/^\.\//, "").normalize("NFC").toLowerCase();
}

export interface NamedImageMatch<F extends { name: string }> { name: string; file?: F }

/** Never attach an arbitrary one of several same-named medical images. */
export function matchNamedImages<F extends { name: string }>(names: readonly string[], files: readonly F[]): NamedImageMatch<F>[] {
  const exact = new Map<string, F[]>();
  const loose = new Map<string, F[]>();
  for (const file of files) {
    const base = imageNameKey(file.name);
    exact.set(base, [...(exact.get(base) ?? []), file]);
    const stem = withoutExtension(base);
    loose.set(stem, [...(loose.get(stem) ?? []), file]);
  }
  return names.map((name) => {
    const path = imageReferenceKey(name);
    const key = imageNameKey(name);
    // An explicit path wins over basename when it names one and only one
    // asset. It may still be enclosed by a top-level imported course folder.
    const paths = files.filter(file => {
      const candidate = imageReferenceKey(file.name);
      return candidate === path || candidate.endsWith("/" + path);
    });
    if (paths.length === 1) return { name, file: paths[0] };
    if (paths.length > 1) return { name, file: undefined };
    const matches = exact.get(key) ?? [];
    if (matches.length === 1) return { name, file: matches[0] };
    if (matches.length > 1) return { name, file: undefined };
    const fallback = loose.get(withoutExtension(key)) ?? [];
    return { name, file: fallback.length === 1 ? fallback[0] : undefined };
  });
}

/** Every distinct source-relative reference across drafts, in source order. */
export function namedImages(drafts: ReadonlyArray<{ attachmentNames?: string[] }>): string[] {
  const seen = new Map<string, string>();
  for (const draft of drafts) {
    for (const name of draft.attachmentNames ?? []) {
      const key = imageReferenceKey(name);
      if (key && !seen.has(key)) seen.set(key, name.trim());
    }
  }
  return [...seen.values()];
}

/**
 * Save a question's named images as its exhibits. Returns what was attached
 * and, in plain words, anything that could not be (wrong type, too large).
 */
export async function attachNamedImages(input: {
  names: readonly string[];
  files: readonly File[];
  questionId: string;
}): Promise<{ attachments: QuestionImageAttachment[]; problems: string[] }> {
  const attachments: QuestionImageAttachment[] = [];
  const problems: string[] = [];
  for (const match of matchNamedImages(input.names, input.files)) {
    if (!match.file) continue;
    const created = await createQuestionAttachment({ file: match.file, questionId: input.questionId, existing: attachments });
    if (created.status === "created") attachments.push({ ...created.attachment, role: "exhibit" });
    else problems.push(`${match.file.name}: ${created.message}`);
  }
  return { attachments, problems };
}
