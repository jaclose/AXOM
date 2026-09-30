// Course Tracker before its first item (JD, Wave 2): instead of "No items
// here", show what a tracked lecture looks like and the three ways in. SGU
// students already have their terms and modules from setup; everyone else
// starts clean and can load a school template in one click.
import type { CSSProperties } from "react";
import { BookOpen, CalendarRange, Eye, ListPlus, type LucideIcon } from "lucide-react";
import { CURRICULA } from "../../lib/curricula";
import type { CardSystem } from "../../lib/cardSystem";
import { installCurriculum } from "../../lib/setupPlan";
import { ankiColor, PASS_COLOR } from "../../lib/tracker";
import { ICON_SIZE } from "../../lib/iconSize";
import { pushToast } from "../../lib/toast";
import "../../styles/course-tracker.css";

interface Action { id: "list" | "course" | "schedule"; icon: LucideIcon; title: string; detail: string }

const ACTIONS: Action[] = [
  { id: "list", icon: ListPlus, title: "Paste a lecture list", detail: "From a syllabus, a spreadsheet or your notes" },
  { id: "course", icon: BookOpen, title: "Add a course", detail: "Name it now, add modules as they come" },
  { id: "schedule", icon: CalendarRange, title: "Import a schedule", detail: "A calendar or schedule export" },
];

export function TrackerFirstRun({ hasCourses, cards, onAction }: {
  hasCourses: boolean;
  cards: CardSystem | null;
  onAction: (action: Action["id"]) => void;
}) {
  return (
    <div className="tracker-first-run">
      <div className="tfr-copy">
        <span className="tfr-eyebrow">{hasCourses ? "Your courses are ready" : "A clean slate"}</span>
        <h3>{hasCourses ? "Add the lectures, and progress fills itself in." : "Build it the way your school runs."}</h3>
        <p>
          Bring your lecture list in once. Every pass{cards ? `, ${cards.label} round` : ""} and question set you log
          moves that lecture from untouched to mastered.
        </p>
      </div>

      <SampleRow cards={cards} />

      <div className="tfr-actions">
        {ACTIONS.map(({ id, icon: Icon, title, detail }, index) => (
          <button key={id} type="button" className={`tfr-action ${index === 0 ? "primary" : ""}`} onClick={() => onAction(id)}>
            <span className="tfr-action-icon" aria-hidden="true"><Icon size={ICON_SIZE.emphasis} strokeWidth={1.5} /></span>
            <b>{title}</b>
            <small>{detail}</small>
          </button>
        ))}
      </div>

      {!hasCourses && (
        <p className="tfr-template">
          Following a published curriculum?{" "}
          {CURRICULA.map((template) => (
            <button key={template.id} type="button" onClick={() => {
              installCurriculum(template);
              pushToast({ tone: "success", title: `${template.label} added`, body: "Your terms and modules are in the tree. Add lectures to each module as you go." });
            }}>
              Load {template.label}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

/** A still picture of one tracked lecture: two passes in, one card round. */
function SampleRow({ cards }: { cards: CardSystem | null }) {
  const style = { "--pass-color": PASS_COLOR.young, "--anki-color": ankiColor(1) } as CSSProperties;
  return (
    <div className="tfr-sample" style={style} aria-hidden="true">
      <div className={`mastery-shard ${cards ? "" : "no-cards"}`}>
        <span className="shard-pass"><Eye size={ICON_SIZE.body} /></span>
        {cards && <span className="shard-anki">{cards.label.charAt(0)}</span>}
      </div>
      <span className="tfr-sample-label">
        <b>Cardiac cycle</b>
        <small>Lecture · 2 of 3 passes</small>
      </span>
      <span className="tfr-sample-passes">
        {[1, 2, 3].map((pass) => <i key={pass} className={pass <= 2 ? "on" : ""} />)}
      </span>
    </div>
  );
}
