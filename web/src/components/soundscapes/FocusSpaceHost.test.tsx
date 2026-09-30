// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FocusSpaceHost } from "./FocusSpaceHost";
import { useFocusSpace } from "../../lib/soundscapes/focusSpaces";

vi.mock("./ScenePlayer", () => ({ ScenePlayer: () => null }));
vi.mock("./SoundscapeVisual", () => ({ SoundscapeVisual: () => null }));
beforeEach(() => { useFocusSpace.setState({ open: false, selected: "axom", compact: false, immersive: false }); });
afterEach(cleanup);

it("keeps one identical frame through preview, expansion and immersive view", () => {
  const { container } = render(<><div className="shell" /><FocusSpaceHost /></>);
  act(() => useFocusSpace.getState().select("site:fluid", true));
  const frame = screen.getByTitle("Fluid painting");
  expect(container.contains(frame)).toBe(false); // body portal, outside route containers
  fireEvent.click(screen.getByRole("button", { name: "Expand experience" }));
  expect(screen.getByTitle("Fluid painting")).toBe(frame);
  expect(document.querySelector<HTMLElement>(".shell")!.inert).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Enter immersive view" }));
  expect(screen.getByTitle("Fluid painting")).toBe(frame);
  fireEvent.click(screen.getByRole("button", { name: "Next experience" }));
  expect(document.querySelectorAll(".experience-host iframe")).toHaveLength(1);
  expect(frame.isConnected).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Close focus space" }));
  expect(document.querySelectorAll(".experience-host iframe")).toHaveLength(0);
  expect(document.querySelector<HTMLElement>(".shell")!.inert).toBe(false);
});

it("unloads a stopped experience, restarts explicitly, and restores keyboard focus", () => {
  render(<><button>Open world</button><FocusSpaceHost /></>);
  const trigger = screen.getByRole("button", { name: "Open world" });
  trigger.focus();
  act(() => useFocusSpace.getState().select("site:fluid"));
  const frame = screen.getByTitle("Fluid painting");
  fireEvent.click(screen.getByRole("button", { name: "Stop experience" }));
  expect(frame.isConnected).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  expect(screen.getByTitle("Fluid painting")).not.toBe(frame);
  fireEvent.click(screen.getByRole("button", { name: "Close focus space" }));
  expect(document.activeElement).toBe(trigger);
});
