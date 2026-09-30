// Palette orbs (JD, Wave 2): each accent palette as a small lit sphere that
// leans toward the pointer, lifts on hover, and carries an unmistakable ring
// when chosen. A radiogroup with arrow keys; still and flat under reduced
// motion. Choosing applies the palette live, everywhere.
import type { CSSProperties, PointerEvent } from "react";
import { Check } from "lucide-react";
import { PALETTES, setPalettePreference } from "../../lib/palette";
import { usePalettePreference, useResolvedTheme } from "../../lib/useAppearance";
import { onRadioGroupKeyDown } from "../shell/AppearanceStudio";
import { ICON_SIZE } from "../../lib/iconSize";

/** The second colour in each pairing ("Gold & white", "Navy & gold"), shown as the orb's shadow side. */
const PAIR: Record<string, { dark: string; light: string }> = {
  classic: { dark: "#2c2c31", light: "#43331f" },
  ivory: { dark: "#f4f1ea", light: "#ffffff" },
  amethyst: { dark: "#150e22", light: "#2a1d44" },
  sapphire: { dark: "#c9d1db", light: "#dfe5ec" },
  midnight: { dark: "#22335e", light: "#22335a" },
  emerald: { dark: "#0b1712", light: "#0f2a1f" },
  rose: { dark: "#2d2426", light: "#4a3a38" },
  platinum: { dark: "#0f0f12", light: "#1d2025" },
};

function lean(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== "mouse") return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  event.currentTarget.style.setProperty("--px", x.toFixed(3));
  event.currentTarget.style.setProperty("--py", y.toFixed(3));
}

function rest(event: PointerEvent<HTMLButtonElement>) {
  event.currentTarget.style.setProperty("--px", "0");
  event.currentTarget.style.setProperty("--py", "0");
}

export function PaletteOrbs({ label = "Accent palette" }: { label?: string }) {
  const palette = usePalettePreference();
  const resolved = useResolvedTheme();
  return (
    <div className="palette-orbs" role="radiogroup" aria-label={label} onKeyDown={onRadioGroupKeyDown}>
      {PALETTES.map((definition) => {
        const input = resolved === "light" ? definition.light : definition.dark;
        const selected = palette.id === definition.id;
        const style = {
          // Colours are data here: each orb previews a palette that may not be active.
          "--orb-hi": input.hi,
          "--orb-accent": input.accent,
          "--orb-lo": input.lo,
          "--orb-cool": input.cool,
          "--orb-deep": input.bg[0],
          "--orb-pair": PAIR[definition.id]?.[resolved === "light" ? "light" : "dark"] ?? input.cool,
        } as CSSProperties;
        return (
          <button
            key={definition.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`palette-orb-choice ${selected ? "on" : ""}`}
            style={style}
            title={definition.description}
            onPointerMove={lean}
            onPointerLeave={rest}
            onClick={() => setPalettePreference({ id: definition.id, customAccent: palette.customAccent })}
          >
            <span className="palette-orb" aria-hidden="true">
              <span className="palette-orb-shine" />
              {selected && <span className="palette-orb-check"><Check size={ICON_SIZE.microInline} strokeWidth={2.5} /></span>}
            </span>
            <span className="palette-orb-label"><b>{definition.label}</b><small>{definition.pairing}</small></span>
          </button>
        );
      })}
    </div>
  );
}
