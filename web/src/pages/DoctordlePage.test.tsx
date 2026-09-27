// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DoctordlePage } from "./DoctordlePage";

afterEach(cleanup);
describe("Doctordle external boundary", () => {
  it("links safely to the verified destination without embedding it", () => {
    const { container } = render(<DoctordlePage />);
    const link = screen.getByRole("link", { name: /open doctordle.org/i });
    expect(link.getAttribute("href")).toBe("https://doctordle.org/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/does not embed/i)).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });
});
