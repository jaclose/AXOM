import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Check, Monitor, Moon, Palette, Pipette, Sparkles, Sun, Wind } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { setThemePreference, type ThemePreference } from "../../lib/theme";
import { useThemePreference } from "../../lib/useThemePreference";
import {
  DEFAULT_CUSTOM_ACCENT,
  PALETTES,
  customPaletteDefinition,
  isHexColor,
  setPalettePreference,
  type PaletteDefinition,
  type PaletteModeInput,
} from "../../lib/palette";
import { setMotionPreference } from "../../lib/motionPreference";
import { useMotionPreference, usePalettePreference, useResolvedTheme } from "../../lib/useAppearance";
import { CinematicSettings } from "./CinematicSettings";

const MODES: Array<{ value: ThemePreference; label: string; detail: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", detail: "Paper", icon: Sun },
  { value: "dark", label: "Dark", detail: "Graphite", icon: Moon },
  { value: "system", label: "System", detail: "Match device", icon: Monitor },
];

/** Quick custom-accent starting points; any color can still be picked. */
const CUSTOM_SUGGESTIONS = ["#7c6cf0", "#e0566b", "#2fb6c9", "#f08c3a", "#58b368", "#c86bd8"];

/** Arrow-key roving for button-based radio groups (WAI-ARIA radio pattern). */
export function onRadioGroupKeyDown(event: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  if (!radios.length) return;
  const current = radios.indexOf(document.activeElement as HTMLButtonElement);
  let next = current < 0 ? 0 : current;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (next + 1) % radios.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (next - 1 + radios.length) % radios.length;
  else if (event.key === "Home") next = 0;
  else next = radios.length - 1;
  event.preventDefault();
  radios[next].focus();
  radios[next].click();
}

/** A tiny rendered sample of the palette in the currently painted mode. */
export function PaletteSwatch({ input, size = "md" }: { input: PaletteModeInput; size?: "sm" | "md" }) {
  return (
    <span
      className={`palette-swatch ${size}`}
      aria-hidden="true"
      style={{
        // Swatch colors are data, not theme tokens — they preview a palette
        // that is not necessarily the active one.
        background: `linear-gradient(145deg, ${input.bg[1]}, ${input.bg[2]})`,
      }}
    >
      <i style={{ background: `linear-gradient(135deg, ${input.hi}, ${input.accent})` }} />
      <i style={{ background: input.cool }} />
      <i style={{ background: input.ink }} />
    </span>
  );
}

