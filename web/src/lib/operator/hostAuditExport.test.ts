import { describe, expect, it } from "vitest";
import { auditCsv, filterHostAudit } from "./hostAuditExport";
import type { OperatorAudit } from "./hostClient";

const sample: OperatorAudit[] = [
  { id: "a1", actor_id: "operator-1", target_id: "account-1", action: "account.role", created_at: "2026-11-07T09:00:00Z", metadata: { reason: "Granted reviewer access", assigned: "moderator" } },
  { id: "a2", actor_id: "operator-2", target_id: "account-2", action: "ai.policy", created_at: "2026-11-06T09:00:00Z", metadata: { reason: "=HYPERLINK(\"https://malicious.example\")", enabled: true } },
];

describe("Host evidence register", () => {
  it("filters only the snapshot actually returned by the server", () => {
    expect(filterHostAudit(sample, "REVIEWER").map((item) => item.id)).toEqual(["a1"]);
    expect(filterHostAudit(sample, "ACCOUNT-2").map((item) => item.id)).toEqual(["a2"]);
    expect(filterHostAudit(sample, "missing")).toEqual([]);
  });

  it("exports documented recent records and neutralizes spreadsheet formulas", () => {
    const csv = auditCsv(sample);
    expect(csv).toContain("Timestamp,Action,Actor ID,Target ID,Reason,Metadata");
    expect(csv).toContain("Granted reviewer access");
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).not.toContain(',"=HYPERLINK(');
    expect(csv.split("\r\n")).toHaveLength(4);
  });

  it("preserves genuinely empty optional identifiers in CSV", () => {
    const line = auditCsv([{ ...sample[0], actor_id: null, target_id: null, metadata: {} }]).split("\r\n")[1];
    expect(line.split(",").slice(2, 5)).toEqual(["", "", ""]);
  });

  it("handles an empty audit register without claiming a complete history", () => {
    const csv = auditCsv([]);
    expect(csv).toBe("Timestamp,Action,Actor ID,Target ID,Reason,Metadata\r\n");
  });
});
