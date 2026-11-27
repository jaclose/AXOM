import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson } from "../compressedText";
import type { SourceDocument } from "../library";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../localVault";
import { readCatalog, readPreparedBank, type LibraryInstallOptions, type LibraryInstallScope, type LibraryReader } from "../privateLibrary/install";
import type { PreparedBank, PrivateLibraryCatalog } from "../privateLibrary/types";
import { blocksToPlainText } from "../question-content/blocks";
import { legacyQuestionFields } from "../question-content/legacyFields";
import type { PackageQuestion } from "../question-content/package";
import { packageImportVerdicts } from "../question-content/toReviewedImport";
import { validateQuestionRecord, type QuestionRecord } from "../questions";
import { useStore } from "../store";
import { readDownloadReference } from "./downloadReference";

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const NOTICE = "Source update review: ";
const ALTERNATIVE = "Current verified source: ";
const RETIRED = "This question is absent from the current source revision and is held for review.";
const SOURCE_FIELDS = ["content", "stem", "options", "correctKey", "correctAnswerText", "explanation",
  "extraction", "citation", "questionNumber", "sourcePage", "needsReview"] as const;
type SourceFields = Pick<QuestionRecord, typeof SOURCE_FIELDS[number]>;
type PriorReceipt = { revisionId: string; questionIds: string[]; documentIds: string[] };

function sourceFields(question: QuestionRecord): SourceFields {
  return Object.fromEntries(SOURCE_FIELDS.map(key => [key, question[key]])) as SourceFields;
}
function matchesIdentity(question: PackageQuestion | undefined, bank: PreparedBank, checksum: string): question is PackageQuestion {
  return Boolean(question && (question.bankId === bank.pkg.manifest.bank.id
      || (question.bankId === undefined && bank.pkg.questions.some(item => item.id === question.id && item.bankId === undefined)))
    && question.provenance.sourceChecksum === `sha256:${checksum}`);
}
function sourceProjection(bank: PreparedBank, question: PackageQuestion) {
  const fields = legacyQuestionFields(bank.pkg.manifest, question);
  // Match the existing canonical record's normalized text, without inventing
  // a reviewed key or flattening away the ordered source content.
  return { content: question, stem: fields.stem.trim(), options: fields.options.map(option => ({
    key: option.key, text: option.text.trim(),
  })), correctKey: fields.correctKey, explanation: fields.explanation?.trim() || undefined };
}
function withoutUpdateNotices(question: PackageQuestion): PackageQuestion {
  if (!question.flags?.some(flag => flag.message.startsWith(NOTICE))) return question;
  const flags = question.flags.filter(flag => !flag.message.startsWith(NOTICE));
  const explanation = question.explanation?.filter(block => block.type !== "callout"
    || (!block.text.startsWith(NOTICE) && !block.text.startsWith(ALTERNATIVE)));
  const { flags: _flags, explanation: _explanation, ...rest } = question;
  return { ...rest, ...(flags.length ? { flags } : {}), ...(explanation?.length ? { explanation } : {}) };
}
function matchesSource(record: QuestionRecord, bank: PreparedBank, question: PackageQuestion, ignoreKey = false): boolean {
  const expected = sourceProjection(bank, question);
  const content = record.content && withoutUpdateNotices(record.content);
  const explanation = content !== record.content && record.explanation === blocksToPlainText(record.content!.explanation ?? []).trim()
    ? blocksToPlainText(content?.explanation ?? []).trim() || undefined : record.explanation;
  const actual = { ...record, content, explanation };
  return Object.entries(expected).every(([key, value]) => (ignoreKey && key === "correctKey") || same(actual[key as keyof QuestionRecord], value));
}
function withHold(question: PackageQuestion, reason: string, current?: PackageQuestion): PackageQuestion {
  const explanation = (question.explanation ?? []).filter(block => block.type !== "callout"
    || (!block.text.startsWith(NOTICE) && !block.text.startsWith(ALTERNATIVE)));
  const flags = (question.flags ?? []).filter(flag => !flag.message.startsWith(NOTICE));
  return { ...question,
    flags: [...flags, { type: "answer_needs_review", message: NOTICE + reason }],
    explanation: [...explanation,
      { type: "callout", tone: "warning", text: NOTICE + reason },
      ...(current ? [{ type: "callout" as const, tone: "note" as const,
        text: `${ALTERNATIVE}answer candidate ${current.correctAnswer?.labels.join(", ") || "not supplied"}. ${blocksToPlainText(current.explanation ?? [])}` }] : []),
    ],
  };
}

