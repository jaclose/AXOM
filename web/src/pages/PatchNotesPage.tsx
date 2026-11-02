import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, History, Search, X } from "lucide-react";
import { GlassCard, Tag } from "../components/ui/primitives";
import { BUILD_INFO } from "../lib/buildInfo";
import { APP_RELEASE_VERSION } from "../lib/brand";
import { ICON_SIZE } from "../lib/iconSize";
import { RELEASE_HISTORY } from "../lib/releaseNotes";
import { releaseHighlights, visibleReleaseNotes, type PatchNotesScope } from "../lib/patchNotes";
import type { ReleaseNote } from "../../../scripts/release-notes.mjs";
import "../styles/patch-notes.css";

function readableDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function RevisionLabel() {
  const revision = BUILD_INFO.commitSha;
  return <span className="patch-notes-revision">
    {revision === "local" ? "Local build" : `Revision ${revision.slice(0, 8)}`}
  </span>;
}

function ReleaseEntry({ release, current }: { release: ReleaseNote; current: boolean }) {
  const highlights = releaseHighlights(release);
  return <li className={`patch-notes-entry${current ? " is-current" : ""}`}>
    <div className="patch-notes-rail" aria-hidden="true"><span /></div>
    <GlassCard pad className="patch-notes-entry-card">
      <div className="patch-notes-entry-meta">
        <time dateTime={release.date}>{readableDate(release.date)}</time>
        <span>v{release.version}</span>
        {current && <Tag tone="cyan">Version in this build</Tag>}
      </div>
      <h2>{release.title}</h2>
      {highlights.length > 0 && <ul className="patch-notes-highlights">
        {highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
      </ul>}
      <details className="patch-notes-full">
        <summary>Read complete notes <ArrowUpRight size={ICON_SIZE.body} aria-hidden="true" /></summary>
        <div className="patch-notes-full-copy">{release.body}</div>
      </details>
    </GlassCard>
  </li>;
}

export function PatchNotesPage() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<PatchNotesScope>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const releases = useMemo(
    () => visibleReleaseNotes(RELEASE_HISTORY, query, scope, APP_RELEASE_VERSION),
    [query, scope],
  );
  const hasCurrentNotes = RELEASE_HISTORY.some((release) => release.version === APP_RELEASE_VERSION);

  return <main className="patch-notes-page" aria-labelledby="patch-notes-title">
    <header className="patch-notes-hero">
      <div className="patch-notes-hero-copy">
        <span className="patch-notes-kicker"><History size={ICON_SIZE.body} aria-hidden="true" /> AXOM / CHANGE RECORD</span>
        <h1 id="patch-notes-title">What changed.</h1>
        <p>A readable record of releases, included with AXOM so you can revisit it offline.</p>
      </div>
      <div className="patch-notes-build" aria-label="Build information">
        <img src={`${import.meta.env.BASE_URL}icons/axom-orb-512.png`} alt="AXOM Orb" width="64" height="64" />
        <div>
          <small>THIS BUILD</small>
          <strong>v{APP_RELEASE_VERSION}</strong>
          <RevisionLabel />
        </div>
      </div>
    </header>

    {!hasCurrentNotes && <p className="patch-notes-missing" role="status">
      Notes for this version are not included in this build. Earlier release records remain below.
    </p>}

    <div className="patch-notes-controls">
      <div className="patch-notes-scope" role="group" aria-label="Release scope">
        <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All releases</button>
        <button type="button" aria-pressed={scope === "current"} onClick={() => setScope("current")}>This version</button>
      </div>
      <div className="patch-notes-search">
        <Search size={ICON_SIZE.body} aria-hidden="true" />
        <label className="sr-only" htmlFor="patch-notes-search">Search patch notes</label>
        <input ref={searchRef} id="patch-notes-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search changes or versions" />
        {query && <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search"><X size={ICON_SIZE.body} aria-hidden="true" /></button>}
      </div>
    </div>

    <p className="patch-notes-count" aria-live="polite">
      {releases.length} release{releases.length === 1 ? "" : "s"} in this view
    </p>
    {releases.length > 0
      ? <ol className="patch-notes-timeline">{releases.map((release) =>
        <ReleaseEntry key={`${release.version}-${release.date}`} release={release} current={release.version === APP_RELEASE_VERSION} />,
      )}</ol>
      : <GlassCard pad className="patch-notes-empty">
        <h2>No matching notes</h2>
        <p>Try a different phrase or show all releases.</p>
        <button type="button" onClick={() => { setQuery(""); setScope("all"); searchRef.current?.focus(); }}>Show all releases</button>
      </GlassCard>}
    <p className="patch-notes-footnote">{BUILD_INFO.commitSha === "local"
      ? "This local build has no verified source revision. Release notes describe its version, not these exact files."
      : "This history records versioned release notes. The revision above identifies the committed source used for this build."}</p>
  </main>;
}
