// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AboutPage } from "./AboutPage";
import { HelpPage } from "./HelpPage";

afterEach(cleanup);

describe("Daily Word help and status", () => {
  it("shows the eager-safe dictionary version and local policy in Help", () => {
    render(<HelpPage />);
    expect(screen.getAllByText(/Dictionary general-2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/8,659 local allowed words/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no network dictionary call/i).length).toBeGreaterThan(0);
  });

  it("describes Daily Word truthfully as an optional local-first ready feature", () => {
    render(<AboutPage />);
    expect(screen.getByText("AXOM Daily Word")).toBeTruthy();
    expect(screen.getByText(/Optional local-first five-letter puzzle/)).toBeTruthy();
    expect(screen.getByText(/after one successful online load/)).toBeTruthy();
    expect(screen.getByText(/hosted sign-in and owner-side publication to authenticated accounts are active/i)).toBeTruthy();
    expect(screen.getByText(/ordinary-account access and cross-device save\/restore have not passed independent live acceptance/i)).toBeTruthy();
    expect(screen.queryByTitle("Live site preview")).toBeNull();
  });
});
