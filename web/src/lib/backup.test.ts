import { describe, expect, it } from "vitest";
import { mergeStates, parseImport, toPortableState } from "./backup";
import { makeSeed, SCHEMA_VERSION } from "./seed";
import { normalizeProfile } from "./store";
import { createTextAnnotation } from "./questionAnnotations";
import { buildQuizPool } from "./quiz";
import { DEFAULT_JOURNAL_NOTEBOOK } from "./journalNotebook";

describe("portable backup safety", () => {
  it.each([
    ["tasks", {}], ["courses", "bad"], ["questions", [null]],
    ["journal", [42]], ["documents", null], ["dayPlans", [[]]],
    ["savedQuestionFilters", false], ["dailyWordPuzzles", ["bad"]],
  ])("rejects an explicit malformed %s collection before normalization", (key, value) => {
    for (const schemaVersion of [undefined, SCHEMA_VERSION]) {
      expect(() => parseImport(JSON.stringify({ terms: [], schemaVersion, [String(key)]: value })))
        .toThrow(`invalid workspace collection (${key})`);
    }
  });

  it.each([
    undefined, null, {}, false, "bad", [null], [[]], [{}],
    [{ id: "", name: "NB1" }], [{ id: " ", name: "NB1" }],
    [{ id: 42, name: "NB1" }], [{ id: "m1" }],
    [{ id: "m1", name: null }], [{ id: "m1", name: 42 }],
    [{ id: "m1", name: "NB1" }, {}],
  ].map(modules => ({ modules })))("rejects malformed course modules %j", ({ modules }) => {
    for (const schemaVersion of [undefined, 31, SCHEMA_VERSION]) {
      const course = { ...makeSeed().courses[0], modules };
      expect(() => parseImport(JSON.stringify({ terms: [], schemaVersion, courses: [course] })))
        .toThrow("invalid course module collection");
    }
  });

  it("preserves valid module identifiers, names and empty courses through portable admission", () => {
    const seed = makeSeed();
    seed.courses[0].modules = [{ id: "m1", name: "NB1" }, { id: "m2", name: "" }];
    const populated = parseImport(JSON.stringify(toPortableState(seed)));
    expect(populated.courses).toEqual(seed.courses);
    seed.courses[0].modules = [];
    expect(parseImport(JSON.stringify(toPortableState(seed))).courses).toEqual(seed.courses);
    expect(parseImport(JSON.stringify({ terms: [] })).courses).toEqual([]);
  });

  it.each([undefined, null, 42, false, {}, [], "", "  ", "/", " / / "].map(path => ({ path })))(
    "rejects unusable tracker paths %j before projection", ({ path }) => {
      for (const schemaVersion of [undefined, 31, SCHEMA_VERSION]) {
        const tracker = [{ id: "invalid-tracker", path, label: "Retain original" }];
        expect(() => parseImport(JSON.stringify({ terms: [], schemaVersion, tracker })))
          .toThrow("invalid Course Tracker path");
      }
    },
  );

  it.each(["T2/NB3/Lectures", "Personal reading", " T2 / NB3 ", "T2//NB3"])(
    "preserves the exact usable tracker path %s, including legacy formatting", path => {
      const seed = makeSeed();
      const tracker = [{ ...seed.tracker[0], path }];
      expect(parseImport(JSON.stringify({ terms: [], tracker })).tracker).toEqual(tracker);
    },
  );

  it("accepts omitted and empty legacy tracker collections", () => {
    expect(parseImport(JSON.stringify({ terms: [] })).tracker).toEqual([]);
    expect(parseImport(JSON.stringify({ terms: [], tracker: [] })).tracker).toEqual([]);
  });

  it("continues to accept omitted legacy record collections and valid arrays", () => {
    expect(parseImport(JSON.stringify({ terms: [] })).tasks).toEqual([]);
    const seed = makeSeed();
    const restored = parseImport(JSON.stringify(toPortableState(seed)));
    expect(restored.terms).toEqual(seed.terms);
    expect(restored.tasks).toEqual(seed.tasks);
  });

  it.each([SCHEMA_VERSION + 1, SCHEMA_VERSION + 100])("rejects future workspace schema %s without projecting it to the current schema", (schemaVersion) => {
    const portable = { ...toPortableState(makeSeed()), schemaVersion, futureOnlyRecord: { retained: "original bytes" } };
    expect(() => parseImport(JSON.stringify(portable))).toThrow("newer workspace schema");
  });

  it.each([null, "35", "36", true, -1, 35.5, Number.MAX_SAFE_INTEGER + 1, {}, []])("rejects malformed explicit workspace schema %j", (schemaVersion) => {
    expect(() => parseImport(JSON.stringify({ terms: [], schemaVersion }))).toThrow("invalid workspace schema version");
  });

  it.each([undefined, 0, 31, SCHEMA_VERSION])("still restores supported workspace schema %s", (schemaVersion) => {
    const seed = makeSeed();
    const restored = parseImport(JSON.stringify({ ...toPortableState(seed), schemaVersion }));
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
    expect(restored.terms).toEqual(seed.terms);
  });


  it("round-trips exact learner method descriptions, timing and every preference layer", () => {
    const state = makeSeed();
    const original = "  Exact original words\n".repeat(50);
    state.profile.studyWorkflow = { configured: true, customContext: original, lecturePasses: 4, reviewAfterDays: 7,
      methods: [{ id: "noji", enabled: true, timing: "ongoing", usage: original }],
      itemKindDefaults: { Lab: { lecturePasses: 3, customContext: "Original lab plan" } },
    };
    state.courses[0].studyPlanOverride = { lecturePasses: 5 };
    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.profile.studyWorkflow).toMatchObject(state.profile.studyWorkflow);
    expect(parsed.courses[0].studyPlanOverride).toEqual({ lecturePasses: 5 });
    expect(parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(parsed) })).profile.studyWorkflow).toEqual(parsed.profile.studyWorkflow);
  });
  it("round-trips notebook metadata, autosaved writing, and bounded local attachments on the current schema", () => {
    const state = makeSeed();
    state.profile.journalNotebook = {
      ...DEFAULT_JOURNAL_NOTEBOOK,
      title: "Clinical notebook",
      subtitle: "Daily rounds",
      coverTone: "copper",
      paperTone: "linen",
      laptopTone: "starlight",
      deskAccent: "lamp",
      purpose: "focus",
      writingMode: "free",
      setupCompleted: true,
      feedbackPrompted: false,
      unlockedStyles: ["copper", "linen", "starlight", "lamp"],
    };
    state.journal = [{
      id: "journal-notebook-page",
      date: "2026-07-13T12:00:00.000Z",
      today: "Protected a focus block.",
      tomorrow: "Review renal questions.",
      blockers: "Late start.",
      energy: "Medium",
      rating: "Useful",
      freeWriting: "A local notebook paragraph.",
      wins: ["Finished the lecture"],
      losses: ["Carry flashcards"],
      attachments: [{
        id: "journal-image",
        name: "study-desk.png",
        type: "image/png",
        size: 4,
        createdAt: "2026-07-13T12:01:00.000Z",
        dataUrl: "data:image/png;base64,YXhvbQ==",
      }],
      dayAtAGlance: {
        hiddenSections: ["energy"],
        corrections: { focus: "75 min" },
        includedText: "Focused time: 75 min",
        includedAt: "2026-07-13T12:02:00.000Z",
      },
      notebookStatus: "draft",
      updatedAt: "2026-07-13T12:03:00.000Z",
    }];

    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.profile.journalNotebook).toEqual(state.profile.journalNotebook);
    expect(parsed.journal).toEqual(state.journal);
    expect(JSON.stringify(parsed.journal)).not.toContain("https://");

    const merged = mergeStates(state, makeSeed());
    expect(merged.journal).toEqual(state.journal);
    expect(merged.profile.journalNotebook).toEqual(state.profile.journalNotebook);
  });

  it("round-trips additive dashboard layouts and preserves current layout on non-destructive merge", () => {
    const state = makeSeed();
    state.profile.dashboardLayout = {
      version: 1,
      preset: "custom",
      order: ["welcome", "todayScore", "future-widget"],
      hiddenWidgetIds: ["future-hidden"],
      widgets: {
        welcome: { size: "large", enabledFields: ["date", "quote"] },
        todayScore: { size: "large", enabledFields: [], preferences: { style: "rings" } },
        "future-widget": { size: "small", enabledFields: ["future-field"], futurePreference: { safe: true } },
      },
      dismissedExtraLargeRecommendation: true,
      updatedAt: "2026-07-13T12:00:00.000Z",
      futureLayoutField: "preserved",
    };

    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.profile.dashboardLayout).toMatchObject(state.profile.dashboardLayout);
    const reparsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(parsed) }));
    expect(reparsed.profile.dashboardLayout).toEqual(parsed.profile.dashboardLayout);

    const imported = makeSeed();
    imported.profile.dashboardLayout = {
      ...state.profile.dashboardLayout,
      preset: "study-heavy",
      order: ["questionBank"],
      widgets: { questionBank: { size: "large", enabledFields: ["due"] } },
    };
    expect(mergeStates(state, imported).profile.dashboardLayout).toEqual(state.profile.dashboardLayout);
  });

  it("round-trips a legacy AI widget preference without restoring it to current defaults", () => {
    const state = makeSeed();
    state.profile.dashboardWidgetOrder = ["aiActions", ...(state.profile.dashboardWidgetOrder ?? [])];
    state.profile.hiddenDashboardWidgets = ["aiActions"];
    const portable = toPortableState(state) as unknown as Record<string, unknown>;
    const profile = portable.profile as Record<string, unknown>;
    profile.dashboardWidgetOrder = [...(profile.dashboardWidgetOrder as string[]), "future-unknown-widget"];

    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...portable }));
    expect(restored.profile.dashboardWidgetOrder?.[0]).toBe("aiActions");
    expect(restored.profile.dashboardWidgetOrder).not.toContain("future-unknown-widget");
    expect(restored.profile.hiddenDashboardWidgets).toEqual(["aiActions"]);
    expect(makeSeed().profile.dashboardWidgetOrder).not.toContain("aiActions");
  });

  it("round-trips versioned promise prompt suppression without a schema change", () => {
    const state = makeSeed();
    state.profile.promisePromptStatus = {
      state: "skipped",
      updatedAt: "2026-07-12T12:00:00.000Z",
      promptVersion: "promise-prompt-v1",
    };
    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.profile.promisePromptStatus).toEqual(state.profile.promisePromptStatus);
  });

  it("round-trips optional daily-loop preferences without exporting delivery metadata", () => {
    const state = makeSeed();
    state.profile.dailyLoopReminders = {
      checkInEnabled: false,
      checkInTime: "09:15",
      closeoutEnabled: true,
      closeoutTime: "21:00",
      quietHoursEnabled: true,
      quietHoursStart: "23:00",
      quietHoursEnd: "06:30",
    };
    const portable = toPortableState(state) as unknown as Record<string, unknown>;
    expect(JSON.stringify(portable)).not.toContain("snoozedUntil");

    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...portable }));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.profile.dailyLoopReminders).toEqual(state.profile.dailyLoopReminders);
  });

  it("keeps question-bank records and import diagnostics in the portable state", () => {
    const state = makeSeed();
    state.questions = [{
      id: "q1",
      source: "imported",
      stem: "Stem",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      correctKey: "B",
      correctAnswerText: "Beta",
      explanation: "Because beta.",
      status: "unseen",
      tags: [],
      attempts: [],
      extraction: {
        confidence: "high",
        reviewed: true,
        overallImportConfidence: 0.96,
        parserRuleIds: ["ANSWER.INLINE_LETTER_TEXT"],
        sourceSnippet: "Answer: B. Beta",
        questionSourceSnippet: "Stem\nA. Alpha\nB. Beta",
        questionSourcePage: 2,
        answerEvidenceSnippet: "Answer: B. Beta",
        answerEvidencePage: 7,
        explanationSourceSnippet: "Because beta.",
        explanationSourcePage: 8,
      },
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }];
    const portable = toPortableState(state);
    expect(portable.questions[0].extraction?.sourceSnippet).toContain("Answer: B");
    expect(portable.questions[0].extraction).toMatchObject({
      questionSourcePage: 2,
      answerEvidencePage: 7,
      explanationSourcePage: 8,
    });
    expect(portable.questions[0].correctAnswerText).toBe("Beta");
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...portable }));
    expect(restored.questions[0].extraction).toMatchObject({
      questionSourceSnippet: "Stem\nA. Alpha\nB. Beta",
      answerEvidenceSnippet: "Answer: B. Beta",
      explanationSourceSnippet: "Because beta.",
      questionSourcePage: 2,
      answerEvidencePage: 7,
      explanationSourcePage: 8,
    });
  });

  it("round-trips question notes and annotation metadata", () => {
    const state = makeSeed();
    state.questions = [{
      id: "q-annotation", source: "manual", stem: "Highlight this text", options: [],
      status: "unseen", tags: [], attempts: [], notes: "Private learner note",
      annotations: [{
        id: "ann-1", target: "stem", startOffset: 10, endOffset: 14,
        exactText: "this", prefix: "Highlight ", suffix: " text", tone: "yellow",
        createdAt: "2026-07-16T10:00:00.000Z", updatedAt: "2026-07-16T10:00:00.000Z",
        sourceTextHash: "fnv1a-test", status: "active",
      }],
      createdAt: "2026-07-16T10:00:00.000Z", updatedAt: "2026-07-16T10:00:00.000Z",
    }];
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(restored.questions[0].notes).toBe("Private learner note");
    expect(restored.questions[0].annotations).toEqual([
      expect.objectContaining({
        ...state.questions[0].annotations?.[0],
        sourceTextHash: expect.stringMatching(/^fnv1a-/),
        status: "active",
      }),
    ]);
  });

  it("merges annotation ids without duplication and keeps the later update", () => {
    const current = makeSeed();
    const base = {
      id: "q1", source: "manual" as const, stem: "Stem", options: [], status: "unseen" as const,
      tags: [], attempts: [], createdAt: "2026-07-16T09:00:00.000Z", updatedAt: "2026-07-16T12:00:00.000Z",
    };
    const annotation = {
      id: "ann-1", target: "stem" as const, startOffset: 0, endOffset: 4, exactText: "Stem",
      prefix: "", suffix: "", tone: "yellow" as const, createdAt: "2026-07-16T09:00:00.000Z",
      updatedAt: "2026-07-16T10:00:00.000Z", sourceTextHash: "fnv1a-test", status: "active" as const,
    };
    current.questions = [{ ...base, annotations: [annotation] }];
    const imported = makeSeed();
    imported.questions = [{
      ...base,
      updatedAt: "2026-07-16T11:00:00.000Z",
      annotations: [{ ...annotation, tone: "cyan", updatedAt: "2026-07-16T11:00:00.000Z" }],
    }];
    const merged = mergeStates(current, imported);
    expect(merged.questions[0].annotations).toHaveLength(1);
    expect(merged.questions[0].annotations?.[0]).toMatchObject({ id: "ann-1", tone: "cyan" });
  });

  it("keeps one attempt per block run when two copies hold different versions of it", () => {
    const base = {
      id: "q-run", source: "manual" as const, stem: "Stem", options: [], status: "incorrect" as const,
      tags: [], createdAt: "2026-07-16T09:00:00.000Z",
    };
    const checked = { at: "2026-07-16T10:00:00.000Z", answerKey: "A", status: "incorrect" as const, quizSessionId: "run-1", mode: "tutor" as const, certainty: "sure" as const };
    const manual = { at: "2026-07-15T10:00:00.000Z", answerKey: "B", status: "correct" as const };
    const current = makeSeed();
    current.questions = [{ ...base, updatedAt: "2026-07-16T10:00:00.000Z", attempts: [manual, checked] }];
    const imported = makeSeed();
    imported.questions = [{
      ...base, updatedAt: "2026-07-16T10:05:00.000Z",
      attempts: [manual, { ...checked, errorType: "missed-clue" as const }],
    }];

    for (const merged of [mergeStates(current, imported), mergeStates(imported, current)]) {
      expect(merged.questions[0].attempts).toHaveLength(2);
      // The newer record's version wins, with the run context intact.
      expect(merged.questions[0].attempts[1]).toEqual({ ...checked, errorType: "missed-clue" });
    }
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(imported) }));
    expect(restored.questions[0].attempts[1]).toEqual({ ...checked, errorType: "missed-clue" });
  });

  it("surfaces different-id overlaps as repair-needed after portable restore and merge", () => {
    const stem = "0123456789abcdefghij";
    const base = {
      id: "q-overlap", source: "manual" as const, stem, options: [], status: "unseen" as const,
      tags: [], attempts: [], createdAt: "2026-07-16T09:00:00.000Z", updatedAt: "2026-07-16T12:00:00.000Z",
    };
    const first = createTextAnnotation({
      id: "first", target: "stem", sourceText: stem, startOffset: 0, endOffset: 10,
      tone: "yellow", now: "2026-07-16T10:00:00.000Z",
    });
    const second = createTextAnnotation({
      id: "second", target: "stem", sourceText: stem, startOffset: 5, endOffset: 15,
      tone: "cyan", now: "2026-07-16T11:00:00.000Z",
    });
    const portableState = makeSeed();
    portableState.questions = [{ ...base, annotations: [second, first] }];
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(portableState) }));
    expect(restored.questions[0].annotations).toEqual([
      expect.objectContaining({ id: "second", status: "needs-repair" }),
      expect.objectContaining({ id: "first", status: "active" }),
    ]);

    const current = makeSeed();
    current.questions = [{ ...base, annotations: [first] }];
    const imported = makeSeed();
    imported.questions = [{ ...base, updatedAt: "2026-07-16T13:00:00.000Z", annotations: [second] }];
    const merged = mergeStates(current, imported);
    expect(merged.questions[0].annotations).toHaveLength(2);
    expect(merged.questions[0].annotations?.find((annotation) => annotation.id === "first")?.status).toBe("active");
    expect(merged.questions[0].annotations?.find((annotation) => annotation.id === "second")?.status).toBe("needs-repair");
  });

  it("round-trips attachment metadata in the portable state and merges by id with later updatedAt", () => {
    const attachment = {
      id: "attachment-1", fileName: "figure.png", mimeType: "image/png" as const, byteSize: 1024,
      altText: "Coombs figure", createdAt: "2026-07-17T10:00:00.000Z", updatedAt: "2026-07-17T10:00:00.000Z",
      blobKey: "attachment-1",
    };
    const state = makeSeed();
    state.questions = [{
      id: "q-attach", source: "manual", stem: "Stem", options: [],
      status: "unseen", tags: [], attempts: [],
      attachments: [attachment],
      createdAt: "2026-07-17T10:00:00.000Z", updatedAt: "2026-07-17T10:00:00.000Z",
    }];
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(restored.questions[0].attachments).toEqual([expect.objectContaining({ id: "attachment-1", altText: "Coombs figure" })]);

    // Merge: same attachment id on both sides — later updatedAt wins, no duplicates.
    const current = makeSeed();
    const base = {
      id: "q-attach", source: "manual" as const, stem: "Stem", options: [], status: "unseen" as const,
      tags: [], attempts: [], createdAt: "2026-07-17T09:00:00.000Z", updatedAt: "2026-07-17T12:00:00.000Z",
    };
    current.questions = [{ ...base, attachments: [{ ...attachment, altText: "old", updatedAt: "2026-07-17T09:30:00.000Z" }] }];
    const imported = { ...current, questions: [{ ...base, attachments: [{ ...attachment, altText: "newer", updatedAt: "2026-07-17T11:00:00.000Z" }] }] };
    const merged = mergeStates(current, parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(imported) })));
    const mergedAttachments = merged.questions.find((q) => q.id === "q-attach")?.attachments;
    expect(mergedAttachments).toHaveLength(1);
    expect(mergedAttachments?.[0]).toMatchObject({ id: "attachment-1", altText: "newer" });
  });

  it("loads a legacy schema-v32 question without attachments unchanged", () => {
    const seed = makeSeed();
    seed.questions = [{
      id: "legacy-q", source: "manual", stem: "Old", options: [], status: "unseen",
      tags: [], attempts: [], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    }];
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(seed), schemaVersion: 32 }));
    expect(restored.questions[0].attachments).toBeUndefined();
  });

  it("normalizes malformed attachment metadata on the replace/import path", () => {
    // A hand-edited/corrupt backup restored via replace must go through
    // normalizeQuestionAttachments — not straight into persisted state.
    const malformed = {
      id: "q-mal", source: "manual", stem: "S", options: [], status: "unseen", tags: [], attempts: [],
      createdAt: "2026-07-17T10:00:00.000Z", updatedAt: "2026-07-17T10:00:00.000Z",
      attachments: [
        // no blobKey (must default to id); over-long altText (must cap to 500); wins by updatedAt
        { id: "att-1", fileName: "x.png", mimeType: "image/png", byteSize: 2048, altText: "A".repeat(900), createdAt: "2026-07-17T10:00:00.000Z", updatedAt: "2026-07-17T10:00:00.000Z" },
        // duplicate id, older — deduped away
        { id: "att-1", fileName: "dup.png", mimeType: "image/png", byteSize: 2048, altText: "older", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" },
        // unsupported type — dropped entirely
        { id: "bad", fileName: "v.svg", mimeType: "image/svg+xml", byteSize: 5, altText: "", createdAt: "x", updatedAt: "x" },
      ],
    };
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(makeSeed()), questions: [malformed] }));
    const atts = restored.questions[0].attachments;
    expect(atts).toHaveLength(1);
    expect(atts?.[0].id).toBe("att-1");
    expect(atts?.[0].blobKey).toBe("att-1");
    expect(atts?.[0].altText.length).toBe(500);
  });

  it("round-trips saved filter presets and normalizes their tags (Q2b-3)", () => {
    const state = makeSeed();
    state.savedQuestionFilters = [{
      id: "p1", name: "Cardio finals",
      criteria: { tags: ["Cardiology", "cardiology"], incorrect: true, difficulty: ["hard"] },
      ordering: "random", createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
    }];
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(restored.savedQuestionFilters).toHaveLength(1);
    expect(restored.savedQuestionFilters[0].criteria.tags).toEqual(["cardiology"]);
    expect(restored.savedQuestionFilters[0].ordering).toBe("random");
    // Merge dedupes presets by id.
    const merged = mergeStates(state, restored);
    expect(merged.savedQuestionFilters.filter((f) => f.id === "p1")).toHaveLength(1);
  });

  it("round-trips a question set's filter snapshot, ordering, and seed (Q2b-3)", () => {
    const state = makeSeed();
    state.questions = ["b", "a"].map((id) => ({
      id, source: "manual", stem: `Question ${id}`,
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
      correctKey: "A", status: "unseen", tags: [], attempts: [],
      createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
    }));
    state.questionSets = [{
      id: "set-1", title: "Cardio", sourceDocumentIds: [], createdAt: "2026-07-18T00:00:00.000Z",
      questionIds: ["a", "b"], tags: [], aiEnhanced: false, parserWarnings: [],
      filterSnapshot: { tags: ["cardiology"] }, ordering: "random", seed: "keep-me",
    }];
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    const set = restored.questionSets[0];
    expect(set.questionIds).toEqual(["a", "b"]);
    expect(set.filterSnapshot?.tags).toEqual(["cardiology"]);
    expect(set.seed).toBe("keep-me");
    expect(buildQuizPool(restored.questions, {
      count: 10, status: "all", setIds: [set.id],
    }, restored.questionSets).map((question) => question.id)).toEqual(["a", "b"]);
  });

  it("normalizes imported question tags on the replace path (Q2b-3)", () => {
    const q = {
      id: "q-tags", source: "manual", stem: "S", options: [], status: "unseen",
      tags: ["Cardiology", "cardiology", " RENAL "], attempts: [],
      createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
    };
    const restored = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(makeSeed()), questions: [q] }));
    expect(restored.questions[0].tags).toEqual(["cardiology", "renal"]);
  });

  it("loads a legacy schema-v32 question without annotations unchanged", () => {
    const state = makeSeed();
    state.questions = [{
      id: "legacy", source: "manual", stem: "Legacy", options: [], status: "unseen",
      tags: [], attempts: [], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    }];
    const restored = parseImport(JSON.stringify({ ...toPortableState(state), schemaVersion: 32 }));
    expect(restored.questions[0].annotations).toBeUndefined();
    expect(restored.questions[0].stem).toBe("Legacy");
  });

  it("parses an exported payload without dropping question-bank collections", () => {
    const state = makeSeed();
    state.documents = [{
      id: "doc1", title: "Source", fileName: "source.txt", fileType: "text",
      uploadedAt: "2026-07-10T00:00:00.000Z", rawText: "text", sizeBytes: 4,
      checksum: "abc", tags: [], linkedQuestionSetIds: ["set1"], libraryOnly: false,
    }];
    state.questionSets = [{
      id: "set1", title: "Set", sourceDocumentIds: ["doc1"], createdAt: "2026-07-10T00:00:00.000Z",
      questionIds: [], tags: [], aiEnhanced: false, parserWarnings: [],
    }];
    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.documents[0].checksum).toBe("abc");
    expect(parsed.questionSets[0].sourceDocumentIds).toEqual(["doc1"]);
  });

  it("merge import is additive, keeps the current profile, and lets newer records win", () => {
    const current = makeSeed();
    current.profile.name = "Current user";
    current.questions = [{
      id: "q1", source: "manual", stem: "Current stem", options: [], status: "unseen", tags: [], attempts: [],
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z",
    }];
    const imported = makeSeed();
    imported.profile.name = "Imported user";
    imported.questions = [
      { ...current.questions[0], stem: "Older imported stem", updatedAt: "2026-07-01T00:00:00.000Z" },
      { ...current.questions[0], id: "q2", stem: "New question", updatedAt: "2026-07-03T00:00:00.000Z" },
    ];
    const merged = mergeStates(current, imported);
    expect(merged.profile.name).toBe("Current user");
    expect(merged.questions).toHaveLength(2);
    expect(merged.questions.find((question) => question.id === "q1")?.stem).toBe("Current stem");
    expect(merged.questions.find((question) => question.id === "q2")?.stem).toBe("New question");
  });



  it.each([
    ["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"],
  ] as const)("refuses noncanonical record identities in %s without aliasing or mutation", (collection, identity) => {
    const parse = (records: Array<Record<string, unknown>>) =>
      parseImport(JSON.stringify({ terms: [], [collection]: records }));
    const valid = { [identity]: "1", updatedAt: "2026-11-25T00:00:00Z", value: "valid" };
    for (const bad of [1, 0, true, false, {}, [], ["1"], " ", "\t", " 1", "1 ", "\u00a0"]) {
      const malformed = { [identity]: bad, updatedAt: "2026-11-26T00:00:00Z", value: "malformed" };
      for (const [left, right] of [
        [[valid], [malformed]], [[malformed], [valid]],
        [[], [valid, malformed]], [[], [malformed, valid]],
        [[valid, malformed], []], [[malformed, valid], []], [[], [malformed]],
      ]) {
        const local = parse(left);
        const imported = parse(right);
        const snapshot = JSON.stringify([local, imported]);
        expect(() => mergeStates(local, imported)).toThrow("invalid or noncanonical record identity");
        expect(JSON.stringify([local, imported])).toBe(snapshot);
      }
    }
  });

  it.each([
    ["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"],
  ] as const)("preserves exact string identities and legacy unkeyed records in %s", (collection, identity) => {
    const parse = (records: Array<Record<string, unknown>>) =>
      parseImport(JSON.stringify({ terms: [], [collection]: records }));
    const keyed = ["1", "01", "0", "a", "A", "a b"].map(value => ({ [identity]: value, value }));
    const unkeyed = [{ value: "missing" }, { [identity]: null, value: "null" }, { [identity]: "", value: "empty" }];
    const local = parse([...keyed.slice(0, 3), ...unkeyed]);
    const imported = parse([...keyed.slice(3), ...unkeyed]);
    const snapshot = JSON.stringify([local, imported]);
    expect(mergeStates(local, imported)[collection]).toEqual([...keyed.slice(3), ...keyed.slice(0, 3), ...unkeyed, ...unkeyed]);
    expect(mergeStates(imported, local)[collection]).toEqual([...keyed, ...unkeyed, ...unkeyed]);
    expect(JSON.stringify([local, imported])).toBe(snapshot);
  });

  it.each([
    ["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"],
  ] as const)("orders explicit timestamp instants in %s without changing the stored representation", (collection, identity) => {
    const parse = (records: Array<Record<string, unknown>>) =>
      parseImport(JSON.stringify({ terms: [], [collection]: records }));
    const pairs = [
      ["2026-11-25T05:30:00Z", "2026-11-25T01:00:00-05:00"],
      ["2026-11-25T05:30:00.1234Z", "2026-11-25T05:30:00.123456Z"],
      ["2026-11-25T05:30:00Z", "2026-11-25T05:30:00.1Z"],
      ["2026-11-25T03:30:00Z", "2026-11-24T23:30:00-05:00"],
      [undefined, "2026-11-25T05:30:00Z"],
    ] as const;
    for (const [earlier, later] of pairs) {
      const older = { [identity]: "fixture", ...(earlier === undefined ? {} : { updatedAt: earlier }), value: "old" };
      const newer = { [identity]: "fixture", updatedAt: later, value: "new" };
      for (const ordered of [[older, newer], [newer, older]]) {
        const local = parse([ordered[0]]);
        const imported = parse([ordered[1]]);
        const duplicates = parse(ordered);
        const snapshot = JSON.stringify([local, imported, duplicates]);
        expect(mergeStates(local, imported)[collection]).toEqual([newer]);
        expect(mergeStates(parse([]), duplicates)[collection]).toEqual([newer]);
        expect(mergeStates(duplicates, parse([]))[collection]).toEqual([newer]);
        expect(JSON.stringify([local, imported, duplicates])).toBe(snapshot);
      }
    }
  });

  it.each([
    ["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"],
  ] as const)("handles equivalent instants and structural equality in %s", (collection, identity) => {
    const parse = (records: Array<Record<string, unknown>>) =>
      parseImport(JSON.stringify({ terms: [], [collection]: records }));
    const first = { [identity]: "fixture", updatedAt: "2026-11-25T05:30:00.100Z", value: { a: 1, b: { x: 2, y: 3 } } };
    const reordered = { value: { b: { y: 3, x: 2 }, a: 1 }, updatedAt: first.updatedAt, [identity]: "fixture" };
    const conflict = { ...first, updatedAt: "2026-11-25T00:30:00.1-05:00", value: "different" };
    for (const ordered of [[first, reordered], [reordered, first]]) {
      expect(mergeStates(parse([]), parse(ordered))[collection]).toEqual([first]);
    }
    for (const ordered of [[first, conflict], [conflict, first]]) {
      expect(mergeStates(parse([ordered[0]]), parse([ordered[1]]))[collection]).toEqual([ordered[0]]);
      const duplicates = parse(ordered);
      const snapshot = JSON.stringify(duplicates);
      expect(() => mergeStates(parse([]), duplicates)).toThrow("conflicting records with the same identity and timestamp");
      expect(() => mergeStates(duplicates, parse([]))).toThrow("conflicting records with the same identity and timestamp");
      expect(JSON.stringify(duplicates)).toBe(snapshot);
    }
    const arrays = [{ ...first, value: [1, 2] }, { ...first, value: [2, 1] }];
    expect(() => mergeStates(parse([]), parse(arrays))).toThrow("conflicting records with the same identity and timestamp");
  });

  it.each([
    ["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"],
  ] as const)("refuses incomparable competing timestamps in %s without dropping legacy records", (collection, identity) => {
    const parse = (records: Array<Record<string, unknown>>) =>
      parseImport(JSON.stringify({ terms: [], [collection]: records }));
    const good = { [identity]: "fixture", updatedAt: "2026-11-25T05:30:00Z", value: "valid" };
    for (const invalid of ["2026-11-25T05:30:00", "2026-02-30T00:00:00Z", "2026-11-25", "bad", 42,
      "2026-11-25T24:00:00Z", "2026-11-25T05:30:00+99:00", "2026-11-25T05:30:00Z\n", "2025-02-29T00:00:00Z"]) {
      const bad = { ...good, updatedAt: invalid, value: "legacy" };
      expect(mergeStates(parse([]), parse([bad]))[collection]).toEqual([bad]);
      expect(mergeStates(parse([]), parse([bad, { ...bad }]))[collection]).toEqual([bad]);
      for (const ordered of [[bad, good], [good, bad]]) {
        const local = parse([ordered[0]]);
        const imported = parse([ordered[1]]);
        const snapshot = JSON.stringify([local, imported]);
        expect(() => mergeStates(local, imported)).toThrow("invalid or unzoned timestamp");
        expect(() => mergeStates(parse([]), parse(ordered))).toThrow("invalid or unzoned timestamp");
        expect(JSON.stringify([local, imported])).toBe(snapshot);
      }
    }
  });

  it.each([
    ["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"],
  ] as const)("resolves same-side duplicate chronology in %s before comparing workspaces", (collection, identity) => {
    const record = (value: string, updatedAt: string) => ({ [identity]: "fixture", value, updatedAt });
    const older = record("older", "2026-11-24T00:00:00Z");
    const middle = record("middle", "2026-11-25T00:00:00Z");
    const latest = record("latest", "2026-11-26T00:00:00Z");
    const parse = (records: Array<Record<string, unknown>>) =>
      parseImport(JSON.stringify({ terms: [], [collection]: records }));
    for (const records of [[latest, older], [older, latest]]) {
      const local = parse([middle]);
      const imported = parse(records);
      const snapshot = JSON.stringify([local, imported]);
      expect(mergeStates(local, imported)[collection]).toEqual([latest]);
      expect(mergeStates(imported, local)[collection]).toEqual([latest]);
      expect(mergeStates(parse([]), imported)[collection]).toEqual([latest]);
      expect(JSON.stringify([local, imported])).toBe(snapshot);
    }
    expect(mergeStates(parse([latest]), parse([{ ...latest, value: "other side" }]))[collection]).toEqual([latest]);
    expect(mergeStates(parse([]), parse([latest, { ...latest }]))[collection]).toEqual([latest]);
    const unkeyed = { value: "legacy" };
    const distinct = { ...older, [identity]: "other" };
    expect(mergeStates(parse([distinct, unkeyed]), parse([latest, unkeyed]))[collection])
      .toEqual([latest, distinct, unkeyed, unkeyed]);
  });

  it.each([
    ["tasks", "id"], ["logs", "id"], ["dayPlans", "dayKey"], ["dailyArchives", "date"],
  ] as const)("refuses ambiguous latest duplicates in %s without changing inputs", (collection, identity) => {
    const first = { [identity]: "fixture", updatedAt: "2026-11-25T00:00:00Z", value: "first" };
    const second = { ...first, value: "second" };
    const newest = { ...first, updatedAt: "2026-11-26T00:00:00Z", value: "newest" };
    const parse = (records: Array<Record<string, unknown>>) =>
      parseImport(JSON.stringify({ terms: [], [collection]: records }));
    for (const records of [[first, second], [second, first]]) {
      const local = parse([]);
      const imported = parse(records);
      const snapshot = JSON.stringify([local, imported]);
      expect(() => mergeStates(local, imported)).toThrow("conflicting records with the same identity and timestamp");
      expect(() => mergeStates(imported, local)).toThrow("conflicting records with the same identity and timestamp");
      expect(JSON.stringify([local, imported])).toBe(snapshot);
      expect(mergeStates(local, parse([...records, newest]))[collection]).toEqual([newest]);
      expect(mergeStates(local, parse([newest, ...records]))[collection]).toEqual([newest]);
    }
  });

  it("keeps unlocks and the selected blueprint lane through export and import", () => {
    const state = makeSeed();
    state.profile.unlocks = ["again"];
    state.profile.blueprintMode = "prehealth";
    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.profile.unlocks).toEqual(["again"]);
    expect(parsed.profile.blueprintMode).toBe("prehealth");

    const portable = toPortableState(state) as unknown as Record<string, unknown>;
    Object.assign(portable.profile as Record<string, unknown>, {
      unlocks: ["again", "again", "Not a slug", 7], blueprintMode: "other",
    });
    const cleaned = parseImport(JSON.stringify({ _app: "AXOM", ...portable }));
    expect(cleaned.profile.unlocks).toEqual(["again"]);
    expect(cleaned.profile.blueprintMode).toBeUndefined();
  });

  it("keeps every profile field the store keeps during an account pull", () => {
    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(makeSeed()) }));
    expect(Object.keys(parsed.profile).sort()).toEqual(Object.keys(normalizeProfile({})).sort());
  });

  it("merges unlocks from either workspace while keeping the current blueprint lane", () => {
    const current = makeSeed();
    current.profile.unlocks = ["again"];
    current.profile.blueprintMode = "usmle";
    const imported = makeSeed();
    imported.profile.unlocks = ["hidden-trail", "again"];
    imported.profile.blueprintMode = "prehealth";
    const merged = mergeStates(current, imported);
    expect(merged.profile.unlocks).toEqual(["again", "hidden-trail"]);
    expect(merged.profile.blueprintMode).toBe("usmle");
    expect(mergeStates(makeSeed(), makeSeed()).profile.unlocks).toBeUndefined();

    const malformed = makeSeed();
    (malformed.profile as unknown as Record<string, unknown>).unlocks = 7;
    expect(mergeStates(current, malformed).profile.unlocks).toEqual(["again"]);
  });

  it("restores the account blueprint lane on a fresh device without changing its local identity", () => {
    const current = makeSeed();
    current.profile.name = "Local learner";
    expect(current.profile.blueprintMode).toBeUndefined();
    const account = makeSeed();
    account.profile.name = "Account learner";
    account.profile.blueprintMode = "prehealth";
    const imported = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(account) }));

    const merged = mergeStates(current, imported);
    expect(merged.profile.name).toBe("Local learner");
    expect(merged.profile.blueprintMode).toBe("prehealth");
    expect(current.profile.blueprintMode).toBeUndefined();
  });

  it("merges unique attempt history for the same question instead of dropping the older side", () => {
    const current = makeSeed();
    current.questions = [{
      id: "q1", source: "manual", stem: "Current", options: [], status: "correct", tags: [],
      attempts: [{ at: "2026-07-01T00:00:00.000Z", status: "correct", answerKey: "A" }],
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-03T00:00:00.000Z",
    }];
    const imported = makeSeed();
    imported.questions = [{
      ...current.questions[0], stem: "Imported older", status: "incorrect",
      attempts: [{ at: "2026-07-02T00:00:00.000Z", status: "incorrect", answerKey: "B" }],
      updatedAt: "2026-07-02T00:00:00.000Z",
    }];
    const merged = mergeStates(current, imported);
    expect(merged.questions[0].stem).toBe("Current");
    expect(merged.questions[0].attempts.map((attempt) => attempt.answerKey)).toEqual(["A", "B"]);
  });

  it("upgrades a v31 portable import to the current schema without erasing answer text", () => {
    const legacy = makeSeed() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 31;
    legacy.questions = [{
      id: "q1", stem: "Legacy", options: [{ key: "A", text: "Alpha" }], correctKey: "B",
      correctAnswerText: "Legacy answer", extraction: { confidence: "medium", reviewed: false },
      source: "manual", status: "unseen", tags: [], attempts: [],
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    }];
    const parsed = parseImport(JSON.stringify(legacy));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.questions[0].correctAnswerText).toBe("Legacy answer");
    expect(parsed.questions[0].extraction?.overallImportConfidence).toBe(0.65);
  });

  it("round-trips Daily Games history and shared clock preferences without enabling legacy imports", () => {
    const state = makeSeed();
    state.profile.experimentalFlags = { habits: true, dailyGames: true };
    state.profile.dailyGamesCollapsed = true;
    state.profile.timeZonePreference = { mode: "custom", customTimezone: "America/Grenada" };
    state.profile.clockPreferences = {
      enabled: false,
      showDigital: true,
      showAnalog: true,
      showDigitalSeconds: true,
      showAnalogSeconds: false,
      showDate: true,
      showTimezoneLabel: true,
      hourCycle: "24",
    };
    state.dailyWordPuzzles = [{
      puzzleId: "daily-word:general-1:2026-07-12",
      puzzleDate: "2026-07-12",
      timezone: "America/Grenada",
      wordListVersion: "general-1",
      guesses: ["apple"],
      completed: false,
      won: false,
      startedAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:01:00.000Z",
    }];

    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.profile.experimentalFlags).toEqual({ habits: true, dailyGames: true });
    expect(parsed.profile.dailyGamesCollapsed).toBe(true);
    expect(parsed.profile.timeZonePreference).toEqual({ mode: "custom", customTimezone: "America/Grenada" });
    expect(parsed.profile.clockPreferences?.hourCycle).toBe("24");
    expect(parsed.dailyWordPuzzles).toMatchObject([{
      puzzleId: "daily-word:general-1:2026-07-12",
      guesses: ["APPLE"],
    }]);

    const legacy = toPortableState(makeSeed()) as unknown as Record<string, unknown>;
    const legacyProfile = { ...(legacy.profile as Record<string, unknown>) };
    delete legacyProfile.experimentalFlags;
    delete legacyProfile.timeZonePreference;
    delete legacyProfile.clockPreferences;
    legacy.profile = legacyProfile;
    delete legacy.dailyWordPuzzles;
    const normalizedLegacy = parseImport(JSON.stringify(legacy));
    expect(normalizedLegacy.profile.experimentalFlags?.dailyGames).toBe(false);
    expect(normalizedLegacy.dailyWordPuzzles).toEqual([]);
  });

  it("merges Daily Word puzzles once by puzzleId and deterministically prefers completed progress", () => {
    const current = makeSeed();
    current.profile.experimentalFlags = { dailyGames: false };
    current.profile.timeZonePreference = { mode: "system" };
    current.dailyWordPuzzles = [{
      puzzleId: "daily-word:general-1:2026-07-12",
      puzzleDate: "2026-07-12",
      timezone: "America/Grenada",
      wordListVersion: "general-1",
      guesses: ["APPLE", "BERRY"],
      completed: false,
      won: false,
      startedAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:05:00.000Z",
    }];
    const imported = makeSeed();
    imported.profile.experimentalFlags = { dailyGames: true };
    imported.profile.timeZonePreference = { mode: "custom", customTimezone: "UTC" };
    imported.dailyWordPuzzles = [{
      ...current.dailyWordPuzzles[0],
      guesses: ["APPLE", "BERRY", "CHIME"],
      completed: true,
      won: true,
      completedAt: "2026-07-12T10:04:00.000Z",
      updatedAt: "2026-07-12T10:04:00.000Z",
    }];

    const merged = mergeStates(current, imported);
    expect(merged.dailyWordPuzzles).toHaveLength(1);
    expect(merged.dailyWordPuzzles[0]).toMatchObject({ completed: true, won: true, guesses: ["APPLE", "BERRY", "CHIME"] });
    // Merge imports intentionally keep current profile/preferences.
    expect(merged.profile.experimentalFlags?.dailyGames).toBe(false);
    expect(merged.profile.timeZonePreference).toEqual({ mode: "system" });

    const reverse = mergeStates(imported, current);
    expect(reverse.dailyWordPuzzles).toEqual(merged.dailyWordPuzzles);
  });

  it("round-trips daily requirements, saved Pomodoro presets, and academic stage", () => {
    const state = makeSeed();
    state.profile.academicStageId = "dedicated-board-prep";
    state.profile.customAcademicStage = undefined;
    state.profile.dailySuccess = {
      version: 1,
      configuredAt: "2026-07-12",
      requirements: [{
        id: "req-questions",
        label: "Practice questions",
        enabled: true,
        source: { kind: "practice-questions" },
        aliases: ["UWorld block"],
        excludedSourceRecordIds: ["wrong-match-log"],
        includedSourceRecordIds: ["reassigned-log"],
        weight: 2,
        manualContributions: [{
          id: "manual-questions",
          requirementId: "req-questions",
          dayKey: "2026-07-12",
          value: 15,
          unit: "questions",
          mode: "override",
          createdAt: "2026-07-12T12:00:00.000Z",
          updatedAt: "2026-07-12T12:00:00.000Z",
        }],
        target: 20,
        unit: "questions",
        schedule: { kind: "weekdays", weekdays: [1, 3, 5] },
        trackingStartsAt: "2026-07-12",
        createdAt: "2026-07-12T12:00:00.000Z",
        updatedAt: "2026-07-12T12:00:00.000Z",
      }],
    };
    state.profile.pomodoroPreferences = {
      autoStartBreak: false,
      autoStartFocus: true,
      savedPresets: [{
        id: "preset-deep",
        label: "Deep 90",
        focus: 90,
        break: 20,
        longBreak: 30,
        cyclesBeforeLongBreak: 2,
        intention: "No tabs",
        createdAt: "2026-07-12T12:00:00.000Z",
        updatedAt: "2026-07-12T12:00:00.000Z",
        useCount: 4,
        lastUsedAt: "2026-07-12T13:00:00.000Z",
      }],
    };

    const parsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(state) }));
    expect(parsed.profile.academicStageId).toBe("dedicated-board-prep");
    expect(parsed.profile.dailySuccess?.requirements).toHaveLength(1);
    expect(parsed.profile.dailySuccess?.requirements[0]).toMatchObject({
      id: "req-questions",
      target: 20,
      aliases: ["UWorld block"],
      excludedSourceRecordIds: ["wrong-match-log"],
      includedSourceRecordIds: ["reassigned-log"],
      weight: 2,
      trackingStartsAt: "2026-07-12",
      schedule: { kind: "weekdays", weekdays: [1, 3, 5] },
    });
    expect(parsed.profile.dailySuccess?.requirements[0].manualContributions).toEqual([
      expect.objectContaining({
        id: "manual-questions",
        requirementId: "req-questions",
        dayKey: "2026-07-12",
        value: 15,
        mode: "override",
      }),
    ]);
    const reparsed = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(parsed) }));
    expect(reparsed.profile.dailySuccess).toEqual(parsed.profile.dailySuccess);
    expect(parsed.profile.pomodoroPreferences?.savedPresets).toHaveLength(1);
    expect(parsed.profile.pomodoroPreferences?.savedPresets[0]).toMatchObject({
      id: "preset-deep", focus: 90, break: 20, longBreak: 30, cyclesBeforeLongBreak: 2, useCount: 4,
    });
    expect(parsed.profile.pomodoroPreferences?.autoStartFocus).toBe(true);

    // A legacy import without the new optional fields hydrates without inventing them.
    const legacy = makeSeed();
    delete (legacy.profile as Partial<typeof legacy.profile>).dailySuccess;
    delete (legacy.profile as Partial<typeof legacy.profile>).pomodoroPreferences;
    delete (legacy.profile as Partial<typeof legacy.profile>).academicStageId;
    const parsedLegacy = parseImport(JSON.stringify({ _app: "AXOM", ...toPortableState(legacy) }));
    expect(parsedLegacy.profile.dailySuccess).toBeUndefined();
    expect(parsedLegacy.profile.academicStageId).toBeUndefined();

    // Merge keeps the current device's requirements/presets and duplicates nothing.
    const merged = mergeStates(state, parsedLegacy);
    expect(merged.profile.dailySuccess?.requirements).toHaveLength(1);
    expect(merged.profile.pomodoroPreferences?.savedPresets).toHaveLength(1);
  });
});
