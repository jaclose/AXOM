import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { NAV } from "../../components/shell/nav";
import { createMockProvider } from "../ai/mock";
import type { AIProvider, AiJsonRequest } from "../ai/types";
import { askGuide } from "./ask";
import { guideTokens, matchGuideTopics, POPULAR_GUIDE_TOPICS } from "./match";
import { GUIDE_TOPICS } from "./topics";

const src = fileURLToPath(new URL("../..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const top = (query: string) => matchGuideTopics(query)[0]?.topic.id;

describe("guide topics", () => {
  it("use unique, selector-safe ids and real routes, with one way to show each", () => {
    const routes = new Set<string>(NAV.map((item) => item.id));
    const ids = GUIDE_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const topic of GUIDE_TOPICS) {
      expect(topic.id).toMatch(/^[a-z0-9-]+$/);
      expect(Boolean(topic.settingsTab) !== Boolean(topic.steps?.length), topic.id).toBe(true);
      for (const step of topic.steps ?? []) {
        expect(routes.has(step.route), `${topic.id} → ${step.route}`).toBe(true);
        if (step.target) expect(step.target).toMatch(/^[a-z0-9-]+$/);
      }
    }
    expect(POPULAR_GUIDE_TOPICS.every(Boolean)).toBe(true);
  });

  it("point only at anchors that exist in the app", () => {
    const code = sourceFiles(src).filter((path) => !path.includes(`${join("lib", "guide")}`)).map((path) => readFileSync(path, "utf8")).join("\n");
    const targets = new Set(GUIDE_TOPICS.flatMap((topic) => (topic.steps ?? []).flatMap((step) => (step.target ? [step.target] : []))));
    for (const target of targets) {
      const anchored = code.includes(`data-guide="${target}"`) || code.includes(`data-tour="${target}"`) || code.includes(`"${target}"]`);
      expect(anchored, `no data-guide or data-tour anchor for "${target}"`).toBe(true);
    }
  });
});

describe("local guide matching", () => {
  it("normalizes phrases, plurals and everyday words", () => {
    expect(guideTokens("How do I log in to sync my decks?")).toEqual(["login", "sync", "card"]);
    expect(guideTokens("Generating MCQs")).toEqual(["generat", "question"]);
  });

  it("finds the right place for common questions", () => {
    expect(top("how do I make flashcards from my notes")).toBe("anki-generate");
    expect(top("generate practice questions with AI")).toBe("questions-generate");
    expect(top("import my uworld questions from a pdf")).toBe("questions-import");
    expect(top("log in")).toBe("account");
    expect(top("dark mode")).toBe("appearance");
    expect(top("restore a backup")).toBe("backup");
    expect(top("pomodoro timer")).toBe("pomodoro");
    expect(top("what should I study next")).toBe("command-brief");
    expect(top("report a bug")).toBe("feedback");
    expect(top("turn on claude")).toBe("ai-settings");
  });

  it("matches partial words while typing and returns nothing for filler", () => {
    expect(top("flashc")).toBe("anki-generate");
    expect(matchGuideTopics("how do I")).toEqual([]);
    expect(matchGuideTopics("   ")).toEqual([]);
  });
});

describe("AI guide answers", () => {
  const providerReturning = (reply: unknown) => {
    const completeJson = vi.fn(async (request: AiJsonRequest) => { void request; return reply; });
    return { provider: { info: { kind: "anthropic", label: "Cloud", local: false, requiresKey: false }, available: async () => ({ ok: true, detail: "" }), completeJson } as AIProvider, completeJson };
  };

  it("sends the catalog and page, constrains ids by schema, and keeps only real topics", async () => {
    const { provider, completeJson } = providerReturning({ answer: " Open Anki Lab. ", topicIds: ["anki-generate", "made-up", "anki-generate", "anki-review"] });
    const answer = await askGuide(provider, "  make cards  ", { route: "questions" });
    expect(answer.text).toBe("Open Anki Lab.");
    expect(answer.topics.map((topic) => topic.id)).toEqual(["anki-generate", "anki-review"]);
    const request = completeJson.mock.calls[0][0];
    expect(request).toMatchObject({ task: "guide.ask", maxTokens: 400 });
    expect(request.prompt).toContain("The learner is on: Question Bank");
    expect(request.prompt).toContain("Question: make cards");
    expect(request.prompt).toContain("- backup: Back up or restore your data.");
    const enumIds = (request.schema as { properties: { topicIds: { items: { enum: string[] } } } }).properties.topicIds.items.enum;
    expect(enumIds).toEqual(GUIDE_TOPICS.map((topic) => topic.id));
  });

  it("falls back to local matches without ids, and refuses an empty answer", async () => {
    const answer = await askGuide(createMockProvider(), "how do I back up my data", { route: "dashboard" });
    expect(answer.text).toContain("[DEMO]");
    expect(answer.topics[0].id).toBe("backup");
    await expect(askGuide(providerReturning({ answer: " ", topicIds: [] }).provider, "x", { route: "dashboard" })).rejects.toThrow(/didn't return/);
    await expect(askGuide(providerReturning({}).provider, "   ", { route: "dashboard" })).rejects.toThrow(/Ask a question/);
  });
});
