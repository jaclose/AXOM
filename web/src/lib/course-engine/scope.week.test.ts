import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import type { QuestionRecord } from "../questions";
import {
  groupQuestionsByScope, parseWeek, questionScope, scopeProgress, trackerPathScope,
  type QuestionSetScope,
} from "./scope";

const sourceScope: QuestionSetScope = { module: "FTM 1", week: 3, courseId: "course-a" };
const sourceSets = (scope: QuestionSetScope = sourceScope) => new Map([["source", { scope }]]);
const legacyWeek = (value: unknown): number => value as number;
const question = (id: string, overrides: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id, source: "manual", stem: "Synthetic scope fixture", options: [], status: "unseen",
  tags: [], attempts: [], createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z",
  setId: "source", ...overrides,
});

describe("source-week integrity", () => {
  it("accepts only a complete single-week label or a bounded positive integer", () => {
    for (const [input, expected] of [
      [1, 1], [99, 99], ["2", 2], [" 09 ", 9], ["Week 12", 12],
      ["wk4", 4], ["W5", 5], ["Week: #6", 6], ["wK : 07", 7],
      ["\tWeek 8\n", 8], ["Week\u00a09", 9],
    ] as const) assert.equal(parseWeek(input), expected, String(input));
  });

  it("rejects dates, module labels, ranges, identifiers and invalid values", () => {
    for (const input of [
      undefined, null, true, false, {}, [], 0, -1, 100, 1.5, NaN, Infinity,
      "", " ", "2026-11-05", "FTM 2", "Lecture 3", "Week 2-3", "Week 2–3",
      "Week 10/11", "Week 2,3", "Week 2 & 3", "Week 5 Anatomy", "Weeks 4",
      "Week 0", "Week 100", "-2", "+2", "1.5", "1e1", "0x10", "009", "#2",
      "Week 2\nWeek 3", "Week 2\u0000", "Week ２", "2w",
    ]) assert.equal(parseWeek(input), undefined, String(input));
  });

  it("rejects heavily padded malformed labels within a bounded process", () => {
    // A subprocess bounds a future regexp regression without wedging Vitest.
    const moduleUrl = new URL("./scope.ts", import.meta.url).href;
    const probe = spawnSync(process.execPath, [
      "--experimental-strip-types", "--input-type=module", "--eval",
      `import { parseWeek } from ${JSON.stringify(moduleUrl)};
       for (const prefix of ["Week", "Week:", "Week:#"]) {
         if (parseWeek(prefix + " ".repeat(100_000) + "x") !== undefined) process.exit(1);
       }`,
    ], { encoding: "utf8", timeout: 5_000 });
    assert.equal(probe.error, undefined, probe.error?.message);
    assert.equal(probe.status, 0, probe.stderr);
  });

  it("round-trips every supported week without accepting trailing source text", () => {
    for (let week = 1; week < 100; week += 1) {
      assert.equal(parseWeek(week), week);
      assert.equal(parseWeek(String(week)), week);
      assert.equal(parseWeek(`Week ${week}`), week);
      assert.equal(parseWeek(`wk${week}`), week);
      assert.equal(parseWeek(`W${week}`), week);
      assert.equal(parseWeek(`Week ${week}-100`), undefined);
      assert.equal(parseWeek(`Week ${week} lecture`), undefined);
      assert.equal(parseWeek(`FTM ${week}`), undefined);
    }
  });

  it("inherits a missing or empty legacy week from a compatible source set", () => {
    for (const value of [undefined, null, "", " \t "]) {
      assert.deepEqual(questionScope({ setId: "source", week: legacyWeek(value) }, sourceSets()), sourceScope);
    }
  });

  it("does not replace an explicit invalid question week with the source week", () => {
    for (const value of [0, -1, 100, NaN, "2026-11-05", "Week 3-4", "FTM 2"]) {
      assert.equal(questionScope({ setId: "source", week: legacyWeek(value) }, sourceSets()).week, undefined);
    }
  });

  it("keeps inheritance for canonical spellings of the same module and course", () => {
    for (const module of ["FTM 1", "ftm1", "FTM-1", " FTM 1 "]) {
      assert.equal(questionScope({ setId: "source", module, courseId: "course-a" }, sourceSets()).week, 3);
    }
    assert.equal(questionScope({ setId: "source", module: "NB2" },
      sourceSets({ module: "NB Block 2", week: 12 })).week, 12);
  });

  it("never carries an old source week across contradictory explicit filing", () => {
    for (const filing of [
      { module: "FTM 2" }, { courseId: "course-b" },
      { module: "FTM 2", courseId: "course-b" }, { module: "" }, { courseId: "" },
    ]) assert.equal(questionScope({ setId: "source", ...filing }, sourceSets()).week, undefined);
  });

  it("honors an explicit valid week after refiling without changing source metadata", () => {
    const sets = sourceSets(Object.freeze({ ...sourceScope }));
    const own = Object.freeze({ setId: "source", module: "FTM 2", courseId: "course-b", week: 7 });
    assert.deepEqual(questionScope(own, sets), { module: "FTM 2", courseId: "course-b", week: 7 });
    assert.deepEqual(sets.get("source")?.scope, sourceScope);
    assert.equal(own.week, 7);
  });

  it("validates inherited legacy weeks instead of trusting the TypeScript declaration", () => {
    for (const value of [0, -1, 100, 1.5, NaN, "2026-11-05", "Week 3-4"]) {
      const sets = sourceSets({ ...sourceScope, week: legacyWeek(value) });
      assert.equal(questionScope({ setId: "source" }, sets).week, undefined);
    }
    const sets = sourceSets({ ...sourceScope, week: legacyWeek("Week 4") });
    assert.equal(questionScope({ setId: "source" }, sets).week, 4);
  });

  it("handles absent source sets without inventing a week or losing own filing", () => {
    assert.deepEqual(questionScope({ setId: "missing", module: "FTM 2", courseId: "course-b" }, sourceSets()),
      { module: "FTM 2", courseId: "course-b", week: undefined });
    assert.deepEqual(questionScope({ module: "FTM 2", week: 8 }),
      { module: "FTM 2", week: 8, courseId: undefined });
  });

  it("preserves explicit tracker paths without interpreting ranges or dates as weeks", () => {
    assert.deepEqual(trackerPathScope("Term 1 / FTM 1 / Week 12"), { module: "FTM 1", week: 12 });
    assert.deepEqual(trackerPathScope("T1/FTM1/wk2"), { module: "FTM1", week: 2 });
    assert.deepEqual(trackerPathScope("Term 1 / FTM 1 / Week 12-13"), {});
    assert.deepEqual(trackerPathScope("Term 1 / FTM 1 / 2026-11-05"), {});
  });

  it("keeps held and refiled questions out of week progress without erasing them", () => {
    const at = "2026-11-05T00:00:00Z";
    const questions = [
      question("valid", { status: "correct", attempts: [{ at, status: "correct" }] }),
      question("ambiguous", { week: legacyWeek("Week 3-4"), status: "incorrect", attempts: [{ at, status: "incorrect" }] }),
      question("other-module", { module: "FTM 2" }),
      question("other-course", { courseId: "course-b" }),
    ];
    const snapshot = JSON.stringify(questions);
    assert.deepEqual(scopeProgress(questions, sourceScope, sourceSets()), {
      total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0, questionIds: ["valid"],
    });
    assert.deepEqual(scopeProgress(questions, { module: "FTM 2", week: 3, courseId: "course-a" }, sourceSets()).questionIds, []);
    assert.deepEqual(scopeProgress(questions, { module: "FTM 1", week: 3, courseId: "course-b" }, sourceSets()).questionIds, []);
    assert.deepEqual(scopeProgress(questions, { module: "FTM 1", courseId: "course-a" }, sourceSets()).questionIds, ["valid", "ambiguous"]);
    const groups = groupQuestionsByScope(questions, sourceSets());
    assert.deepEqual(groups.find(group => group.key === "ftm1|w3")?.questionIds, ["valid"]);
    assert.deepEqual(groups.flatMap(group => group.questionIds).sort(), questions.map(q => q.id).sort());
    assert.equal(JSON.stringify(questions), snapshot);
  });
});


