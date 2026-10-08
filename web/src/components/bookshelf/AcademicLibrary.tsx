// The frame round a bookshelf: Browse, Recover, Import, Create. Each means
// one thing. Browse shows what is already in AXOM. Recover looks for work
// AXOM saved earlier. Import adds a file the learner picks. Create starts a
// new one. A tab is shown only when the screen that hosts the library can
// really do it, so nothing here pretends.
import { useId, useState, type ReactNode } from "react";
import { FilePlus2, FolderInput, History, LibraryBig } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton } from "../ui/primitives";

export type LibraryMode = "browse" | "recover" | "import" | "create";

export interface AcademicLibraryProps {
  title: string;
  subtitle?: string;
  /** The shelf itself. */
  browse: ReactNode;
  /** What AXOM found saved on this device or in a backup. Leave out when there is no such search. */
  recover?: ReactNode;
  /** Opens the file picker. The browser only ever sees a file the learner chooses. */
  onChooseFile?: () => void;
  importHint?: string;
  /** Starts a new template or bank, where that exists. */
  onCreate?: () => void;
  createHint?: string;
}

const MODES: { id: LibraryMode; label: string; icon: typeof LibraryBig }[] = [
  { id: "browse", label: "Browse", icon: LibraryBig },
  { id: "recover", label: "Recover", icon: History },
  { id: "import", label: "Import", icon: FolderInput },
  { id: "create", label: "Create", icon: FilePlus2 },
];

export function AcademicLibrary({ title, subtitle, browse, recover, onChooseFile, importHint, onCreate, createHint }: AcademicLibraryProps) {
  const [mode, setMode] = useState<LibraryMode>("browse");
  const id = useId();
  const offered = MODES.filter((entry) => entry.id === "browse" || (entry.id === "recover" && recover !== undefined) || (entry.id === "import" && onChooseFile) || (entry.id === "create" && onCreate));
  return (
    <div className="academic-library">
      <div className="academic-library-head">
        <div>
          <h2 className="academic-library-title">{title}</h2>
          {subtitle && <p className="academic-library-sub">{subtitle}</p>}
        </div>
        {offered.length > 1 && (
          <div className="academic-library-tabs" role="tablist" aria-label={`${title}: what to do`}>
            {offered.map(({ id: entry, label, icon: Icon }) => (
              <button
                key={entry} type="button" role="tab" id={`${id}-${entry}-tab`} className="academic-library-tab"
                aria-selected={mode === entry} aria-controls={`${id}-${entry}`} tabIndex={mode === entry ? 0 : -1}
                onClick={() => setMode(entry)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  const at = offered.findIndex((item) => item.id === mode);
                  const next = offered[(at + (event.key === "ArrowRight" ? 1 : offered.length - 1)) % offered.length];
                  setMode(next.id);
                  document.getElementById(`${id}-${next.id}-tab`)?.focus();
                }}
              >
                <Icon size={ICON_SIZE.body} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="academic-library-panel" role="tabpanel" id={`${id}-${mode}`} aria-labelledby={offered.length > 1 ? `${id}-${mode}-tab` : undefined}>
        {mode === "browse" && browse}
        {mode === "recover" && recover}
        {mode === "import" && (
          <div className="academic-library-plain">
            <h3>Add a file</h3>
            <p>{importHint ?? "Choose a file from this device. AXOM reads only the file you pick, shows you what it found, and saves nothing until you confirm."}</p>
            <div><GButton variant="primary" onClick={onChooseFile}><FolderInput size={ICON_SIZE.emphasis} aria-hidden="true" /> Choose a file</GButton></div>
          </div>
        )}
        {mode === "create" && (
          <div className="academic-library-plain">
            <h3>Start a new one</h3>
            <p>{createHint ?? "Start an empty one and fill it in yourself."}</p>
            <div><GButton variant="primary" onClick={onCreate}><FilePlus2 size={ICON_SIZE.emphasis} aria-hidden="true" /> Create</GButton></div>
          </div>
        )}
      </div>
    </div>
  );
}
