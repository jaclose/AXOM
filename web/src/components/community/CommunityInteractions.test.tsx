// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptFriend, deleteCommunityComment, deleteCommunityPost, editCommunityComment, editCommunityPost, joinCommunity,
  loadCommunityComments, loadCommunityProfile, publishCommunityComment, publishCommunityPost,
  removeFriend, setReaction, updateCommunityProfile,
  type CommunityComment, type CommunityPost, type CommunityProfile,
} from "../../lib/community/community";
import { isoDate } from "../../lib/scoring";
import { addDays } from "../../lib/community/progressBoard";
import { CommunityComposer } from "./CommunityComposer";
import { CommunityIdentityDialog, CommunityPersonButton } from "./CommunityIdentity";
import { CommunityProfileDialog } from "./CommunityProfileDialog";
import { CommunityPostCard } from "./CommunityPostCard";
import { CommunityThread } from "./CommunityThread";
import { CommunityFriendAction } from "./CommunityPeople";
import { retryCommunityProgress } from "./CommunityProgressSync";
import { createCommunityDraftCache } from "./communityDraftCache";

vi.mock("../../lib/store", () => ({
  useStore: (select: (state: { logs: []; questionSets: Array<{ id: string; title: string }> }) => unknown) =>
    select({ logs: [], questionSets: [{ id: "set-one", title: "A title chosen by its owner" }] }),
}));
vi.mock("./CommunityProgressSync", () => ({ retryCommunityProgress: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/community/community", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/community/community")>(),
  acceptFriend: vi.fn(), deleteCommunityComment: vi.fn(), deleteCommunityPost: vi.fn(), editCommunityComment: vi.fn(), editCommunityPost: vi.fn(),
  joinCommunity: vi.fn(), loadCommunityComments: vi.fn(), loadCommunityProfile: vi.fn(),
  publishCommunityComment: vi.fn(), publishCommunityPost: vi.fn(), removeFriend: vi.fn(), setReaction: vi.fn(),
  updateCommunityProfile: vi.fn(),
}));

const today = () => isoDate(new Date());
const profile: CommunityProfile = { user_id: "me", handle: "kai_learner", display_name: "Kai", bio: "Learning one day at a time.", discoverable: false };
const post = (patch: Partial<CommunityPost> = {}): CommunityPost => ({
  id: "post-one", user_id: "me", kind: "update", caption: "A useful connection today.", visibility: "friends", activity_day: null,
  minutes: 0, cards: 0, questions: 0, set_title: null, created_at: new Date().toISOString(), revision: 4, ...patch,
});
const comment = (patch: Partial<CommunityComment> = {}): CommunityComment => ({
  id: "reply-one", post_id: "post-one", user_id: "me", body: "I can join after class.", created_at: new Date().toISOString(), updated_at: "2026-11-05T12:00:00Z",
  author: { user_id: "me", handle: profile.handle, display_name: profile.display_name }, ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(publishCommunityPost).mockResolvedValue();
  vi.mocked(updateCommunityProfile).mockResolvedValue();
  vi.mocked(joinCommunity).mockResolvedValue();
  vi.mocked(loadCommunityComments).mockResolvedValue([]);
  vi.mocked(publishCommunityComment).mockResolvedValue();
  vi.mocked(editCommunityComment).mockResolvedValue();
  vi.mocked(deleteCommunityComment).mockResolvedValue();
  vi.mocked(deleteCommunityPost).mockResolvedValue();
  vi.mocked(editCommunityPost).mockResolvedValue();
  vi.mocked(setReaction).mockResolvedValue();
  vi.mocked(acceptFriend).mockResolvedValue();
  vi.mocked(removeFriend).mockResolvedValue();
});
afterEach(cleanup);

