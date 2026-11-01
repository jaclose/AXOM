import { useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { assertVaultWritesSince, flushLocalVaultWrites, getVaultWriteCheckpoint } from "../lib/localVault";
import { pushToast } from "../lib/toast";
import { GlassCard, GButton } from "../components/ui/primitives";
import {
  academicResourcesForTrackerScope, asAcademicResource, asActivityLinkedBookmarkResource,
  bookmarkActivityCandidates, canonicalPanoptoVideoUrl, indexAcademicBookmarks, parseBookmarkHtml,
  type AcademicBookmarkIndex,
} from "../lib/course-engine/bookmarkEvidence";
import { SGU_CURRICULUM } from "../lib/curricula";

/**
 * Source citations from a learner's browser are opt-in study shortcuts, not
 * an official curriculum or redistributable content. No video is downloaded.
 */
export function AcademicBookmarkImporter() {
  const chooser = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<AcademicBookmarkIndex>();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [activityChoices, setActivityChoices] = useState<Record<string, string>>({});
  const tracker = useStore((state) => state.tracker);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const existing = useStore((state) => state.resources);
  const urlsInVault = useMemo(() => new Set(existing.flatMap((item) => {
    const url = canonicalPanoptoVideoUrl(item.url);
    return url ? [url] : [];
  })), [existing]);
  const missing = review?.videos.filter((video) => !urlsInVault.has(video.url)) ?? [];
  const unresolved = missing.filter((video) => !choices[video.url]
    && video.assignment !== "unique-candidate").length;
  const folderSuggestions = missing.filter((video) => video.suggestedOwnerKey
    && choices[video.url] === undefined).length;

  function useFolderSuggestions() {
    // This explicit review action never overwrites an individual selection,
    // including the learner's conscious keep-unassigned choice (empty string).
    setChoices((current) => {
      const next = { ...current };
      for (const item of missing) if (item.suggestedOwnerKey && next[item.url] === undefined) {
        next[item.url] = item.suggestedOwnerKey;
      }
      return next;
    });
  }

  async function select(file: File) {
    setError(""); setMessage(""); setReview(undefined); setChoices({}); setActivityChoices({});
    setExpanded(false); setBusy(true);
    try {
      if (file.size > 6_000_000) throw new Error("Export exceeds the 6 MB review limit.");
      const text = await file.text();
      const index = indexAcademicBookmarks(parseBookmarkHtml(text), SGU_CURRICULUM);
      if (index.videos.length === 0) throw new Error("No supported Panopto recording-viewer links were found.");
      setReview(index);
      setMessage(`${index.videos.length} distinct recording links found. ${index.excludedProviderLinks} other Panopto pages excluded. Review module associations before saving.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not inspect the bookmark export.");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!review || busy) return;
    setBusy(true); setError("");
    const checkpoint = getVaultWriteCheckpoint();
    let locallyUpdated = false;
    try {
      // Fresh store read: another tab/component may have already added a link
      // while the reviewer was assigning courses.
      const state = useStore.getState();
      const currentUrls = new Set(state.resources.flatMap((resource) => {
        const url = canonicalPanoptoVideoUrl(resource.url);
        return url ? [url] : [];
      }));
      const additions = review.videos.filter((video) => !currentUrls.has(video.url)).map((video) => {
        // Empty means an explicit learner choice to leave this video unassigned;
        // unlike ||, ?? never silently restores the suggested module.
        const selected = choices[video.url] ?? (video.assignment === "unique-candidate"
          ? video.candidates[0]?.key : undefined);
        const owner = video.candidates.find((candidate) => candidate.key === selected);
        const chosenActivity = activityChoices[video.url];
        if (!chosenActivity) return asAcademicResource(video, owner);
        if (!owner) throw new Error("Choose the academic course before attaching a recording to an item.");
        const currentItem = state.tracker.find((item) => item.id === chosenActivity);
        if (!currentItem) throw new Error("The selected tracker item no longer exists. Review its source association.");
        return asActivityLinkedBookmarkResource(video, owner, currentItem);
      });
      if (additions.length === 0) {
        setMessage("These recording links already exist in your Resources. Nothing was overwritten.");
        return;
      }
      state.bulkAddResources(additions);
      locallyUpdated = true;
      await flushLocalVaultWrites();
      assertVaultWritesSince(checkpoint);
      setMessage(`${additions.length} recording bookmarks saved to your Resources. They remain private study links, not official week assignments.`);
      pushToast({ title: "Study bookmarks saved locally", body: `${additions.length} unique links added to Resources; existing records were not replaced.`, tone: "success" });
    } catch (cause) {
      setError(locallyUpdated
        ? `Links were added in memory, but local persistence was not confirmed: ${cause instanceof Error ? cause.message : "unknown error"}`
        : cause instanceof Error ? cause.message : "Unable to save study links.");
    } finally { setBusy(false); }
  }

  return <GlassCard pad className="tracker-bookmark-import">
    <details>
      <summary><b>Import study video bookmarks</b><span className="sub">Private links · review course mapping</span></summary>
      <p className="sub">Select a Chrome or Safari HTML bookmarks export. AXOM reads only supported Panopto recording links, strips extra URL parameters and never downloads videos or uploads your bookmark file. Bookmarked lecture numbers are <b>not</b> a verified week schedule.</p>
      <input ref={chooser} type="file" accept=".html,.htm,text/html"
        aria-label="Choose a browser bookmarks HTML export" hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void select(file);
        }} />
      <GButton size="sm" disabled={busy} onClick={() => chooser.current?.click()}>
        {busy ? "Checking bookmarks…" : "Choose bookmarks HTML"}
      </GButton>
      {message && <p className="sub" role="status">{message}</p>}
      {error && <p className="sub" role="alert">{error}</p>}
      {review && <div className="tracker-bookmark-review">
        <p className="sub"><b>{review.videos.length}</b> unique video links · <b>{missing.length}</b> new · <b>{unresolved}</b> without a reviewed module choice · <b>{review.duplicateVideoLinks}</b> duplicate links collapsed.</p>
        <p className="sub">Unassigned links can still be saved in Resources. They will not be attached to an academic module until you review their location.</p>
        {folderSuggestions > 0 && <div className="tracker-bookmark-hints">
          <span className="sub">{folderSuggestions} bookmark folders suggest a unique module, but these are personal folder labels, not verified school schedules.</span>
          <GButton size="tiny" onClick={useFolderSuggestions}>Use {folderSuggestions} folder suggestions</GButton>
        </div>}
        <div className="tracker-bookmark-preview">
          {missing.slice(0, expanded ? missing.length : 12).map((video) => {
            const selected = choices[video.url] ?? (video.assignment === "unique-candidate" ? video.candidates[0].key : "");
            const owner = video.candidates.find((candidate) => candidate.key === selected);
            const possibleItems = owner ? bookmarkActivityCandidates(video, owner, tracker) : [];
            return <div className="tracker-bookmark-choice" key={video.url}>
              <b>{video.title}</b>
              <small>{video.activity ?? "Study video"}{video.activityNumber ? ` ${video.activityNumber}${video.part ?? ""}` : ""} · {video.assignment === "needs-course-review"
                ? "Module requires selection" : video.assignment === "unique-candidate" ? "One candidate from course outline" : "Course unassigned"}</small>
              {video.suggestedOwnerKey && <small>Bookmark folder suggests {video.candidates.find((candidate) => candidate.key === video.suggestedOwnerKey)?.module}. Confirm before associating.</small>}
              {video.candidates.length > 0 && <select className="scope-select" aria-label={`Course for ${video.title}`}
                value={selected}
                onChange={(event) => {
                  setChoices((current) => ({ ...current, [video.url]: event.target.value }));
                  setActivityChoices((current) => ({ ...current, [video.url]: "" }));
                }}>
                <option value="">Keep course unassigned</option>
                {video.candidates.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>{candidate.term} / {candidate.course} / {candidate.module}</option>
                ))}
              </select>}
              {possibleItems.length > 0 && <select className="scope-select" aria-label={`Tracker activity for ${video.title}`}
                value={activityChoices[video.url] ?? ""}
                onChange={(event) => setActivityChoices((current) => ({ ...current, [video.url]: event.target.value }))}>
                <option value="">Keep video at module level</option>
                {possibleItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.label} · {item.path}</option>
                ))}
              </select>}
              {possibleItems.length > 0 && <small>Activity numbers are candidate matches only. Select an exact tracker row yourself; the bookmark title is not source-verified week evidence.</small>}
            </div>;
          })}
        </div>
        {missing.length > 12 && <GButton size="tiny" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer links" : `Review all ${missing.length} links`}
        </GButton>}
        <GButton size="sm" disabled={busy || missing.length === 0} onClick={() => void save()}>
          {busy ? "Saving…" : `Save ${missing.length} new links to my Resources`}
        </GButton>
      </div>}
    </details>
  </GlassCard>;
}

export function TrackerBookmarkLinks({ scope }: { scope: string }) {
  const resources = useStore((state) => state.resources);
  const tracker = useStore((state) => state.tracker);
  const terms = useStore((state) => state.terms);
  const courses = useStore((state) => state.courses);
  const matches = useMemo(() =>
    academicResourcesForTrackerScope(scope, resources, terms, courses),
  [scope, resources, terms, courses]);
  if (!matches.length) return null;

  return <GlassCard pad className="tracker-bookmark-links">
    <div className="tracker-bookmark-heading"><b>Saved study recordings</b><span className="sub">{matches.length} private reference{matches.length === 1 ? "" : "s"}</span></div>
    <p className="sub">These Panopto links were saved from your own bookmarks. Course-platform access may be required. Bookmark titles do not verify individual lecture identity or official week timing.</p>
    <ul>{matches.slice(0, 12).map((resource) => {
      const trackerId = resource.tags.find((tag) => tag.startsWith("academic:tracker:"))?.slice("academic:tracker:".length);
      const associated = tracker.find((item) => item.id === trackerId);
      return <li key={resource.id}>
        <a href={resource.url} target="_blank" rel="noopener noreferrer">{resource.title}</a>
        {associated && <small> · Linked by you to {associated.label}</small>}
      </li>;
    })}</ul>
    {matches.length > 12 && <p className="sub">{matches.length - 12} more study links are available in Resources.</p>}
  </GlassCard>;
}

/** An explicit learner-selected recording association, never an automatic title match. */
export function TrackerItemBookmarkLinks({ itemId }: { itemId: string }) {
  const resources = useStore((state) => state.resources);
  const links = useMemo(() => resources.filter((resource) =>
    resource.tags.includes("axom:academic-panopto")
    && resource.tags.includes(`academic:tracker:${itemId}`)
    && canonicalPanoptoVideoUrl(resource.url) !== undefined), [resources, itemId]);
  if (!links.length) return null;
  return <div className="tracker-item-bookmark-links" aria-label="Linked study recordings">
    {links.slice(0, 3).map((resource) =>
      <a key={resource.id} href={resource.url} target="_blank" rel="noopener noreferrer">
        Recording: {resource.title}
      </a>)}
    {links.length > 3 && <small>+{links.length - 3} more linked recordings</small>}
  </div>;
}
