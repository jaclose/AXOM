import { describe, expect, it } from "vitest";
import { AXOM_CORRESPONDENTS } from "./correspondents";
import { ATLAS25_AXES, ATLAS25_ITEMS, ATLAS25_ORDER, ATLAS25_TARGETS, scoreAtlas25, rankAtlas25, recommendAxom25 } from "./learningPreferences25";

const answers = (count = 30, value = 4) => Object.fromEntries(ATLAS25_ORDER.slice(0, count).map(item => [item.id, value]));

describe("AXOM Living Atlas / preference assessment V3", () => {
  it("uses 25 curated identities, six scales and exactly five original items per scale", () => {
    expect(AXOM_CORRESPONDENTS).toHaveLength(25);
    expect(ATLAS25_AXES).toHaveLength(6);
    expect(ATLAS25_ITEMS).toHaveLength(30);
    expect(ATLAS25_ORDER).toHaveLength(30);
    expect(new Set(ATLAS25_ORDER.map(item => item.id)).size).toBe(30);
    expect(Object.keys(ATLAS25_TARGETS)).toHaveLength(25);
    for (const a of ATLAS25_AXES) expect(ATLAS25_ITEMS.filter(item => item.axis === a.id)).toHaveLength(5);
    for (const p of AXOM_CORRESPONDENTS) expect(ATLAS25_TARGETS[p.id]).toHaveLength(6);
  });

  it("does not infer a personality until every dimension has three answers", () => {
    expect(scoreAtlas25(answers(17)).eligible).toBe(false);
    expect(rankAtlas25(scoreAtlas25(answers(17)))).toEqual([]);
    expect(scoreAtlas25(answers(18)).eligible).toBe(true);
    expect(scoreAtlas25(answers(18)).provisional).toBe(true);
    expect(scoreAtlas25(answers(30)).provisional).toBe(false);
  });

  it("reverse-scores without confusing agreement with proficiency", () => {
    const a = answers();
    for (const item of ATLAS25_ITEMS.filter(item => item.axis === "route")) a[item.id] = item.key === 1 ? 7 : 1;
    expect(scoreAtlas25(a).axes.route.score).toBe(100);
    for (const item of ATLAS25_ITEMS.filter(item => item.axis === "route")) a[item.id] = item.key === 1 ? 1 : 7;
    expect(scoreAtlas25(a).axes.route.score).toBe(0);
  });

  it("has reachable, deterministic reference vectors for all 25 identities", () => {
    for (const p of AXOM_CORRESPONDENTS) {
      const vector = ATLAS25_TARGETS[p.id];
      const a = Object.fromEntries(ATLAS25_ORDER.map(item => {
        const i = ATLAS25_AXES.findIndex(axis => axis.id === item.axis);
        const response = Math.max(1, Math.min(7, Math.round(1 + vector[i] / 100 * 6)));
        return [item.id, item.key === 1 ? response : 8 - response];
      }));
      const winner = rankAtlas25(scoreAtlas25(a))[0];
      expect(winner.id).toBe(p.id);
    }
  });

  it("does not change any grading, privacy or subscription settings", () => {
    const s = scoreAtlas25(answers());
    const proposed = recommendAxom25(s);
    expect(proposed).not.toBeNull();
    expect(proposed?.previewOnly).toBe(true);
    expect(proposed?.requiresApproval).toBe(true);
    expect(proposed?.marketingSubscribed).toBe(false);
    expect(proposed?.journalAccess).toBe(false);
    expect(proposed?.canChangeAnswerKeys).toBe(false);
    expect(proposed?.canChangeGrades).toBe(false);
  });
});
