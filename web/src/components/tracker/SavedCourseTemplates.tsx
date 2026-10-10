import { useMemo, useState } from "react";
import { Download, BookOpen } from "lucide-react";
import type { SourceDocument } from "../../lib/library";
import { courseTemplateFamily, courseTemplateVersions, savedCourseTemplates } from "../../lib/course-engine/templateLibrary";
import { ICON_SIZE } from "../../lib/iconSize";
import { Field, SelectField } from "../ui/Modal";
import { GButton, GhostButton } from "../ui/primitives";

export function SavedCourseTemplates({ documents, onUse }: {
  documents: readonly SourceDocument[];
  onUse: (document: SourceDocument) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const groups = useMemo(() => courseTemplateVersions(savedCourseTemplates(documents)), [documents]);
  const shown = groups.filter((versions) => versions.some(({ document }) => `${document.title} ${document.fileName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())));
  function download(document: SourceDocument) {
    const url = URL.createObjectURL(new Blob([document.rawText], { type: "text/plain;charset=utf-8" }));
    const link = window.document.createElement("a");
    link.href = url; link.download = document.fileName.endsWith(".txt") ? document.fileName : `${document.fileName}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="saved-course-templates" aria-label="Saved course templates">
    <div><b>Your template library</b><p className="sub">Import once. Keep each version and choose what to load into your tracker.</p></div>
    {!groups.length ? <p className="sub">No templates saved yet. Choose template files below to start your library.</p> : <>
      <Field label="Find a saved template" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Module or filename" />
      {!shown.length && <p role="status">No templates match. Try another module or filename.</p>}
      <div className="saved-template-list">
        {shown.map((versions) => {
          const latest = versions[0];
          const family = courseTemplateFamily(latest.section);
          const selected = versions.find(({ document }) => document.id === chosen[family]) ?? latest;
          return <article key={family} className="saved-template-row">
            <div><b>{selected.document.title}</b><p className="sub">{selected.section.items.length} activities · {versions.length} saved version{versions.length === 1 ? "" : "s"}</p></div>
            {versions.length > 1 && <SelectField label={`Version of ${latest.document.title}`} value={selected.document.id}
              onChange={(event) => setChosen((current) => ({ ...current, [family]: event.target.value }))}>
              {versions.map(({ document }, index) => <option key={document.id} value={document.id}>Version {versions.length - index}{index === 0 ? " · Latest import" : ""} · {document.fileName}</option>)}
            </SelectField>}
            <div className="row wrap gap8">
              <GButton size="sm" onClick={() => onUse(selected.document)} aria-label={`Use saved ${selected.document.title}`}><BookOpen size={ICON_SIZE.body} /> Select template</GButton>
              <GhostButton onClick={() => download(selected.document)} aria-label={`Export ${selected.document.title}`}><Download size={ICON_SIZE.body} /> Export</GhostButton>
            </div>
          </article>;
        })}
      </div>
    </>}
  </section>;
}