describe("verified primary-source progress attribution", () => {
  it("holds conflicting, missing, forged and malformed primary evidence without discarding attempts", () => {
    const at = "2026-11-06T00:00:00Z";
    const ownScope = { module: "NB2", week: 3, courseId: "core" };
    const fullSets = new Map([
      ["primary", { scope: ownScope, questionIds: ["valid", "inherited", "malformed"] }],
      ["elsewhere", { scope: { module: "FTM 1", week: 4, courseId: "elective" },
        questionIds: ["conflict"] }],
      ["review", { scope: ownScope, questionIds: ["valid", "valid", "conflict"] }],
    ]);
    const correct = [{ at, status: "correct" as const }];
    const questions = [
      question("valid", { setId: "primary", ...ownScope, status: "correct", attempts: correct }),
      question("inherited", { setId: "primary" }),
      question("legacy", { setId: undefined, ...ownScope }),
      question("conflict", { setId: "elsewhere", ...ownScope,
        status: "incorrect", attempts: [{ at, status: "incorrect" }] }),
      question("forged", { setId: "primary", ...ownScope, attempts: correct }),
      question("missing", { setId: "missing", ...ownScope, attempts: correct }),
      question("malformed", { setId: "primary", ...ownScope,
        week: legacyWeek("Week 3-4"), attempts: correct }),
      question("unbound-malformed", { setId: undefined, ...ownScope,
        week: legacyWeek("Week 3/4"), attempts: correct }),
    ];
    const before = JSON.stringify(questions);
    const result = scopeProgress(questions, ownScope, fullSets);
    assert.deepEqual(result, {
      total: 3, attempted: 1, firstTimeCorrect: 1, missed: 0,
      questionIds: ["valid", "inherited", "legacy"], sourceReviewHeld: 3,
    });
    const wholeModule = scopeProgress(questions, { module: "NB2", courseId: "core" }, fullSets);
    assert.equal(wholeModule.total, 3);
    assert.equal(wholeModule.sourceReviewHeld, 5);
    const groups = groupQuestionsByScope(questions, fullSets);
    assert.deepEqual(groups.find(group => group.key === "nb2|w3")?.questionIds,
      ["valid", "inherited", "legacy"]);
    assert.deepEqual(groups.find(group => group.key === "unassigned")?.questionIds,
      ["conflict", "forged", "missing", "malformed", "unbound-malformed"]);
    // The old answers remain on the same original records for later review.
    assert.equal(JSON.stringify(questions), before);
  });

  it("deduplicates the same original question rather than inflating progress", () => {
    const attempt = { at: "2026-11-06T00:00:00Z", status: "correct" as const };
    const questionRecord = question("original", {
      setId: "primary", module: "NB2", week: 3, courseId: "core",
      attempts: [attempt], status: "correct",
    });
    const sets = new Map([["primary", { scope: { module: "NB2", week: 3, courseId: "core" },
      questionIds: ["original", "original"] }]]);
    const original = JSON.stringify(questionRecord);
    assert.deepEqual(scopeProgress([questionRecord, questionRecord],
      { module: "NB2", week: 3, courseId: "core" }, sets), {
      total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0, questionIds: ["original"],
    });
    assert.deepEqual(groupQuestionsByScope([questionRecord, questionRecord], sets)
      .flatMap(group => group.questionIds), ["original"]);
    assert.equal(JSON.stringify(questionRecord), original);
  });

  it("holds duplicate IDs with competing primary-source claims in either input order", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([
      ["primary-a", { scope: filing, questionIds: ["shared"] }],
      ["primary-b", { scope: filing, questionIds: ["shared"] }],
    ]);
    const correct = [{ at: "2026-11-06T00:00:00Z", status: "correct" as const }];
    const wrong = [{ at: "2026-11-06T00:00:00Z", status: "incorrect" as const }];
    const a = question("shared", { setId: "primary-a", ...filing, attempts: correct, status: "correct" });
    const b = question("shared", { setId: "primary-b", ...filing, attempts: wrong, status: "incorrect" });
    const before = JSON.stringify([a, b, [...sets]]);
    for (const records of [[a, b], [b, a]]) {
      const progress = scopeProgress(records, filing, sets);
      assert.equal(progress.total, 0);
      assert.equal(progress.attempted, 0);
      assert.equal(progress.sourceReviewHeld, 1);
      assert.deepEqual(progress.questionIds, []);
      assert.deepEqual(groupQuestionsByScope(records, sets)
        .find(group => group.key === "unassigned")?.questionIds, ["shared"]);
    }
    assert.equal(JSON.stringify([a, b, [...sets]]), before);
  });

  it("holds duplicate practice snapshots whose first answers or latest states disagree", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["shared"] }]]);
    const first = question("shared", { setId: "primary", ...filing, status: "correct",
      attempts: [{ at: "2026-11-06T00:00:00Z", status: "correct" }] });
    const second = question("shared", { setId: "primary", ...filing, status: "incorrect",
      attempts: [{ at: "2026-11-06T00:00:00Z", status: "incorrect" }] });
    for (const records of [[first, second], [second, first]]) {
      const progress = scopeProgress(records, filing, sets);
      assert.equal(progress.total, 0);
      assert.equal(progress.sourceReviewHeld, 1);
      assert.deepEqual(groupQuestionsByScope(records, sets)
        .find(group => group.key === "unassigned")?.questionIds, ["shared"]);
    }
  });

  it("holds duplicate originals whose later answer histories conflict despite equal first and current states", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["shared"] }]]);
    const first = { at: "2026-11-06T00:00:00Z", status: "correct" as const };
    const incorrect = { at: "2026-11-06T01:00:00Z", status: "incorrect" as const };
    const correct = { at: "2026-11-06T01:00:00Z", status: "correct" as const };
    const a = question("shared", { setId: "primary", ...filing,
      attempts: [first, incorrect], status: "incorrect" });
    const b = question("shared", { setId: "primary", ...filing,
      attempts: [first, correct, incorrect], status: "incorrect" });
    const before = JSON.stringify([a, b]);
    for (const records of [[a, b], [b, a]]) {
      const progress = scopeProgress(records, filing, sets);
      assert.deepEqual(progress, {
        total: 0, attempted: 0, firstTimeCorrect: 0, missed: 0,
        questionIds: [], sourceReviewHeld: 1,
      });
      assert.deepEqual(groupQuestionsByScope(records, sets)
        .find(group => group.key === "unassigned")?.questionIds, ["shared"]);
    }
    // Timestamps are not an answer-history conflict: identical ordered
    // statuses can be replayed from another device without double credit.
    const replay = question("shared", { setId: "primary", ...filing,
      attempts: [
        { at: "2026-11-07T00:00:00Z", status: "correct" },
        { at: "2026-11-07T01:00:00Z", status: "incorrect" },
      ], status: "incorrect" });
    assert.equal(scopeProgress([a, replay], filing, sets).total, 1);
    assert.equal(scopeProgress([replay, a], filing, sets).sourceReviewHeld, undefined);
    assert.equal(JSON.stringify([a, b]), before);
  });

  it("holds duplicate same-status retakes with different chosen answer keys", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["shared"] }]]);
    const original = question("shared", { setId: "primary", ...filing,
      correctKey: "C", status: "incorrect",
      attempts: [{ at: "2026-11-06T00:00:00Z", status: "incorrect", answerKey: "A" }],
    });
    const disputed = question("shared", { setId: "primary", ...filing,
      correctKey: "C", status: "incorrect",
      attempts: [{ at: "2026-11-06T00:00:00Z", status: "incorrect", answerKey: "B" }],
    });
    const before = JSON.stringify([original, disputed]);
    for (const records of [[original, disputed], [disputed, original]]) {
      const progress = scopeProgress(records, filing, sets);
      assert.deepEqual(progress, {
        total: 0, attempted: 0, firstTimeCorrect: 0, missed: 0,
        questionIds: [], sourceReviewHeld: 1,
      });
      assert.deepEqual(groupQuestionsByScope(records, sets)
        .find(group => group.key === "unassigned")?.questionIds, ["shared"]);
    }
    const equivalentReplay = question("shared", { setId: "primary", ...filing,
      correctKey: "C", status: "incorrect",
      attempts: [{ at: "2026-11-07T01:00:00Z", status: "incorrect", answerKey: "A" }],
    });
    assert.equal(scopeProgress([original, equivalentReplay], filing, sets).total, 1);
    assert.equal(scopeProgress([equivalentReplay, original], filing, sets).sourceReviewHeld, undefined);
    assert.equal(JSON.stringify([original, disputed]), before);
  });

  it("holds a malformed later attempt in a duplicate without crashing the week overview", () => {
    // Older stored JSON accepts an attempts array without validating each
    // member; a corrupt later member must not throw while checking duplicates.
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["shared"] }]]);
    const first = { at: "2026-11-06T00:00:00Z", status: "correct" as const };
    const malformedAttempts = [first, null] as unknown as QuestionRecord["attempts"];
    const corrupt = question("shared", { setId: "primary", ...filing,
      status: "correct", attempts: malformedAttempts });
    const valid = question("shared", { setId: "primary", ...filing,
      status: "correct", attempts: [first, { at: "2026-11-06T01:00:00Z", status: "correct" }] });
    const before = JSON.stringify([corrupt, valid]);
    for (const records of [[corrupt, valid], [valid, corrupt]]) {
      const progress = scopeProgress(records, filing, sets);
      assert.equal(progress.total, 0);
      assert.equal(progress.sourceReviewHeld, 1);
      assert.deepEqual(groupQuestionsByScope(records, sets)
        .find(group => group.key === "unassigned")?.questionIds, ["shared"]);
    }
    assert.equal(JSON.stringify([corrupt, valid]), before);
  });

  it("holds conflicting duplicates with malformed top-level attempt histories without throwing", () => {
    // Imported/legacy JSON may contain a null, missing or non-array attempts
    // container. Do not count disputed same-ID progress or change stored rows.
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["shared"] }]]);
    const valid = question("shared", { setId: "primary", ...filing,
      status: "correct", attempts: [{ at: "2026-11-06T00:00:00Z", status: "correct", answerKey: "A" }] });
    for (const malformed of [null, undefined, "broken-history", { 0: { status: "correct" } }]) {
      const broken = question("shared", { setId: "primary", ...filing,
        status: "correct", attempts: malformed as unknown as QuestionRecord["attempts"] });
      const before = JSON.stringify([valid, broken]);
      for (const records of [[valid, broken], [broken, valid]]) {
        assert.deepEqual(scopeProgress(records, filing, sets), {
          total: 0, attempted: 0, firstTimeCorrect: 0, missed: 0,
          questionIds: [], sourceReviewHeld: 1,
        });
        assert.deepEqual(groupQuestionsByScope(records, sets)
          .find(group => group.key === "unassigned")?.questionIds, ["shared"]);
      }
      assert.equal(JSON.stringify([valid, broken]), before);
    }
  });

  it("does not grant attempted or mastery progress for a lone malformed attempts container", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["alone"] }]]);
    for (const malformed of [null, undefined, "broken-history", { 0: { status: "correct" } }]) {
      const broken = question("alone", { setId: "primary", ...filing, status: "correct",
        attempts: malformed as unknown as QuestionRecord["attempts"] });
      const before = JSON.stringify(broken);
      assert.deepEqual(scopeProgress([broken], filing, sets), {
        total: 1, attempted: 0, firstTimeCorrect: 0, missed: 0, questionIds: ["alone"],
      });
      assert.equal(JSON.stringify(broken), before);
    }
    const valid = question("alone", { setId: "primary", ...filing,
      status: "correct", attempts: [{ at: "2026-11-06T00:00:00Z", status: "correct" }] });
    assert.deepEqual(scopeProgress([valid], filing, sets), {
      total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0, questionIds: ["alone"],
    });
  });

  it("counts equivalent cloned records once without holding legitimate source evidence", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["shared"] }]]);
    const a = question("shared", { setId: "primary", ...filing, status: "correct",
      attempts: [{ at: "2026-11-06T00:00:00Z", status: "correct" }] });
    const b = question("shared", { setId: "primary", ...filing, status: "correct",
      attempts: [{ at: "2026-11-06T01:00:00Z", status: "correct" }] });
    assert.deepEqual(scopeProgress([a, b], filing, sets), {
      total: 1, attempted: 1, firstTimeCorrect: 1, missed: 0, questionIds: ["shared"],
    });
    assert.deepEqual(groupQuestionsByScope([b, a], sets).flatMap(group => group.questionIds),
      ["shared"]);
  });

  it("keeps unrelated week memberships unread during a scoped progress query", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const unrelatedIds = ["other"];
    unrelatedIds.includes = () => { throw new Error("unrelated source membership was scanned"); };
    const sets = new Map([
      ["primary", { scope: filing, questionIds: ["tracked"] }],
      ["unrelated", { scope: { module: "FTM 1", week: 4, courseId: "elective" },
        questionIds: unrelatedIds }],
    ]);
    const records = [
      question("tracked", { setId: "primary", ...filing }),
      question("other", { setId: "unrelated", module: "FTM 1", week: 4, courseId: "elective" }),
    ];
    const progress = scopeProgress(records, filing, sets);
    assert.equal(progress.total, 1);
    assert.equal(progress.sourceReviewHeld, undefined);
  });

  it("holds same-ID duplicates with different source documents or scoring keys", () => {
    const filing = { module: "NB2", week: 3, courseId: "core" };
    const sets = new Map([["primary", { scope: filing, questionIds: ["shared"] }]]);
    const baseline = question("shared", { setId: "primary", ...filing,
      sourceDocumentId: "source-a", correctKey: "A" });
    for (const changes of [{ sourceDocumentId: "source-b" }, { correctKey: "B" }]) {
      const altered = { ...baseline, ...changes };
      for (const pair of [[baseline, altered], [altered, baseline]]) {
        const progress = scopeProgress(pair, filing, sets);
        assert.equal(progress.total, 0);
        assert.equal(progress.sourceReviewHeld, 1);
        assert.deepEqual(groupQuestionsByScope(pair, sets)
          .find(group => group.key === "unassigned")?.questionIds, ["shared"]);
      }
    }
  });
});


