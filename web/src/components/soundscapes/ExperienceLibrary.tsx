import { useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Compass } from "lucide-react";
import { EXPERIENCES, EXPERIENCE_REFERENCES, experienceById, nextExperience } from "../../lib/soundscapes/experiences";
import { useFocusSpace } from "../../lib/soundscapes/focusSpaces";
import "../../styles/experiences.css";

export function ExperienceLibrary() {
  const selected = useFocusSpace((state) => state.selected);
  const [previewId, setPreviewId] = useState(() => experienceById(selected)?.id ?? EXPERIENCES[0].id);
  const preview = EXPERIENCES.find((site) => site.id === previewId) ?? EXPERIENCES[0];
  const index = EXPERIENCES.indexOf(preview);
  const step = (direction: number) => setPreviewId(nextExperience(`site:${preview.id}`, direction).id);
  return <section className="experience-library" aria-labelledby="experience-library-title">
    <div className="experience-intro"><span className="soundscape-kicker"><Compass size={14} aria-hidden="true" /> A small detour</span><h2 id="experience-library-title">Room to wander.</h2><p>Twenty little worlds to explore, make something, or watch an idea unfold. Your timer stays close.</p></div>
    <div className="experience-feature">
      <button type="button" className={`experience-poster experience-poster--${preview.category.toLowerCase()}`} onClick={() => useFocusSpace.getState().select(`site:${preview.id}`, true)} aria-label={`Preview ${preview.title}`}>
        <svg viewBox="0 0 600 280" fill="none" aria-hidden="true"><g>{[0,1,2,3,4,5,6,7].map((line) => <ellipse key={line} cx={300} cy={140} rx={68 + line * 23} ry={24 + line * 12} transform={`rotate(${line * 11 + index * 9} 300 140)`} />)}</g><circle cx="300" cy="140" r="6" /></svg>
        <span className="experience-poster-index">{String(index + 1).padStart(2, "0")} / {EXPERIENCES.length}</span><span className="experience-poster-category">{preview.category}</span><span className="experience-poster-action">Step inside <ArrowUpRight size={18} /></span>
      </button>
      <div className="experience-feature-copy">
        <label className="experience-chooser">Choose an experience<select className="field" value={preview.id} onChange={(event) => setPreviewId(event.target.value)}>{EXPERIENCES.map((site) => <option key={site.id} value={site.id}>{site.title}</option>)}</select></label>
        <h3>{preview.title}</h3><p>{preview.description}</p><small>By {preview.author} · Free to explore</small>
        <div className="experience-launch"><button type="button" className="gbtn primary" onClick={() => useFocusSpace.getState().select(`site:${preview.id}`, true)}>Open experience <ArrowRight size={16} /></button><div><button type="button" className="experience-icon-button" aria-label="Previous experience preview" onClick={() => step(-1)}><ChevronLeft size={18} /></button><button type="button" className="experience-icon-button" aria-label="Next experience preview" onClick={() => step(1)}><ChevronRight size={18} /></button></div></div>
      </div>
    </div>
    <details className="experience-about"><summary>About this collection</summary><p>These free, open-source projects run on their creators’ websites. Only the experience you open loads. The site receives a normal visit; AXOM does not send your study data. Availability and site storage depend on your browser. Closing or changing an experience ends its current view.</p><p>AXOM’s transitions respect reduced motion. External animation is controlled by each site; use Stop experience at any time. Sound starts only through a site’s own controls. Credit and source links stay with every experience.</p></details>
    <div className="experience-bookmarks"><span>From your bookmarks</span>{EXPERIENCE_REFERENCES.map((site) => <a key={site.title} href={site.url} title={site.note} target="_blank" rel="noopener noreferrer">{site.title}<ArrowUpRight size={14} /><small>opens website</small></a>)}<p>These two stay external while in-app embedding permission is unresolved. Desktop wallpaper apps can be used here through your own video files below.</p></div>
  </section>;
}