export function AppearanceStudio() {
  const groupId = useId();
  const mode = useThemePreference();
  const resolved = useResolvedTheme();
  const palette = usePalettePreference();
  const motion = useMotionPreference();
  const [customDraft, setCustomDraft] = useState(palette.customAccent ?? DEFAULT_CUSTOM_ACCENT);

  useEffect(() => {
    if (palette.customAccent) setCustomDraft(palette.customAccent);
  }, [palette.customAccent]);

  const customDefinition: PaletteDefinition = customPaletteDefinition(isHexColor(customDraft) ? customDraft : DEFAULT_CUSTOM_ACCENT);

  function applyCustom(hex: string) {
    setCustomDraft(hex);
    if (isHexColor(hex)) setPalettePreference({ id: "custom", customAccent: hex });
  }

  return (
    <div className="appearance-studio">
      <section className="appearance-block" aria-labelledby={`${groupId}-mode`}>
        <header>
          <h4 id={`${groupId}-mode`}><Sun size={ICON_SIZE.body} aria-hidden="true" /> Mode</h4>
          <p>Paper or graphite. System follows your device automatically.</p>
        </header>
        <div className="appearance-segment" role="radiogroup" aria-labelledby={`${groupId}-mode`} onKeyDown={onRadioGroupKeyDown}>
          {MODES.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className={selected ? "on" : ""}
                onClick={() => setThemePreference(option.value)}
              >
                <Icon size={ICON_SIZE.body} aria-hidden="true" />
                <span><b>{option.label}</b><small>{option.detail}</small></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="appearance-block" aria-labelledby={`${groupId}-palette`}>
        <header>
          <h4 id={`${groupId}-palette`}><Palette size={ICON_SIZE.body} aria-hidden="true" /> Accent palette</h4>
          <p>Changes the accent, secondary tone, and ambient tint everywhere. Every palette has a tuned light and dark version.</p>
        </header>
        <div className="palette-grid" role="radiogroup" aria-labelledby={`${groupId}-palette`} onKeyDown={onRadioGroupKeyDown}>
          {PALETTES.map((definition) => {
            const selected = palette.id === definition.id;
            return (
              <button
                key={definition.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className={`palette-card ${selected ? "on" : ""}`}
                onClick={() => setPalettePreference({ id: definition.id, customAccent: palette.customAccent })}
              >
                <PaletteSwatch input={resolved === "light" ? definition.light : definition.dark} />
                <span className="palette-card-copy">
                  <b>{definition.label}</b>
                  <small>{definition.pairing}</small>
                </span>
                {selected && <Check className="palette-card-check" size={ICON_SIZE.body} aria-hidden="true" />}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={palette.id === "custom"}
            tabIndex={palette.id === "custom" ? 0 : -1}
            className={`palette-card custom ${palette.id === "custom" ? "on" : ""}`}
            onClick={() => applyCustom(isHexColor(customDraft) ? customDraft : DEFAULT_CUSTOM_ACCENT)}
          >
            <PaletteSwatch input={resolved === "light" ? customDefinition.light : customDefinition.dark} />
            <span className="palette-card-copy">
              <b>Custom</b>
              <small>Your own color</small>
            </span>
            {palette.id === "custom" && <Check className="palette-card-check" size={ICON_SIZE.body} aria-hidden="true" />}
          </button>
        </div>

        <div className={`palette-custom ${palette.id === "custom" ? "active" : ""}`}>
          <label className="palette-custom-picker">
            <Pipette size={ICON_SIZE.body} aria-hidden="true" />
            <span>Pick any accent</span>
            <input
              type="color"
              value={isHexColor(customDraft) ? customDraft : DEFAULT_CUSTOM_ACCENT}
              aria-label="Custom accent color"
              onChange={(event) => applyCustom(event.target.value)}
            />
          </label>
          <input
            className="field palette-custom-hex"
            value={customDraft}
            maxLength={7}
            spellCheck={false}
            aria-label="Custom accent hex code"
            aria-invalid={!isHexColor(customDraft)}
            onChange={(event) => {
              const value = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
              setCustomDraft(value);
              if (isHexColor(value)) setPalettePreference({ id: "custom", customAccent: value });
            }}
          />
          <div className="palette-custom-suggestions" aria-label="Suggested custom colors">
            {CUSTOM_SUGGESTIONS.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={`Use ${hex}`}
                className={customDraft.toLowerCase() === hex ? "on" : ""}
                style={{ background: hex }}
                onClick={() => applyCustom(hex)}
              />
            ))}
          </div>
          <p className="palette-custom-note">
            <Sparkles size={ICON_SIZE.microInline} aria-hidden="true" /> AXOM keeps your hue but adjusts brightness so text stays readable in both modes.
          </p>
        </div>
      </section>

      <section className="appearance-block" aria-labelledby={`${groupId}-motion`}>
        <header>
          <h4 id={`${groupId}-motion`}><Wind size={ICON_SIZE.body} aria-hidden="true" /> Motion</h4>
          <p>Reduce motion calms card lusters, drifting light, and transitions — even if your device allows motion.</p>
        </header>
        <div className="appearance-segment two" role="radiogroup" aria-labelledby={`${groupId}-motion`} onKeyDown={onRadioGroupKeyDown}>
          {([
            { value: "system", label: "Match device", detail: "Follow OS setting" },
            { value: "reduce", label: "Reduce motion", detail: "Calm everywhere" },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={motion === option.value}
              tabIndex={motion === option.value ? 0 : -1}
              className={motion === option.value ? "on" : ""}
              onClick={() => setMotionPreference(option.value)}
            >
              <span><b>{option.label}</b><small>{option.detail}</small></span>
            </button>
          ))}
        </div>
      </section>

      <CinematicSettings />
      <p className="appearance-footnote">Appearance is saved on this device only, so each device can look the way you like.</p>
    </div>
  );
}
