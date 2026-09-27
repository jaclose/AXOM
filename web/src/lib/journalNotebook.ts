import type { DayAtAGlance } from "./dayAtAGlance";
import type { JournalEntry } from "./types";

export const JOURNAL_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const JOURNAL_ATTACHMENT_TOTAL_BYTES = 12 * 1024 * 1024;
export const JOURNAL_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export type JournalCoverTone = "onyx" | "forest" | "oxblood" | "navy";
export type JournalPaperTone = "warm" | "cream" | "white";

export interface JournalNotebookPreferences {
  title: string;
  subtitle: string;
  coverTone: JournalCoverTone;
  paperTone: JournalPaperTone;
}

export const DEFAULT_JOURNAL_NOTEBOOK: JournalNotebookPreferences = {
  title: "My AXOM Journal",
  subtitle: "Daily pages",
  coverTone: "onyx",
  paperTone: "warm",
};

export interface JournalImageAttachment {
  id: string;
  name: string;
  type: (typeof JOURNAL_IMAGE_TYPES)[number];
  size: number;
  createdAt: string;
  dataUrl: string;
  altText?: string;
}

export type JournalGlanceSectionKey =
  | "intention"
  | "focus"
  | "questions"
  | "targets"
  | "habits"
  | "tasks"
  | "energy"
  | "wins"
  | "unfinished"
  | "sessions"
  | "accuracy"
  | "sound"
  | "rest"
  | "checkins";

export interface JournalGlancePreferences {
  hiddenSections?: JournalGlanceSectionKey[];
  corrections?: Partial<Record<JournalGlanceSectionKey, string>>;
  includedText?: string;
  includedAt?: string;
}

/** Optional Stage-1 notebook fields. Legacy standup fields stay canonical. */
export interface JournalNotebookEntryFields {
  freeWriting?: string;
  wins?: string[];
  losses?: string[];
  attachments?: JournalImageAttachment[];
  dayAtAGlance?: JournalGlancePreferences;
  notebookStatus?: "draft" | "complete";
  updatedAt?: string;
}

export type NotebookJournalEntry = JournalEntry & JournalNotebookEntryFields;

export interface JournalGlanceSection {
  key: JournalGlanceSectionKey;
  label: string;
  value: string;
  hasEvidence: boolean;
}

export type JournalImageValidation = { ok: true } | { ok: false; message: string };

export function normalizeJournalNotebookPreferences(value: unknown): JournalNotebookPreferences {
  const record = isRecord(value) ? value : {};
  return {
    title: cleanText(record.title, DEFAULT_JOURNAL_NOTEBOOK.title, 80),
    subtitle: cleanText(record.subtitle, DEFAULT_JOURNAL_NOTEBOOK.subtitle, 120),
    coverTone: isCoverTone(record.coverTone) ? record.coverTone : DEFAULT_JOURNAL_NOTEBOOK.coverTone,
    paperTone: isPaperTone(record.paperTone) ? record.paperTone : DEFAULT_JOURNAL_NOTEBOOK.paperTone,
  };
}

/**
 * Hydration/import boundary for optional notebook fields. Legacy journal
 * records and unknown future fields are preserved; unsafe attachment payloads
 * are omitted before they can reach an image element or the local vault.
 */
export function normalizeJournalEntries(value: unknown): JournalEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((record) => {
      const next: Record<string, unknown> = { ...record };
      if (record.freeWriting !== undefined) next.freeWriting = typeof record.freeWriting === "string" ? record.freeWriting : undefined;
      if (record.wins !== undefined) next.wins = stringList(record.wins);
      if (record.losses !== undefined) next.losses = stringList(record.losses);
      if (record.attachments !== undefined) next.attachments = normalizeJournalAttachments(record.attachments);
      if (record.dayAtAGlance !== undefined) next.dayAtAGlance = normalizeGlancePreferences(record.dayAtAGlance);
      if (record.notebookStatus !== undefined) {
        next.notebookStatus = record.notebookStatus === "complete" ? "complete" : "draft";
      }
      if (record.updatedAt !== undefined) next.updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : undefined;
      return next as unknown as JournalEntry;
    });
}

export function validateJournalImage(
  file: Pick<File, "name" | "type" | "size">,
  existing: JournalImageAttachment[] = [],
): JournalImageValidation {
  if (!JOURNAL_IMAGE_TYPES.includes(file.type as JournalImageAttachment["type"])) {
    return { ok: false, message: "Use a JPG, PNG, WebP, or GIF image." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: "That image is empty or could not be read." };
  }
  if (file.size > JOURNAL_ATTACHMENT_MAX_BYTES) {
    return { ok: false, message: "Keep each image under 3 MB." };
  }
  const existingBytes = existing.reduce((sum, attachment) => sum + Math.max(0, attachment.size), 0);
  if (existingBytes + file.size > JOURNAL_ATTACHMENT_TOTAL_BYTES) {
    return { ok: false, message: "This page has reached its 12 MB local attachment limit." };
  }
  return { ok: true };
}

