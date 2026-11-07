import { useState } from "react";
import { BookOpen, FolderOpen, Link2 } from "lucide-react";
import { useStore } from "../lib/store";
import { ResourcesPage } from "./ResourcesPage";
import { HubFoldersPage } from "./HubFoldersPage";
import "../styles/workspace-hubs.css";

export type LibraryWorkspaceTab = "sources" | "folders";

const LIBRARY_VIEWS = [
  { id: "sources", label: "Sources", hint: "References and saved links", icon: BookOpen },
  { id: "folders", label: "Folders", hint: "Project and drive shortcuts", icon: FolderOpen },
] as const;

/** Consolidates the two existing link stores without merging their identities. */
export function LibraryWorkspacePage({ initialTab = "sources" }: { initialTab?: LibraryWorkspaceTab }) {
  const [tab, setTab] = useState<LibraryWorkspaceTab>(initialTab);
  const resources = useStore((state) => state.resources);
  const folders = useStore((state) => state.folders);

  return <section className="axom-workspace" aria-labelledby="library-workspace-title">
    <header className="axom-workspace-hero">
      <div>
        <span className="axom-workspace-eyebrow">AXOM / PERSONAL ARCHIVE</span>
        <h1 id="library-workspace-title">Everything, within reach.</h1>
        <p>References, drives and project locations stay editable in their original collections. A shortcut is not proof that the linked source has been reviewed.</p>
      </div>
      <span className="axom-workspace-hero-symbol" aria-hidden="true"><Link2 size={42} strokeWidth={1.1} /></span>
    </header>
    <div className="axom-workspace-indicators">
      <div><span>RESOURCE LINKS</span><strong>{resources.length}</strong><small>Curated and personal references</small></div>
      <div><span>ACTIVE FOLDERS</span><strong>{folders.filter((folder) => !folder.archived).length}</strong><small>Shortcuts available to open</small></div>
      <div><span>ARCHIVED</span><strong>{folders.filter((folder) => folder.archived).length}</strong><small>Preserved, not deleted</small></div>
      <span className="axom-workspace-evidence axom-workspace-explainer">Local paths open in the desktop app only.</span>
    </div>
    <nav className="axom-workspace-nav" aria-label="Library views">
      {LIBRARY_VIEWS.map(({ id, label, hint, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={tab === id} aria-controls="library-workspace-content" onClick={() => setTab(id)}>
          <Icon size={18} aria-hidden="true" />
          <span><b>{label}</b><small>{hint}</small></span>
        </button>
      ))}
    </nav>
    <div id="library-workspace-content" className="axom-workspace-content" aria-label={tab === "sources" ? "Saved resources" : "Hub Folders"}>
      {tab === "sources" ? <ResourcesPage /> : <HubFoldersPage />}
    </div>
  </section>;
}
