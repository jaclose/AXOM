// Pieces every exam interface shares: the lab reference table, a question's
// exhibit images, and the explanation shown once an answer is revealed. Each
// interface styles them its own way; what they contain is the same.
import { useEffect, useState, type ReactNode } from "react";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionImageAttachment } from "../../lib/questionAttachments";
import { getQuestionAttachmentBlob } from "../../lib/questionAttachments";
import { LAB_SECTIONS, LAB_VALUES_SOURCE, searchLabValues, type LabSection } from "../../data/labValues";
import { formatQuestionTime } from "../../lib/exam/questionTime";
import type { ItemResult } from "../../lib/exam/engine";

export function LabValuesPanel({ autoFocus = true }: { autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<LabSection["id"]>("serum");
  const [showSi, setShowSi] = useState(false);
  const results = query.trim() ? searchLabValues(query) : null;
  const active = LAB_SECTIONS.find((item) => item.id === section)!;
  const rows = results ?? active.values.map((value) => ({ ...value, section: active.title }));
  let lastGroup: string | undefined;
  return (
    <div className="sim-labs">
      <input className="sim-labs-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lab values (e.g. sodium, TSH, CSF glucose)" aria-label="Search lab values" autoFocus={autoFocus} />
      {!results && (
        <div className="sim-labs-tabs" role="tablist" aria-label="Lab sections">
          {LAB_SECTIONS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={section === item.id} className={section === item.id ? "on" : ""} onClick={() => setSection(item.id)}>{item.title}</button>
          ))}
        </div>
      )}
      <label className="sim-labs-si"><input type="checkbox" checked={showSi} onChange={(event) => setShowSi(event.target.checked)} /> SI reference intervals</label>
      <table className="sim-labs-table">
        <thead><tr><th scope="col">Test</th><th scope="col">{showSi ? "SI reference interval" : "Reference range"}</th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const heading = results ? row.section : row.group;
            const showHeading = heading && heading !== lastGroup;
            lastGroup = heading;
            return (
              <FragmentRows key={`${row.section}-${row.group ?? ""}-${row.name}`} heading={showHeading ? heading : undefined}>
                <tr><th scope="row">{row.name}</th><td>{(showSi ? row.si : row.range).split("; ").map((part) => <span key={part}>{part}</span>)}</td></tr>
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      {results && !results.length && <p className="sim-review-empty">No lab value matches “{query}”.</p>}
      <p className="sim-labs-source">{LAB_VALUES_SOURCE}</p>
    </div>
  );
}

function FragmentRows({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <>
      {heading && <tr className="sim-labs-group"><th colSpan={2} scope="colgroup">{heading}</th></tr>}
      {children}
    </>
  );
}

/**
 * Object URLs for a question's images, read from the device vault. An image
 * that is not on this device has no entry (the caller says so in its place).
 */
export function useExhibitUrls(attachments: readonly QuestionImageAttachment[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const signature = attachments.map((attachment) => `${attachment.id}:${attachment.blobKey}`).join("|");
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const attachment of attachments) {
        const record = await getQuestionAttachmentBlob(attachment.blobKey).catch(() => undefined);
        if (record) {
          const url = URL.createObjectURL(record.blob);
          created.push(url);
          next[attachment.id] = url;
        }
      }
      if (!cancelled) setUrls(next);
      else created.forEach((url) => URL.revokeObjectURL(url));
    })();
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return urls;
}

/** What the explanation says first: the result in a word, the right answer, and the time taken. */
export function verdictLine(result: ItemResult | undefined): string {
  return result === "correct" ? "Correct" : result === "incorrect" ? "Incorrect" : result === "omitted" ? "Not answered" : "Answer key not confirmed";
}

export function ExplanationBody({ question, picked, correctKey, result, seconds }: {
  question: QuestionRecord;
  picked?: string;
  correctKey?: string;
  result: ItemResult | undefined;
  seconds: number;
}) {
  const rationales = question.choiceRationales ?? {};
  return (
    <section className="sim-explanation" aria-label="Explanation">
      <div className={`sim-explanation-verdict ${result === "correct" ? "ok" : result === "incorrect" ? "bad" : ""}`}>
        <b>{verdictLine(result)}</b>
        {correctKey && <span>Correct answer: {correctKey}</span>}
        <span>Time spent: {formatQuestionTime(seconds)}</span>
      </div>
      {question.explanation && <div className="sim-explanation-text">{question.explanation.trim()}</div>}
      {Object.keys(rationales).length > 0 && (
        <dl className="sim-rationales">
          {question.options.filter((option) => rationales[option.key]).map((option) => (
            <div key={option.key} className={option.key === correctKey ? "ok" : option.key === picked ? "bad" : ""}>
              <dt>({option.key}) {option.text}</dt>
              <dd>{rationales[option.key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {!question.explanation && !Object.keys(rationales).length && <p className="sim-review-empty">No explanation was imported for this item.</p>}
    </section>
  );
}
