import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Archive, ArrowDown, ArrowUp, Check, Clock3, Copy, ExternalLink, FolderOpen, Info, LayoutGrid, List, Loader2, Pencil, Plus, Search, Star, Trash2,
} from "lucide-react";
import { useStore } from "../lib/store";
import { GlassCard, GButton, GhostButton, EmptyState } from "../components/ui/primitives";
import { Modal, Field, SelectField } from "../components/ui/Modal";
import { Icon, ICON_NAMES } from "../lib/icons";
import type { HubFolder } from "../lib/types";
import { ICON_SIZE } from "../lib/iconSize";
import { isTauriShell as isDesktopShell } from "../lib/desktopShell";

import { localHubFolderPath } from "../lib/localHubFolders";
import { hubFolderInfo, openHubFolder, safeFolderLink, validFolderPath, type HubFolderInfo } from "../lib/hubFolders";
import "../styles/hub-native.css";

const FOLDER_COLORS: Array<{ label: string; value: string }> = [
  { label: "Cool", value: "var(--cyan)" },
  { label: "Accent", value: "var(--gold)" },
  { label: "Green", value: "var(--green)" },
  { label: "Violet", value: "var(--purple)" },
  { label: "Orange", value: "var(--orange)" },
  { label: "Red", value: "var(--red)" },
];

type ViewMode = "grid" | "list";

export function filterFolders(folders: readonly HubFolder[], query: string, group: string | null, favoritesOnly: boolean): HubFolder[] {
  const needle = query.trim().toLowerCase();
  return folders.filter((folder) => (
    (!group || (folder.group ?? "Ungrouped") === group)
    && (!favoritesOnly || folder.favorite)
    && (!needle || [folder.name, folder.description, folder.link, folder.localPath, folder.group, ...(folder.tags ?? [])]
      .some((value) => value?.toLowerCase().includes(needle)))
  ));
}

