/** Preserve the mounted application and open the canonical course plan. */
export function openAcademicCourse(collectionId: string): void {
  const url = new URL(location.href);
  url.searchParams.set("course-library", "1");
  url.searchParams.set("course", `remote:${collectionId}`);
  history.replaceState(null, "", url);
  location.hash = "tracker";
}