export async function readJournalImage(
  file: File,
  existing: JournalImageAttachment[] = [],
  readAsDataUrl: (file: File) => Promise<string> = browserReadAsDataUrl,
): Promise<JournalImageAttachment> {
  const validation = validateJournalImage(file, existing);
  if (!validation.ok) throw new Error(validation.message);
  const dataUrl = await readAsDataUrl(file);
  const expectedPrefix = `data:${file.type};base64,`;
  if (!dataUrl.startsWith(expectedPrefix)) throw new Error("AXOM could not verify that image.");
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `journal-image-${Date.now()}`,
    name: safeAttachmentName(file.name),
    type: file.type as JournalImageAttachment["type"],
    size: file.size,
    createdAt: new Date().toISOString(),
    dataUrl,
  };
}

export function withoutJournalAttachment(
  attachments: JournalImageAttachment[] | undefined,
  attachmentId: string,
): JournalImageAttachment[] {
  return (attachments ?? []).filter((attachment) => attachment.id !== attachmentId);
}

export function createJournalAttachmentExport(attachment: JournalImageAttachment): { filename: string; blob: Blob } {
  const separator = attachment.dataUrl.indexOf(",");
  if (separator < 0) throw new Error("This attachment could not be exported.");
  const header = attachment.dataUrl.slice(0, separator);
  const body = attachment.dataUrl.slice(separator + 1);
  if (!header.includes(";base64") || !header.startsWith(`data:${attachment.type}`)) {
    throw new Error("This attachment could not be verified for export.");
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { filename: safeAttachmentName(attachment.name), blob: new Blob([bytes], { type: attachment.type }) };
}

export function buildJournalGlanceSections(glance: DayAtAGlance): JournalGlanceSection[] {
  const questionParts = [
    glance.questions.trustedAttempts ? `${glance.questions.trustedAttempts} practice question${glance.questions.trustedAttempts === 1 ? "" : "s"}` : "",
    glance.cards.reviewed ? `${glance.cards.reviewed} card${glance.cards.reviewed === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const taskParts = [
    glance.tasks.completed.length ? `${glance.tasks.completed.length} completed` : "",
    glance.tasks.open.length ? `${glance.tasks.open.length} still open` : "",
  ].filter(Boolean);
  const targetValue = glance.targetCompletion.eligibleCount
    ? `${glance.targetCompletion.metCount}/${glance.targetCompletion.eligibleCount} scheduled targets met`
    : "No targets were scheduled";
  const habitValue = glance.habits.expected
    ? `${glance.habits.done}/${glance.habits.expected} scheduled habits complete`
    : "No habits were scheduled";
  return [
    section("intention", "Intention", glance.intention?.text ?? "No intention recorded", Boolean(glance.intention)),
    section("focus", "Focused time", `${Math.round(glance.focusedMinutes.value)} min`, glance.focusedMinutes.value > 0),
    section("questions", "Questions and cards", questionParts.join(" · ") || "No practice recorded", questionParts.length > 0),
    section("targets", "Today’s targets", targetValue, glance.targetCompletion.eligibleCount > 0),
    section("habits", "Habits", habitValue, glance.habits.expected > 0),
    section("tasks", "Tasks", taskParts.join(" · ") || "No task changes recorded", taskParts.length > 0),
    section(
      "energy",
      "Energy and readiness",
      glance.energy.hasEvidence
        ? `${glance.energy.selfReported.label || "No check-in"} · ${glance.energy.readinessLabel}`
        : "Not enough local evidence",
      glance.energy.hasEvidence,
    ),
    section("wins", "Wins", glance.wins.map((win) => win.text).join(" · ") || "No wins recorded yet", glance.wins.length > 0),
    section(
      "unfinished",
      "Open loops",
      glance.unfinishedItems.map((item) => item.label).slice(0, 5).join(" · ") || "No open loops detected",
      glance.unfinishedItems.length > 0,
    ),
  ];
}

export function renderJournalGlanceText(
  sections: JournalGlanceSection[],
  preferences: JournalGlancePreferences | undefined,
): string {
  const hidden = new Set(preferences?.hiddenSections ?? []);
  return sections
    .filter((item) => !hidden.has(item.key))
    .map((item) => `${item.label}: ${preferences?.corrections?.[item.key]?.trim() || item.value}`)
    .join("\n");
}

export function hasNotebookContent(entry: Partial<NotebookJournalEntry>): boolean {
  return Boolean(
    entry.today?.trim()
      || entry.tomorrow?.trim()
      || entry.blockers?.trim()
      || entry.freeWriting?.trim()
      || entry.wins?.some((value) => value.trim())
      || entry.losses?.some((value) => value.trim())
      || entry.attachments?.length
      || entry.dayAtAGlance?.includedText?.trim(),
  );
}

export function buildJournalMarkdown(entry: NotebookJournalEntry, dayLabel: string): string {
  const lines = [`# ${dayLabel}`, ""];
  if (entry.today.trim()) lines.push("## What went well", "", entry.today.trim(), "");
  if (entry.blockers.trim()) lines.push("## What got in the way", "", entry.blockers.trim(), "");
  if (entry.tomorrow.trim()) lines.push("## What matters tomorrow", "", entry.tomorrow.trim(), "");
  if (entry.wins?.some((item) => item.trim())) {
    lines.push("## Wins", "", ...entry.wins.filter(Boolean).map((item) => `- ${item.trim()}`), "");
  }
  if (entry.losses?.some((item) => item.trim())) {
    lines.push("## Unfinished loops", "", ...entry.losses.filter(Boolean).map((item) => `- ${item.trim()}`), "");
  }
  if (entry.freeWriting?.trim()) lines.push("## Free writing", "", entry.freeWriting.trim(), "");
  if (entry.dayAtAGlance?.includedText?.trim()) {
    lines.push("## Day at a glance", "", entry.dayAtAGlance.includedText.trim(), "");
  }
  if (entry.energy) lines.push(`Energy: ${entry.energy}`, "");
  if (entry.attachments?.length) {
    lines.push("## Local attachments", "", ...entry.attachments.map((attachment) => `- ${attachment.name} (${formatBytes(attachment.size)})`), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function previousJournalDay(key: string): string {
  return shiftJournalDay(key, -1);
}

export function nextJournalDay(key: string): string {
  return shiftJournalDay(key, 1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shiftJournalDay(key: string, amount: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  if (!Number.isFinite(date.getTime())) return key;
  date.setDate(date.getDate() + amount);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function browserReadAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("AXOM could not read that image."));
    reader.onerror = () => reject(new Error("AXOM could not read that image."));
    reader.readAsDataURL(file);
  });
}

function safeAttachmentName(value: string): string {
  const withoutControls = Array.from(value, (character) => character.charCodeAt(0) < 32 ? "-" : character).join("");
  const cleaned = withoutControls.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 120);
  return cleaned || "journal-image";
}

function section(key: JournalGlanceSectionKey, label: string, value: string, hasEvidence: boolean): JournalGlanceSection {
  return { key, label, value, hasEvidence };
}

function cleanText(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, max);
  return cleaned || fallback;
}

function isCoverTone(value: unknown): value is JournalCoverTone {
  return value === "onyx" || value === "forest" || value === "oxblood" || value === "navy";
}

function isPaperTone(value: unknown): value is JournalPaperTone {
  return value === "warm" || value === "cream" || value === "white";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeJournalAttachments(value: unknown): JournalImageAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: JournalImageAttachment[] = [];
  let totalBytes = 0;
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const type = candidate.type;
    const size = candidate.size;
    const dataUrl = candidate.dataUrl;
    if (!JOURNAL_IMAGE_TYPES.includes(type as JournalImageAttachment["type"])) continue;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > JOURNAL_ATTACHMENT_MAX_BYTES) continue;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith(`data:${type};base64,`)) continue;
    const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const decodedBytes = Math.max(0, Math.floor(encoded.length * 0.75) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0));
    if (decodedBytes <= 0 || decodedBytes > JOURNAL_ATTACHMENT_MAX_BYTES) continue;
    if (totalBytes + decodedBytes > JOURNAL_ATTACHMENT_TOTAL_BYTES) break;
    totalBytes += decodedBytes;
    const rawId = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 120) : "";
    const rawCreatedAt = typeof candidate.createdAt === "string" ? candidate.createdAt.slice(0, 40) : "";
    const normalized: JournalImageAttachment = {
      id: rawId || `journal-image-${attachments.length + 1}`,
      name: safeAttachmentName(typeof candidate.name === "string" ? candidate.name : "journal-image"),
      type: type as JournalImageAttachment["type"],
      size: decodedBytes,
      createdAt: rawCreatedAt && Number.isFinite(new Date(rawCreatedAt).getTime()) ? rawCreatedAt : "",
      dataUrl,
    };
    if (typeof candidate.altText === "string") normalized.altText = candidate.altText.slice(0, 300);
    attachments.push(normalized);
  }
  return attachments;
}

function normalizeGlancePreferences(value: unknown): JournalGlancePreferences {
  const record = isRecord(value) ? value : {};
  const allowed = new Set<JournalGlanceSectionKey>([
    "intention", "focus", "questions", "targets", "habits", "tasks", "energy", "wins", "unfinished",
  ]);
  const hiddenSections = Array.isArray(record.hiddenSections)
    ? record.hiddenSections.filter((key): key is JournalGlanceSectionKey => typeof key === "string" && allowed.has(key as JournalGlanceSectionKey))
    : undefined;
  const rawCorrections = isRecord(record.corrections) ? record.corrections : {};
  const corrections: Partial<Record<JournalGlanceSectionKey, string>> = {};
  for (const key of allowed) {
    if (typeof rawCorrections[key] === "string") corrections[key] = rawCorrections[key] as string;
  }
  return {
    ...record,
    hiddenSections,
    corrections: Object.keys(corrections).length ? corrections : undefined,
    includedText: typeof record.includedText === "string" ? record.includedText : undefined,
    includedAt: typeof record.includedAt === "string" ? record.includedAt : undefined,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