/** Receipts only locate a possible baseline. The editable local bank and these
 * local hints never authorize replacement: its old revision and bytes must
 * still pass the server's permissions, collection identity and file hashes. */
function priorReceipts(documents: readonly SourceDocument[], accountId: string, collectionId: string, revisionId: string): PriorReceipt[] {
  const found: PriorReceipt[] = [];
  for (const document of [...documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))) {
    if (!["axom-academic-reference", "axom-community-reference"].includes(document.fileType)) continue;
    try {
      const value = JSON.parse(document.rawText);
      if (!value || value.accountId !== accountId || !uuid(value.revisionId) || value.revisionId === revisionId) continue;
      if (document.fileType === "axom-academic-reference") {
        const verified = readDownloadReference(documents, { id: collectionId, current_revision_id: value.revisionId }, accountId);
        if (verified) found.push(verified);
      } else if (value.version === 1 && value.pending === false && document.id === `community-${value.revisionId}`
        && Array.isArray(value.questionIds) && value.questionIds.every((id: unknown) => typeof id === "string" && id.length > 0)) {
        found.push({ revisionId: value.revisionId, questionIds: value.questionIds, documentIds: [] });
      }
    } catch { /* An invalid local hint cannot supply an immutable baseline. */ }
  }
  return found.slice(0, 20);
}

/** Update only source-owned fields as one durable snapshot. CAS and rollback
 * preserve concurrent notes, attempts, annotations, filing and set membership. */
async function commitChanges(changes: Array<{ expected: QuestionRecord; source: SourceFields }>, scope: LibraryInstallScope) {
  if (!changes.length) return;
  scope.assertCurrent();
  const before = new Map<string, QuestionRecord>();
  const after = new Map<string, QuestionRecord>();
  const checkpoint = getVaultWriteCheckpoint();
  let adopted = false;
  try {
    useStore.setState(live => {
      scope.assertCurrent();
      for (const change of changes) {
        const record = live.questions.find(question => question.id === change.expected.id);
        if (!record || !same(sourceFields(record), sourceFields(change.expected)))
          throw new Error("A source question changed during download. Its local edits are preserved; retry this course.");
        const replacement = { ...record, ...change.source, updatedAt: new Date().toISOString() };
        const validation = validateQuestionRecord(replacement);
        if (!validation.ok) throw new Error(`A source update could not be saved: ${validation.errors.join(" ")}`);
        before.set(record.id, record); after.set(record.id, replacement);
      }
      adopted = true;
      return { questions: live.questions.map(question => after.get(question.id) ?? question) };
    });
    await flushLocalVaultWrites(); assertVaultWritesSince(checkpoint); scope.assertCurrent();
    if (changes.some(change => {
      const saved = useStore.getState().questions.find(q => q.id === change.expected.id);
      return !saved || !same(sourceFields(saved), change.source);
    }))
      throw new Error("The source update changed before its saved state could be confirmed.");
  } catch (cause) {
    if (!adopted) throw cause;
    // Never write an old account's rollback into the newly selected workspace.
    scope.assertCurrent();
    const rollbackCheckpoint = getVaultWriteCheckpoint();
    let incomplete = false;
    try {
      useStore.setState(live => ({ questions: live.questions.map(question => {
        const prior = before.get(question.id), replacement = after.get(question.id);
        if (!prior || !replacement) return question;
        if (!same(sourceFields(question), sourceFields(replacement))) {
          incomplete = true;
          // Text, choices and key form one projection. Never splice old fields
          // into a concurrently edited source and leave a graded hybrid.
          return { ...question, needsReview: true, extraction: {
            ...(question.extraction ?? { confidence: "low" as const }), reviewed: false,
            warnings: [...new Set([...(question.extraction?.warnings ?? []),
              NOTICE + "A source edit changed during a failed save. Its complete current wording and mapping are preserved and held for review."])],
          } };
        }
        return { ...question, ...sourceFields(prior),
          updatedAt: question.updatedAt === replacement.updatedAt ? prior.updatedAt : question.updatedAt };
      }) }));
      await flushLocalVaultWrites(); assertVaultWritesSince(rollbackCheckpoint);
    } catch { incomplete = true; }
    throw new Error(`${cause instanceof Error ? cause.message : "The source update could not be saved."}${incomplete
      ? " Rollback could not be fully confirmed; keep the safety backup and inspect this source before retrying." : " The previous source content was restored."}`, { cause });
  }
}

