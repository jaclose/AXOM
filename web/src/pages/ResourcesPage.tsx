import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Star, ExternalLink, Search, ListPlus, Link as LinkIcon, HardDrive, EyeOff } from "lucide-react";
import { useStore } from "../lib/store";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag, EmptyState } from "../components/ui/primitives";
import { Modal, Field, SelectField, TextAreaField } from "../components/ui/Modal";
import type { Resource } from "../lib/types";
import { resolveTrack } from "../lib/tracks";
import {
  RESOURCE_GROUPS, SOURCE_TYPES, hostOfResource, isDriveVisibleForTrack,
  normalizeResourceUrl, resourceAudience, resourceGroup, resourceSortScore,
  resourceSourceType, usableResourceHref,
} from "../lib/resourceUtils";
import { ICON_SIZE } from "../lib/iconSize";

const CATEGORIES = ["Drives", "MCAT", "Pre-Med", "STEP 1", "STEP 2", "Shelf", "Clinical", ...RESOURCE_GROUPS];

export function ResourcesPage() {
  const s = useStore();
  const [editing, setEditing] = useState<Resource | "new" | null>(null);
  const [addDrive, setAddDrive] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [cat, setCat] = useState("All");
  const [source, setSource] = useState("All");
  const [audience, setAudience] = useState("All");
  const [sort, setSort] = useState("Curated");
  const [q, setQ] = useState("");

  const track = resolveTrack(s.profile.educationTrack);
  const showSgu = s.profile.showSguResources ?? track.showsSguResources;
  const allDrives = s.resources.filter((r) => r.category === "Drives");
  // Course-scoped drives hide when the toggle is off; personal + universal stay.
  const hiddenSguCount = allDrives.filter((r) => !isDriveVisibleForTrack(r, showSgu)).length;
  const drives = allDrives
    .filter((r) => isDriveVisibleForTrack(r, showSgu))
    .filter((r) => passesResourceFilters(r, { cat, source, audience, q, includeDrives: true }))
    .sort(compareResources(sort));

  const categories = useMemo(
    () => ["All", "★ Favorites", ...Array.from(new Set([...CATEGORIES, ...s.resources.map((r) => resourceGroup(r))]))],
    [s.resources],
  );

  const shown = s.resources
    .filter((r) => r.category !== "Drives")
    .filter((r) => passesResourceFilters(r, { cat, source, audience, q, includeDrives: false }))
    .sort(compareResources(sort));

  return (
    <>
      <GlassCard pad>
        <PanelHeader title="Resources" sub="Saved hyperlinks — STEP 1 prep, references, decks, tools"
          action={
            <div className="row gap8">
              <GButton size="sm" onClick={() => setBulk(true)}><ListPlus size={ICON_SIZE.body} /> Import links</GButton>
              <GButton size="sm" variant="primary" onClick={() => setEditing("new")}><Plus size={ICON_SIZE.body} /> Add</GButton>
            </div>} />
        <div className="resource-filter-row">
          <div className="search-wrap grow">
            <Search size={ICON_SIZE.body} />
            <input className="search-input" placeholder="Search resources…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <SelectField label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option>All</option>
            {SOURCE_TYPES.map((type) => <option key={type}>{type}</option>)}
          </SelectField>
          <SelectField label="Owner" value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option>All</option>
            <option>Personal</option>
            <option>Public</option>
          </SelectField>
          <SelectField label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option>Curated</option>
            <option>Rating high to low</option>
            <option>Category</option>
            <option>Name</option>
          </SelectField>
        </div>
        <div className="filter-bar">
          {categories.map((c) => (
            <button key={c} className={`filter-pill ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </GlassCard>

      {/* Curated drives are optional by course; personal and universal links remain. */}
      {(cat === "All" || cat === "Drives" || drives.length > 0) && (
        <GlassCard pad className="drives-band" data-tour="resources">
          <PanelHeader title="Curated Drives"
            sub={`Tailored to ${track.short}. Personal drives and universal board packs always stay; course-specific drives follow the toggle.`}
            action={
              <div className="row gap8">
                <button type="button" className={`filter-pill drive-sgu-toggle ${showSgu ? "on" : ""}`}
                  onClick={() => s.updateProfile({ showSguResources: !showSgu })}
                  title={showSgu ? "Hide course-specific drives" : "Show course-specific drives"}>
                  {showSgu ? <HardDrive size={ICON_SIZE.body} /> : <EyeOff size={ICON_SIZE.body} />} Course drives {showSgu ? "on" : "off"}
                </button>
                <GButton size="sm" onClick={() => setAddDrive(true)}><Plus size={ICON_SIZE.body} /> Add drive</GButton>
              </div>} />
          {hiddenSguCount > 0 && !showSgu && (
            <div className="drives-hidden-note">
              <EyeOff size={ICON_SIZE.body} /> {hiddenSguCount} course-specific drive{hiddenSguCount === 1 ? "" : "s"} hidden for your program. Toggle them on any time.
            </div>
          )}
          {drives.length === 0 ? (
            <EmptyState icon={<HardDrive size={ICON_SIZE.display} />} title="No drives yet"
              hint="Paste a course or Google Drive link. It stays in your private workspace." />
          ) : (
            <div className="grid grid-courses">
              {drives.map((r) => {
                const href = usableResourceHref(r.url);
                const group = resourceGroup(r);
                const main = (
                  <>
                    <span className="folder-icon"><HardDrive size={ICON_SIZE.emphasis} /></span>
                    <div className="grow">
                      <div className="fc-name truncate">{r.title}</div>
                      <div className="fc-desc truncate">{href ? `${resourceSourceType(r.url)} · ${hostOfResource(href)}` : "Missing or invalid drive link"}</div>
                    </div>
                  </>
                );
                return (
                  <div className="drive-tile-wrap" key={r.id}>
                    {typeof r.rating === "number" && (
                      <span className={`drive-rating r${r.rating >= 10 ? "10" : r.rating >= 8 ? "8" : "low"}`}
                        title={r.ratingReason || `Personal usefulness: ${r.rating}/10`}>
                        {r.rating}<small>/10</small>
                      </span>
                    )}
                    {href
                      ? <a className="drive-tile" href={href} target="_blank" rel="noreferrer noopener">{main}</a>
                      : <button type="button" className="drive-tile missing" onClick={() => setEditing(r)}>{main}</button>}
                    <div className="drive-foot">
                      <Tag tone="purple">{group}</Tag>
                      <div className="right row gap6">
                        <GhostButton title="Edit / rate" onClick={() => setEditing(r)}><Pencil size={ICON_SIZE.body} /></GhostButton>
                        <GhostButton className="danger" title="Remove drive" onClick={() => confirmRemoveResource(r) && s.removeResource(r.id)}><Trash2 size={ICON_SIZE.body} /></GhostButton>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {shown.length === 0 && cat !== "Drives" && (
        <GlassCard pad><EmptyState icon={<LinkIcon size={ICON_SIZE.display} />} title="No resources" hint="Add a link or import a batch to start your library." /></GlassCard>
      )}

      <div className="grid grid-courses">
        {shown.map((r) => {
          const href = usableResourceHref(r.url);
          return (
          <GlassCard pad hoverable key={r.id} className="folder-card">
            <div className="card-hover-tools">
              <GhostButton onClick={() => setEditing(r)}><Pencil size={ICON_SIZE.body} /></GhostButton>
              <GhostButton className="danger" onClick={() => confirmRemoveResource(r) && s.removeResource(r.id)}><Trash2 size={ICON_SIZE.body} /></GhostButton>
            </div>
            {typeof r.rating === "number" && (
              <span className={`drive-rating resource-rating r${r.rating >= 10 ? "10" : r.rating >= 8 ? "8" : "low"}`}
                title={r.ratingReason || `Personal usefulness: ${r.rating}/10`}>
                {r.rating}<small>/10</small>
              </span>
            )}
            <div className="row gap8" style={{ alignItems: "flex-start" }}>
              <span className="folder-icon"><Favicon url={r.url} /></span>
              <button className={`star ${r.favorite ? "on" : ""}`} onClick={() => s.toggleResourceFavorite(r.id)} title="Favorite">
                <Star size={ICON_SIZE.body} fill={r.favorite ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="fc-name">{r.title}</div>
            <div className="fc-desc truncate">{href ? `${resourceSourceType(r.url)} · ${hostOfResource(href)}` : "Missing or invalid link"}</div>
            {r.note && <div className="fc-desc">{r.note}</div>}
            <div className="row wrap gap6">
              <Tag tone="cyan">{resourceGroup(r)}</Tag>
              <Tag tone="neutral">{resourceAudience(r)}</Tag>
              {r.tags.slice(0, 3).map((t) => <Tag key={t} tone="neutral">#{t}</Tag>)}
            </div>
            {href
              ? <a className="gbtn sm" href={href} target="_blank" rel="noreferrer" style={{ marginTop: "auto" }}>
                  Open <ExternalLink size={ICON_SIZE.body} />
                </a>
              : <button className="gbtn sm resource-missing" onClick={() => setEditing(r)} style={{ marginTop: "auto" }}>
                  Add working link
                </button>}
          </GlassCard>
        );})}
      </div>

      {editing && <ResourceEditor resource={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {addDrive && <ResourceEditor resource={null} defaultCategory="Drives" onClose={() => setAddDrive(false)} />}
      {bulk && <BulkLinksModal onClose={() => setBulk(false)} />}
    </>
  );
}

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOfResource(url);
  if (!host || failed || !/\./.test(host)) return <LinkIcon size={ICON_SIZE.emphasis} />;
  return (
    <img className="favicon" src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
      alt="" width={18} height={18} loading="lazy" onError={() => setFailed(true)} />
  );
}

function passesResourceFilters(
  r: Resource,
  filter: { cat: string; source: string; audience: string; q: string; includeDrives: boolean },
): boolean {
  if (!filter.includeDrives && r.category === "Drives") return false;
  if (filter.cat === "★ Favorites" && !r.favorite) return false;
  if (filter.cat !== "All" && filter.cat !== "★ Favorites" && filter.cat !== resourceGroup(r) && filter.cat !== r.category) return false;
  if (filter.source !== "All" && resourceSourceType(r.url) !== filter.source) return false;
  if (filter.audience !== "All" && resourceAudience(r) !== filter.audience) return false;
  const needle = filter.q.trim().toLowerCase();
  if (needle && !(`${r.title} ${r.url} ${r.tags.join(" ")} ${r.note ?? ""} ${resourceGroup(r)} ${resourceSourceType(r.url)}`.toLowerCase().includes(needle))) return false;
  return true;
}

function compareResources(sort: string) {
  return (a: Resource, b: Resource) => {
    if (sort === "Rating high to low") return (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title);
    if (sort === "Category") return resourceGroup(a).localeCompare(resourceGroup(b)) || resourceSortScore(a) - resourceSortScore(b) || a.title.localeCompare(b.title);
    if (sort === "Name") return a.title.localeCompare(b.title);
    return resourceSortScore(a) - resourceSortScore(b) || resourceGroup(a).localeCompare(resourceGroup(b)) || a.title.localeCompare(b.title);
  };
}

function confirmRemoveResource(resource: Resource): boolean {
  const personal = resourceAudience(resource) === "Personal" ? "personal " : "";
  return confirm(`Remove the ${personal}resource “${resource.title}”? This only removes the shortcut from AXOM; it does not delete the remote drive or file.`);
}

function ResourceEditor({ resource, defaultCategory, onClose }: { resource: Resource | null; defaultCategory?: string; onClose: () => void }) {
  const s = useStore();
  const [title, setTitle] = useState(resource?.title ?? "");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [category, setCategory] = useState(resource ? (resource.category === "Drives" ? "Drives" : resourceGroup(resource)) : defaultCategory ?? "Step 1");
  const [tags, setTags] = useState((resource?.tags ?? []).join(", "));
  const [note, setNote] = useState(resource?.note ?? "");
  const [rating, setRating] = useState(resource?.rating != null ? String(resource.rating) : "");
  const [ratingReason, setRatingReason] = useState(resource?.ratingReason ?? "");
  const normalized = url.trim() ? normalizeResourceUrl(url) : "";
  const duplicate = normalized
    ? s.resources.find((r) => r.id !== resource?.id && normalizeResourceUrl(r.url).toLowerCase() === normalized.toLowerCase())
    : undefined;

  const urlValid = !url.trim() || Boolean(usableResourceHref(normalized));

  function save() {
    if (!title.trim() || !url.trim()) return;
    if (!usableResourceHref(normalized)) return;
    const ratingNum = rating.trim() ? Math.max(1, Math.min(10, Number(rating) || 0)) : undefined;
    const payload = {
      title: title.trim(), url: normalized, category: category.trim() || "General",
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean), note: note.trim() || undefined,
      favorite: resource?.favorite,
      rating: ratingNum, ratingReason: ratingReason.trim() || undefined,
    };
    if (resource) s.updateResource(resource.id, payload);
    else s.addResource(payload);
    onClose();
  }

  return (
    <Modal title={resource ? "Edit resource" : defaultCategory === "Drives" ? "Add shared drive" : "Add resource"} onClose={onClose}
      footer={<><GButton onClick={onClose}>Cancel</GButton><GButton variant="primary" onClick={save}>Save</GButton></>}>
      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <Field label="URL" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      {!urlValid && <div className="form-warning">Paste a complete http(s) URL. Google Drive links are welcome here.</div>}
      {duplicate && <div className="form-warning">This URL already exists as “{duplicate.title}”. Saving will update the existing shortcut instead of creating clutter.</div>}
      <div className="row gap12">
        <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </SelectField>
        <Field label="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <TextAreaField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      <div className="row gap12">
        <Field label="Usefulness (1–10)" type="number" min={1} max={10} placeholder="10"
          value={rating} onChange={(e) => setRating(e.target.value)} />
        <Field label="Why this rating (shown on hover)" value={ratingReason} onChange={(e) => setRatingReason(e.target.value)} />
      </div>
      <div className="sub">Source detected: {url.trim() ? resourceSourceType(normalized) : "—"} · URLs are normalized to prevent duplicate cards.</div>
    </Modal>
  );
}

/** Paste many links at once: "Title | URL" per line, or just URLs. */
function BulkLinksModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [category, setCategory] = useState("Step 1");
  const [text, setText] = useState("");

  const existing = useMemo(() => new Set(s.resources.map((r) => normalizeResourceUrl(r.url).toLowerCase())), [s.resources]);
  const parsed = parseLinks(text, existing);

  function run() {
    if (!parsed.length) return;
    s.bulkAddResources(parsed.map((p) => ({ ...p, category, tags: [] })));
    onClose();
  }

  return (
    <Modal title="Import links" onClose={onClose}
      footer={<><GButton onClick={onClose}>Cancel</GButton>
        <GButton variant="primary" disabled={!parsed.length} onClick={run}>Import {parsed.length || ""}</GButton></>}>
      <SelectField label="Category for all" value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </SelectField>
      <ol className="import-steps">
        <li>Choose the bucket first: <b>Drives</b> for course or Google Drive packages, <b>STEP 1</b> or <b>STEP 2</b> for board resources.</li>
        <li>Paste one link per line. Use <span className="mono">Title | URL</span> when you want a clean name.</li>
        <li>Blank or malformed links are ignored, so dead placeholders will not be imported.</li>
      </ol>
      <TextAreaField label={'One per line — "Title | https://url" or just a URL'}
        placeholder={"Boards & Beyond | https://www.boardsbeyond.com\nhttps://www.uptodate.com"}
        value={text} onChange={(e) => setText(e.target.value)} rows={9} autoFocus />
      <div className="sub">{parsed.length} link{parsed.length === 1 ? "" : "s"} detected.</div>
    </Modal>
  );
}

function parseLinks(text: string, existing: Set<string>): { title: string; url: string }[] {
  const seen = new Set(existing);
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [a, b] = line.split("|").map((x) => x.trim());
    if (b) return { title: a, url: normalizeResourceUrl(b) };
    const url = normalizeResourceUrl(a);
    return { title: hostOfResource(url), url };
  }).filter((r) => {
    if (!usableResourceHref(r.url)) return false;
    const key = normalizeResourceUrl(r.url).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
