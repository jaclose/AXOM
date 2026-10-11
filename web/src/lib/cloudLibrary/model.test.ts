import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { catalogCourses, currentReleases, parseEntry, parseCatalogFile, safeCatalogPath, selectedBanks, verifyCatalogBytes } from "./model";
const release = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bank = { release_id: release, id: "bank-one", kind: "bank", title: "Practice", module: "GOER", term: "Term 5", week: 2, question_count: 2, image_question_count: 1, activity_count: 0, payload_path: "banks/one.json", source_label: "Practice.pdf" };
describe("shared catalog contracts", () => {
  it("rejects traversal, URLs, encoded traversal and control characters", () => {
    for (const path of ["../secret", "/etc/passwd", "a//b", "a/./b", "a\\b", "a/%2e%2e/b", "a?x", "a#x", "a\nb"]) expect(() => safeCatalogPath(path)).toThrow();
    expect(safeCatalogPath("banks/one/assets/scan 1.png")).toBe("banks/one/assets/scan 1.png");
  });
  it("does not turn a failed readiness count into a ready bank", () => {
    expect(parseEntry(bank).question_count).toBe(2);
    for (const patch of [{ question_count: 0 }, { image_question_count: 3 }, { activity_count: 1 }, { week: 0 }, { kind: "unknown" }]) expect(() => parseEntry({ ...bank, ...patch })).toThrow();
  });
  it("preserves term boundaries and deduplicates metadata", () => {
    const first = parseEntry(bank), second = parseEntry({ ...bank, term: "Term 4" });
    const courses = catalogCourses([first, first, second]);
    expect(courses).toHaveLength(2); expect(courses[1].entries).toHaveLength(1);
    expect(() => selectedBanks(courses[1], [])).toThrow(/Select/);
    expect(selectedBanks(courses[1], [`${release}:bank-one`])).toEqual([first]);
  });
  it("selects the latest published version of each catalog, not the largest version string", () => {
    const item = { id: release, catalog_key: "course", title: "Courses", version: "99", published_at: "2026-10-01T00:00:00Z" };
    const later = { ...item, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", version: "2", published_at: "2026-10-02T00:00:00Z" };
    expect(currentReleases([item, later])).toEqual([later]);
  });
  it("requires exact manifest membership and bounded bytes", async () => {
    const bytes = new TextEncoder().encode("verified");
    const digest = await webcrypto.subtle.digest("SHA-256", bytes);
    const hex = Buffer.from(digest).toString("hex");
    const file = parseCatalogFile({ release_id: release, path: "banks/one.json", storage_path: `${release}/banks/one.json`, sha256: hex, byte_size: bytes.length, mime_type: "application/json" });
    await expect(verifyCatalogBytes(file, bytes)).resolves.toBeUndefined();
    await expect(verifyCatalogBytes(file, new TextEncoder().encode("tampered"))).rejects.toThrow(/integrity/);
    await expect(verifyCatalogBytes(file, new Uint8Array(1))).rejects.toThrow(/size/);
    expect(() => parseCatalogFile({ ...file, storage_path: "another-release/banks/one.json" })).toThrow();
    expect(() => parseCatalogFile({ ...file, byte_size: 16777217 })).toThrow();
  });
});