describe("source module inheritance after course refiling", () => {
  it("does not assign the old source module to a question moved to a different course", () => {
    const moved = question("moved", { courseId: "course-b" });
    assert.deepEqual(questionScope(moved, sourceSets()), {
      module: undefined, week: undefined, courseId: "course-b",
    });
    assert.equal(scopeProgress([moved], { module: "FTM 1", courseId: "course-b" }, sourceSets()).total, 0);
  });

  it("preserves an explicit week without borrowing a module from the previous course", () => {
    const moved = question("moved", { courseId: "course-b", week: 8 });
    assert.deepEqual(questionScope(moved, sourceSets()), {
      module: undefined, week: 8, courseId: "course-b",
    });
    assert.equal(scopeProgress([moved], { module: "FTM 1", week: 8, courseId: "course-b" }, sourceSets()).total, 0);
  });

  it("preserves explicit new module evidence and compatible inherited module evidence", () => {
    const explicit = question("explicit", { module: "FTM 1", week: 8, courseId: "course-b" });
    assert.deepEqual(questionScope(explicit, sourceSets()), { module: "FTM 1", week: 8, courseId: "course-b" });
    assert.deepEqual(questionScope(question("same", { courseId: "course-a" }), sourceSets()), sourceScope);
    assert.deepEqual(questionScope(question("legacy", { courseId: "course-b" }),
      sourceSets({ module: "FTM 1", week: 3 })), { module: "FTM 1", week: 3, courseId: "course-b" });
  });

  it("keeps unresolved moved questions visible without rewriting their source links or attempts", () => {
    const moved = question("moved", { courseId: "course-b", week: 8,
      attempts: [{ at: "2026-11-05T00:00:00Z", status: "correct" }] });
    const before = JSON.stringify(moved);
    Object.freeze(moved);
    assert.deepEqual(groupQuestionsByScope([moved], sourceSets()), [{
      key: "unassigned", module: undefined, week: undefined, questionIds: ["moved"],
    }]);
    assert.equal(JSON.stringify(moved), before);
  });
});

