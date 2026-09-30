import catalog from "../../data/experiences/catalog.json";

export const EXPERIENCES = catalog;
export type Experience = typeof catalog[number];
export const EXPERIENCE_CATEGORIES = ["All", "Flow", "Worlds", "Make", "Play", "Discover"] as const;
export const EXPERIENCE_SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock";
export const EXPERIENCE_ALLOW = "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; fullscreen 'none'; autoplay 'none'";

export function experienceById(id: string): Experience | undefined {
  return EXPERIENCES.find((experience) => `site:${experience.id}` === id);
}

/** No arbitrary URLs, HTML embeds or redirects are accepted from workspace data. */
export function experienceUrl(id: string): string | undefined {
  return experienceById(id)?.url;
}

export function nextExperience(id: string, direction = 1): Experience {
  const index = EXPERIENCES.findIndex((experience) => `site:${experience.id}` === id);
  return EXPERIENCES[(Math.max(index, 0) + (index < 0 ? 0 : direction) + EXPERIENCES.length) % EXPERIENCES.length];
}

export const EXPERIENCE_REFERENCES = [
  { title: "WindowSwap", url: "https://www.window-swap.com/", note: "Your saved /Window link is retired. The current site opens separately while embedding permission is unresolved." },
  { title: "Zoomquilt", url: "https://zzz.zoomquilt.org/", note: "From your bookmarks. Free to visit; in-app embedding permission is not published." },
] as const;
