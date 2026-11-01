import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowRight, Check, Monitor, Moon, Palette, Pipette, Sparkles, Sun, Wind } from "lucide-react";
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
import { TimerCueSettings } from "./TimerCueSettings";

const MODES: Array<{ value: ThemePreference; label: string; detail: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", detail: "Warm paper", icon: Sun },
  { value: "dark", label: "Dark", detail: "Deep graphite", icon: Moon },
  { value: "system", label: "System", detail: "Follows your device", icon: Monitor },
];

/** Quick custom-accent starting points; any color can still be picked. */
const CUSTOM_SUGGESTIONS = [
  { hex: "#7c6cf0", label: "Iris" },
  { hex: "#e0566b", label: "Coral" },
  { hex: "#2fb6c9", label: "Lagoon" },
  { hex: "#f08c3a", label: "Copper" },
  { hex: "#58b368", label: "Sage" },
  { hex: "#c86bd8", label: "Orchid" },
];

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

/** Compact palette mark for the top-bar appearance popover. */
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

function paletteOrbStyle(input: PaletteModeInput): CSSProperties {
  return {
    "--orb-hi": input.hi,
    "--orb-accent": input.accent,
    "--orb-lo": input.lo,
    "--orb-deep": input.bg[0],
  } as CSSProperties;
}

