// I3-26 (JD): "autosort the items chronologically so they are not flip
// flopped". Lecture files and sets are numbered ("L2", "L10"), so natural
// order (numbers compared as numbers) is the order a student expects.
export const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortByNaturalTitle<T extends { title: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => naturalCollator.compare(a.title, b.title));
}
