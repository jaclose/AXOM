import { ExternalLink } from "lucide-react";
import { matchAxomDiagram } from "../../lib/diagrams/match";
import type { QuestionRecord } from "../../lib/questions";
import "../../styles/axom-diagrams.css";

export function AxomDiagramCard({ question }: { question: QuestionRecord }) {
  const diagram = matchAxomDiagram(question);
  if (!diagram) return null;

  return (
    <aside className="axom-diagram" aria-label="Related AXOM diagram" data-diagram-id={diagram.id}>
      <div className="axom-diagram-copy">
        <span className="axom-diagram-eyebrow">Related AXOM diagram</span>
        <h3>{diagram.title}</h3>
        <p className="axom-diagram-subtitle">{diagram.subtitle}</p>
        <p>Rhinoviruses are the most frequent cause of the common cold. Symptoms can resemble other respiratory infections.</p>
        <p className="axom-diagram-caveat">Linked to the supplied correct answer and stem clues. This diagram does not verify the question’s answer key.</p>
        <a href={diagram.source.url} target="_blank" rel="noopener noreferrer">
          {diagram.source.title}<ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      <div className="axom-diagram-art" role="img" aria-label="Rhinovirus in the center with common cold symptoms around it: runny nose, sneezing, nasal congestion, cough, and sore throat. These symptoms can resemble other respiratory infections.">
        <svg viewBox="0 0 480 330" aria-hidden="true" focusable="false">
          <circle className="diagram-orbit" cx="240" cy="164" r="115" />
          <circle className="diagram-orbit diagram-orbit-inner" cx="240" cy="164" r="58" />
          <path className="diagram-connector" d="M 182 164 H 112 M 299 164 H 369 M 240 106 V 68 M 202 208 L 151 259 M 278 208 L 333 259" />
          <circle className="diagram-core" cx="240" cy="164" r="51" />
          <text className="diagram-core-label" x="240" y="161" textAnchor="middle">RHINO</text>
          <text className="diagram-core-sub" x="240" y="181" textAnchor="middle">VIRUS</text>
          <g className="diagram-node"><circle cx="70" cy="164" r="42" /><text x="70" y="160" textAnchor="middle"><tspan x="70">Runny</tspan><tspan x="70" dy="16">nose</tspan></text></g>
          <g className="diagram-node"><circle cx="410" cy="164" r="42" /><text x="410" y="169" textAnchor="middle">Sneezing</text></g>
          <g className="diagram-node"><circle cx="240" cy="40" r="40" /><text x="240" y="37" textAnchor="middle"><tspan x="240">Nasal</tspan><tspan x="240" dy="16">congestion</tspan></text></g>
          <g className="diagram-node"><circle cx="123" cy="278" r="39" /><text x="123" y="283" textAnchor="middle">Cough</text></g>
          <g className="diagram-node"><circle cx="357" cy="278" r="39" /><text x="357" y="274" textAnchor="middle"><tspan x="357">Sore</tspan><tspan x="357" dy="16">throat</tspan></text></g>
        </svg>
      </div>
    </aside>
  );
}
