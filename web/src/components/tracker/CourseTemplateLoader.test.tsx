// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MAX_COURSE_TEMPLATE_BYTES } from "../../lib/course-engine/templateLibrary";
import { CourseTemplateLoader } from "./CourseTemplateLoader";

const vault = vi.hoisted(() => ({ flush: vi.fn(), add: vi.fn() }));
vi.mock("../../lib/store", () => ({ useStore: () => ({ documents: [], courses: [], terms: [], tracker: [], addDocument: vault.add }) }));
vi.mock("../../lib/localVault", () => ({ getVaultWriteCheckpoint: () => 0, flushLocalVaultWrites: vault.flush, assertVaultWritesSince: () => {} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

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

it.each([
  { name: "wrong-format.pdf", type: "application/pdf", size: 20, message: "plain-text .txt" },
  { name: "too-large.txt", type: "text/plain", size: MAX_COURSE_TEMPLATE_BYTES + 1, message: "exceeds 2 MiB" },
])("rejects a batch containing $name before reading any selected file", async ({ name, type, size, message }) => {
  const validRead = vi.fn().mockResolvedValue("DEMO - Lectures:\nLecture 01 Sample [Lecture]");
  const rejectedRead = vi.fn().mockResolvedValue("invalid");
  const valid = { name: "valid.txt", type: "text/plain", size: 40, text: validRead };
  const rejected = { name, type, size, text: rejectedRead };
  render(<CourseTemplateLoader onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Choose course template files"), {
    target: { files: [valid, rejected] },
  });
  expect((await screen.findByRole("alert")).textContent).toContain(`${name}:`);
  expect(screen.getByRole("alert").textContent).toContain(message);
  expect(validRead).not.toHaveBeenCalled();
  expect(rejectedRead).not.toHaveBeenCalled();
  expect(vault.add).not.toHaveBeenCalled();
  expect(vault.flush).not.toHaveBeenCalled();
});

it("rejects an oversized pasted template before writing to the vault", async () => {
  render(<CourseTemplateLoader onClose={vi.fn()} />);
  fireEvent.click(screen.getByText("Or paste a template"));
  fireEvent.change(screen.getByLabelText("Template text"), {
    target: { value: "x".repeat(MAX_COURSE_TEMPLATE_BYTES + 1) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save and preview" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Pasted template.txt: template exceeds 2 MiB");
  expect(vault.add).not.toHaveBeenCalled();
  expect(vault.flush).not.toHaveBeenCalled();
});

it("reads and previews a valid .txt template after preflight", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const text = "DEMO - Lectures:\nLecture 01 Sample [Lecture]";
  const read = vi.fn().mockResolvedValue(text);
  render(<CourseTemplateLoader onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Choose course template files"), {
    target: { files: [{ name: "demo.txt", type: "text/plain", size: text.length, text: read }] },
  });
  expect(await screen.findByRole("region", { name: "Template for DEMO" })).toBeTruthy();
  expect(read).toHaveBeenCalledOnce();
  expect(vault.add).toHaveBeenCalledOnce();
  expect(vault.flush).toHaveBeenCalledOnce();
});
