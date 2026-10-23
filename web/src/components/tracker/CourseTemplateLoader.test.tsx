// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CourseTemplateLoader } from "./CourseTemplateLoader";

const vault = vi.hoisted(() => ({ flush: vi.fn(), add: vi.fn() }));
vi.mock("../../lib/store", () => ({ useStore: () => ({ documents: [], courses: [], terms: [], tracker: [], addDocument: vault.add }) }));
vi.mock("../../lib/localVault", () => ({ getVaultWriteCheckpoint: () => 0, flushLocalVaultWrites: vault.flush, assertVaultWritesSince: () => {} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("requires one academic edition when two dated plans target the same course", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const user = userEvent.setup();
  render(<CourseTemplateLoader onClose={() => {}} />);
  await user.upload(screen.getByLabelText("Choose course template files"), ["Fall 2026", "Spring 2026"].map(session =>
    new File([`T4 - RHPS - Lectures:\n@academic-term: ${session}\nWeek 10:\nRHPS Lecture 01 Sample [Lecture]`], `${session}.txt`, { type: "text/plain" })));
  expect((await screen.findByRole("alert")).textContent).toContain("Several editions target the same course");
  expect(screen.getByRole("button", { name: "Add 2 items" })).toHaveProperty("disabled", true);
  expect(vault.add).toHaveBeenCalledTimes(2);
});

it("keeps the template text available and does not offer loading after a vault failure", async () => {
  vi.stubGlobal("crypto", webcrypto);
  vault.flush.mockRejectedValueOnce(new Error("Storage is full. Export your work before retrying."));
  const close = vi.fn();
  const user = userEvent.setup();
  render(<CourseTemplateLoader onClose={close} />);
  await user.click(screen.getByText("Or paste a template"));
  const text = "DEMO - Lectures:\nLecture 01 Sample [Lecture]";
  await user.type(screen.getByLabelText("Template text"), text.replace(/\[/g, "[["));
  await user.click(screen.getByRole("button", { name: "Save and preview" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Storage is full");
  expect(screen.queryByRole("region", { name: "Template for DEMO" })).toBeNull();
  expect(screen.getByRole("button", { name: "Nothing to add" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Template text")).toHaveProperty("value", text);
  expect(close).not.toHaveBeenCalled();
  expect(vault.add).toHaveBeenCalledOnce();
});