/** A miniature workspace, painted from the same palette inputs as the real app. */
function PalettePreview({ input, mode }: { input: PaletteModeInput; mode: "light" | "dark" }) {
  const style = {
    "--preview-page": input.bg[1],
    "--preview-edge": input.bg[2],
    "--preview-surface": input.surface,
    "--preview-accent": input.accent,
    "--preview-ink": input.ink,
    "--preview-hi": input.hi,
    "--preview-lo": input.lo,
    "--preview-cool": input.cool,
    "--preview-text": mode === "light" ? input.structure ?? "#302b24" : "#f3f0e9",
  } as CSSProperties;

  return (
    <span className={`palette-preview ${mode}`} style={style} aria-hidden="true">
      <span className="palette-preview-bar">
        <span className="palette-preview-brand"><img src={`${import.meta.env.BASE_URL}icons/axom-orb-512.png`} alt="" /> AXOM</span>
        <span className="palette-preview-bar-mark"><i /><i /><i /></span>
      </span>
      <span className="palette-preview-workspace">
        <span className="palette-preview-rail"><i className="active" /><i /><i /></span>
        <span className="palette-preview-content">
          <span className="palette-preview-overline">YOUR DAY <i>01 / 03</i></span>
          <span className="palette-preview-title">Make room<br />for focus.</span>
          <span className="palette-preview-bottom">
            <span className="palette-preview-progress-ring"><i>64<span>%</span></i></span>
            <span className="palette-preview-progress-copy"><b>2h 15m</b><small>Today's study</small><span className="palette-preview-meter"><i /></span></span>
          </span>
        </span>
      </span>
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
  const customInput = resolved === "light" ? customDefinition.light : customDefinition.dark;
  const activeDefinition = palette.id === "custom"
    ? customPaletteDefinition(palette.customAccent ?? DEFAULT_CUSTOM_ACCENT)
    : PALETTES.find((definition) => definition.id === palette.id) ?? PALETTES[0];
  const sample = resolved === "light" ? activeDefinition.light : activeDefinition.dark;
  const specimenStyle = {
    "--specimen-accent": sample.ink,
    "--specimen-surface": sample.surface,
    background: `linear-gradient(145deg, ${sample.bg[1]}, ${sample.bg[2]})`,
  } as CSSProperties;

  function applyCustom(hex: string) {
    setCustomDraft(hex);
    if (isHexColor(hex)) setPalettePreference({ id: "custom", customAccent: hex });
  }

  return (
    <div className="appearance-studio">
      <section className="appearance-specimen" aria-label="Live appearance preview">
        <div className="appearance-specimen-copy">
          <span className="appearance-kicker">Live preview</span>
          <h3>Make room for focus.</h3>
          <p>Choose the surface, color, and pace that feel right for your work.</p>
          <span className="appearance-specimen-current">
            <i aria-hidden="true" /> {activeDefinition.label} <span aria-hidden="true">/</span> {resolved === "light" ? "Light" : "Dark"}
          </span>
        </div>
        <div className="appearance-specimen-window" style={specimenStyle} aria-hidden="true">
          <div className="appearance-specimen-toolbar">
            <span className="appearance-specimen-brand"><img src={`${import.meta.env.BASE_URL}icons/axom-orb-512.png`} alt="" /> ΛXOM</span>
            <span>SAMPLE VIEW</span>
          </div>
          <div className="appearance-specimen-page">
            <span className="appearance-specimen-eyebrow">TODAY / STUDY DESK</span>
            <strong>Find your next<br />clear step.</strong>
            <span className="appearance-specimen-rule" />
            <span className="appearance-specimen-action">Continue studying <ArrowRight size={ICON_SIZE.body} /></span>
          </div>
        </div>
      </section>

      <section className="appearance-block appearance-mode-block" aria-labelledby={`${groupId}-mode`}>
        <header>
          <h4 id={`${groupId}-mode`}><Sun size={ICON_SIZE.body} aria-hidden="true" /> Mode</h4>
          <p>Set the canvas for your workspace.</p>
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
                <span className="appearance-choice-top"><Icon size={ICON_SIZE.emphasis} aria-hidden="true" /><Check size={ICON_SIZE.body} className="appearance-choice-check" aria-hidden="true" /></span>
                <span className={`appearance-mode-sample ${option.value}`} aria-hidden="true"><i /><i /><i /></span>
                <span className="appearance-choice-copy"><b>{option.label}</b><small>{option.detail}</small></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="appearance-block appearance-palette-block" aria-labelledby={`${groupId}-palette`}>
        <header>
          <h4 id={`${groupId}-palette`}><Palette size={ICON_SIZE.body} aria-hidden="true" /> Accent palette</h4>
          <p>Color shapes buttons, highlights, and the room around your work. Every palette adapts to light and dark.</p>
        </header>
        <div className="palette-grid" role="radiogroup" aria-labelledby={`${groupId}-palette`} onKeyDown={onRadioGroupKeyDown}>
          {PALETTES.map((definition) => {
            const selected = palette.id === definition.id;
            const input = resolved === "light" ? definition.light : definition.dark;
            return (
              <button
                key={definition.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className={`palette-card ${selected ? "on" : ""}`}
                title={definition.description}
                onClick={() => setPalettePreference({ id: definition.id, customAccent: palette.customAccent })}
              >
                <PalettePreview input={input} mode={resolved} />
                <span className="palette-card-copy">
                  <span className="palette-card-orb" aria-hidden="true" style={paletteOrbStyle(input)} />
                  <span><b>{definition.label}</b><small>{definition.pairing}</small></span>
                </span>
                <Check className="palette-card-check" size={ICON_SIZE.body} aria-hidden="true" />
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
            <PalettePreview input={customInput} mode={resolved} />
            <span className="palette-card-copy">
              <span className="palette-card-orb" aria-hidden="true" style={paletteOrbStyle(customInput)} />
              <span><b>Custom</b><small>Your own color</small></span>
            </span>
            <Check className="palette-card-check" size={ICON_SIZE.body} aria-hidden="true" />
          </button>
        </div>

        <div className={`palette-custom ${palette.id === "custom" ? "active" : ""}`}>
          <div className="palette-custom-heading">
            <span><b>Mix your own</b><small>Start with a color, then AXOM tunes it for both modes.</small></span>
            <span className="palette-custom-status">{palette.id === "custom" ? "In use" : "Optional"}</span>
          </div>
          <div className="palette-custom-controls">
            <label className="palette-custom-picker">
              <Pipette size={ICON_SIZE.body} aria-hidden="true" />
              <span>Pick a color</span>
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
              aria-describedby={!isHexColor(customDraft) ? `${groupId}-custom-error` : undefined}
              onChange={(event) => {
                const value = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
                setCustomDraft(value);
                if (isHexColor(value)) setPalettePreference({ id: "custom", customAccent: value });
              }}
            />
            <div className="palette-custom-suggestions" aria-label="Suggested custom colors">
              {CUSTOM_SUGGESTIONS.map(({ hex, label }) => (
                <button
                  key={hex}
                  type="button"
                  title={`${label} · ${hex}`}
                  aria-label={`Use ${label} (${hex})`}
                  className={palette.id === "custom" && customDraft.toLowerCase() === hex ? "on" : ""}
                  style={{ background: hex }}
                  onClick={() => applyCustom(hex)}
                />
              ))}
            </div>
          </div>
          {!isHexColor(customDraft) && <p id={`${groupId}-custom-error`} className="palette-custom-validation" role="status">Enter a six-digit color, for example #7c6cf0.</p>}
          <p className="palette-custom-note">
            <Sparkles size={ICON_SIZE.microInline} aria-hidden="true" /> Brightness adjusts so text stays readable in both modes.
          </p>
        </div>
      </section>

      <section className="appearance-block appearance-motion-block" aria-labelledby={`${groupId}-motion`}>
        <header>
          <h4 id={`${groupId}-motion`}><Wind size={ICON_SIZE.body} aria-hidden="true" /> Motion</h4>
          <p>Set how quietly the interface moves.</p>
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
              <span className="appearance-motion-mark" aria-hidden="true"><i /><i /><i /></span>
              <span className="appearance-choice-copy"><b>{option.label}</b><small>{option.detail}</small></span>
              <Check size={ICON_SIZE.body} className="appearance-choice-check" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <CinematicSettings />
      <TimerCueSettings />
      <p className="appearance-footnote">Appearance is saved on this device only, so each device can look the way you like.</p>
    </div>
  );
}
