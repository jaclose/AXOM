import { useState } from "react";
import { ArrowUpRight, BookOpenCheck, LibraryBig, Workflow } from "lucide-react";
import { useStore } from "../lib/store";
import { STUDY_METHODS } from "../lib/studyMethods";
import { StudyMethodsPage } from "./StudyMethodsPage";
import { PromptLibraryPage } from "./PromptLibraryPage";
import "../styles/workspace-hubs.css";

export type StudyStudioTab = "methods" | "prompts";

const STUDY_VIEWS = [
  { id: "methods", label: "Methods", hint: "Choose how to work", icon: BookOpenCheck },
  { id: "prompts", label: "Prompts", hint: "Reuse your instructions", icon: LibraryBig },
] as const;

/** Method selection and AI prompt authoring share one learning workflow. */
export function StudyStudioPage({ initialTab = "methods" }: { initialTab?: StudyStudioTab }) {
  const [tab, setTab] = useState<StudyStudioTab>(initialTab);
  const prompts = useStore((state) => state.prompts);
  return <section className="axom-workspace" aria-labelledby="study-studio-title">
    <header className="axom-workspace-hero">
      <div>
        <span className="axom-workspace-eyebrow">AXOM / LEARNING PRACTICE</span>
        <h1 id="study-studio-title">From method to execution.</h1>
        <p>Choose a suitable technique, begin a session, or keep an instruction you will use again. Recommendations remain rules-based, never fabricated performance predictions.</p>
      </div>
      <span className="axom-workspace-hero-symbol" aria-hidden="true"><Workflow size={42} strokeWidth={1.1} /></span>
    </header>
    <div className="axom-workspace-indicators">
      <div><span>METHODS</span><strong>{STUDY_METHODS.length}</strong><small>Technique guides with trade-offs</small></div>
      <div><span>YOUR PROMPTS</span><strong>{prompts.length}</strong><small>Stored reusable instructions</small></div>
      <div><span>WORKFLOW</span><strong className="axom-workspace-word">Choose → Practice</strong><small>You remain in control</small></div>
      <a className="axom-workspace-evidence" href="#anki">Open Anki Lab <ArrowUpRight size={15} aria-hidden="true" /></a>
    </div>
    <nav className="axom-workspace-nav" aria-label="Study Studio views">
      {STUDY_VIEWS.map(({ id, label, hint, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={tab === id} aria-controls="study-studio-content" onClick={() => setTab(id)}>
          <Icon size={18} aria-hidden="true" />
          <span><b>{label}</b><small>{hint}</small></span>
        </button>
      ))}
    </nav>
    <div id="study-studio-content" className="axom-workspace-content" aria-label={tab === "methods" ? "Study Methods" : "Prompt Library"}>
      {tab === "methods" ? <StudyMethodsPage /> : <PromptLibraryPage />}
    </div>
  </section>;
}
