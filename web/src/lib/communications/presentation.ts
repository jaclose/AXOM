import { paletteDefinition, readPalettePreference } from "../palette";
import { DOCTORDLE_URL } from "../doctordle";
import type { NoctyriumState } from "../types";
import { examContext } from "./context";
import { buildPulse } from "./snapshot";
import { localClock, periodBefore, type EmailType, type Personalization } from "./model";
export function currentPresentation() {
  const palette = readPalettePreference(); const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  return { theme, accent: paletteDefinition(palette.id, palette.customAccent)[theme].accent } as const;
}
export function localEmailContext(state: NoctyriumState, type: EmailType, theme: "dark" | "light" = currentPresentation().theme): Personalization {
  const timezone = state.profile.timeZonePreference?.mode === "custom" ? state.profile.timeZonePreference.customTimezone ?? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = localClock(new Date(), timezone).day; const scope = type === "pulse" ? "year" : type === "monthly_report" ? "month" : "week";
  const { start, end } = type === "pulse" ? { start: `${day.slice(0, 4)}-01-01`, end: day } : periodBefore(day, scope);
  const accent = currentPresentation().accent;
  return { displayName: state.profile.name, accent, theme, locale: "en", timezone, orbUrl: `${location.origin}/icons/axom-orb-512.png`, course: state.courses[0]?.name,
    exam: examContext(state, day),
    snapshot: buildPulse(state, { start, end, scope, timezone, accent }),
    games: state.profile.experimentalFlags?.dailyGames ? [{ name: "DoctorDle", url: DOCTORDLE_URL, detail: "Independent daily diagnosis game. Availability is set by the provider." }, { name: "DailyWord", url: `${location.origin}/#daily-word`, detail: "Your AXOM daily word puzzle." }].filter(g => !(state.profile.hiddenNav ?? []).includes(g.name === "DailyWord" ? "daily-word" : "doctordle")) : [],
  };
}
export function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
