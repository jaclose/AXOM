import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { SOUNDSCAPES, type SoundscapeId } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";
import { forYouOrder } from "../../lib/soundscapes/taste";
import { SoundscapeStage } from "./SoundscapeStage";
import { TransportButtons } from "./SoundscapeControls";
import { PinButton } from "./PinButton";
import { ICON_SIZE } from "../../lib/iconSize";

function ForYouCard({ id }: { id: SoundscapeId }) {
  const preset = SOUNDSCAPES[id];
  const status = useSoundscape((state) => state.status);
  const presetId = useSoundscape((state) => state.presetId);
  const previewing = useSoundscape((state) => state.previewing);
  const [hover, setHover] = useState(false);
  const live = status !== "idle" && presetId === id && !previewing;
  return (
    <article className={`foryou-card ${live ? "live" : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-label={preset.name}>
      <SoundscapeStage preset={preset} animate={live || hover} reactive={live} ring={live} />
      <div className="foryou-copy">
        <span>
          <b>{preset.name}</b>
          <small>{preset.significance?.state ?? preset.band}</small>
        </span>
        <TransportButtons presetId={id} />
      </div>
      <PinButton presetId={id} className="foryou-pin-toggle" />
    </article>
  );
}

/** Pinned soundscapes first, then what you said you're into. */
export function ForYouRow({ onPersonalize }: { onPersonalize: () => void }) {
  const taste = useSoundscape((state) => state.taste);
  const pinned = useSoundscape((state) => state.pinned);
  const order = forYouOrder(taste, pinned);
  if (!order.length) {
    return (
      <div className="foryou-empty">
        <span>Pin sounds you love, or tell AXOM what you're into, and they'll live up here.</span>
        <button type="button" className="gbtn sm" onClick={onPersonalize}><SlidersHorizontal size={ICON_SIZE.body} /> Personalize</button>
      </div>
    );
  }
  return (
    <section className="foryou" aria-labelledby="foryou-title">
      <div className="foryou-head">
        <h2 id="foryou-title">For you</h2>
        <button type="button" className="gbtn sm" onClick={onPersonalize}><SlidersHorizontal size={ICON_SIZE.body} /> Personalize</button>
      </div>
      <div className="foryou-strip">
        {order.map((id) => <ForYouCard key={id} id={id} />)}
      </div>
    </section>
  );
}
