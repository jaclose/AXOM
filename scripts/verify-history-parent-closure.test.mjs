// R14: an injectable history resolver must not claim attestation from a truncated parent graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCompleteSourceIntegration } from "./verify-source-integration.mjs";

const BASE = "a".repeat(40);
const SOURCE = "b".repeat(40);
const INTEGRATED = "c".repeat(40);
const OMITTED = "d".repeat(40);
const BLOB = "e".repeat(40);
const OLDER = "f".repeat(40);
const CHANGE = { status: "M", path: "docs/approved.md" };
const source = (parents = [BASE]) => ({ sha: SOURCE, parents, changes: [CHANGE] });
const merge = (parents = [BASE, SOURCE]) => ({ sha: INTEGRATED, parents, changes: [CHANGE] });
const manifest = { version: 2, integrationBaseSha: BASE, integratedSha: INTEGRATED,
  sources: [{ baseSha: BASE, sourceSha: SOURCE }] };

function adapters(sourceHistory, integrationHistory) {
  return {
    listChanges: () => [CHANGE],
    isAncestor: (ancestor, descendant) =>
      ancestor === descendant
      || (ancestor === BASE && [SOURCE, INTEGRATED, OMITTED].includes(descendant))
      || (ancestor === SOURCE && descendant === INTEGRATED)
      || (ancestor === OLDER && descendant === BASE),
    readFile: () => ({ mode: "100644", blob: BLOB }),
    listTreePaths: () => [CHANGE.path],
    listHistoryChanges: (_base, tip) => tip === SOURCE ? sourceHistory : integrationHistory,
  };
}

test("v2 rejects a source history inventory that lists the tip but silently omits its parent", () => {
  const missing = [source([OMITTED])];
  const integrated = [source([OMITTED]), merge()];
  assert.throws(() => verifyCompleteSourceIntegration(manifest, adapters(missing, integrated)),
    /incomplete.*history|missing.*parent|unreviewed.*parent/i);
});

test("v2 rejects an unreviewed integration-only parent omitted by the history resolver", () => {
  const completeSource = [source()];
  const truncatedIntegration = [source(), merge([OMITTED, SOURCE])];
  assert.throws(() => verifyCompleteSourceIntegration(manifest, adapters(completeSource, truncatedIntegration)),
    /incomplete.*history|missing.*parent|unreviewed.*parent/i);
});

test("v2 accepts a complete source/integration parent graph and older-main merge ancestry", () => {
  const middle = { sha: OMITTED, parents: [BASE], changes: [CHANGE] };
  const fullSource = [middle, source([OMITTED])];
  const fullIntegration = [middle, source([OMITTED]), merge()];
  assert.equal(verifyCompleteSourceIntegration(manifest, adapters(fullSource, fullIntegration)).commitHistoryAttested, true);
  // A merged parent already preceding the declared base need not be repeated
  // inside the base..tip inventory; a parent outside the range is valid only
  // when the ancestry resolver confirms it is reachable from that base.
  const withOldParent = [source([BASE, OLDER])];
  const allowed = adapters(withOldParent, [source([BASE, OLDER]), merge()]);
  assert.equal(verifyCompleteSourceIntegration(manifest, allowed).commitHistoryAttested, true);
});
