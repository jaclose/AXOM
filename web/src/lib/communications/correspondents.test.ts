import { describe, expect, it } from "vitest";
import { AXOM_CORRESPONDENTS, matchCorrespondent, renderCorrespondentIntroduction, correspondentSender, type CorrespondentId } from "./correspondents";

const base = { userKey: "3c48cf9a-b93d-4de5-8d2a-f5af7efc213a" };
const ids = AXOM_CORRESPONDENTS.map(item => item.id);
const slugs = AXOM_CORRESPONDENTS.map(item => item.localPart);

describe("AXOM Correspondents V1", () => {
  it("keeps exactly 25 distinct, recognizable pseudonyms with safe email local-parts", () => {
    expect(AXOM_CORRESPONDENTS).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(new Set(slugs).size).toBe(25);
    for (const item of AXOM_CORRESPONDENTS) {
      expect(item.localPart).toMatch(/^[a-z][a-z0-9-]{1,30}$/);
      expect(item.name.length).toBeGreaterThan(2);
      expect(item.description.length).toBeGreaterThan(20);
    }
  });

  it("assigns a deterministic initial name without pretending a personality inference", () => {
    const first = matchCorrespondent(base);
    expect(matchCorrespondent(base)).toEqual(first);
    expect(first.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/starter/i)]));
    expect(first.basis).toBe("starter");
    expect(first.inferredPersonality).toBe(false);
  });

  it("uses intentionally selected colors and declared work styles, not a secret personality score", () => {
    const sample = { ...base, selectedAccent: "#226cb4", declaredStyles: ["visual", "systems"] as const };
    const result = matchCorrespondent(sample);
    expect(result.basis).toBe("preferences");
    expect(result.reasons.join(" ")).toMatch(/color|visual|systems/i);
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

  it("renders an accessible, AXOM-colored welcome diagram and truthful disclosure", () => {
    const match = matchCorrespondent({ ...base, selectedAccent: "#3260ca", declaredStyles: ["precision"] });
    const email = renderCorrespondentIntroduction(match, { displayName: "Alex", useCase: "welcome", orbUrl: "https://axom.info/icons/axom-orb-512.png" });
    expect(email.subject).toMatch(/^AXOM POC · WELCOME · Meet /);
    expect(email.html).toMatch(/SOURCE/);
    expect(email.html).toMatch(/MATCH/);
    expect(email.html).toMatch(/CORRESPONDENT/);
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
    expect(email.text).toMatch(/based on preferences you shared|starter/i);
    expect(email.text).not.toMatch(/your diary reveals|we analyzed your journal|clinical profile/i);
  });
});
