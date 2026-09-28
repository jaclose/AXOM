import { Pin, PinOff } from "lucide-react";
import { SOUNDSCAPES, type SoundscapeId } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";

/** Pin a soundscape to the top of the page (and the For you row). */
export function PinButton({ presetId, className = "" }: { presetId: SoundscapeId; className?: string }) {
  const pinned = useSoundscape((state) => state.pinned.includes(presetId));
  const togglePin = useSoundscape((state) => state.togglePin);
  const name = SOUNDSCAPES[presetId].name;
  return (
    <button
      type="button"
      className={`soundscape-pin ${pinned ? "on" : ""} ${className}`}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
      title={pinned ? "Pinned to the top — click to unpin" : "Pin to the top"}
      onClick={(event) => { event.stopPropagation(); togglePin(presetId); }}
    >
      {pinned ? <Pin size={15} fill="currentColor" /> : <Pin size={15} />}
      <PinOff size={15} className="soundscape-pin-off" aria-hidden="true" />
    </button>
  );
}
