import { APP_RELEASE_VERSION } from "../../lib/brand";
import { RELEASE_HISTORY } from "../../lib/releaseNotes";

export function ReleaseNotesHistory() {
  return <section aria-label="Release history">
    <h3>What’s new &amp; patch notes</h3>
    <p className="sub">Included with this app, available offline. New release details also appear before you update.</p>
    {RELEASE_HISTORY.slice(0, 12).map((release) => <details key={release.version} open={release.version === APP_RELEASE_VERSION}>
      <summary>v{release.version} · {release.title}</summary>
      <p className="sub">{release.date}{release.version === APP_RELEASE_VERSION ? " · Installed version" : ""}</p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{release.body}</p>
    </details>)}
  </section>;
}
