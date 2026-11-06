// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { markVaultWrite, markVaultWriteFailure } from "../../lib/vaultActivity";
import { ProductivitySaveStatus, useProductivitySaveStatus } from "./ProductivitySaveStatus";

function Status() { const status = useProductivitySaveStatus(); return <ProductivitySaveStatus status={status} />; }
afterEach(cleanup);
it("tracks failed and successful saves through vault events", () => {
  render(<Status />);
  act(() => markVaultWriteFailure(new Date("2026-07-13T12:00:00Z")));
  expect(screen.getByRole("status").textContent).toContain("Save failed");
  act(() => markVaultWrite("indexeddb", new Date("2026-07-13T12:01:00Z")));
  expect(screen.getByRole("status").textContent).toContain("Saved on this device");
});
