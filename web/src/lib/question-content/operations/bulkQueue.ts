// Deterministic source-job selection and accounting for AXOM's existing
// parser/review infrastructure. Pure data: no database or source mutation.
export interface CorpusJob {
  source_path: string;
  equivalent_paths?: string[];
  canonical_input_key?: string;
  input_mode?: string;
  priority?: number;
  source_ids?: string[];
  status?: string;
}
export interface PriorityBatch {
  id: string;
  jobs?: CorpusJob[];
  job_indices?: number[];
}
export interface PriorityQueue {
  processing_order: PriorityBatch[];
}
export type CorpusDisposition =
  | "unavailable" | "source-over-limit" | "unsupported-format"
  | "checksum-mismatch" | "extraction-error" | "no-questions"
  | "review-prepared" | "review-partial";
export interface CorpusReceipt {
  schemaVersion: 1;
  adapterVersion: string;
  batch: string;
  queueIndex: number;
  sourceKey: string;
  sourceSha256?: string;
  inputExtension: string;
  status: CorpusDisposition;
  sourcePath?: string;
  originalPath?: string;
  sourceBytes?: number;
  sourcePages?: number;
  detected: number;
  canonicalReadable: number;
  ready: number;
  reviewRequired: number;
  unresolved: number;
  rejected: number;
  imageAssets: number;
  pageMapped?: number;
  inventoryChecksumVerified: boolean;
  answerIndependentlyVerified: boolean;
  accountCloudReadbackVerified: boolean;
  reasons: string[];
  createdAt: string;
}
const SHA256 = /^[a-f0-9]{64}$/;
export function queueJobs(queue: PriorityQueue, all: readonly CorpusJob[], batchId: string): CorpusJob[] {
  const batch = queue.processing_order.find(x => x.id === batchId);
  if (!batch) throw new Error("Unknown academic source priority batch: " + batchId);
  if (batch.jobs) return batch.jobs;
  return (batch.job_indices ?? []).map(index => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= all.length)
      throw new Error(`Invalid ${batchId} job index ${index}; update the source inventory before continuing.`);
    return all[index];
  });
}
export function queueWindow(jobs: readonly CorpusJob[], offset: number, limit: number): CorpusJob[] {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Offset must be nonnegative and batch limit must be 1–200.");
  return jobs.slice(offset, offset + limit);
}
export function inventorySha(job: CorpusJob): string | undefined {
  const field = job.canonical_input_key;
  if (!field?.startsWith("byte:")) return undefined;
  const digest = field.slice(5);
  if (!SHA256.test(digest)) throw new Error("The source inventory contains an invalid SHA-256 key.");
  return digest;
}
export function recoveredSourcePath(job: CorpusJob, exists: (path: string) => boolean): string | undefined {
  const paths = [job.source_path, ...(job.equivalent_paths ?? [])];
  return [...new Set(paths)].find(path => typeof path === "string" && path.startsWith("/") && exists(path));
}
export function corpusExtension(name: string): string {
  return /\.[a-z0-9]+$/i.exec(name)?.[0].toLowerCase() ?? "";
}
/** Extension checks are insufficient: a PDF filename can be a 133-byte link
 * placeholder or a Word lock file. Reject before invoking external parsers. */
export function inputSignatureProblem(data: Uint8Array, extension: string, name: string): string | undefined {
  if (name.startsWith("~$")) return "This is an Office lock file, not an academic document. Reopen the unlocked original.";
  if (extension === ".pdf") {
    const head = new TextDecoder("latin1").decode(data.subarray(0, Math.min(1024, data.length)));
    if (!head.includes("%PDF-")) return "File has a .pdf extension but no PDF header; this may be a broken link or placeholder. Locate the original PDF.";
  } else if ([".docx", ".pptx", ".ppsx"].includes(extension)) {
    if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b ||
        data[2] !== 0x03 || data[3] !== 0x04)
      return "The Office document is not a readable ZIP/OOXML package. Preserve the original and export a valid DOCX/PPTX.";
  } else if ([".txt", ".md", ".markdown", ".csv", ".json"].includes(extension)) {
    if (data.subarray(0, Math.min(512, data.length)).includes(0))
      return "The text input contains NUL bytes and does not resemble UTF-8 question text. Convert it to UTF-8 first.";
  }
  return undefined;
}
export function corpusKey(job: CorpusJob): string {
  const id = job.canonical_input_key;
  if (id && /^(?:byte:[a-f0-9]{64}|pkg:[a-f0-9]{20,64})$/.test(id)) return id.replace(":", "-");
  return "";
}
export function dispositionCounts(receipts: readonly CorpusReceipt[]) {
  const summary: Record<CorpusDisposition, number> = {
    unavailable: 0, "source-over-limit": 0, "unsupported-format": 0,
    "checksum-mismatch": 0, "extraction-error": 0, "no-questions": 0,
    "review-prepared": 0, "review-partial": 0,
  };
  let detected = 0, canonicalReadable = 0, ready = 0, reviewRequired = 0, unresolved = 0, rejected = 0, images = 0;
  for (const receipt of receipts) {
    summary[receipt.status]++;
    detected += receipt.detected; canonicalReadable += receipt.canonicalReadable;
    ready += receipt.ready; reviewRequired += receipt.reviewRequired;
    unresolved += receipt.unresolved; rejected += receipt.rejected;
    images += receipt.imageAssets;
  }
  return { statuses: summary, files: receipts.length, detected, canonicalReadable, ready,
    reviewRequired, unresolved, rejected, images, cloudVerified: 0 };
}
export function receiptConsistent(receipt: CorpusReceipt): boolean {
  const values = [receipt.detected, receipt.canonicalReadable, receipt.ready,
    receipt.reviewRequired, receipt.unresolved, receipt.rejected, receipt.imageAssets];
  return receipt.schemaVersion === 1 && values.every(value => Number.isSafeInteger(value) && value >= 0)
    && receipt.detected === receipt.ready + receipt.reviewRequired + receipt.unresolved + receipt.rejected
    && receipt.canonicalReadable <= receipt.detected
    && receipt.ready === 0 && !receipt.accountCloudReadbackVerified
    && (!receipt.sourceSha256 || SHA256.test(receipt.sourceSha256));
}
