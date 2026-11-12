import { describe, expect, it } from "vitest";
import { isBrowserStorageQuotaFailure } from "./storageQuota";

describe("local storage quota classification", () => {
  it("recognizes the browser's typed quota error", () => {
    expect(isBrowserStorageQuotaFailure(new DOMException("Full", "QuotaExceededError"))).toBe(true);
  });
  it("recognizes a message from a failed importer receipt", () => {
    expect(isBrowserStorageQuotaFailure("QuotaExceededError: browser storage is full")).toBe(true);
  });
  it("recognizes quota failures nested under backup and fallback errors", () => {
    const fallback = new DOMException("Browser storage full", "QuotaExceededError");
    const failure = new AggregateError([new Error("Temporary IndexedDB failure"), fallback], "Could not save backup");
    expect(isBrowserStorageQuotaFailure(new Error("Import failed", { cause: failure }))).toBe(true);
  });
  it("does not confuse a remote provider request quota with device persistence", () => {
    expect(isBrowserStorageQuotaFailure(new Error("Provider request quota reached."))).toBe(false);
  });
  it("fails closed on cyclic causes without looping", () => {
    const circular = new Error("Unrelated error") as Error & { cause: unknown };
    circular.cause = circular;
    expect(isBrowserStorageQuotaFailure(circular)).toBe(false);
  });
});
