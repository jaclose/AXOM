export type QuestionAnnotationTarget = "stem" | "explanation" | "option";
export type QuestionAnnotationTone = "yellow" | "cyan" | "purple";
export type QuestionAnnotationStatus = "active" | "needs-repair";

export interface QuestionTextAnnotation {
  id: string;
  target: QuestionAnnotationTarget;
  optionKey?: string;
  startOffset: number;
  endOffset: number;
  exactText: string;
  prefix: string;
  suffix: string;
  tone: QuestionAnnotationTone;
  createdAt: string;
  updatedAt: string;
  sourceTextHash: string;
  status: QuestionAnnotationStatus;
  note?: string;
}

export type AnnotationCreationResult =
  | { status: "created"; annotation: QuestionTextAnnotation; annotations: QuestionTextAnnotation[]; mergedIds: string[] }
  | { status: "overlap"; existingAnnotationId: string; reason: string }
  | { status: "ignored"; reason: "collapsed" | "whitespace" | "duplicate-id" };

const CONTEXT_LENGTH = 24;
const TONES = new Set<QuestionAnnotationTone>(["yellow", "cyan", "purple"]);
const TARGETS = new Set<QuestionAnnotationTarget>(["stem", "explanation", "option"]);

export function sourceTextHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createTextAnnotation(input: {
  id: string;
  target: QuestionAnnotationTarget;
  optionKey?: string;
  sourceText: string;
  startOffset: number;
  endOffset: number;
  tone: QuestionAnnotationTone;
  now: string;
  note?: string;
}): QuestionTextAnnotation {
  const { sourceText, startOffset, endOffset } = input;
  if (!input.id.trim()) throw new Error("Annotation id is required.");
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)
    || startOffset < 0 || endOffset <= startOffset || endOffset > sourceText.length) {
    throw new Error("Annotation range is invalid.");
  }
  if (input.target === "option" && !input.optionKey?.trim()) {
    throw new Error("Option annotations require an option key.");
  }
  return {
    id: input.id,
    target: input.target,
    optionKey: input.target === "option" ? input.optionKey?.trim().toUpperCase() : undefined,
    startOffset,
    endOffset,
    exactText: sourceText.slice(startOffset, endOffset),
    prefix: sourceText.slice(Math.max(0, startOffset - CONTEXT_LENGTH), startOffset),
    suffix: sourceText.slice(endOffset, endOffset + CONTEXT_LENGTH),
    tone: input.tone,
    createdAt: input.now,
    updatedAt: input.now,
    sourceTextHash: sourceTextHash(sourceText),
    status: "active",
    note: input.note?.trim() || undefined,
  };
}

function sameAnnotationTarget(
  annotation: Pick<QuestionTextAnnotation, "target" | "optionKey">,
  target: QuestionAnnotationTarget,
  optionKey?: string,
): boolean {
  if (annotation.target !== target) return false;
  if (target !== "option") return true;
  return annotation.optionKey === optionKey?.trim().toUpperCase();
}

export function createTextAnnotationWithIntegrity(input: {
  id: string;
  target: QuestionAnnotationTarget;
  optionKey?: string;
  sourceText: string;
  startOffset: number;
  endOffset: number;
  tone: QuestionAnnotationTone;
  now: string;
  note?: string;
  existingAnnotations: readonly QuestionTextAnnotation[];
}): AnnotationCreationResult {
  if (input.endOffset <= input.startOffset) {
    return { status: "ignored", reason: "collapsed" };
  }
  if (!input.sourceText.slice(input.startOffset, input.endOffset).trim()) {
    return { status: "ignored", reason: "whitespace" };
  }
  if (input.existingAnnotations.some((annotation) => annotation.id === input.id)) {
    return { status: "ignored", reason: "duplicate-id" };
  }
  const optionKey = input.target === "option" ? input.optionKey?.trim().toUpperCase() : undefined;
  const candidates = input.existingAnnotations
    .filter((annotation) => sameAnnotationTarget(annotation, input.target, optionKey))
    .map((annotation) => ({ original: annotation, current: reconcileTextAnnotation(annotation, input.sourceText) }));
  let startOffset = input.startOffset;
  let endOffset = input.endOffset;
  const merged = new Map<string, QuestionTextAnnotation>();
  // Grow to a fixed point: a selection may bridge several existing marks.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { original, current } of candidates) {
      if (merged.has(current.id) || original.status !== "active" || current.status !== "active"
        || current.tone !== input.tone || current.note !== (input.note?.trim() || undefined)
        || current.startOffset > endOffset || current.endOffset < startOffset) continue;
      merged.set(current.id, current);
      startOffset = Math.min(startOffset, current.startOffset);
      endOffset = Math.max(endOffset, current.endOffset);
      changed = true;
    }
  }
  const overlap = candidates.find(({ current }) => !merged.has(current.id)
    && startOffset < current.endOffset && endOffset > current.startOffset);
  if (overlap) {
    return {
      status: "overlap",
      existingAnnotationId: overlap.current.id,
      reason: "This selection crosses a different color, note, or a highlight needing repair. Erase that highlight first.",
    };
  }
  const oldest = [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
  const annotation = createTextAnnotation({ ...input, id: oldest?.id ?? input.id, startOffset, endOffset });
  if (oldest) annotation.createdAt = oldest.createdAt;
  return {
    status: "created",
    annotation,
    mergedIds: [...merged.keys()],
    annotations: [...input.existingAnnotations.filter((item) => !merged.has(item.id)), annotation],
  };
}

