import { describe, expect, it } from "vitest";
import { AXOM_CORRESPONDENTS, CORRESPONDENT_ORDERS, matchCorrespondent, renderCorrespondentIntroduction, correspondentSender, type CorrespondentId } from "./correspondents";

const base = { userKey: "3c48cf9a-b93d-4de5-8d2a-f5af7efc213a" };
const ids = AXOM_CORRESPONDENTS.map(item => item.id);
const slugs = AXOM_CORRESPONDENTS.map(item => item.localPart);

describe("AXOM Correspondents V2", () => {
  it("keeps exactly 40 distinct, recognizable pseudonyms with safe email local-parts", () => {
    expect(AXOM_CORRESPONDENTS).toHaveLength(40);
    expect(new Set(ids).size).toBe(25);
    expect(new Set(slugs).size).toBe(25);
    for (const item of AXOM_CORRESPONDENTS) {
      expect(item.localPart).toMatch(/^[a-z][a-z0-9-]{1,30}$/);
      expect(item.name.length).toBeGreaterThan(2);
      expect(item.description.length).toBeGreaterThan(20);
    }
  });

  it("places each of the 40 companions in exactly one of eight five-member orders", () => {
    expect(Object.keys(CORRESPONDENT_ORDERS)).toHaveLength(8);
    const listed = Object.values(CORRESPONDENT_ORDERS).flat();
    expect(listed).toHaveLength(40);
    expect(new Set(listed).size).toBe(40);
    expect(new Set(listed)).toEqual(new Set(ids));
    for (const row of Object.values(CORRESPONDENT_ORDERS)) expect(row).toHaveLength(5);
  });

  it("never treats color as a measure of personality or changes an academic preference match", () => {
    const sample = { ...base, academicHouse: "KEEPERS" as const, declaredStyles: ["writing", "reflection"] };
    const warm = matchCorrespondent({ ...sample, selectedAccent: "#DC6C39" });
    const cold = matchCorrespondent({ ...sample, selectedAccent: "#3475CF" });
    expect(warm.id).toBe(cold.id);
    expect(warm.accent).not.toBe(cold.accent);
    expect(warm.reasons.join(" ")).not.toMatch(/color|blue|orange/i);
  });

  it("assigns a deterministic initial name without pretending a personality inference", () => {
    const first = matchCorrespondent(base);
    expect(matchCorrespondent(base)).toEqual(first);
    expect(first.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/starter/i)]));
    expect(first.basis).toBe("starter");
    expect(first.inferredPersonality).toBe(false);
  });

  it("uses declared academic preferences rather than color as personality evidence", () => {
    const sample = { ...base, academicHouse: "ARCHITECTS" as const, selectedAccent: "#226cb4", declaredStyles: ["visual", "systems"] as const };
    const result = matchCorrespondent(sample);
    expect(result.basis).toBe("preferences");
    expect(result.reasons.join(" ")).toMatch(/academic|study|preferences/i);
    expect(result.reasons.join(" ")).not.toMatch(/color|blue|226cb4/i);
    expect(result.inferredPersonality).toBe(false);
    expect(matchCorrespondent(sample).id).toBe(result.id);
  });

  it("ignores journal-derived themes unless the recipient opted in", () => {
    const sample = { ...base, journalThemes: ["creative", "writing"] as const };
    expect(matchCorrespondent(sample)).toEqual(matchCorrespondent(base));
    const optedIn = matchCorrespondent({ ...sample, journalOptIn: true });
    expect(optedIn.reasons.join(" ")).toMatch(/optional journal/i);
    expect(optedIn.reasons.join(" ")).not.toMatch(/creative|writing/i);
    expect(optedIn.inferredPersonality).toBe(false);
  });

  it("ignores arbitrary journal text, sensitive-looking words and unknown tags", () => {
    const withPrivateContent = { ...base, journalOptIn: true, journalThemes: ["medical diagnosis", "private-diary-secret", "creative"] as string[], journalEntries: "DO NOT SEND THIS JOURNAL ENTRY" };
    const result = matchCorrespondent(withPrivateContent);
    const rendered = renderCorrespondentIntroduction(result, { displayName: "<script>bad()</script>", useCase: "welcome", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
    expect(rendered.html).not.toContain("DO NOT SEND THIS JOURNAL ENTRY");
    expect(rendered.html).not.toContain("private-diary-secret");
    expect(rendered.html).not.toContain("medical diagnosis");
    expect(rendered.html).not.toContain("<script>bad()</script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.text).not.toContain("private-diary-secret");
  });

  it("honors the learner's explicit override without changing it for a new color", () => {
    const preferredId = "vellum" as CorrespondentId;
    const result = matchCorrespondent({ ...base, preferredId, selectedAccent: "#d14c23", declaredStyles: ["exploration"] });
    expect(result.id).toBe(preferredId);
    expect(result.basis).toBe("chosen");
    expect(result.reasons).toEqual(["You chose this correspondent."]);
  });

  it("introduces the AXOM academic system before the fictional companion, with a private opt-out", () => {
    const match = matchCorrespondent({ ...base, preferredId: "juniper" });
    const email = renderCorrespondentIntroduction(match, { displayName: "Alex", useCase: "welcome" });
    const axomIntro = email.html.indexOf("Welcome to AXOM");
    const atlasIntro = email.html.indexOf("The Living Atlas");
    const nameReveal = email.html.indexOf("Meet Juniper", atlasIntro);
    expect(axomIntro).toBeGreaterThan(0);
    expect(atlasIntro).toBeGreaterThan(axomIntro);
    expect(nameReveal).toBeGreaterThan(atlasIntro);
    expect(email.text).toContain("forty fictional academic companions");
    expect(email.text).toContain("questions");
    expect(email.text).toContain("change or turn off");
    expect(email.html).not.toMatch(/your color revealed|analyzed your journal|you chose this correspondent/i);
  });

  it("renders an accessible, AXOM-colored welcome diagram and truthful disclosure", () => {
    const match = matchCorrespondent({ ...base, selectedAccent: "#3260ca", declaredStyles: ["precision"] });
    const email = renderCorrespondentIntroduction(match, { displayName: "Alex", useCase: "welcome", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
    expect(email.subject).toMatch(/^AXOM POC · WELCOME · Meet /);
    expect(email.html).toMatch(/ORIGIN/);
    expect(email.html).toMatch(/NATURE/);
    expect(email.html).toMatch(/COMPANION/);
    expect(email.html).toContain("#0D0D0E");
    expect(email.html).toContain("#E6E2D6");
    expect(email.html).toContain("#C8A96A");
    expect(email.html).toContain("axom-orb-512.png");
    expect(email.html).toContain("not a personality assessment");
    expect(email.text).toContain("not a personality assessment");
    expect(email.html).not.toMatch(/<script|<svg|onclick=/i);
  });

  it("keeps sender aliases off unless the domain and reply inbox are explicitly verified", () => {
    const match = matchCorrespondent(base);
    expect(correspondentSender(match, { domain: "axom.info", verifiedDomains: [], replyTo: "team@axom.info" })).toBeNull();
    expect(correspondentSender(match, { domain: "axom.info", verifiedDomains: ["axom.info"], replyTo: "" })).toBeNull();
    const sender = correspondentSender(match, { domain: "axom.info", verifiedDomains: ["axom.info"], replyTo: "team@axom.info" });
    expect(sender).toEqual({ from: expect.stringContaining("<" + match.localPart + "@axom.info>"), replyTo: "team@axom.info" });
  });

  it("includes all eight orders and the fifteen new academic companions", () => {
    const expected = ["orrery", "eidolon", "rook", "thren", "virelai", "tessera", "zephyr", "halcyon", "thistle", "calyx", "aureline", "helion", "caelum", "solara", "noctis"];
    for (const id of expected) expect(ids).toContain(id);
  });

  it("keeps public welcome copy focused on the character, not the private matching rationale", () => {
    const result = matchCorrespondent({ ...base, preferredId: "juniper" });
    const email = renderCorrespondentIntroduction(result, { displayName: "Alex", useCase: "welcome" });
    expect(email.html).toContain("Juniper");
    expect(email.text).toMatch(/living atlas|archive|companion/i);
    expect(email.text).not.toMatch(/you chose this correspondent|selected from your color|because you chose/i);
  });

  it("never enables personalized FROM for security or authentication use cases", () => {
    const match = matchCorrespondent(base);
    const opts = { domain: "axom.info", verifiedDomains: ["axom.info"], replyTo: "team@axom.info" };
    expect(correspondentSender(match, opts, "auth")).toBeNull();
    expect(correspondentSender(match, opts, "security")).toBeNull();
    expect(correspondentSender(match, opts, "deletion_completed")).toBeNull();
    expect(correspondentSender(match, opts, "welcome")?.from).toContain("@axom.info>");
  });

  it("does not claim a journal inference when none was permitted", () => {
    const result = matchCorrespondent({ ...base, selectedAccent: "#C8A96A" });
    const email = renderCorrespondentIntroduction(result, { displayName: "Learner", useCase: "welcome" });
    expect(email.text).toMatch(/archive|companion|learning/i);
    expect(email.text).not.toMatch(/chosen because|selected because|color|you chose/i);
    expect(email.text).not.toMatch(/your diary reveals|we analyzed your journal|clinical profile/i);
  });
});
