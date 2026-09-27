import { useState, type CSSProperties } from "react";
import { Tag } from "../ui/primitives";
import { EVIDENCE_LABEL, SOUNDSCAPES, type EvidenceLevel, type SoundscapeId } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";
import { carrierPair } from "../../lib/soundscapes/engine";
import { SoundscapeStage } from "./SoundscapeStage";
import { TransportButtons, VersionChips } from "./SoundscapeControls";
import { PinButton } from "./PinButton";

const EVIDENCE_TONE: Record<EvidenceLevel, "cyan" | "neutral" | "orange" | "green"> = {
  tentative: "cyan",
  low: "neutral",
  "very-low": "orange",
  comfort: "green",
};

/**
 * The two carriers and the beat they make, drawn as an interference
 * envelope that scrolls slowly (display only: the real beat is far faster).
 */
export function BeatWave({ beatHz, tint }: { beatHz: number; tint: string }) {
  const envelopes = beatHz <= 3 ? 1 : beatHz <= 12 ? 2 : beatHz <= 25 ? 3 : 5;
  const carrierCycles = 44;
  const width = 400;
  const points: string[] = [];
  for (let i = 0; i <= 800; i += 1) {
    const x = (i / 800) * width * 2;
    const t = i / 400; // two periods of the pattern, so the scroll loops seamlessly
    const envelope = Math.cos(Math.PI * envelopes * t);
    const y = 24 - 18 * envelope * Math.sin(2 * Math.PI * carrierCycles * t);
    points.push(`${x.toFixed(1)},${y.toFixed(2)}`);
  }
  return (
    <svg className="beat-wave" viewBox={`0 0 ${width} 48`} preserveAspectRatio="none" aria-hidden="true" style={{ "--wave-tint": tint } as CSSProperties}>
      <defs>
        <linearGradient id={`wave-fade-${beatHz}`} x1="0" x2="1">
          <stop offset="0" stopColor={tint} stopOpacity="0" />
          <stop offset="0.15" stopColor={tint} stopOpacity="0.9" />
          <stop offset="0.85" stopColor={tint} stopOpacity="0.9" />
          <stop offset="1" stopColor={tint} stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="beat-wave-track">
        <polyline points={points.join(" ")} fill="none" stroke={`url(#wave-fade-${beatHz})`} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

/** A brainwave frequency, told as a card: scene, ring, what it's linked to, and how to use it. */
export function FrequencyCard({ id }: { id: SoundscapeId }) {
  const preset = SOUNDSCAPES[id];
  const status = useSoundscape((state) => state.status);
  const presetId = useSoundscape((state) => state.presetId);
  const output = useSoundscape((state) => state.output);
  const [hover, setHover] = useState(false);
  const live = status !== "idle" && presetId === id;
  const significance = preset.significance!;
  const pair = carrierPair(preset, output);
  return (
    <article
      className={`frequency-card ${live ? "live" : ""}`}
      style={{ "--tint": significance.tint } as CSSProperties}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`${preset.name} — ${significance.state}`}
    >
      <div className="frequency-stage">
        <SoundscapeStage preset={preset} animate={live || hover} reactive={live} />
        <div className="frequency-badge">
          <span className="frequency-symbol" aria-hidden="true">{significance.symbol}</span>
          <span>
            <b>{preset.band}</b>
            <small>{significance.range}</small>
          </span>
        </div>
        <div className="frequency-play"><PinButton presetId={id} /><TransportButtons presetId={id} /></div>
      </div>
      <div className="frequency-body">
        <span className="frequency-state">{significance.state} · {preset.beatHz} Hz beat</span>
        <h3>{significance.headline}</h3>
        <BeatWave beatHz={preset.beatHz ?? 10} tint={significance.tint} />
        {pair && <small className="frequency-pair">{output === "headphones" ? `Left ${pair[0]} Hz · right ${pair[1]} Hz` : `${pair[0]} + ${pair[1]} Hz, blended for speakers`}</small>}
        <p>{significance.body}</p>
        <div className="frequency-uses" aria-label="Best for">
          {preset.bestFor.map((use) => <span key={use}>{use}</span>)}
        </div>
        <VersionChips presetId={id} />
        <p className="frequency-howto">{preset.howTo}</p>
        <div className="frequency-evidence">
          <Tag tone={EVIDENCE_TONE[preset.evidence]}>{EVIDENCE_LABEL[preset.evidence]}</Tag>
          <span>{preset.evidenceNote}</span>
        </div>
      </div>
    </article>
  );
}

/** A compact card for ambient sounds (noise, rooms, nature). */
export function AmbientCard({ id }: { id: SoundscapeId }) {
  const preset = SOUNDSCAPES[id];
  const status = useSoundscape((state) => state.status);
  const presetId = useSoundscape((state) => state.presetId);
  const [hover, setHover] = useState(false);
  const live = status !== "idle" && presetId === id;
  return (
    <article className={`ambient-card ${live ? "live" : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-label={preset.name}>
      <div className="ambient-stage">
        <SoundscapeStage preset={preset} animate={live || hover} reactive={live} ring={live} />
        <div className="ambient-head">
          <span><b>{preset.name}</b><small>{preset.band}</small></span>
          <span className="ambient-actions"><PinButton presetId={id} /><TransportButtons presetId={id} /></span>
        </div>
      </div>
      <div className="ambient-body">
        <p>{preset.bestFor.join(" · ")}</p>
        <VersionChips presetId={id} />
        <div className="frequency-evidence">
          <Tag tone={EVIDENCE_TONE[preset.evidence]}>{EVIDENCE_LABEL[preset.evidence]}</Tag>
          <span>{preset.evidenceNote}</span>
        </div>
      </div>
    </article>
  );
}