/** This hook is created only by downloadAcademicCourse's authenticated,
 * checksum-verifying reader. It does not grant review or change any key gate. */
export function academicSourceReconciler(client: SupabaseClient, revisionId: string, scope: LibraryInstallScope,
  readRevision: (revision: string) => Promise<LibraryReader>): NonNullable<LibraryInstallOptions["reconcileSource"]> {
  let collectionId: string | undefined;
  const priorBanks = new Map<string, Promise<PreparedBank | undefined>>();
  async function assertRevision() {
    scope.assertCurrent();
    const { data, error } = await client.from("academic_collections").select("id,current_revision_id,withdrawn")
      .eq("current_revision_id", revisionId).single();
    scope.assertCurrent();
    if (error || !data || !uuid(data.id) || data.current_revision_id !== revisionId || data.withdrawn !== false
      || (collectionId && collectionId !== data.id))
      throw new Error("This is no longer the current accessible course revision. Refresh the course before updating saved questions.");
    collectionId = data.id;
  }
  async function priorBank(receipt: PriorReceipt, catalog: PrivateLibraryCatalog, source: PrivateLibraryCatalog["sources"][number]) {
    const key = `${receipt.revisionId}:${source.id}:${source.checksum}`;
    let pending = priorBanks.get(key);
    if (!pending) {
      pending = (async () => {
        scope.assertCurrent();
        const { data, error } = await client.from("academic_revisions").select("id,collection_id,status")
          .eq("id", receipt.revisionId).single();
        scope.assertCurrent();
        if (error || data?.id !== receipt.revisionId || data.collection_id !== collectionId || data.status !== "ready") return;
        const read = await readRevision(receipt.revisionId);
        const previousCatalog = readCatalog(JSON.parse(new TextDecoder().decode(await read("catalog.json"))));
        scope.assertCurrent();
        if (previousCatalog.id !== catalog.id) return;
        const previousSource = previousCatalog.sources.find(item => item.id === source.id && item.checksum === source.checksum);
        if (!previousSource?.bankFile) return;
        const bank = readPreparedBank(JSON.parse(new TextDecoder().decode(await read(previousSource.bankFile))));
        scope.assertCurrent();
        if (bank.pkg.questions.some(question => question.provenance.sourceChecksum !== `sha256:${source.checksum}`)) return;
        return bank;
      })().catch(() => { scope.assertCurrent(); return undefined; });
      priorBanks.set(key, pending);
    }
    return pending;
  }
  return async (incoming, catalog, source, storedReview, reviewId = storedReview?.id ?? `private-review-${source.checksum}`) => {
    // Old canonical records may omit bankId. A checksum alone is only a
    // lookup hint, never authority to change an unrelated local question.
    const possibleRecords = useStore.getState().questions.filter(question => question.content
      && question.content.provenance.sourceChecksum === `sha256:${source.checksum}`
      && (question.content.bankId === undefined || question.content.bankId === incoming.pkg.manifest.bank.id));
    if (!possibleRecords.length && !storedReview) return;
    await assertRevision();
    const receipts = priorReceipts(useStore.getState().documents, scope.key, collectionId!, revisionId);
    const baselines: Array<{ bank: PreparedBank; receipt: PriorReceipt }> = [];
    for (const receipt of receipts) {
      if (!possibleRecords.some(record => receipt.questionIds.includes(record.id))
        && !receipt.documentIds.includes(storedReview?.id ?? "")) continue;
      const bank = await priorBank(receipt, catalog, source);
      if (bank?.pkg.manifest.bank.id === incoming.pkg.manifest.bank.id) baselines.push({ bank, receipt });
    }
    const unverifiedRemoval = possibleRecords.some(record => !incoming.pkg.questions.some(question => question.id === record.content!.id)
      && receipts.some(receipt => receipt.questionIds.includes(record.id))
      && !baselines.some(({ receipt }) => receipt.questionIds.includes(record.id)));
    if (unverifiedRemoval)
      throw new Error("An earlier downloaded source could not be verified, so removed-question updates cannot be confirmed. Your saved work is preserved; reconnect or review the prior source before retrying.");
    const records = possibleRecords.filter(record => incoming.pkg.questions.some(question => question.id === record.content!.id
      && matchesIdentity(record.content, incoming, source.checksum)) || baselines.some(({ bank, receipt }) =>
      receipt.questionIds.includes(record.id) && bank.pkg.questions.some(question => question.id === record.content!.id
        && question.bankId === record.content!.bankId && matchesIdentity(question, bank, source.checksum))));
    const storedBank = storedReview ? readPreparedBank(JSON.parse(storedReview.rawText)) : undefined;
    if (storedBank && (storedBank.pkg.manifest.bank.id !== incoming.pkg.manifest.bank.id
      || storedBank.pkg.questions.some(question => question.provenance.sourceChecksum !== `sha256:${source.checksum}`
        || (question.bankId !== undefined && question.bankId !== incoming.pkg.manifest.bank.id))))
      throw new Error("The local review has a different source identity. Export and reconcile it before updating this source.");
    const conflicts = new Map<string, string>();
    const sourceOwned = new Map<string, boolean>();
    const incomingById = new Map(incoming.pkg.questions.map(question => [question.id, question]));
    const incomingVerdicts = packageImportVerdicts(incoming.pkg, incoming.issues);
    const bank: PreparedBank = { ...incoming, pkg: { ...incoming.pkg, questions: incoming.pkg.questions.map(question => {
      const localReview = storedBank?.pkg.questions.find(item => item.id === question.id);
      const saved = records.filter(record => record.content!.id === question.id);
      const reviewUnchanged = !storedBank || (localReview
        ? same(withoutUpdateNotices(localReview), question) || baselines.some(({ bank: base, receipt }) =>
          (receipt.documentIds.includes(storedReview!.id) || saved.some(record => receipt.questionIds.includes(record.id)))
          && same(withoutUpdateNotices(localReview), base.pkg.questions.find(item => item.id === question.id)))
        : baselines.some(({ bank: base }) => !base.pkg.questions.some(item => item.id === question.id)));
      for (const record of saved) sourceOwned.set(record.id, matchesSource(record, incoming, question)
        || baselines.some(({ bank: base, receipt }) => {
          const previous = base.pkg.questions.find(item => item.id === question.id);
          return receipt.questionIds.includes(record.id) && previous && (matchesSource(record, base, previous)
            || (record.needsReview === true && record.content!.flags?.some(flag => flag.message.startsWith(NOTICE))
              && record.correctKey === sourceProjection(base, previous).correctKey && matchesSource(record, incoming, question, true)));
        }));
      const recordsUnchanged = saved.every(record => sourceOwned.get(record.id));
      if (!reviewUnchanged || !recordsUnchanged) {
        const reason = "Local source edits or an unavailable prior source prevent an automatic replacement. Your wording and answers are preserved. Compare the current source below before accepting a mapping.";
        conflicts.set(question.id, reason);
        return withHold(localReview ?? saved[0]?.content ?? question, reason, question);
      }
      if (saved.some(record => !same(record.content!.assets, question.assets))) {
        // The ordinary importer reuses an existing attachment by filename.
        // A changed exhibit needs explicit review; never pair new source text
        // with an older, still-readable image under the same name.
        const reason = "The source images changed. The existing question and images are preserved and held until the updated exhibits are reviewed.";
        conflicts.set(question.id, reason);
        saved.forEach(record => sourceOwned.set(record.id, false));
        return withHold(question, reason);
      }
      if (saved.some(record => record.correctKey !== legacyQuestionFields(incoming.pkg.manifest, question).correctKey)) {
        const reason = "The current source proposes a different answer. The saved answer and attempts are preserved; explicit answer review is required before graded practice.";
        conflicts.set(question.id, reason);
        return withHold(question, reason);
      }
      if (incomingVerdicts.get(question)?.readiness === "ready"
        && saved.some(record => record.needsReview || (record.extraction && !record.extraction.reviewed))) {
        const reason = "Your existing review hold is preserved. Inspect the updated source before confirming its answer mapping.";
        conflicts.set(question.id, reason);
        return withHold(question, reason);
      }
      return question;
    }) } };
    // Keep removed source rows and unfinished local review rows visible. Only
    // records admitted through the verified prior receipt above are retracted.
    const retained = new Map([
      ...records.map(record => [record.content!.id, record.content!] as const),
      ...(storedBank?.pkg.questions.map(question => [question.id, question] as const) ?? []),
    ]);
    for (const question of retained.values()) if (!incomingById.has(question.id))
      bank.pkg.questions.push(withHold(question, RETIRED));
    function assertReviewUnchanged() {
      scope.assertCurrent();
      // The review this install writes: bank-scoped when sibling banks share a source.
      if (!same(useStore.getState().documents.find(document => document.id === reviewId)?.rawText, storedReview?.rawText))
        throw new Error("The local source review changed during download. Its edits were preserved; retry this course.");
    }
    return { bank, assertReviewUnchanged, apply: async issues => {
      await assertRevision(); assertReviewUnchanged();
      const verdicts = packageImportVerdicts(bank.pkg, issues);
      const changes = records.flatMap(record => {
        const candidate = bank.pkg.questions.find(question => question.id === record.content!.id);
        const original = incomingById.get(record.content!.id);
        const reason = conflicts.get(record.content!.id);
        const missing = !original;
        const verdict = candidate && verdicts.get(candidate);
        const held = missing || Boolean(reason) || verdict?.readiness !== "ready" || !verdict.saveable;
        let content = missing ? withHold(record.content!, RETIRED)
          : reason && original && !sourceOwned.get(record.id) ? withHold(record.content!, reason, original) : candidate;
        let preserveReading = missing || Boolean(reason && content !== candidate);
        if (!preserveReading && content && !content.choices.some(choice => choice.label === record.correctKey)) {
          content = withHold(record.content!, "The current choices no longer contain the saved answer. Its original wording and mapping remain held for explicit review.", original);
          preserveReading = true;
        }
        const fields = sourceProjection(bank, content!);
        const sourceFieldsValue: SourceFields = { ...sourceFields(record), content,
          ...(!preserveReading ? { stem: fields.stem, options: fields.options, explanation: fields.explanation } : {
            explanation: blocksToPlainText(content!.explanation ?? []),
          }),
          // A revision is evidence, not a person's permission to regrade history.
          correctKey: record.correctKey,
          correctAnswerText: (preserveReading ? record.options : fields.options).find(option => option.key === record.correctKey)?.text,
          needsReview: held || record.needsReview || undefined,
          extraction: record.extraction ? { ...record.extraction,
            ...(held ? { reviewed: false, warnings: [...new Set([...(record.extraction.warnings ?? []),
              ...(verdict?.reasons ?? []), ...(reason ? [NOTICE + reason] : []), ...(missing ? [NOTICE + "Question removed from current revision."] : []),
            ])] } : {}),
          } : undefined,
        };
        return same(sourceFields(record), sourceFieldsValue) ? [] : [{ expected: record, source: sourceFieldsValue }];
      });
      await commitChanges(changes, scope);
    } };
  };
}