export function removeTextAnnotationById(
  annotations: readonly QuestionTextAnnotation[],
  annotationId: string,
): QuestionTextAnnotation[] {
  return annotations.filter((annotation) => annotation.id !== annotationId);
}

export function reconcileTextAnnotation(
  annotation: QuestionTextAnnotation,
  sourceText: string,
): QuestionTextAnnotation {
  const exactAtStoredRange = sourceText.slice(annotation.startOffset, annotation.endOffset) === annotation.exactText;
  if (annotation.sourceTextHash === sourceTextHash(sourceText) && exactAtStoredRange) {
    return annotation.status === "active" ? annotation : { ...annotation, status: "active" };
  }

  const candidates: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= sourceText.length - annotation.exactText.length) {
    const match = sourceText.indexOf(annotation.exactText, fromIndex);
    if (match < 0) break;
    const prefixStart = Math.max(0, match - annotation.prefix.length);
    const suffixEnd = match + annotation.exactText.length + annotation.suffix.length;
    if (
      sourceText.slice(prefixStart, match) === annotation.prefix
      && sourceText.slice(match + annotation.exactText.length, suffixEnd) === annotation.suffix
    ) candidates.push(match);
    fromIndex = match + Math.max(1, annotation.exactText.length);
  }

  if (candidates.length !== 1) return { ...annotation, status: "needs-repair" };
  const startOffset = candidates[0];
  return {
    ...annotation,
    startOffset,
    endOffset: startOffset + annotation.exactText.length,
    sourceTextHash: sourceTextHash(sourceText),
    status: "active",
  };
}

export function normalizeQuestionAnnotations(value: unknown): QuestionTextAnnotation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byId = new Map<string, QuestionTextAnnotation>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const target = TARGETS.has(item.target as QuestionAnnotationTarget)
      ? item.target as QuestionAnnotationTarget : undefined;
    const exactText = typeof item.exactText === "string" ? item.exactText : "";
    const startOffset = typeof item.startOffset === "number" && Number.isInteger(item.startOffset) ? item.startOffset : -1;
    const endOffset = typeof item.endOffset === "number" && Number.isInteger(item.endOffset) ? item.endOffset : -1;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
    const sourceHash = typeof item.sourceTextHash === "string" ? item.sourceTextHash : "";
    if (!id || !target || !exactText || startOffset < 0 || endOffset <= startOffset
      || !createdAt || !updatedAt || !sourceHash) continue;
    const optionKey = target === "option" && typeof item.optionKey === "string" && item.optionKey.trim()
      ? item.optionKey.trim().toUpperCase() : undefined;
    if (target === "option" && !optionKey) continue;
    const annotation: QuestionTextAnnotation = {
      id,
      target,
      optionKey,
      startOffset,
      endOffset,
      exactText,
      prefix: typeof item.prefix === "string" ? item.prefix.slice(-CONTEXT_LENGTH) : "",
      suffix: typeof item.suffix === "string" ? item.suffix.slice(0, CONTEXT_LENGTH) : "",
      tone: TONES.has(item.tone as QuestionAnnotationTone) ? item.tone as QuestionAnnotationTone : "yellow",
      createdAt,
      updatedAt,
      sourceTextHash: sourceHash,
      status: item.status === "needs-repair" ? "needs-repair" : "active",
      note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : undefined,
    };
    const existing = byId.get(id);
    if (!existing || annotation.updatedAt >= existing.updatedAt) byId.set(id, annotation);
  }
  return byId.size ? [...byId.values()] : undefined;
}

export function reconcileQuestionAnnotationSources<T extends {
  stem: string;
  explanation?: string;
  options: Array<{ key: string; text: string }>;
  annotations?: QuestionTextAnnotation[];
}>(question: T): T {
  if (!question.annotations?.length) return question;
  const annotations = question.annotations.map((annotation) => {
    const sourceText = annotation.target === "stem"
      ? question.stem
      : annotation.target === "explanation"
        ? question.explanation ?? ""
        : question.options.find((option) => option.key === annotation.optionKey)?.text ?? "";
    return reconcileTextAnnotation(annotation, sourceText);
  });
  const priority = [...annotations].sort((left, right) => (
    Number(left.status === "needs-repair") - Number(right.status === "needs-repair")
    || left.startOffset - right.startOffset
    || left.endOffset - right.endOffset
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ));
  const accepted: QuestionTextAnnotation[] = [];
  const statusById = new Map<string, QuestionAnnotationStatus>();
  for (const annotation of priority) {
    const overlap = accepted.some((existing) => (
      sameAnnotationTarget(existing, annotation.target, annotation.optionKey)
      && annotation.startOffset < existing.endOffset
      && annotation.endOffset > existing.startOffset
    ));
    statusById.set(annotation.id, overlap ? "needs-repair" : annotation.status);
    accepted.push(annotation);
  }
  return {
    ...question,
    annotations: annotations.map((annotation) => ({
      ...annotation,
      status: statusById.get(annotation.id) ?? annotation.status,
    })),
  };
}
