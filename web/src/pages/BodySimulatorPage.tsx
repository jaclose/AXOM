import { useState } from "react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { GButton, Tag } from "../components/ui/primitives";
import { ICON_SIZE } from "../lib/iconSize";
import {
  BODY_REGIONS,
  REGION_OBSERVATIONS,
  SIMULATION_STAGES,
  sourcesFor,
  type BodyRegion,
  type SimulationStage,
} from "../lib/simulator/asthmaScenario";
import "../styles/body-simulator.css";

function BodyMap({
  stage,
  region,
  onSelectRegion,
}: {
  stage: SimulationStage;
  region: BodyRegion;
  onSelectRegion: (region: BodyRegion) => void;
}) {
  return (
    <figure className="body-sim__map-panel">
      <div className="body-sim__map-head">
        <span>Figure 01 / Regional view</span>
        <span>Front</span>
      </div>
      <div className="body-sim__body-map" data-stage={stage}>
        <svg viewBox="0 0 320 530" aria-hidden="true" focusable="false">
          <path className="body-sim__grid-line" d="M160 15V517M39 264H281" />
          <circle className="body-sim__grid-ring" cx="160" cy="195" r="139" />
          <circle className="body-sim__silhouette" cx="160" cy="55" r="28" />
          <path className="body-sim__neck" d="M145 79V98M175 79V98" />
          <path className="body-sim__silhouette" d="M139 91 Q160 100 181 91 L205 103 Q224 112 229 140 L249 250 Q254 270 245 275 Q233 279 228 266 L202 185 L201 266 L184 313 L184 477 Q184 496 175 498 L167 498 Q160 496 160 483 L154 333 L148 483 Q147 497 139 498 L132 498 Q123 496 124 477 L124 313 L107 266 L108 185 L82 266 Q77 279 65 275 Q56 270 61 250 L81 140 Q86 112 115 103Z" />
          <path className="body-sim__anatomy-line" d="M160 96V133 M160 129 Q142 130 135 142 M160 129 Q178 130 185 142" />
          <path className="body-sim__lung" d="M150 138 Q134 131 122 145 Q109 162 113 204 Q117 228 136 229 Q151 226 152 210Z" />
          <path className="body-sim__lung" d="M170 138 Q186 131 198 145 Q211 162 207 204 Q203 228 184 229 Q169 226 168 210Z" />
          <path className="body-sim__heart" d="M160 183 C150 169 137 180 143 193 C147 202 157 210 160 213 C163 210 173 202 177 193 C183 180 170 169 160 183Z" />
          <circle className="body-sim__hand-ring" cx="72" cy="268" r="15" />
          <circle className="body-sim__hand-ring" cx="240" cy="268" r="15" />
          <path className="body-sim__measure" d="M40 104h31M40 104v31M280 104h-31M280 104v31M40 468h31M40 468v-31M280 468h-31M280 468v-31" />
        </svg>
        <button
          type="button"
          className={`body-sim__pin body-sim__pin--airways${region === "airways" ? " is-selected" : ""}`}
          aria-label="Inspect airways"
          aria-pressed={region === "airways"}
          onClick={() => onSelectRegion("airways")}
        >
          <span>01</span>
        </button>
        <button
          type="button"
          className={`body-sim__pin body-sim__pin--heart${region === "heart" ? " is-selected" : ""}`}
          aria-label="Inspect heart"
          aria-pressed={region === "heart"}
          onClick={() => onSelectRegion("heart")}
        >
          <span>02</span>
        </button>
        <button
          type="button"
          className={`body-sim__pin body-sim__pin--hands${region === "hands" ? " is-selected" : ""}`}
          aria-label="Inspect hands"
          aria-pressed={region === "hands"}
          onClick={() => onSelectRegion("hands")}
        >
          <span>03</span>
        </button>
      </div>
      <figcaption>Stylized map. This first study models one airway scenario and two possible drug effects, not whole-body physiology.</figcaption>
    </figure>
  );
}

