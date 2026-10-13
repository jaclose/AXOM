import { describe, expect, it } from "vitest";
import { workspaceDelta } from "./workspaceDelta";
import type { CloudSnapshot } from "./cloudSnapshot";

const packed = (workspace: unknown): CloudSnapshot => ({ _axomCloudFormat: 2, _axomDeltaFormat: 1,
  content: JSON.stringify(workspace), expandedBytes: 0, media: [], sources: [] });

describe("revision-bound workspace changes", () => {
  it("sends one answer independently of unchanged question count", () => {
    const transfer = (count: number) => {
      const questions = Array.from({ length: count }, (_, i) => ({ id: `q${i}`, notes: "", attempts: [] }));
      const before = packed({ questions, profile: { name: "Learner" } });
      const after = packed({ questions: [{ ...questions[0], notes: "Recall the figure", attempts: [{ id: "attempt-1", answer: "A" }] }, ...questions.slice(1)], profile: { name: "Learner" } });
      return workspaceDelta(before, after);
    };
    expect(transfer(10000)).toEqual(transfer(1));
    expect(JSON.stringify(transfer(10000)).length).toBeLessThan(250);
  });
  it("preserves reorders, removals, false/null values and nested edits", () => {
    const before = packed({ records: [{ id: "a", note: "keep" }, { id: "b" }, { id: "c" }], flag: true, removed: 7 });
    const after = packed({ records: [{ id: "b", note: "new" }], flag: false, added: null });
    expect(workspaceDelta(before, after)).toEqual([
      { op: "remove", path: ["workspace", "removed"] },
      { op: "set", path: ["workspace", "records", "0", "id"], value: "b" },
      { op: "set", path: ["workspace", "records", "0", "note"], value: "new" },
      { op: "remove", path: ["workspace", "records", "2"] },
      { op: "remove", path: ["workspace", "records", "1"] },
      { op: "set", path: ["workspace", "flag"], value: false },
      { op: "set", path: ["workspace", "added"], value: null },
    ]);
    expect(workspaceDelta(after, after)).toEqual([]);
  });
});