describe("secondary collections cannot replace primary source evidence", () => {
  it("holds review, custom and legacy missed-review primary pointers without losing attempts", () => {
    const sources = [
      { kind: "review" as const, tags: [] },
      { kind: "custom" as const, tags: [] },
      { kind: undefined, tags: ["missed-review"] },
    ];
    for (const meta of sources) {
      const sets = new Map([["secondary", { scope: sourceScope, questionIds: ["q"], ...meta }]]);
      const q = question("q", {
        setId: "secondary", ...sourceScope, status: "correct",
        attempts: [{ at: "2026-11-06T00:00:00Z", status: "correct" }],
      });
      const snapshot = JSON.stringify(q);
      const progress = scopeProgress([q], sourceScope, sets);
      assert.equal(progress.total, 0);
      assert.equal(progress.sourceReviewHeld, 1);
      assert.deepEqual(groupQuestionsByScope([q], sets).find((group) => group.key === "unassigned")?.questionIds, ["q"]);
      assert.equal(JSON.stringify(q), snapshot);
    }
  });

  it("retains a genuine generated primary source when its own record is compatible", () => {
    const generated = new Map([["generated", {
      kind: "generated" as const, scope: sourceScope, questionIds: ["q"],
    }]]);
    const q = question("q", { setId: "generated", ...sourceScope });
    assert.equal(scopeProgress([q], sourceScope, generated).total, 1);
    assert.deepEqual(groupQuestionsByScope([q], generated).flatMap((group) => group.questionIds), ["q"]);
  });
});

