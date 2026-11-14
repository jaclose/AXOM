// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcademicLibrary } from "./AcademicLibrary";

afterEach(cleanup);
describe("Question Bank's two import routes", () => {
  it("offers an explicit AXOM ZIP picker alongside ordinary source-file import", () => {
    const chooseFile = vi.fn(), chooseZip = vi.fn();
    render(<AcademicLibrary title="Your collection" browse={<p>Existing courses</p>}
      onChooseFile={chooseFile} onChooseZip={chooseZip} />);
    fireEvent.click(screen.getByRole("tab", { name: "Import" }));
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import AXOM ZIP" }));
    expect(chooseZip).toHaveBeenCalledOnce();
    expect(chooseFile).not.toHaveBeenCalled();
  });
});
