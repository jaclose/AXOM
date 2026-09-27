import { describe, expect, it } from "vitest";
import {
  applyStudySuggestion,
  applyStudySuggestions,
  interpretStudyText,
  MAX_STUDY_SUGGESTIONS,
  type StudySuggestion,
} from "./studyInterpretation";
import type { StudyMethodId, StudyWorkflowPreferences } from "./studyPreferences";

/** A configured learner with nothing enabled and non-default numbers, so
 * default-valued phrases (2 passes, 3 days) still produce suggestions. */
function blank(overrides: Partial<StudyWorkflowPreferences> = {}): StudyWorkflowPreferences {
  return { configured: true, methods: [], lecturePasses: 1, reviewAfterDays: 5, ...overrides };
}

function labels(text: string, workflow = blank()): string[] {
  return interpretStudyText(text, workflow).map(suggestion => suggestion.label);
}

function enabledIds(text: string, workflow = blank()): StudyMethodId[] {
  return interpretStudyText(text, workflow).filter(s => s.kind === "enable-method").map(s => s.methodId!);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("interpretStudyText — methods", () => {
  it.each<[string, StudyMethodId, string]>([
    ["I use Anki for everything.", "anki", "Anki"],
    ["AnkiDroid on the bus", "anki", "AnkiDroid"],
    ["the AnKing deck", "anki", "AnKing deck"],
    ["Quizlet sets from classmates", "quizlet", "Quizlet sets"],
    ["I review on Noji", "noji", "Noji"],
    ["Rem Note for my own cards", "remnote", "Rem Note"],
    ["UWorld blocks at night", "practice-questions", "UWorld"],
    ["some Amboss sessions", "practice-questions", "Amboss"],
    ["question banks are key", "practice-questions", "question banks"],
    ["I do questions at night", "practice-questions", "do questions"],
    ["Notion pages", "notes", "Notion"],
    ["I take notes by hand", "notes", "notes"],
    ["I teach it to my roommate", "teach-aloud", "teach it"],
    ["the Feynman technique", "teach-aloud", "Feynman technique"],
    ["I explain out loud while walking", "teach-aloud", "explain out loud"],
    ["active recall on paper", "recall", "active recall"],
    ["lots of blurting", "recall", "blurting"],
    ["Boards and Beyond videos", "external-resource", "Boards and Beyond"],
    ["Pathoma chapter 3", "external-resource", "Pathoma"],
    ["Sketchy for micro", "external-resource", "Sketchy"],
    ["First Aid annotations", "external-resource", "First Aid"],
    ["random YouTube explainers", "external-resource", "YouTube"],
  ])("maps %j to %s with exact evidence", (text, methodId, evidence) => {
    const [first] = interpretStudyText(text, blank());
    expect(first).toMatchObject({ kind: "enable-method", methodId, evidence });
    expect(text).toContain(first.evidence);
  });

  it("uses plain, exact labels and stable ids", () => {
    expect(interpretStudyText("Anki", blank())).toEqual([
      { id: "enable-method:anki", kind: "enable-method", methodId: "anki", label: "Turn on Anki", evidence: "Anki" },
    ]);
    expect(labels("UWorld")).toEqual(["Turn on question-based practice"]);
  });

  it("does not map generic flashcards to any specific app", () => {
    expect(interpretStudyText("I make flashcards for every lecture", blank())).toEqual([]);
    expect(interpretStudyText("flash cards every day", blank())).toEqual([]);
  });

  it("keeps an app-specific card phrase as one mention", () => {
    expect(interpretStudyText("Quizlet flashcards", blank())).toEqual([
      expect.objectContaining({ methodId: "quizlet", evidence: "Quizlet flashcards" }),
    ]);
  });
});

describe("interpretStudyText — negation", () => {
  it.each([
    "I don't use Anki",
    "I don’t use Anki", // typographic apostrophe
    "I DO NOT use Anki",
    "I no longer use Anki",
    "not Anki",
    "I never use Anki",
    "I stopped using Anki",
    "I used to use Anki",
    "I use Pathoma instead of Anki",
  ])("does not suggest a negated method: %j", text => {
    expect(enabledIds(text)).not.toContain("anki");
  });

  it("limits negation to its own clause and carries it across a list", () => {
    expect(enabledIds("I don't use Quizlet, but I use Anki")).toEqual(["anki"]);
    expect(enabledIds("I no longer use Quizlet. Anki now.")).toEqual(["anki"]);
    expect(enabledIds("I don't use Quizlet, Noji or Anki")).toEqual([]);
    expect(enabledIds("I use Anki and not Quizlet")).toEqual(["anki"]);
    expect(enabledIds("I used to use Quizlet but now I use Anki")).toEqual(["anki"]);
  });

  it("treats familiarity and emphasis as affirmative", () => {
    expect(enabledIds("I'm used to Anki")).toEqual(["anki"]);
    expect(enabledIds("not only Anki but also Noji")).toEqual(["anki", "noji"]);
  });

  it("does not suggest negated timing, passes or spacing", () => {
    expect(labels("I use Anki but not before exams")).toEqual(["Turn on Anki"]);
    expect(labels("I don't watch lectures twice")).toEqual([]);
    expect(labels("I don't review after 7 days")).toEqual([]);
  });
});

describe("interpretStudyText — lecture passes", () => {
  it.each<[string, number, string]>([
    ["I watch lectures twice", 2, "watch lectures twice"],
    ["2 passes per lecture", 2, "2 passes"],
    ["I go through each lecture three times", 3, "go through each lecture three times"],
    ["rewatch the lectures 4x", 4, "rewatch the lectures 4x"],
    ["I watch them twice because lectures are dense", 2, "watch them twice"],
  ])("reads %j as %i passes", (text, value, evidence) => {
    expect(interpretStudyText(text, blank())).toEqual([
      expect.objectContaining({ kind: "enable-method", methodId: "lecture-passes", evidence }),
      { id: `lecture-passes:${value}`, kind: "lecture-passes", value, label: `Set usual lecture passes to ${value}`, evidence },
    ]);
  });

  it("clamps pass counts to the Settings maximum and says so", () => {
    expect(interpretStudyText("I watch lectures 10 times", blank())[1]).toMatchObject({
      value: 6,
      label: "Set usual lecture passes to 6 (the most AXOM supports)",
    });
  });

  it("ignores frequencies, playback speed and pronouns without lecture context", () => {
    expect(labels("I watch lectures twice a week")).toEqual([]);
    expect(labels("I watch lectures twice per week")).toEqual([]);
    expect(labels("watch lectures 2x speed")).toEqual([]);
    expect(labels("I watch them twice")).toEqual([]);
    expect(labels("watch lectures 0 times")).toEqual([]);
  });
});

describe("interpretStudyText — review spacing", () => {
  it.each<[string, number]>([
    ["I review after 3 days", 3],
    ["every 2 days", 2],
    ["every other day", 2],
    ["I revisit it a week later", 7],
    ["review again in two weeks", 14],
    ["I review the next day", 1],
    ["I go back over it after a couple of days", 2],
  ])("reads %j as %i days", (text, value) => {
    expect(interpretStudyText(text, blank())).toEqual([
      expect.objectContaining({ kind: "review-after-days", value, label: `Review again after ${value} day${value === 1 ? "" : "s"}` }),
    ]);
  });

  it("clamps spacing to 14 days", () => {
    expect(interpretStudyText("I review after 30 days", blank())).toEqual([
      expect.objectContaining({ value: 14, label: "Review again after 14 days (the most AXOM supports)" }),
    ]);
  });

  it("requires review wording for relative phrases", () => {
    expect(labels("my exam is a week later")).toEqual([]);
    expect(labels("the block starts in 3 days")).toEqual([]);
  });

  it("keeps the first stated value when the text conflicts", () => {
    expect(interpretStudyText("review after 2 days, sometimes after 4 days", blank()).map(s => s.value)).toEqual([2]);
  });
});

describe("interpretStudyText — timing attached to the nearest method", () => {
  it.each<[string, string]>([
    ["Pathoma before lecture", "Use external resources before learning"],
    ["I pre-read with First Aid", "Use external resources before learning"],
    ["Anki after lecture", "Use Anki after the first pass"],
    ["UWorld after learning the material", "Use question-based practice after learning"],
    ["UWorld before exams", "Use question-based practice near an exam"],
    ["blurting during exam week", "Use recall sessions near an exam"],
    ["Anki every day", "Use Anki throughout the course"],
    ["Noji throughout the semester", "Use Noji throughout the course"],
  ])("%j → %s", (text, label) => {
    const suggestions = interpretStudyText(text, blank());
    expect(suggestions.map(s => s.kind)).toEqual(["enable-method", "method-timing"]);
    expect(suggestions[1].label).toBe(label);
    expect(text).toContain(suggestions[1].evidence);
  });

  it("attaches each phrase to the method in its own clause", () => {
    const suggestions = interpretStudyText("before lecture I skim Pathoma and after lecture I do Anki", blank());
    expect(suggestions.filter(s => s.kind === "method-timing").map(s => [s.methodId, s.value, s.evidence])).toEqual([
      ["external-resource", "before", "before lecture I skim Pathoma"],
      ["anki", "after-first-pass", "after lecture I do Anki"],
    ]);
  });

  it("never attaches timing across sentences, to generic flashcards, or to a negated method", () => {
    expect(labels("I use Anki. I watch lectures every day.")).toEqual(["Turn on Anki"]);
    expect(labels("I do flashcards every day on Anki")).toEqual(["Turn on Anki"]);
    expect(labels("I don't use Quizlet every day")).toEqual([]);
  });

  it("orders each method's timing right after its enable suggestion", () => {
    expect(labels("I use Anki every day and do UWorld before exams.")).toEqual([
      "Turn on Anki",
      "Use Anki throughout the course",
      "Turn on question-based practice",
      "Use question-based practice near an exam",
    ]);
  });
});

describe("interpretStudyText — suppression, limits and purity", () => {
  it("never suggests what is already true", () => {
    const workflow = blank({
      methods: [{ id: "anki", enabled: true, timing: "ongoing" }, { id: "practice-questions", enabled: true }, { id: "lecture-passes", enabled: true }],
      lecturePasses: 2,
      reviewAfterDays: 3,
    });
    expect(labels("Anki every day, UWorld before exams, watch lectures twice, review after 3 days", workflow)).toEqual([
      "Use question-based practice near an exam",
    ]);
    // The defaults shown in Settings count as current values.
    expect(labels("2 passes, review after 3 days", { configured: false })).toEqual(["Turn on lecture passes"]);
  });

  it("offers a changed timing and re-enabling a disabled method", () => {
    const workflow = blank({ methods: [{ id: "anki", enabled: false, timing: "near-exam", usage: "Mine" }] });
    expect(labels("Anki every day", workflow)).toEqual(["Turn on Anki", "Use Anki throughout the course"]);
  });

  it("de-duplicates repeated mentions and keeps the earliest evidence", () => {
    const suggestions = interpretStudyText("Pathoma, Sketchy and Boards and Beyond. Anki, then Anki again.", blank());
    expect(suggestions.map(s => [s.id, s.evidence])).toEqual([
      ["enable-method:external-resource", "Pathoma"],
      ["enable-method:anki", "Anki"],
    ]);
  });

  it(`caps the list at ${MAX_STUDY_SUGGESTIONS} in a stable order`, () => {
    const text = "Anki every day, Quizlet before lecture, Noji after lecture, RemNote throughout, UWorld before exams, Notion, blurting, Pathoma, Feynman. Watch lectures three times and review after 4 days.";
    const first = interpretStudyText(text, blank());
    expect(first).toHaveLength(MAX_STUDY_SUGGESTIONS);
    expect(interpretStudyText(text, blank())).toEqual(first);
    expect(new Set(first.map(s => s.id)).size).toBe(first.length);
    expect(first.slice(0, 3).map(s => s.label)).toEqual(["Turn on Anki", "Use Anki throughout the course", "Turn on Quizlet"]);
  });

  it("returns nothing for empty, blank or unrelated text", () => {
    expect(interpretStudyText("", blank())).toEqual([]);
    expect(interpretStudyText("   \n\t ", blank())).toEqual([]);
    expect(interpretStudyText("I study at the library after dinner.", blank())).toEqual([]);
    expect(interpretStudyText(undefined as unknown as string, blank())).toEqual([]);
  });

  it("keeps exact evidence around unicode and in very long text", () => {
    const unicode = "📚 J’étudie avec Anki chaque jour — et j’utilise Pathoma 🧠";
    const suggestions = interpretStudyText(unicode, blank());
    expect(suggestions.map(s => s.evidence)).toEqual(["Anki", "Pathoma"]);
    suggestions.forEach(s => expect(unicode).toContain(s.evidence));

    const long = "I study with my own materials and try to stay consistent. ".repeat(4000) + "Lately I use Noji every day.";
    const started = performance.now();
    expect(labels(long)).toEqual(["Turn on Noji", "Use Noji throughout the course"]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("never modifies the text or the workflow", () => {
    const text = "  I use Anki every day.\n  I watch lectures twice.  ";
    const copy = `${text}`;
    const workflow = deepFreeze(blank({ methods: [{ id: "noji", enabled: true, usage: "keep me" }], customContext: text }));
    expect(() => interpretStudyText(text, workflow)).not.toThrow();
    expect(text).toBe(copy);
    expect(workflow.customContext).toBe(copy);
  });
});

describe("applyStudySuggestion", () => {
  const find = (suggestions: StudySuggestion[], kind: StudySuggestion["kind"]) => suggestions.find(s => s.kind === kind)!;

  it("applies exactly one change and preserves method metadata and original text", () => {
    const original = "  Anki every day.\nI watch lectures three times; review after 4 days.  ";
    const workflow = deepFreeze(blank({
      methods: [{ id: "noji", enabled: true, timing: "after-first-pass", usage: "My words", label: "Own deck" }, { id: "anki", enabled: false, usage: "Old cards" }],
      customContext: original,
      itemKindDefaults: { Lab: { lecturePasses: 3 } },
    }));
    const suggestions = interpretStudyText(original, workflow);

    const enabled = applyStudySuggestion(workflow, find(suggestions, "enable-method"));
    expect(enabled.methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "anki", enabled: true, usage: "Old cards" }),
      expect.objectContaining({ id: "noji", enabled: true, timing: "after-first-pass", usage: "My words", label: "Own deck" }),
    ]));
    expect(enabled).toMatchObject({ lecturePasses: 1, reviewAfterDays: 5, customContext: original, itemKindDefaults: { Lab: { lecturePasses: 3 } } });

    expect(applyStudySuggestion(workflow, find(suggestions, "lecture-passes"))).toMatchObject({ lecturePasses: 3, reviewAfterDays: 5, customContext: original, methods: workflow.methods });
    expect(applyStudySuggestion(workflow, find(suggestions, "review-after-days"))).toMatchObject({ lecturePasses: 1, reviewAfterDays: 4, customContext: original });
    const timed = applyStudySuggestion(workflow, find(suggestions, "method-timing"));
    expect(timed.methods).toContainEqual({ id: "anki", enabled: false, usage: "Old cards", timing: "ongoing" });
    expect(timed.methods).toContainEqual(workflow.methods![0]);
  });

  it("makes every applied suggestion disappear, and Apply all leaves nothing to suggest", () => {
    const text = "Anki every day, UWorld before exams, watch lectures three times, review after 4 days";
    const workflow = blank({ customContext: text });
    const suggestions = interpretStudyText(text, workflow);
    for (const suggestion of suggestions) {
      const next = applyStudySuggestion(workflow, suggestion);
      expect(interpretStudyText(text, next).map(s => s.id)).not.toContain(suggestion.id);
    }
    const all = applyStudySuggestions(workflow, suggestions);
    expect(interpretStudyText(text, all)).toEqual([]);
    expect(all.customContext).toBe(text);
    expect(all.configured).toBe(true);
  });

  it("is a no-op for a suggestion that is already true", () => {
    const workflow = blank({ methods: [{ id: "anki", enabled: true }] });
    const suggestion: StudySuggestion = { id: "enable-method:anki", kind: "enable-method", methodId: "anki", label: "Turn on Anki", evidence: "Anki" };
    expect(applyStudySuggestion(workflow, suggestion)).toBe(workflow);
  });
});