function AirwayDiagram({ stage }: { stage: SimulationStage }) {
  return (
    <div className="body-sim__airway-figure" data-stage={stage}>
      <div className="body-sim__airway-heading">
        <span>Detail / Airway cross-section</span>
        <span>Qualitative</span>
      </div>
      <svg viewBox="0 0 240 192" aria-hidden="true" focusable="false">
        <circle className="body-sim__airway-outer" cx="120" cy="98" r="77" />
        <circle className="body-sim__airway-muscle" cx="120" cy="98" r="58" />
        <circle className="body-sim__airway-lining" cx="120" cy="98" r="44" />
        <circle className="body-sim__airway-lumen" cx="120" cy="98" r="34" />
        <path className="body-sim__airway-axis" d="M120 12V184M32 98H208" />
      </svg>
      <div className="body-sim__airway-legend">
        <span><i className="body-sim__legend-muscle" /> Airway muscle</span>
        <span><i className="body-sim__legend-lining" /> Lining</span>
        <span><i className="body-sim__legend-lumen" /> Air passage</span>
      </div>
      <p>The passage changes size to show the idea, not a measured diameter or treatment outcome.</p>
    </div>
  );
}

export function BodySimulatorPage() {
  const [stage, setStage] = useState<SimulationStage>("asthma");
  const [region, setRegion] = useState<BodyRegion>("airways");
  const observation = REGION_OBSERVATIONS[stage][region];
  const evidence = sourcesFor(observation);
  const stageLabel = SIMULATION_STAGES.find((option) => option.id === stage)?.label ?? stage;
  const regionLabel = BODY_REGIONS.find((option) => option.id === region)?.label ?? region;

  function reset() {
    setStage("asthma");
    setRegion("airways");
  }

  return (
    <main className="body-sim" data-stage={stage}>
      <header className="body-sim__hero">
        <div className="body-sim__eyebrow">
          <span>AXOM / SIMULATIONS / 001</span>
          <Tag tone="gold">Study preview</Tag>
        </div>
        <h1>See the mechanism.</h1>
        <p>Move between asthma and inhaled albuterol. Select a body region to trace what the evidence shows and where this model stops.</p>
      </header>

      <section className="body-sim__stage-section" aria-labelledby="body-sim-stage-title">
        <div className="body-sim__stage-heading">
          <div>
            <span className="body-sim__section-index">01 / Choose a state</span>
            <h2 id="body-sim-stage-title">Asthma · inhaled albuterol</h2>
          </div>
          <GButton size="sm" onClick={reset} aria-label="Reset simulator to asthma airways">
            <RotateCcw size={ICON_SIZE.body} aria-hidden="true" /> Reset
          </GButton>
        </div>
        <div className="body-sim__stage-options" role="group" aria-label="Scenario state">
          {SIMULATION_STAGES.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className={`body-sim__stage-option${stage === option.id ? " is-active" : ""}`}
              aria-labelledby={`body-sim-option-label-${option.id}`}
              aria-describedby={`body-sim-option-cue-${option.id}`}
              aria-pressed={stage === option.id}
              onClick={() => setStage(option.id)}
            >
              <span className="body-sim__stage-number">0{index + 1}</span>
              <span className="body-sim__stage-label" id={`body-sim-option-label-${option.id}`}>{option.label}</span>
              <span className="body-sim__stage-cue" id={`body-sim-option-cue-${option.id}`}>{option.cue}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="body-sim__workbench" aria-label="Interactive body map">
        <BodyMap stage={stage} region={region} onSelectRegion={setRegion} />
        <div className="body-sim__reading-column">
          <AirwayDiagram stage={stage} />
          <div className="body-sim__region-group" role="group" aria-label="Body region">
            {BODY_REGIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`body-sim__region-option${region === option.id ? " is-active" : ""}`}
                aria-pressed={region === option.id}
                onClick={() => setRegion(option.id)}
              >
                <span>{option.number}</span>
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
          <p className="sr-only" role="status">Viewing {stageLabel}, {regionLabel}: {observation.heading}</p>
          <article className="body-sim__observation">
            <div className="body-sim__observation-meta">
              <span>{observation.label}</span>
              <span>{region.toUpperCase()}</span>
            </div>
            <h3>{observation.heading}</h3>
            <p>{observation.explanation}</p>
            <div className="body-sim__boundary">{observation.boundary}</div>
            {evidence.length > 0 && (
              <div className="body-sim__sources">
                <span>Sources</span>
                <ul>
                  {evidence.map((source) => (
                    <li key={source.id}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        {source.label} <ArrowUpRight size={ICON_SIZE.microInline} aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        </div>
      </section>

      <footer className="body-sim__footer">
        <span>Model boundary / 01</span>
        <p>For studying mechanisms, not diagnosis or treatment. No doses, response times, risk estimates, or patient data are modeled.</p>
      </footer>
    </main>
  );
}
