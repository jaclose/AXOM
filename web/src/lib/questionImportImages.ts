// ===========================================================================
// Images named by an import ("Attachment: ecg-12.png"). The learner adds the
// image files next to the text; each file is matched to the questions that
// name it and saved as that question's exhibit, so it shows with the stem.
// Matching is by file name only: no folders, no case, and, when nothing
// matches exactly, no extension (a "figure-2.png" in the text finds
// "figure-2.jpg" if that is the only figure-2 added).
// ===========================================================================
import { createQuestionAttachment, type QuestionImageAttachment } from "./questionAttachments";

/** "Figures/ECG-12.PNG" → "ecg-12.png" */
export function imageNameKey(name: string): string {
  return (name.trim().split(/[\\/]/).pop() ?? "").toLowerCase();
}

const withoutExtension = (key: string) => key.replace(/\.[a-z0-9]{2,5}$/, "");

export interface NamedImageMatch<F extends { name: string }> { name: string; file?: F }

/** One entry per name, in order; `file` is absent when no added file answers it. */
export function matchNamedImages<F extends { name: string }>(names: readonly string[], files: readonly F[]): NamedImageMatch<F>[] {
  const exact = new Map<string, F>();
  const loose = new Map<string, F[]>();
  for (const file of files) {
    const key = imageNameKey(file.name);
    if (!exact.has(key)) exact.set(key, file);
    const stem = withoutExtension(key);
    loose.set(stem, [...(loose.get(stem) ?? []), file]);
  }
  return names.map((name) => {
    const key = imageNameKey(name);
    const candidates = loose.get(withoutExtension(key)) ?? [];
    return { name, file: exact.get(key) ?? (candidates.length === 1 ? candidates[0] : undefined) };
  });
}

/** Every image name the given drafts mention, once each, in first-seen order. */
export function namedImages(drafts: ReadonlyArray<{ attachmentNames?: string[] }>): string[] {
  const seen = new Map<string, string>();
  for (const draft of drafts) {
    for (const name of draft.attachmentNames ?? []) {
      const key = imageNameKey(name);
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
