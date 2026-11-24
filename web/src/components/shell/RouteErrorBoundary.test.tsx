// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary, isChunkLoadError } from "./RouteErrorBoundary";

vi.mock("../../lib/updateCheckpoint", () => ({ createUpdateCheckpoint: vi.fn() }));
vi.mock("../../lib/webUpdates", () => ({ activateWaitingWebUpdate: vi.fn() }));
vi.mock("../../lib/backup", () => ({ exportStateWithAttachments: vi.fn() }));
import { createUpdateCheckpoint } from "../../lib/updateCheckpoint";
import { activateWaitingWebUpdate } from "../../lib/webUpdates";

function Boom({ error }: { error: Error }): never { throw error; }

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("RouteErrorBoundary", () => {
  it("recognises failed lazy chunks from each browser", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://axom.info/assets/DailyWordPage-abc.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    // A screen's stylesheet from an older build (Vite preload helper wording).
    expect(isChunkLoadError(new Error("Unable to preload CSS for https://www.axom.info/assets/PatchNotesPage-CiphMviP.css"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of null (reading 'map')"))).toBe(false);
  });

  it("treats a stylesheet that failed to load as an outdated screen, not a retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteErrorBoundary onHome={() => {}}><Boom error={new Error("Unable to preload CSS for https://www.axom.info/assets/SharedDailyLeaderboard-BSw6khOX.css")} /></RouteErrorBoundary>);
    expect(screen.getByRole("heading", { name: "This screen needs the latest AXOM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reload AXOM/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("keeps a stale-deploy failure inside the shell and offers a reload", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteErrorBoundary onHome={() => {}}><Boom error={new TypeError("Failed to fetch dynamically imported module: x.js")} /></RouteErrorBoundary>);
    expect(screen.getByRole("heading", { name: "This screen needs the latest AXOM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reload AXOM/ })).toBeTruthy();
  });

  it("offers a backup, then a refresh, when the save before reloading fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createUpdateCheckpoint).mockReset();
    vi.mocked(activateWaitingWebUpdate).mockReset();
    vi.mocked(createUpdateCheckpoint).mockRejectedValueOnce(new Error("Could not verify the saved workspace."));
    render(<RouteErrorBoundary onHome={() => {}}><Boom error={new Error("Unable to preload CSS for https://www.axom.info/assets/ReportsPage-x.css")} /></RouteErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Reload AXOM" }));
    const group = await screen.findByRole("group", { name: "Refresh after a backup" });
    expect(within(group).getByRole("button", { name: /Download backup/ })).toBeTruthy();
    // Refreshing waits until a backup of what is open has been downloaded.
    expect(within(group).getByRole("button", { name: /Refresh now/ }).hasAttribute("disabled")).toBe(true);
    expect(activateWaitingWebUpdate).not.toHaveBeenCalled();
  });

  it("lets a render failure retry and go home", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onHome = vi.fn();
    let fail = true;
    function Flaky() { if (fail) throw new Error("render broke"); return <p>screen ok</p>; }
    render(<RouteErrorBoundary onHome={onHome}><Flaky /></RouteErrorBoundary>);
    expect(screen.getByRole("heading", { name: "This screen hit a snag" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dashboard/ }));
    expect(onHome).toHaveBeenCalledOnce();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(screen.getByText("screen ok")).toBeTruthy();
  });
  it("does not activate an update or reload when the recovery checkpoint fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createUpdateCheckpoint).mockRejectedValueOnce(new Error("Device storage is full."));
    render(<RouteErrorBoundary onHome={() => {}}><Boom error={new TypeError("Failed to fetch dynamically imported module: x.js")} /></RouteErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Reload AXOM" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("This window has been kept open"));
    expect(activateWaitingWebUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reload AXOM" }).hasAttribute("disabled")).toBe(false);
  });

  it("offers a separately confirmed verified-save refresh after an extra backup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createUpdateCheckpoint).mockReset();
    vi.mocked(activateWaitingWebUpdate).mockReset();
    vi.mocked(createUpdateCheckpoint)
      .mockRejectedValueOnce(Object.assign(new Error("Browser storage is full"), { canContinueWithoutRecoverySnapshot: true }))
      .mockResolvedValueOnce("verified-persisted-state");
    vi.mocked(activateWaitingWebUpdate).mockRejectedValueOnce(new Error("Worker unavailable"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<RouteErrorBoundary onHome={() => {}}><Boom error={new TypeError("Failed to fetch dynamically imported module: x.js")} /></RouteErrorBoundary>);

    fireEvent.click(screen.getByRole("button", { name: "Reload AXOM" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh with verified save" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Refresh with verified save" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("extra recovery copy"));
    await waitFor(() => expect(createUpdateCheckpoint).toHaveBeenNthCalledWith(2, false, { skipRecoverySnapshot: true }));
    expect(screen.getByRole("status").textContent).toContain("Worker unavailable");
  });

  it("does not refresh on rejected consent or misdiagnose a non-quota copy failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createUpdateCheckpoint).mockReset();
    vi.mocked(activateWaitingWebUpdate).mockReset();
    vi.mocked(createUpdateCheckpoint).mockRejectedValueOnce(
      Object.assign(new Error("Browser policy blocked a recovery copy"), { canContinueWithoutRecoverySnapshot: true }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<RouteErrorBoundary onHome={() => {}}><Boom error={new TypeError("Failed to fetch dynamically imported module: x.js")} /></RouteErrorBoundary>);

    fireEvent.click(screen.getByRole("button", { name: "Reload AXOM" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh with verified save" })).toBeTruthy());
    expect(screen.getByText(/could not create an extra recovery copy/i)).toBeTruthy();
    expect(screen.queryByText(/browser storage is full/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh with verified save" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(createUpdateCheckpoint).toHaveBeenCalledTimes(1);
    expect(activateWaitingWebUpdate).not.toHaveBeenCalled();
  });

});
