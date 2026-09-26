// One parser for the app, web metadata and native updater feed. Changelog text
// is displayed as plain text, never interpreted as HTML or executable markup.
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function plainText(markdown) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\r/g, '')
    .replace(/([^\n])\n[ \t]+(?=\S)/g, '$1 ')
    .trim();
}

/** Newest section wins when historical releases reused a version number. */
export function parseReleaseNotes(changelog) {
  if (typeof changelog !== 'string') throw new Error('Release notes must be Markdown text.');
  const releases = [];
  const versions = new Set();
  const sections = changelog.split(/^## /m).slice(1);
  for (const section of sections) {
    const newline = section.indexOf('\n');
    const heading = section.slice(0, newline < 0 ? undefined : newline).trim();
    const match = heading.match(/^(\S+)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})(?:\s+\((.*)\))?$/);
    if (!match || !VERSION.test(match[1]) || versions.has(match[1])) continue;
    const body = plainText(newline < 0 ? '' : section.slice(newline + 1));
    if (!body) continue;
    if (body.length > 16_000) throw new Error(`Release notes for ${match[1]} exceed 16,000 characters; keep user-facing changes concise.`);
    versions.add(match[1]);
    releases.push({ version: match[1], date: match[2], title: plainText(match[3] ?? `AXOM ${match[1]}`), body });
  }
  return releases;
}

export function requireReleaseNotes(changelog, version) {
  const release = parseReleaseNotes(changelog).find(entry => entry.version === version);
  if (!release) throw new Error(`Add user-facing notes to CHANGELOG.md under "## ${version} — YYYY-MM-DD (Title)" before building this release.`);
  return release;
}

export function formatReleaseNotes(release) {
  return `${release.title}\n${release.date}\n\n${release.body}`;
}
