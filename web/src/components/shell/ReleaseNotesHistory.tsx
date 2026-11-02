import { APP_RELEASE_VERSION } from "../../lib/brand";
import { RELEASE_HISTORY } from "../../lib/releaseNotes";
import { orderedReleaseNotes } from "../../lib/patchNotes";

export function ReleaseNotesHistory() {
  return <details className="release-history-disclosure">
    <summary><span>What’s new &amp; patch notes</span><small>Read release history</small></summary>
    <section aria-label="Release history">
      <p className="sub">Included with this app and available offline.</p>
      {orderedReleaseNotes(RELEASE_HISTORY).slice(0, 3).map((release) => <details key={release.version} open={release.version === APP_RELEASE_VERSION}>
        <summary>v{release.version} · {release.title}</summary>
        <p className="sub">{release.date}{release.version === APP_RELEASE_VERSION ? " · Installed version" : ""}</p>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{release.body}</p>
      </details>)}
      <a className="gbtn sm" href="#patch-notes">Browse all patch notes</a>
    </section>
  </details>;
}
