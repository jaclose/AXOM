// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount, type CommunitySignupPreferences } from "../../lib/account/accountStore";
import { reportCommunityShare, resetCommunityShare, useCommunityShare } from "../../lib/community/shareStore";
import { useStore } from "../../lib/store";
import { CommunityPreferencesSettings } from "./CommunityPreferences";

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), leave: vi.fn(), retry: vi.fn() }));
vi.mock("../../lib/community/community", () => ({
  readCommunityPreferences: api.read,
  saveCommunityPreferences: api.save,
  leaveCommunity: api.leave,
}));
vi.mock("./CommunityProgressSync", () => ({ retryCommunityProgress: api.retry }));

type SavedPreferences = CommunitySignupPreferences & { revision: number };
const account = { id: "learner-1", email: "learner@example.com", displayName: "Alex", emailConfirmed: true };
const initialAccount = useAccount.getState();
const privateChoices: SavedPreferences = { discoverable: false, shareMode: "off", revision: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const discovery = () => screen.getByRole("checkbox", { name: "Appear in learner search" }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(privateChoices);
  api.save.mockImplementation(async (_accountId: string, choices: CommunitySignupPreferences) => ({ ...choices, revision: 1 }));
  api.leave.mockResolvedValue(undefined);
  api.retry.mockResolvedValue(undefined);
  resetCommunityShare();
  useAccount.setState({ phase: "signed-in", user: account, link: "linked", busy: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAccount.setState(initialAccount, true);
  resetCommunityShare();
});

describe("Account Community choices", () => {
  it("reads the account's choices without overwriting existing consent or requiring a profile", async () => {
    api.read.mockResolvedValueOnce({ discoverable: true, shareMode: "friends", revision: 7 });
    render(<CommunityPreferencesSettings accountId={account.id} />);
    expect(screen.queryByRole("radio")).toBeNull();
    await screen.findByRole("radio", { name: "Friends" });
    expect(discovery().checked).toBe(true);
    expect(radio("Friends").checked).toBe(true);
    expect((screen.getByRole("button", { name: "Save Community choices" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.read).toHaveBeenCalledWith(account.id);
    expect(api.save).not.toHaveBeenCalled();
    expect(useCommunityShare.getState()).toMatchObject({ accountId: account.id, mode: "friends", revision: 7 });
  });

  it("keeps consent unknown after a read failure and offers a real retry", async () => {
    api.read.mockRejectedValueOnce(new Error("Your choices could not be checked."));
    render(<CommunityPreferencesSettings accountId={account.id} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Your choices could not be checked.");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(useCommunityShare.getState().mode).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry Community choices" }));
    await screen.findByRole("radio", { name: "Off" });
    expect(radio("Off").checked).toBe(true);
    expect(discovery().checked).toBe(false);
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("saves discovery and sharing atomically after two independent choices", async () => {
    api.save.mockResolvedValueOnce({ discoverable: true, shareMode: "community", revision: 4 });
    render(<CommunityPreferencesSettings accountId={account.id} />);
    await screen.findByRole("radio", { name: "Community" });
    fireEvent.click(radio("Community"));
    expect(discovery().checked).toBe(false);
    expect(screen.getByText(/With learner search off/)).toBeTruthy();
    expect(useCommunityShare.getState().mode).toBe("off");
    fireEvent.click(discovery());
    fireEvent.click(screen.getByRole("button", { name: "Save Community choices" }));
    await screen.findByText("Community choices saved for your account.");
    expect(api.save).toHaveBeenCalledWith(account.id, { discoverable: true, shareMode: "community" });
    expect(useCommunityShare.getState()).toMatchObject({ accountId: account.id, mode: "community", revision: 4 });
    expect((screen.getByRole("button", { name: "Save Community choices" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a failed privacy change editable and retries without claiming success", async () => {
    api.read.mockResolvedValueOnce({ discoverable: true, shareMode: "friends", revision: 3 });
    api.save.mockRejectedValueOnce(new Error("Your privacy choice could not be saved."));
    api.save.mockResolvedValueOnce({ discoverable: false, shareMode: "off", revision: 4 });
    render(<CommunityPreferencesSettings accountId={account.id} />);
    await screen.findByRole("radio", { name: "Off" });
    fireEvent.click(discovery());
    fireEvent.click(radio("Off"));
    fireEvent.click(screen.getByRole("button", { name: "Save Community choices" }));
    await screen.findByText("Your privacy choice could not be saved.");
    expect(radio("Off").checked).toBe(true);
    expect(discovery().checked).toBe(false);
    expect(useCommunityShare.getState().mode).toBe("friends");
    expect(screen.queryByText("Community choices saved for your account.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Community choices" }));
    await screen.findByText("Community choices saved for your account.");
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(useCommunityShare.getState()).toMatchObject({ mode: "off", revision: 4 });
  });

  it("discards a delayed preference read when the signed-in account changes", async () => {
    const old = deferred<SavedPreferences>();
    api.read.mockReturnValueOnce(old.promise);
    const { rerender } = render(<CommunityPreferencesSettings accountId={account.id} />);
    await waitFor(() => expect(api.read).toHaveBeenCalledWith(account.id));
    act(() => { useAccount.setState({ user: { ...account, id: "learner-2" } }); });
    rerender(<CommunityPreferencesSettings accountId="learner-2" />);
    await screen.findByRole("radio", { name: "Off" });
    await act(async () => { old.resolve({ discoverable: true, shareMode: "community", revision: 9 }); await old.promise; });
    expect(discovery().checked).toBe(false);
    expect(radio("Off").checked).toBe(true);
    expect(useCommunityShare.getState()).toMatchObject({ accountId: "learner-2", mode: "off", revision: 0 });
    expect(api.save).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"] as const)("ignores a delayed save %s after switching accounts", async outcome => {
    const old = deferred<SavedPreferences>();
    api.save.mockReturnValueOnce(old.promise);
    const { rerender } = render(<CommunityPreferencesSettings accountId={account.id} />);
    await screen.findByRole("radio", { name: "Friends" });
    fireEvent.click(radio("Friends"));
    fireEvent.click(screen.getByRole("button", { name: "Save Community choices" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    act(() => { useAccount.setState({ user: { ...account, id: "learner-2" } }); });
    rerender(<CommunityPreferencesSettings accountId="learner-2" />);
    await screen.findByRole("radio", { name: "Off" });
    await act(async () => {
      if (outcome === "success") old.resolve({ discoverable: true, shareMode: "friends", revision: 9 });
      else old.reject(new Error("Old account save failed."));
      await old.promise.catch(() => {});
    });
    expect(discovery().checked).toBe(false);
    expect(radio("Off").checked).toBe(true);
    expect(screen.queryByText("Community choices saved for your account.")).toBeNull();
    expect(screen.queryByText("Old account save failed.")).toBeNull();
    expect(useCommunityShare.getState()).toMatchObject({ accountId: "learner-2", mode: "off", revision: 0 });
  });

  it("confirms leaving, surfaces failures, and preserves the private workspace", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    vi.stubGlobal("confirm", confirm);
    api.read.mockResolvedValueOnce({ discoverable: true, shareMode: "friends", revision: 2 });
    api.leave.mockRejectedValueOnce(new Error("Community could not be reached."));
    const workspace = useStore.getState();
    render(<CommunityPreferencesSettings accountId={account.id} />);
    await screen.findByRole("radio", { name: "Friends" });
    fireEvent.click(screen.getByText("Leave Community", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave Community" }));
    expect(api.leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Leave Community" }));
    await screen.findByText("Community could not be reached.");
    expect(radio("Friends").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave Community" }));
    await screen.findByText("You left Community. Your private workspace and account are unchanged.");
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Your private workspace and account stay intact"));
    expect(api.leave).toHaveBeenCalledTimes(2);
    expect(radio("Off").checked).toBe(true);
    expect(discovery().checked).toBe(false);
    expect(useCommunityShare.getState().mode).toBe("off");
    expect(useStore.getState()).toBe(workspace);
    expect(useAccount.getState().user?.id).toBe(account.id);
  });

  it("offers retry when progress sharing fails even though consent is already saved", async () => {
    api.read.mockResolvedValue({ discoverable: false, shareMode: "friends", revision: 2 });
    render(<CommunityPreferencesSettings accountId={account.id} />);
    await screen.findByRole("radio", { name: "Friends" });
    act(() => { reportCommunityShare(account.id, "error", "Your daily totals could not be shared."); });
    expect(screen.getByRole("alert").textContent).toContain("Your daily totals could not be shared.");
    fireEvent.click(screen.getByRole("button", { name: "Retry progress sharing" }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith(account.id));
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("region", { name: "Community and leaderboards" }).getAttribute("aria-busy")).toBe("false"));
    expect(api.save).not.toHaveBeenCalled();
  });

  it("takes the learner to the existing workspace decision before automatic sharing", async () => {
    api.read.mockResolvedValue({ discoverable: false, shareMode: "friends", revision: 2 });
    const review = vi.fn();
    render(<CommunityPreferencesSettings accountId={account.id} onReviewWorkspace={review} />);
    await screen.findByRole("radio", { name: "Friends" });
    act(() => { reportCommunityShare(account.id, "needs-device", "Link this device before sharing."); });
    fireEvent.click(screen.getByRole("button", { name: "Review device protection" }));
    expect(review).toHaveBeenCalledOnce();
    expect(api.save).not.toHaveBeenCalled();
  });
});