export function HubFoldersPage() {
  const s = useStore();
  const [editing, setEditing] = useState<HubFolder | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState<ViewMode>(() => { try { return localStorage.getItem("axom.folders.view") === "list" ? "list" : "grid"; } catch { return "grid"; } });
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, { path: string; message: string } | undefined>>({});
  const [details, setDetails] = useState<Record<string, { path: string; info: HubFolderInfo }>>({});
  const desktop = isDesktopShell();
  const deviceFolders = s.folders.map((folder) => ({ ...folder, localPath: localHubFolderPath(folder) }));
  const activeFolders = deviceFolders.filter((folder) => !folder.archived);
  const archivedFolders = deviceFolders.filter((folder) => folder.archived);
  const groups = useMemo(() => [...new Set(activeFolders.map((folder) => folder.group ?? "Ungrouped"))].sort(), [activeFolders]);
  const visible = filterFolders(activeFolders, query, group, favoritesOnly);
  const favorites = visible.filter((folder) => folder.favorite);
  const recent = [...activeFolders].filter((folder) => folder.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "")).slice(0, 4);
  const sections = useMemo(() => {
    const rest = visible.filter((folder) => !folder.favorite);
    const map = new Map<string, HubFolder[]>();
    for (const folder of rest) {
      const key = folder.group ?? "Ungrouped";
      map.set(key, [...(map.get(key) ?? []), folder]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "Ungrouped" ? 1 : b === "Ungrouped" ? -1 : a.localeCompare(b)));
  }, [visible]);

  function setViewMode(next: ViewMode) {
    setView(next);
    try { localStorage.setItem("axom.folders.view", next); } catch { /* device preference */ }
  }

  function move(folder: HubFolder, direction: -1 | 1) {
    const list = activeFolders;
    const index = list.findIndex((item) => item.id === folder.id);
    const target = list[index + direction];
    if (!target) return;
    s.updateFolder(folder.id, { sortOrder: target.sortOrder ?? index + direction });
    s.updateFolder(target.id, { sortOrder: folder.sortOrder ?? index });
  }

  function markOpened(folder: HubFolder) {
    s.updateFolder(folder.id, { lastOpenedAt: new Date().toISOString() });
  }

  async function copyPath(folder: HubFolder) {
    const value = folder.localPath || folder.link || "";
    try {
      await navigator.clipboard.writeText(value);
      setCopied(folder.id);
      markOpened(folder);
      window.setTimeout(() => setCopied((current) => (current === folder.id ? null : current)), 1600);
    } catch {
      window.prompt("Copy this path", value);
    }
  }

  async function openLocal(folder: HubFolder, reveal = false) {
    if (!folder.localPath) return;
    setPending(folder.id);
    setErrors((previous) => ({ ...previous, [folder.id]: undefined }));
    try {
      await openHubFolder(folder.localPath, reveal);
      markOpened(folder);
    } catch (error) {
      setErrors((previous) => ({ ...previous, [folder.id]: { path: folder.localPath!, message: error instanceof Error ? error.message : String(error) } }));
    } finally { setPending(null); }
  }

  async function inspectLocal(folder: HubFolder) {
    if (!folder.localPath) return;
    setPending(folder.id);
    setErrors((previous) => ({ ...previous, [folder.id]: undefined }));
    try {
      const info = await hubFolderInfo(folder.localPath);
      setDetails((previous) => ({ ...previous, [folder.id]: { path: folder.localPath!, info } }));
    } catch (error) {
      setErrors((previous) => ({ ...previous, [folder.id]: { path: folder.localPath!, message: error instanceof Error ? error.message : String(error) } }));
    } finally { setPending(null); }
  }

  function renderFolder(folder: HubFolder) {
    const linkTarget = safeFolderLink(folder.link);
    const cached = details[folder.id];
    const info = cached?.path === folder.localPath ? cached?.info : undefined;
    const failure = errors[folder.id];
    const error = failure?.path === folder.localPath ? failure?.message : undefined;
    return (
      <GlassCard pad hoverable key={folder.id} className={`folder-card folder-card--${view}`} style={{ "--folder-color": folder.color || "var(--cyan)" } as React.CSSProperties}>
        <div className="folder-card-top">
          <span className="folder-icon"><Icon name={folder.icon} size={ICON_SIZE.control} /></span>
          <div className="folder-card-title">
            <div className="fc-name">{folder.name}{folder.favorite && <Star size={ICON_SIZE.microInline} className="folder-fav" fill="currentColor" aria-label="Favorite" />}</div>
            {folder.description && <div className="fc-desc">{folder.description}</div>}
          </div>
          <div className="folder-tools">
            <GhostButton title={folder.favorite ? "Unfavorite" : "Favorite"} aria-label={`${folder.favorite ? "Unfavorite" : "Favorite"} ${folder.name}`} onClick={() => s.updateFolder(folder.id, { favorite: !folder.favorite })}>
              <Star size={ICON_SIZE.body} fill={folder.favorite ? "currentColor" : "none"} />
            </GhostButton>
            <GhostButton title="Move up" aria-label={`Move ${folder.name} up`} onClick={() => move(folder, -1)} disabled={activeFolders[0]?.id === folder.id}><ArrowUp size={ICON_SIZE.body} /></GhostButton>
            <GhostButton title="Move down" aria-label={`Move ${folder.name} down`} onClick={() => move(folder, 1)} disabled={activeFolders.at(-1)?.id === folder.id}><ArrowDown size={ICON_SIZE.body} /></GhostButton>
            <GhostButton title="Edit" aria-label={`Edit ${folder.name}`} onClick={() => setEditing(folder)}><Pencil size={ICON_SIZE.body} /></GhostButton>
            <GhostButton title="Archive" aria-label={`Archive ${folder.name}`} onClick={() => s.updateFolder(folder.id, { archived: true })}><Archive size={ICON_SIZE.body} /></GhostButton>
          </div>
        </div>
        {folder.localPath && <div className="fc-path truncate" title={folder.localPath}>{folder.localPath}</div>}
        {folder.localPath && <div className="folder-native-meta">
          <span>{desktop ? "Local folder · this device" : "Local folder · desktop required"}</span>
          {info && <span>{info.entries.toLocaleString()}{info.entriesCapped ? "+" : ""} items{info.modifiedAt ? ` · Modified ${new Date(info.modifiedAt * 1000).toLocaleDateString()}` : ""}</span>}
        </div>}
        {folder.link && !linkTarget && <p className="folder-native-meta">App links can be copied and opened in their own app.</p>}
        {error && <p className="folder-error" role="alert">{error}</p>}
        <div className="folder-card-foot">
          <div className="row wrap gap6">
            {(folder.tags ?? []).slice(0, 3).map((tag) => <span className="tag neutral" key={tag}>#{tag}</span>)}
          </div>
          <div className="folder-actions">
            {folder.localPath && desktop && <>
              <GButton variant="primary" size="sm" disabled={pending === folder.id} onClick={() => void openLocal(folder)} aria-label={`Open ${folder.name} in file manager`}>
                {pending === folder.id ? <Loader2 className="folder-spinner" size={ICON_SIZE.body} /> : <FolderOpen size={ICON_SIZE.body} />} Open folder
              </GButton>
              <GhostButton disabled={pending === folder.id} onClick={() => void openLocal(folder, true)} aria-label={`Reveal ${folder.name} in file manager`} title="Reveal folder"><ExternalLink size={ICON_SIZE.body} /></GhostButton>
              <GhostButton disabled={pending === folder.id} onClick={() => void inspectLocal(folder)} aria-label={`Refresh details for ${folder.name}`} title="Read folder details"><Info size={ICON_SIZE.body} /></GhostButton>
            </>}
            {(folder.localPath || folder.link) && (
              <GButton size="sm" onClick={() => void copyPath(folder)} aria-label={`Copy ${folder.localPath ? "path" : "link"} for ${folder.name}`}>
                {copied === folder.id ? <><Check size={ICON_SIZE.body} /> Copied</> : <><Copy size={ICON_SIZE.body} /> Copy {folder.localPath ? "path" : "link"}</>}
              </GButton>
            )}
            {linkTarget && (
              <a className="gbtn sm primary" href={linkTarget} target="_blank" rel="noreferrer" onClick={() => markOpened(folder)}>
                Open <ExternalLink size={ICON_SIZE.body} />
              </a>
            )}
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard pad className="folders-hero">
        <div className="sec-row">
          <div>
            <div className="panel-title">Hub Folders</div>
            <div className="panel-sub">One place for the folders, drives, repos, and sites you open every day. Links open directly. {desktop ? "Local folders open in your file manager." : "Local folders open in the desktop app; copy their path here."}</div>
          </div>
          <GButton variant="primary" size="sm" onClick={() => setEditing("new")}><Plus size={ICON_SIZE.body} /> Add folder</GButton>
        </div>
        <div className="folders-toolbar">
          <label className="folders-search">
            <Search size={ICON_SIZE.body} aria-hidden="true" />
            <input className="field" placeholder="Search folders, tags, paths…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search folders" />
          </label>
          <div className="filter-bar" role="group" aria-label="Filter by group">
            <button type="button" className={`filter-pill ${!group && !favoritesOnly ? "on" : ""}`} onClick={() => { setGroup(null); setFavoritesOnly(false); }}>All <small>{activeFolders.length}</small></button>
            <button type="button" className={`filter-pill ${favoritesOnly ? "on" : ""}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}><Star size={ICON_SIZE.microInline} /> Favorites</button>
            {groups.map((name) => (
              <button type="button" key={name} className={`filter-pill ${group === name ? "on" : ""}`} aria-pressed={group === name} onClick={() => setGroup(group === name ? null : name)}>{name}</button>
            ))}
          </div>
          <div className="folders-view" role="group" aria-label="Layout">
            <button type="button" className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} aria-label="Grid view" onClick={() => setViewMode("grid")}><LayoutGrid size={ICON_SIZE.body} /></button>
            <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} aria-label="List view" onClick={() => setViewMode("list")}><List size={ICON_SIZE.body} /></button>
          </div>
        </div>
        {recent.length > 0 && !query && !group && !favoritesOnly && (
          <div className="folders-recent">
            <span><Clock3 size={ICON_SIZE.microInline} aria-hidden="true" /> Recently used</span>
            {recent.map((folder) => (
              <button type="button" key={folder.id} onClick={() => folder.localPath && desktop ? void openLocal(folder) : safeFolderLink(folder.link) ? (markOpened(folder), window.open(safeFolderLink(folder.link), "_blank", "noopener,noreferrer")) : void copyPath(folder)}>
                <Icon name={folder.icon} size={ICON_SIZE.microInline} /> {folder.name}
              </button>
            ))}
          </div>
        )}
      </GlassCard>

      {activeFolders.length === 0 && <GlassCard pad><EmptyState title="No active hub folders" hint="Add your first drive, repository, project, study folder, or external launch destination." /></GlassCard>}
      {activeFolders.length > 0 && visible.length === 0 && <GlassCard pad><EmptyState title="Nothing matches" hint="Clear the search or pick another group." /></GlassCard>}

      {favorites.length > 0 && (
        <section className="folders-section" aria-label="Pinned folders">
          <h3><Star size={ICON_SIZE.body} aria-hidden="true" /> Pinned</h3>
          <div className={view === "grid" ? "grid grid-courses" : "folders-list"}>{favorites.map((folder) => renderFolder(folder))}</div>
        </section>
      )}
      {sections.map(([name, folders]) => (
        <section className="folders-section" key={name} aria-label={`${name} folders`}>
          <h3>{name} <small>{folders.length}</small></h3>
          <div className={view === "grid" ? "grid grid-courses" : "folders-list"}>
            {folders.map((folder) => renderFolder(folder))}
            {name === sections.at(-1)?.[0] && view === "grid" && (
              <button type="button" className="add-tile" onClick={() => setEditing("new")} style={{ minHeight: 132 }}>
                <Plus size={ICON_SIZE.emphasis} /> Add folder
              </button>
            )}
          </div>
        </section>
      ))}

      {archivedFolders.length > 0 && (
        <GlassCard pad>
          <div className="sec-row">
            <div>
              <div className="panel-title">Archived folders</div>
              <div className="panel-sub">Hidden from the command layer, preserved for restore or permanent removal.</div>
            </div>
          </div>
          <div className="stack gap8" style={{ marginTop: 10 }}>
            {archivedFolders.map((folder) => (
              <div className="dense-row" key={folder.id}>
                <span className="folder-icon" style={{ color: folder.color || "var(--cyan)" }}><Icon name={folder.icon} size={ICON_SIZE.emphasis} /></span>
                <div className="grow"><b>{folder.name}</b><span className="sub">{folder.description || folder.link || folder.localPath || "Archived shortcut"}</span></div>
                <GButton size="sm" onClick={() => s.updateFolder(folder.id, { archived: false })}>Restore</GButton>
                <GhostButton className="danger" title="Remove permanently" onClick={() => confirm(`Remove “${folder.name}” from Hub Folders?`) && s.removeFolder(folder.id)}><Trash2 size={ICON_SIZE.body} /></GhostButton>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {editing && <FolderEditor folder={editing === "new" ? null : editing} groups={groups.filter((name) => name !== "Ungrouped")} onClose={() => setEditing(null)} />}
    </>
  );
}

function FolderEditor({ folder, groups, onClose }: { folder: HubFolder | null; groups: string[]; onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState(folder?.name ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [link, setLink] = useState(folder?.link ?? "");
  const [localPath, setLocalPath] = useState(folder?.localPath ?? "");
  const [icon, setIcon] = useState(folder?.icon ?? "Folder");
  const [color, setColor] = useState(folder?.color ?? "var(--cyan)");
  const [group, setGroup] = useState(folder?.group ?? "");
  const [tags, setTags] = useState((folder?.tags ?? []).join(", "));
  const [favorite, setFavorite] = useState(folder?.favorite ?? false);
  const linkInvalid = Boolean(link.trim()) && !/^(https?:\/\/|mailto:|obsidian:|notion:)/i.test(link.trim());
  const pathInvalid = Boolean(localPath.trim()) && !validFolderPath(localPath.trim());

  function save() {
    if (!name.trim() || linkInvalid || pathInvalid) return;
    const payload = {
      name: name.trim(),
      description: description.trim(),
      link: link.trim() || undefined,
      localPath: localPath.trim(),
      icon,
      color,
      group: group.trim() || undefined,
      tags: tags.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean),
      favorite,
      archived: folder?.archived ?? false,
      sortOrder: folder?.sortOrder,
    };
    if (folder) s.updateFolder(folder.id, payload);
    else s.addFolder(payload);
    onClose();
  }

  function pickFolder(e: ChangeEvent<HTMLInputElement>) {
    const first = e.target.files?.[0];
    const rel = first?.webkitRelativePath;
    const root = rel?.split("/")[0];
    if (root && !name.trim()) setName(root);
    if (root && !description.trim()) setDescription(`Local folder shortcut: ${root}`);
  }

  return (
    <Modal title={folder ? "Edit folder" : "Add folder"} onClose={onClose}
      footer={<><GButton onClick={onClose}>Cancel</GButton><GButton variant="primary" onClick={save} disabled={!name.trim() || linkInvalid || pathInvalid}>Save</GButton></>}>
      <Field label="Name" value={name} list="hub-folder-name-options" onChange={(e) => setName(e.target.value)} autoFocus />
      <datalist id="hub-folder-name-options">
        {s.folders.map((existing) => <option key={existing.id} value={existing.name} />)}
      </datalist>
      <Field label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Field label="Link (optional)" placeholder="https://drive.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} />
      {linkInvalid && <div className="field-error" role="alert">Links should start with https:// (or mailto:, obsidian:, notion:).</div>}
      <Field label="Local path (optional)" placeholder="/Users/you/Medical School/01 BPM 501" value={localPath} onChange={(e) => setLocalPath(e.target.value)} />
      {pathInvalid && <div className="field-error" role="alert">Use an absolute folder path without parent-directory shortcuts.</div>}
      <div className="row gap12">
        <Field label="Group" placeholder="Study folders, Drives…" value={group} list="hub-folder-groups" onChange={(e) => setGroup(e.target.value)} />
        <datalist id="hub-folder-groups">{groups.map((name) => <option key={name} value={name} />)}</datalist>
        <Field label="Tags" placeholder="anki, step, research" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="folder-color-row" role="radiogroup" aria-label="Folder color">
        {FOLDER_COLORS.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={color === option.value} aria-label={option.label} title={option.label}
            className={color === option.value ? "on" : ""} style={{ background: option.value }} onClick={() => setColor(option.value)} />
        ))}
        <label className="row gap8" style={{ alignItems: "center", marginLeft: "auto" }}>
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          Pin to top
        </label>
      </div>
      <label className="folder-picker">
        <input type="file" onChange={pickFolder} {...{ webkitdirectory: "", directory: "" }} />
        Import local folder name
      </label>
      <div className="sub">Existing folder names autocomplete; saving the same name or destination updates the existing shortcut instead of creating a duplicate.</div>
      <SelectField label="Icon" value={icon} onChange={(e) => setIcon(e.target.value)}>
        {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
      </SelectField>
    </Modal>
  );
}