describe("Explicit community publishing", () => {
  it("keeps exact field labels when composer and reply drafts are restored", async () => {
    const user = userEvent.setup();
    const draftCache = createCommunityDraftCache();
    draftCache.replies.set("post-one", { draft: "A retained reply.", editBody: "" });
    render(<>
      <CommunityComposer accountId="me" profile={profile} posts={[]} onPublished={() => {}}
        initialDraft={{ kind: "update", audience: "private", day: today(), caption: "A retained update.", setId: "" }} />
      <CommunityThread accountId="me" postId="post-one" canReply draftCache={draftCache} onOpenProfile={() => {}} />
    </>);
    const update = screen.getByRole("textbox", { name: "Your update" }) as HTMLTextAreaElement;
    const reply = screen.getByRole("textbox", { name: "Write a reply" }) as HTMLTextAreaElement;
    expect(update.value).toBe("A retained update.");
    expect(reply.value).toBe("A retained reply.");
    expect(Array.from(update.labels ?? [], label => label.textContent)).toEqual(["Your update"]);
    expect(Array.from(reply.labels ?? [], label => label.textContent)).toEqual(["Write a reply"]);
    expect(update.id).not.toBe(reply.id);
    await user.click(screen.getByText("Write a reply", { selector: "label" }));
    expect(document.activeElement).toBe(reply);
  });

  it("defaults each new post to Only me and resets its audience only after a confirmed save", async () => {
    const user = userEvent.setup();
    const onPublished = vi.fn();
    render(<CommunityComposer accountId="me" profile={profile} posts={[]} onPublished={onPublished} />);
    const audience = screen.getByRole("combobox", { name: "Who can see this?" }) as HTMLSelectElement;
    expect(audience.value).toBe("private");
    await user.type(screen.getByRole("textbox", { name: "Your update" }), "One small win.");
    await user.selectOptions(audience, "friends");
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(publishCommunityPost).toHaveBeenCalledWith("me", { kind: "update", visibility: "friends", caption: "One small win." }));
    expect(onPublished).toHaveBeenCalledWith("Your post is shared.");
    expect(audience.value).toBe("private");
    expect((screen.getByRole("textbox", { name: "Your update" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("preserves the note and audience if publishing cannot be confirmed", async () => {
    const user = userEvent.setup();
    vi.mocked(publishCommunityPost).mockRejectedValue(new Error("Offline. Your draft is still here."));
    const onPublished = vi.fn();
    render(<CommunityComposer accountId="me" profile={profile} posts={[]} onPublished={onPublished} />);
    await user.type(screen.getByRole("textbox", { name: "Your update" }), "My draft survives.");
    await user.selectOptions(screen.getByRole("combobox", { name: "Who can see this?" }), "friends");
    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Offline");
    expect((screen.getByRole("textbox", { name: "Your update" }) as HTMLTextAreaElement).value).toBe("My draft survives.");
    expect((screen.getByRole("combobox", { name: "Who can see this?" }) as HTMLSelectElement).value).toBe("friends");
    expect(onPublished).not.toHaveBeenCalled();
  });

  it("publishes a study invitation with an explicit audience and no invented session or metrics", async () => {
    const user = userEvent.setup();
    render(<CommunityComposer accountId="me" profile={profile} posts={[]} onPublished={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Study together" }));
    expect((screen.getByRole("button", { name: "Save post" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "Your study invitation" }), "Renal review tomorrow at 4. Reply if you want to join.");
    await user.selectOptions(screen.getByRole("combobox", { name: "Who can see this?" }), "friends");
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(publishCommunityPost).toHaveBeenCalledWith("me", {
      kind: "study_invite", visibility: "friends", caption: "Renal review tomorrow at 4. Reply if you want to join.",
    }));
  });

  it("updates an existing daily post with corrected zero totals and its known revision", async () => {
    const user = userEvent.setup();
    render(<CommunityComposer accountId="me" profile={profile} posts={[post({ kind: "progress", activity_day: today(), minutes: 60, revision: 7 })]} onPublished={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Daily progress" }));
    expect(screen.getByText(/Publishing replaces its totals/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Update day" }));
    await waitFor(() => expect(publishCommunityPost).toHaveBeenCalledWith("me", {
      kind: "progress", visibility: "private", caption: "", activityDay: today(), minutes: 0, cards: 0, questions: 0, expectedRevision: 7,
    }));
  });

  it("shares a selected set title without copying its identifier or source content", async () => {
    const user = userEvent.setup();
    render(<CommunityComposer accountId="me" profile={profile} posts={[]} onPublished={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Question Set" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Question Set to celebrate" }), "set-one");
    await user.click(screen.getByRole("button", { name: "Save post" }));
    await waitFor(() => expect(publishCommunityPost).toHaveBeenCalledWith("me", {
      kind: "question_set", visibility: "private", caption: "", setTitle: "A title chosen by its owner",
    }));
  });
});

describe("Community identity and shared profiles", () => {
  it("previews only visible profile details on hover or focus and opens the full profile by keyboard", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<CommunityPersonButton profile={profile} onClick={onOpen} />);
    const button = screen.getByRole("button", { name: "View Kai's profile" });
    await user.hover(button);
    expect(screen.getByRole("tooltip").textContent).toContain(profile.bio);
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
    await user.unhover(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    button.focus();
    expect(await screen.findByRole("tooltip")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it("edits identity independently of sharing settings", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn(), onClose = vi.fn();
    render(<CommunityIdentityDialog accountId="me" profile={profile} onSaved={onSaved} onClose={onClose} />);
    const bio = screen.getByRole("textbox", { name: "Biography" }) as HTMLTextAreaElement;
    expect(bio.value).toBe(profile.bio);
    expect(Array.from(bio.labels ?? [], label => label.textContent)).toEqual(["Biography"]);
    const name = screen.getByRole("textbox", { name: "Display name" });
    await user.clear(name); await user.type(name, "Kai Noor");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(updateCommunityProfile).toHaveBeenCalledWith("me", { handle: "kai_learner", displayName: "Kai Noor", bio: profile.bio }));
    expect(joinCommunity).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });

  it("keeps an identity draft after a handle conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(joinCommunity).mockRejectedValue(new Error("That handle is already in use."));
    const onClose = vi.fn();
    render(<CommunityIdentityDialog accountId="me" displayName="Kai" onSaved={() => {}} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already in use");
    expect((screen.getByRole("textbox", { name: /Public handle/ }) as HTMLInputElement).value).toBe("kai");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("retries previously authorized automatic sharing after creating an identity", async () => {
    const user = userEvent.setup();
    render(<CommunityIdentityDialog accountId="me" displayName="Kai" onSaved={() => {}} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Create profile" }));
    await waitFor(() => expect(joinCommunity).toHaveBeenCalledWith("me", "kai", "Kai", ""));
    expect(retryCommunityProgress).toHaveBeenCalledWith("me");
  });

  it("shows only shared-day totals and labels the limited streak window", async () => {
    vi.mocked(loadCommunityProfile).mockResolvedValue({ profile, posts: [
      post({ id: "today", kind: "progress", activity_day: today(), minutes: 30, questions: 4 }),
      post({ id: "yesterday", kind: "progress", activity_day: addDays(today(), -1), minutes: 30, cards: 10 }),
      post({ id: "private", kind: "progress", visibility: "private", activity_day: addDays(today(), -2), minutes: 900 }),
    ] });
    render(<CommunityProfileDialog accountId="me" userId="me" onClose={() => {}} onEdit={() => {}} />);
    const stats = await screen.findByRole("region", { name: "Shared study in the last 30 days" });
    expect(within(stats).getByText("60 min")).toBeTruthy();
    expect(within(stats).getByText("2-day shared streak")).toBeTruthy();
    expect(within(stats).queryByText("900")).toBeNull();
    expect(within(stats).getByText(/Only days shared with you/)).toBeTruthy();
  });

  it("withdraws a loaded profile when a refreshed friendship no longer authorizes it", async () => {
    vi.mocked(loadCommunityProfile).mockResolvedValue({ profile: { ...profile, user_id: "friend" }, posts: [post({ user_id: "friend", caption: "Shared with my friend" })] });
    const view = render(<CommunityProfileDialog accountId="me" userId="friend" refreshKey={0} onClose={() => {}} onEdit={() => {}} />);
    expect(await screen.findByText("Shared with my friend")).toBeTruthy();
    vi.mocked(loadCommunityProfile).mockResolvedValue({ profile: null, posts: [] });
    view.rerender(<CommunityProfileDialog accountId="me" userId="friend" refreshKey={1} onClose={() => {}} onEdit={() => {}} />);
    expect(screen.queryByText("Shared with my friend")).toBeNull();
    expect(await screen.findByRole("heading", { name: "This profile is unavailable" })).toBeTruthy();
  });
});

describe("Posts and replies", () => {
  it("lets owners withdraw legacy posts while holding new-schema actions until the service is updated", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<CommunityPostCard accountId="me" post={post({ revision: undefined, share_source: undefined })} profile={profile} liked={false} reactionCount={0}
      canParticipate serviceUpgradeRequired onChanged={onChanged} onOpenProfile={vi.fn()} />);
    expect(screen.getByText("A useful connection today.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replies" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Edit post" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Delete post" })).toHaveProperty("disabled", false);
    await user.click(screen.getByRole("button", { name: "Delete post" }));
    expect(deleteCommunityPost).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove my post" }));
    expect(deleteCommunityPost).toHaveBeenCalledWith("me", "post-one");
    expect(onChanged).toHaveBeenCalledWith("Your post is removed.");
  });
  it("captures the edit revision before a background refresh and preserves a conflicting draft", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const props = { accountId: "me", profile, liked: false, reactionCount: 0, canParticipate: true, onChanged, onOpenProfile: vi.fn() };
    const view = render(<CommunityPostCard {...props} post={post({ revision: 4 })} />);
    await user.click(screen.getByRole("button", { name: "Edit post" }));
    const caption = screen.getByRole("textbox", { name: "Edit your post" }) as HTMLTextAreaElement;
    expect(caption.value).toBe("A useful connection today.");
    expect(Array.from(caption.labels ?? [], label => label.textContent)).toEqual(["Edit your post"]);
    await user.clear(screen.getByRole("textbox", { name: "Edit your post" }));
    await user.type(screen.getByRole("textbox", { name: "Edit your post" }), "My unfinished edit.");
    view.rerender(<CommunityPostCard {...props} post={post({ revision: 5, caption: "Newer edit on another device" })} />);
    vi.mocked(editCommunityPost).mockRejectedValue(new Error("This post changed on another device. Refresh before editing again."));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(editCommunityPost).toHaveBeenCalledWith("me", "post-one", {
      caption: "My unfinished edit.", visibility: "friends", expectedRevision: 4,
    }));
    expect((await screen.findByRole("alert")).textContent).toContain("another device");
    expect((screen.getByRole("textbox", { name: "Edit your post" }) as HTMLTextAreaElement).value).toBe("My unfinished edit.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("opens authors and sends a reversible kudos action without offering edits to another learner", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    render(<CommunityPostCard accountId="me" post={post({ user_id: "friend" })} profile={{ ...profile, user_id: "friend" }}
      liked reactionCount={2} canParticipate onChanged={() => {}} onOpenProfile={onOpenProfile} />);
    await user.click(screen.getByRole("button", { name: "View Kai's profile" }));
    expect(onOpenProfile).toHaveBeenCalledWith("friend");
    expect(screen.queryByRole("button", { name: "Edit post" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "2 Kudos given" }));
    await waitFor(() => expect(setReaction).toHaveBeenCalledWith("me", "post-one", false));
  });

  it("preserves a reply draft on failure and sends it on a successful retry", async () => {
    const user = userEvent.setup();
    vi.mocked(publishCommunityComment).mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue();
    render(<CommunityThread accountId="me" postId="post-one" canReply onOpenProfile={() => {}} />);
    const input = await screen.findByRole("textbox", { name: "Write a reply" });
    await user.type(input, "I can join.");
    await user.click(screen.getByRole("button", { name: "Post reply" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Connection lost");
    expect((input as HTMLTextAreaElement).value).toBe("I can join.");
    await user.click(screen.getByRole("button", { name: "Post reply" }));
    await waitFor(() => expect(publishCommunityComment).toHaveBeenCalledTimes(2));
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(await screen.findByText("Your reply is posted.")).toBeTruthy();
  });

  it("edits or confirms removal only for the signed-in author's replies", async () => {
    const user = userEvent.setup();
    vi.mocked(loadCommunityComments).mockResolvedValue([comment(), comment({ id: "other", user_id: "friend", body: "See you there.", author: undefined })]);
    render(<CommunityThread accountId="me" postId="post-one" canReply onOpenProfile={() => {}} />);
    const edit = await screen.findByRole("button", { name: "Edit reply" });
    expect(screen.getAllByRole("button", { name: "Delete reply" })).toHaveLength(1);
    await user.click(edit);
    const input = screen.getByRole("textbox", { name: "Edit your reply" }) as HTMLTextAreaElement;
    // Browser label matching must not include the textarea's saved contents.
    expect(input.value).toBe("I can join after class.");
    expect(Array.from(input.labels ?? [], label => label.textContent)).toEqual(["Edit your reply"]);
    await user.clear(input); await user.type(input, "I can join at five.");
    await user.click(screen.getByRole("button", { name: "Save reply" }));
    await waitFor(() => expect(editCommunityComment).toHaveBeenCalledWith("me", "reply-one", "I can join at five.", "2026-11-05T12:00:00Z"));
    await user.click(screen.getByRole("button", { name: "Delete reply" }));
    expect(deleteCommunityComment).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove reply" }));
    await waitFor(() => expect(deleteCommunityComment).toHaveBeenCalledWith("me", "reply-one"));
  });

  it("lets post owners remove another learner's reply after confirmation without editing it", async () => {
    const user = userEvent.setup();
    vi.mocked(loadCommunityComments).mockResolvedValue([comment({ user_id: "friend", author: undefined })]);
    render(<CommunityPostCard accountId="me" post={post()} profile={profile} liked={false} reactionCount={0}
      canParticipate onChanged={() => {}} onOpenProfile={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Replies" }));
    const thread = within(screen.getByRole("region", { name: "Post replies" }));
    await user.click(await thread.findByRole("button", { name: "Delete reply" }));
    expect(thread.queryByRole("button", { name: "Edit reply" })).toBeNull();
    expect(thread.getByText("Remove this reply from your post?")).toBeTruthy();
    expect(deleteCommunityComment).not.toHaveBeenCalled();
    await user.click(thread.getByRole("button", { name: "Keep reply" }));
    expect(thread.queryByRole("group", { name: "Confirm reply removal" })).toBeNull();
    await user.click(thread.getByRole("button", { name: "Delete reply" }));
    vi.mocked(loadCommunityComments).mockResolvedValue([]);
    await user.click(thread.getByRole("button", { name: "Remove reply" }));
    await waitFor(() => expect(deleteCommunityComment).toHaveBeenCalledWith("me", "reply-one"));
    expect(await thread.findByText("Reply removed from your post.")).toBeTruthy();
    expect(editCommunityComment).not.toHaveBeenCalled();
  });

  it("does not let ordinary readers remove or edit another learner's replies", async () => {
    const user = userEvent.setup();
    vi.mocked(loadCommunityComments).mockResolvedValue([comment({ user_id: "third-learner", author: undefined })]);
    render(<CommunityPostCard accountId="me" post={post({ user_id: "friend" })} liked={false} reactionCount={0}
      canParticipate onChanged={() => {}} onOpenProfile={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Replies" }));
    const thread = within(screen.getByRole("region", { name: "Post replies" }));
    expect(await thread.findByText("I can join after class.")).toBeTruthy();
    expect(thread.queryByRole("button", { name: "Delete reply" })).toBeNull();
    expect(thread.queryByRole("button", { name: "Edit reply" })).toBeNull();
    expect(deleteCommunityComment).not.toHaveBeenCalled();
    expect(editCommunityComment).not.toHaveBeenCalled();
  });

  it("loads another chronological page of replies instead of silently truncating the conversation", async () => {
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 100 }, (_, index) => comment({ id: `reply-${index}`, body: `Reply ${index}`, user_id: "friend", author: undefined }));
    vi.mocked(loadCommunityComments).mockImplementation(async (_id, _post, offset = 0) => offset === 0 ? firstPage : [comment({ id: "last-reply", body: "The final reply", user_id: "friend", author: undefined })]);
    render(<CommunityThread accountId="me" postId="post-one" canReply onOpenProfile={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "Load more replies" }));
    await waitFor(() => expect(loadCommunityComments).toHaveBeenCalledWith("me", "post-one", 100));
    expect(await screen.findByText("The final reply")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more replies" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(101);
  });

  it("keeps the reply timestamp from edit start when a refresh returns a newer reply", async () => {
    const user = userEvent.setup();
    vi.mocked(loadCommunityComments).mockResolvedValue([comment()]);
    const view = render(<CommunityThread accountId="me" postId="post-one" canReply refreshKey={0} onOpenProfile={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "Edit reply" }));
    const input = screen.getByRole("textbox", { name: "Edit your reply" });
    await user.clear(input); await user.type(input, "Draft from this device.");
    vi.mocked(loadCommunityComments).mockResolvedValue([comment({ body: "Edited elsewhere", updated_at: "2026-11-05T12:01:00Z" })]);
    view.rerender(<CommunityThread accountId="me" postId="post-one" canReply refreshKey={1} onOpenProfile={() => {}} />);
    await waitFor(() => expect(loadCommunityComments).toHaveBeenCalledTimes(2));
    vi.mocked(editCommunityComment).mockRejectedValue(new Error("This reply changed on another device."));
    await user.click(screen.getByRole("button", { name: "Save reply" }));
    await waitFor(() => expect(editCommunityComment).toHaveBeenCalledWith("me", "reply-one", "Draft from this device.", "2026-11-05T12:00:00Z"));
    expect((await screen.findByRole("alert")).textContent).toContain("another device");
    expect((screen.getByRole("textbox", { name: "Edit your reply" }) as HTMLTextAreaElement).value).toBe("Draft from this device.");
  });

  it("hides cached replies if the next page is no longer authorized without discarding the draft", async () => {
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 100 }, (_, index) => comment({ id: `reply-${index}`, body: `Visible reply ${index}`, user_id: "friend", author: undefined }));
    vi.mocked(loadCommunityComments).mockImplementation(async (_id, _post, offset = 0) => {
      if (offset) throw new Error("This post is no longer available to you.");
      return firstPage;
    });
    render(<CommunityThread accountId="me" postId="post-one" canReply onOpenProfile={() => {}} />);
    await user.type(screen.getByRole("textbox", { name: "Write a reply" }), "Unsent thought.");
    await user.click(await screen.findByRole("button", { name: "Load more replies" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no longer available");
    expect(screen.queryByText("Visible reply 0")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Write a reply" }) as HTMLTextAreaElement).value).toBe("Unsent thought.");
  });

  it("drops a late profile response after the requested learner changes", async () => {
    let resolve!: (value: { profile: CommunityProfile; posts: CommunityPost[] }) => void;
    const late = new Promise<{ profile: CommunityProfile; posts: CommunityPost[] }>(done => { resolve = done; });
    vi.mocked(loadCommunityProfile).mockImplementation(async (_accountId, userId) => userId === "first" ? late : { profile: null, posts: [] });
    const view = render(<CommunityProfileDialog accountId="me" userId="first" onClose={() => {}} onEdit={() => {}} />);
    view.rerender(<CommunityProfileDialog accountId="me" userId="second" onClose={() => {}} onEdit={() => {}} />);
    expect(await screen.findByRole("heading", { name: "This profile is unavailable" })).toBeTruthy();
    await act(async () => { resolve({ profile, posts: [post({ caption: "Stale profile content" })] }); });
    expect(screen.queryByText("Stale profile content")).toBeNull();
  });
});

describe("Friendship controls", () => {
  it("offers accept and decline only to the recipient of a pending request", async () => {
    const user = userEvent.setup();
    render(<CommunityFriendAction accountId="me" otherId="friend" connection={{ id: "request", requester_id: "friend", addressee_id: "me", status: "pending" }} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(acceptFriend).toHaveBeenCalledWith("me", "request"));
  });

  it("requires confirmation before removing an accepted friend", async () => {
    const user = userEvent.setup();
    render(<CommunityFriendAction accountId="me" otherId="friend" connection={{ id: "friendship", requester_id: "me", addressee_id: "friend", status: "accepted" }} onChanged={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Friends" }));
    expect(removeFriend).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove friend" }));
    await waitFor(() => expect(removeFriend).toHaveBeenCalledWith("me", "friendship"));
  });
});