describe("immutable original question content collisions", () => {
  it("holds same-ID rewritten stems and answer options in both orders, preserving records", () => {
    const source = new Map([["source", { scope: sourceScope, questionIds: ["collision"] }]]);
    const original = question("collision", {
      stem: "Which original mechanism is tested?",
      options: [{ key: "A", text: "Original rationale" }, { key: "B", text: "Alternative" }],
      correctKey: "A",
    });
    for (const altered of [
      { ...original, stem: "A different medical mechanism is tested" },
      { ...original, options: [{ key: "A", text: "Changed correct option" }, { key: "B", text: "Alternative" }] },
      { ...original, questionNumber: 40 },
    ]) {
      for (const pair of [[original, altered], [altered, original]]) {
        const before = JSON.stringify(pair);
        const progress = scopeProgress(pair, sourceScope, source);
        assert.equal(progress.total, 0);
        assert.equal(progress.attempted, 0);
        assert.equal(progress.sourceReviewHeld, 1);
        assert.deepEqual(groupQuestionsByScope(pair, source).find(group => group.key === "unassigned")?.questionIds, ["collision"]);
        assert.equal(JSON.stringify(pair), before);
      }
    }
  });

  it("counts a truly equivalent original once, ignoring learner annotations", () => {
    const source = new Map([["source", { scope: sourceScope, questionIds: ["same"] }]]);
    const original = question("same", { stem: "Same original", correctKey: "A" });
    const equivalent = { ...original, notes: "Learner-owned marginal note", marked: true };
    const counted = scopeProgress([equivalent, original], sourceScope, source);
    assert.equal(counted.total, 1);
    assert.deepEqual(counted.questionIds, ["same"]);
    assert.equal(counted.sourceReviewHeld, undefined);
  });
});
