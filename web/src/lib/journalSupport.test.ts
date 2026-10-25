import { describe, expect, it } from "vitest";
import { journalReflectionNeedsSupport } from "./journalSupport";

describe("journalReflectionNeedsSupport", () => {
  it.each([
    "I want to hurt myself.",
    "I keep thinking about suicide.",
    "I don't want to be alive.",
    "I would be better off not here.",
    "My family would be better off without me.",
  ])("recognizes direct first-person safety language: %s", (reflection) => {
    expect(journalReflectionNeedsSupport([reflection])).toBe(true);
  });

  it.each([
    "I reviewed the suicide risk assessment lecture.",
    "The patient reports wanting to harm himself.",
    "Add self-harm screening to the study guide.",
    "Suicide is a public health concern.",
    "I wrote a safety plan for my patient.",
    "I can't keep going with this lecture tonight.",
  ])("does not infer distress from educational or third-person text: %s", (reflection) => {
    expect(journalReflectionNeedsSupport([reflection])).toBe(false);
  });

  it("checks each learner-authored field without combining unrelated fragments", () => {
    expect(journalReflectionNeedsSupport(["A difficult day", "I feel suicidal", "Review tomorrow"])).toBe(true);
    expect(journalReflectionNeedsSupport(["I plan to", "review self-harm screening"])).toBe(false);
  });
});
